
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import {
  Brackets,
  DataSource,
  Repository,
} from 'typeorm';

import { ChatsGateway } from './chats.gateway.js';
import { ChatRequest } from '../entities/request.entity.js';
import { Conversation } from '../entities/conversation.entity.js';
import { ChatRequestStatus } from '../entities/enum/chat.enum.js';

/**
 * Response type for outgoing chat requests.
 */
export interface OutgoingChatRequest {
  id: string;
  senderId: string;
  receiverId: string;
  message: string | null;
  status: ChatRequestStatus;
  respondedAt: Date | null;
  createdAt: Date;
}

export interface PaginatedOutgoingRequests {
  data: OutgoingChatRequest[];
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

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
   * Normalize user IDs so a conversation always uses
   * the same userOneId/userTwoId pair.
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

    // Notify the receiver if connected.
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
  async getIncomingRequests(
    userId: string,
    cursor?: string,
    limit = 20,
  ) {
    const pageSize = Math.min(Math.max(limit, 1), 50);

    const query = this.chatRequestRepository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.sender', 'sender')
      .select([
        'request.id',
        'request.senderId',
        'request.receiverId',
        'request.message',
        'request.status',
        'request.respondedAt',
        'request.createdAt',

        'sender.id',
        'sender.name',
        'sender.username',
        'sender.avatarUrl',
      ])
      .where('request.receiverId = :userId', { userId })
      .andWhere('request.status = :status', {
        status: ChatRequestStatus.PENDING,
      });

    if (cursor) {
      query.andWhere(
        'request.createdAt < :cursor',
        { cursor },
      );
    }

    const requests = await query
      .orderBy('request.createdAt', 'DESC')
      .addOrderBy('request.id', 'DESC')
      .take(pageSize + 1)
      .getMany();

    const hasMore = requests.length > pageSize;
    const data = requests.slice(0, pageSize);

    return {
      data,
      pagination: {
        limit: pageSize,
        hasMore,
        nextCursor: hasMore
          ? data[data.length - 1].createdAt
          : null,
      },
    };
  }

  /**
   * Retrieve requests sent by the authenticated user.
   */

async getOutgoingRequests(
  userId: string,
  cursor?: string,
  limit = 20,
): Promise<PaginatedOutgoingRequests> {
  const safeLimit = Math.min(Math.max(limit, 1), 50);

  const query = this.chatRequestRepository
    .createQueryBuilder("request")
    .leftJoinAndSelect("request.receiver", "receiver")
    .select([
      // Request fields
      "request.id",
      "request.senderId",
      "request.receiverId",
      "request.message",
      "request.status",
      "request.respondedAt",
      "request.createdAt",

      // Receiver fields
      "receiver.id",
      "receiver.name",
      "receiver.email",
      "receiver.username",
      "receiver.avatarUrl",
      "receiver.status",
    ])
    .where("request.senderId = :userId", { userId })
    .orderBy("request.createdAt", "DESC")
    .addOrderBy("request.id", "DESC")
    .take(safeLimit + 1);

  if (cursor) {
    const cursorRequest = await this.chatRequestRepository.findOne({
      where: {
        id: cursor,
        senderId: userId,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    if (!cursorRequest) {
      throw new NotFoundException("Invalid outgoing request cursor");
    }

    query.andWhere(
      new Brackets((qb) => {
        qb.where("request.createdAt < :createdAt", {
          createdAt: cursorRequest.createdAt,
        }).orWhere(
          "request.createdAt = :createdAt AND request.id < :id",
          {
            createdAt: cursorRequest.createdAt,
            id: cursorRequest.id,
          },
        );
      }),
    );
  }

  const requests = await query.getMany();

  const hasMore = requests.length > safeLimit;
  const data = requests.slice(0, safeLimit);

  return {
    data,
    pagination: {
      limit: safeLimit,
      hasMore,
      nextCursor: hasMore ? data[data.length - 1].id : null,
    },
  };
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

        // Lock the row to prevent concurrent responses.
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
              await conversationRepository.save(conversation);
          }
        }

        return {
          request: savedRequest,
          conversation,
        };
      },
    );

    // Notify the original sender after transaction commits.
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
