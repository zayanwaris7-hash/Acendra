import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import {
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { Server, Socket } from 'socket.io';

import { ChatsService } from './chats.service.js';
import { SendMessageDto } from './dtos/send-message.dto.js';

interface SocketUser {
  sub?: string;
  id?: string;
}

interface AuthenticatedSocket extends Socket {
  data: {
    userId?: string;
  };
}

@WebSocketGateway({
  namespace: '/chats',
  cors: {
    origin: (process.env.FRONTEND_URL ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
  },
})
export class ChatsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly chatsService: ChatsService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        client.handshake.auth?.token ??
        client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');

      if (!token || typeof token !== 'string') {
        client.disconnect(true);
        return;
      }

      const payload = await this.jwtService.verifyAsync<SocketUser>(
        token,
        {
          secret: this.configService.getOrThrow<string>(
            'JWT_ACCESS_SECRET',
          ),
        },
      );

      const userId = payload.sub ?? payload.id;

      if (!userId) {
        client.disconnect(true);
        return;
      }

      client.data.userId = userId;

      // Each user gets a private room for notifications.
      await client.join(this.getUserRoom(userId));

      this.logger.log(`Authenticated socket for user ${userId}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.debug(
      `Socket disconnected for user ${client.data.userId ?? 'unknown'}`,
    );
  }

  private getUserRoom(userId: string) {
    return `user:${userId}`;
  }

  private getConversationRoom(conversationId: string) {
    return `conversation:${conversationId}`;
  }

  private getUserId(client: AuthenticatedSocket): string {
    const userId = client.data.userId;

    if (!userId) {
      throw new Error('Socket is not authenticated.');
    }

    return userId;
  }

  private emitError(
    client: AuthenticatedSocket,
    error: unknown,
  ) {
    const message =
      error instanceof Error
        ? error.message
        : 'An unexpected chat error occurred.';

    client.emit('chat:error', { message });
  }

  /**
   * Join a conversation only after checking membership.
   */
  @SubscribeMessage('chat:join')
  async joinConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { conversationId: string },
  ) {
    try {
      const userId = this.getUserId(client);

      if (!payload?.conversationId) {
        throw new Error('conversationId is required.');
      }

      const conversation =
        await this.chatsService.assertConversationMember(
          payload.conversationId,
          userId,
        );

      await this.chatsService.assertChatAccepted(
        conversation.userOneId,
        conversation.userTwoId,
      );

      await client.join(
        this.getConversationRoom(conversation.id),
      );

      return {
        event: 'chat:joined',
        data: {
          conversationId: conversation.id,
        },
      };
    } catch (error) {
      this.emitError(client, error);

      return {
        event: 'chat:join:failed',
        data: {
          message:
            error instanceof Error
              ? error.message
              : 'Could not join conversation.',
        },
      };
    }
  }

  /**
   * Receive and persist a text message, then broadcast it.
   */
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @SubscribeMessage('chat:message:send')
  async sendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: SendMessageDto,
  ) {
    try {
      const senderId = this.getUserId(client);

      const message = await this.chatsService.sendTextMessage(
        senderId,
        payload.receiverId,
        payload.content,
      );

      const conversation =
        await this.chatsService.getAuthorizedConversation(
          senderId,
          payload.receiverId,
        );

      const eventData = {
        conversationId: conversation.id,
        message,
      };

      // Deliver to all active connections belonging to both users.
      this.server
        .to(this.getUserRoom(senderId))
        .emit('chat:message:new', eventData);

      this.server
        .to(this.getUserRoom(payload.receiverId))
        .emit('chat:message:new', eventData);

      return {
        event: 'chat:message:sent',
        data: eventData,
      };
    } catch (error) {
      this.emitError(client, error);

      return {
        event: 'chat:message:failed',
        data: {
          message:
            error instanceof Error
              ? error.message
              : 'Message could not be sent.',
        },
      };
    }
  }

  /**
   * Notify the other user when someone starts or stops typing.
   */
  @SubscribeMessage('chat:typing')
  async typing(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    payload: {
      receiverId: string;
      isTyping: boolean;
    },
  ) {
    try {
      const senderId = this.getUserId(client);

      const conversation =
        await this.chatsService.getAuthorizedConversation(
          senderId,
          payload.receiverId,
        );

      await this.chatsService.assertChatAccepted(
        senderId,
        payload.receiverId,
      );

      this.server
        .to(this.getUserRoom(payload.receiverId))
        .emit('chat:typing', {
          conversationId: conversation.id,
          userId: senderId,
          isTyping: Boolean(payload.isTyping),
        });

      return { success: true };
    } catch (error) {
      this.emitError(client, error);
      return { success: false };
    }
  }

  /**
   * Mark messages from the other user as read and notify them.
   */
  @SubscribeMessage('chat:messages:read')
  async markRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { senderId: string },
  ) {
    try {
      const readerId = this.getUserId(client);

      const result = await this.chatsService.markMessagesAsRead(
        readerId,
        payload.senderId,
      );

      this.server
        .to(this.getUserRoom(payload.senderId))
        .emit('chat:messages:read', {
          readerId,
          senderId: payload.senderId,
          affected: result.affected,
          readAt: new Date().toISOString(),
        });

      return {
        success: true,
        affected: result.affected,
      };
    } catch (error) {
      this.emitError(client, error);
      return { success: false };
    }
  }

  /**
   * Called by REST controllers after they save an attachment message.
   */
  emitNewMessage(
    conversationId: string,
    senderId: string,
    receiverId: string,
    message: unknown,
  ) {
    const eventData = {
      conversationId,
      message,
    };

    this.server
      .to(this.getUserRoom(senderId))
      .emit('chat:message:new', eventData);

    this.server
      .to(this.getUserRoom(receiverId))
      .emit('chat:message:new', eventData);
  }

  /**
   * Notify users about chat-request changes.
   */
  emitChatRequest(
    receiverId: string,
    event: 'chat:request:new' | 'chat:request:updated',
    data: unknown,
  ) {
    this.server
      .to(this.getUserRoom(receiverId))
      .emit(event, data);
  }
}