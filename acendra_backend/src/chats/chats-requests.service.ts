import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import {
  DataSource,
  Repository,
} from 'typeorm';


import { ChatsGateway } from './chats.gateway.js';
import { ChatRequest } from '../entities/request.entity.js';
import { Conversation } from '../entities/conversation.entity.js';
import { ChatRequestStatus } from '../entities/enum/chat.enum.js';

@Injectable()
export class ChatsRequestsService {
  constructor(
    private readonly dataSource: DataSource,

    @InjectRepository(ChatRequest)
    private readonly chatRequestRepository: Repository<ChatRequest>,

    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,

    private readonly chatsGateway: ChatsGateway,
  ) {}

  /**
   * Normalize the user IDs so that a conversation between
   * two users always uses the same userOneId/userTwoId pair.
   */
  private normalizeUserIds(
    firstUserId: string,
    secondUserId: string,
  ): [string, string] {
    return [firstUserId, secondUserId].sort() as [
      string,
      string,
    ];
  }

  /**
   * Send a chat request to another user.
   */
  async sendRequest(
    senderId: string,
    receiverId: string,
    message?: string,
  ) {
    if (senderId === receiverId) {
      throw new BadRequestException(
        'You cannot send a chat request to yourself.',
      );
    }

    const normalizedMessage = message?.trim();

    if (normalizedMessage && normalizedMessage.length > 500) {
      throw new BadRequestException(
        'Request message cannot exceed 500 characters.',
      );
    }

    const [userOneId, userTwoId] = this.normalizeUserIds(
      senderId,
      receiverId,
    );

    // Prevent requests when a conversation already exists.
    const existingConversation =
      await this.conversationRepository.findOne({
        where: {
          userOneId,
          userTwoId,
        },
      });

    if (existingConversation) {
      throw new ConflictException(
        'A conversation already exists between these users.',
      );
    }

    // Prevent duplicate pending requests in either direction.
    const existingPendingRequest =
      await this.chatRequestRepository.findOne({
        where: [
          {
            senderId,
            receiverId,
            status: ChatRequestStatus.PENDING,
          },
          {
            senderId: receiverId,
            receiverId: senderId,
            status: ChatRequestStatus.PENDING,
          },
        ],
      });

    if (existingPendingRequest) {
      throw new ConflictException(
        'A pending chat request already exists between these users.',
      );
    }

    const chatRequest = this.chatRequestRepository.create({
      senderId,
      receiverId,
      message: normalizedMessage || null,
      status: ChatRequestStatus.PENDING,
      respondedAt: null,
    });

    const savedRequest =
      await this.chatRequestRepository.save(chatRequest);

    // Notify the receiver if they are connected.
    this.chatsGateway.emitChatRequest(
      receiverId,
      'chat:request:new',
      savedRequest,
    );

    return {
      message: 'Chat request sent successfully.',
      request: savedRequest,
    };
  }

  /**
   * Retrieve pending incoming requests.
   */
  async getIncomingRequests(userId: string) {
    return this.chatRequestRepository.find({
      where: {
        receiverId: userId,
        status: ChatRequestStatus.PENDING,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  /**
   * Retrieve requests sent by the authenticated user.
   */
  async getOutgoingRequests(userId: string) {
    return this.chatRequestRepository.find({
      where: {
        senderId: userId,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  /**
   * Retrieve the status of a particular request.
   */
  async getRequestById(
    requestId: string,
    userId: string,
  ) {
    const request = await this.chatRequestRepository.findOne({
      where: {
        id: requestId,
      },
    });

    if (!request) {
      throw new NotFoundException(
        'Chat request not found.',
      );
    }

    if (
      request.senderId !== userId &&
      request.receiverId !== userId
    ) {
      throw new ForbiddenException(
        'You cannot access this chat request.',
      );
    }

    return request;
  }

  /**
   * Accept or reject an incoming chat request.
   *
   * Only the receiver can respond.
   */
  async respondToRequest(
    requestId: string,
    receiverId: string,
    status: 'ACCEPTED' | 'REJECTED',
  ) {
    const result = await this.dataSource.transaction(
      async (manager) => {
        const requestRepository =
          manager.getRepository(ChatRequest);

        const conversationRepository =
          manager.getRepository(Conversation);

        // Lock the row so concurrent responses cannot both succeed.
        const request = await requestRepository
          .createQueryBuilder('request')
          .setLock('pessimistic_write')
          .where('request.id = :requestId', {
            requestId,
          })
          .getOne();

        if (!request) {
          throw new NotFoundException(
            'Chat request not found.',
          );
        }

        if (request.receiverId !== receiverId) {
          throw new ForbiddenException(
            'Only the receiver can respond to this request.',
          );
        }

        if (
          request.status !== ChatRequestStatus.PENDING
        ) {
          throw new ConflictException(
            'This chat request has already been answered.',
          );
        }

        request.status =
          status === 'ACCEPTED'
            ? ChatRequestStatus.ACCEPTED
            : ChatRequestStatus.REJECTED;

        request.respondedAt = new Date();

        const savedRequest =
          await requestRepository.save(request);

        let conversation: Conversation | null = null;

        if (status === 'ACCEPTED') {
          const [userOneId, userTwoId] =
            this.normalizeUserIds(
              request.senderId,
              request.receiverId,
            );

          conversation =
            await conversationRepository.findOne({
              where: {
                userOneId,
                userTwoId,
              },
            });

          if (!conversation) {
            conversation =
              conversationRepository.create({
                userOneId,
                userTwoId,
                lastMessageAt: null,
              });

            conversation =
              await conversationRepository.save(
                conversation,
              );
          }
        }

        return {
          request: savedRequest,
          conversation,
        };
      },
    );

    // Notify the original sender after the transaction commits.
    this.chatsGateway.emitChatRequest(
      result.request.senderId,
      'chat:request:updated',
      {
        request: result.request,
        conversation: result.conversation,
      },
    );

    return {
      message:
        status === 'ACCEPTED'
          ? 'Chat request accepted successfully.'
          : 'Chat request rejected successfully.',
      request: result.request,
      conversation: result.conversation,
    };
  }
}