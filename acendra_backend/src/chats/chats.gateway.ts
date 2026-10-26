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
    origin: (
      process.env.FRONTEND_URL ?? 'http://localhost:3000'
    )
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
    this.logger.log(
      `[CONNECTING] socketId=${client.id} namespace=${client.nsp.name}`,
    );

    try {
      const token =
        client.handshake.auth?.token ??
        client.handshake.headers.authorization?.replace(
          /^Bearer\s+/i,
          '',
        );

      if (!token || typeof token !== 'string') {
        this.logger.warn(
          `[AUTH FAILED] socketId=${client.id} reason=Missing token`,
        );

        client.disconnect(true);
        return;
      }

      this.logger.debug(
        `[AUTH] Verifying JWT for socketId=${client.id}`,
      );

      const payload =
        await this.jwtService.verifyAsync<SocketUser>(
          token,
          {
            secret: this.configService.getOrThrow<string>(
              'JWT_ACCESS_SECRET',
            ),
          },
        );

      const userId = payload.sub ?? payload.id;

      if (!userId) {
        this.logger.warn(
          `[AUTH FAILED] socketId=${client.id} reason=Missing user ID in JWT`,
        );

        client.disconnect(true);
        return;
      }

      client.data.userId = userId;

      const userRoom = this.getUserRoom(userId);
      await client.join(userRoom);

      this.logger.log(
        `[AUTH SUCCESS] socketId=${client.id} userId=${userId} room=${userRoom}`,
      );
    } catch (error) {
      this.logger.error(
        `[AUTH ERROR] socketId=${client.id} ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );

      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(
      `[DISCONNECTED] socketId=${client.id} userId=${
        client.data.userId ?? 'unknown'
      }`,
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
      this.logger.warn(
        `[UNAUTHENTICATED EVENT] socketId=${client.id}`,
      );

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

    this.logger.error(
      `[EVENT ERROR] socketId=${client.id} userId=${
        client.data.userId ?? 'unknown'
      } message=${message}`,
    );

    client.emit('chat:error', { message });
  }

  /**
   * Join a conversation after checking membership and acceptance.
   */
  @SubscribeMessage('chat:join')
  async joinConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { conversationId: string },
  ) {
    this.logger.log(
      `[EVENT RECEIVED] chat:join socketId=${client.id}`,
    );

    try {
      const userId = this.getUserId(client);

      if (!payload?.conversationId) {
        throw new Error('conversationId is required.');
      }

      this.logger.debug(
        `[CHAT JOIN] userId=${userId} conversationId=${payload.conversationId}`,
      );

      const conversation =
        await this.chatsService.assertConversationMember(
          payload.conversationId,
          userId,
        );

      await this.chatsService.assertChatAccepted(
        conversation.userOneId,
        conversation.userTwoId,
      );

      const room = this.getConversationRoom(conversation.id);
      await client.join(room);

      this.logger.log(
        `[CHAT JOIN SUCCESS] userId=${userId} conversationId=${conversation.id} room=${room}`,
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
   * Save a text message and notify both users.
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
    this.logger.log(
      `[EVENT RECEIVED] chat:message:send socketId=${client.id}`,
    );

    try {
      const senderId = this.getUserId(client);

      this.logger.log(
        `[MESSAGE SENDING] senderId=${senderId} receiverId=${payload.receiverId}`,
      );

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

      this.logger.log(
        `[MESSAGE SAVED] messageId=${message.id} conversationId=${conversation.id}`,
      );

      this.server
        .to(this.getUserRoom(senderId))
        .emit('chat:message:new', eventData);

      this.logger.debug(
        `[MESSAGE EMITTED] event=chat:message:new recipient=${senderId}`,
      );

      this.server
        .to(this.getUserRoom(payload.receiverId))
        .emit('chat:message:new', eventData);

      this.logger.log(
        `[MESSAGE DELIVERED TO ROOMS] senderId=${senderId} receiverId=${payload.receiverId}`,
      );

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
   * Notify the recipient about typing status.
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
    this.logger.debug(
      `[EVENT RECEIVED] chat:typing socketId=${client.id}`,
    );

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

      const eventData = {
        conversationId: conversation.id,
        userId: senderId,
        isTyping: Boolean(payload.isTyping),
      };

      this.server
        .to(this.getUserRoom(payload.receiverId))
        .emit('chat:typing', eventData);

      this.logger.log(
        `[TYPING EMITTED] senderId=${senderId} receiverId=${payload.receiverId} isTyping=${eventData.isTyping}`,
      );

      return { success: true };
    } catch (error) {
      this.emitError(client, error);
      return { success: false };
    }
  }

  /**
   * Mark received messages as read and notify the sender.
   */
  @SubscribeMessage('chat:messages:read')
  async markRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { senderId: string },
  ) {
    this.logger.log(
      `[EVENT RECEIVED] chat:messages:read socketId=${client.id}`,
    );

    try {
      const readerId = this.getUserId(client);

      this.logger.debug(
        `[READ RECEIPT] readerId=${readerId} senderId=${payload.senderId}`,
      );

      const result = await this.chatsService.markMessagesAsRead(
        readerId,
        payload.senderId,
      );

      const eventData = {
        readerId,
        senderId: payload.senderId,
        affected: result.affected,
        readAt: new Date().toISOString(),
      };

      this.server
        .to(this.getUserRoom(payload.senderId))
        .emit('chat:messages:read', eventData);

      this.logger.log(
        `[READ RECEIPT EMITTED] readerId=${readerId} senderId=${payload.senderId} affected=${result.affected ?? 0}`,
      );

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
   * Emit a newly saved attachment message.
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

    this.logger.log(
      `[ATTACHMENT MESSAGE EMIT] conversationId=${conversationId} senderId=${senderId} receiverId=${receiverId}`,
    );

    this.server
      .to(this.getUserRoom(senderId))
      .emit('chat:message:new', eventData);

    this.server
      .to(this.getUserRoom(receiverId))
      .emit('chat:message:new', eventData);
  }

  /**
   * Emit chat-request notifications.
   */
  emitChatRequest(
    receiverId: string,
    event: 'chat:request:new' | 'chat:request:updated',
    data: unknown,
  ) {
    this.logger.log(
      `[CHAT REQUEST EMIT] event=${event} receiverId=${receiverId}`,
    );

    this.server
      .to(this.getUserRoom(receiverId))
      .emit(event, data);
  }
}
