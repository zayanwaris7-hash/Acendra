import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, Not } from 'typeorm';
import { Message, MessageType } from '../entities/chats.entity.js';
import { Conversation } from '../entities/conversation.entity.js';
import { ChatRequest } from '../entities/request.entity.js';
import { ChatRequestStatus } from '../entities/enum/chat.enum.js';


@Injectable()
export class ChatsService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,

    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,

    @InjectRepository(ChatRequest)
    private readonly chatRequestRepository: Repository<ChatRequest>,
  ) {}

  /**
   * Sort IDs so that the same two users always map
   * to the same conversation record.
   */
  private normalizeUserIds(
    firstUserId: string,
    secondUserId: string,
  ): [string, string] {
    if (firstUserId === secondUserId) {
      throw new BadRequestException(
        'You cannot start a conversation with yourself.',
      );
    }

    return [firstUserId, secondUserId].sort() as [
      string,
      string,
    ];
  }

  /**
   * Find a conversation and verify that the user belongs to it.
   */
  async getAuthorizedConversation(
    userId: string,
    otherUserId: string,
  ): Promise<Conversation> {
    const [userOneId, userTwoId] = this.normalizeUserIds(
      userId,
      otherUserId,
    );

    const conversation = await this.conversationRepository.findOne({
      where: {
        userOneId,
        userTwoId,
      },
    });

    if (!conversation) {
      throw new NotFoundException(
        'Conversation not found. The chat request may not have been accepted.',
      );
    }

    if (
      conversation.userOneId !== userId &&
      conversation.userTwoId !== userId
    ) {
      throw new ForbiddenException(
        'You are not a member of this conversation.',
      );
    }

    return conversation;
  }

  /**
   * Check that a chat request was accepted.
   *
   * A conversation should only be created after acceptance.
   * This additional check helps protect against inconsistent data.
   */
  async assertChatAccepted(
    firstUserId: string,
    secondUserId: string,
  ): Promise<void> {
    const acceptedRequest = await this.chatRequestRepository.findOne({
      where: [
        {
          senderId: firstUserId,
          receiverId: secondUserId,
          status: ChatRequestStatus.ACCEPTED,
        },
        {
          senderId: secondUserId,
          receiverId: firstUserId,
          status: ChatRequestStatus.ACCEPTED,
        },
      ],
    });

    if (!acceptedRequest) {
      throw new ForbiddenException(
        'You must have an accepted chat request before messaging.',
      );
    }
  }

  /**
   * Send a text message.
   *
   * The caller must be authenticated, and the receiver must
   * have an accepted chat relationship with the sender.
   */
  async sendTextMessage(
    senderId: string,
    receiverId: string,
    content: string,
  ): Promise<Message> {
    if (senderId === receiverId) {
      throw new BadRequestException(
        'You cannot send a message to yourself.',
      );
    }

    const trimmedContent = content?.trim();

    if (!trimmedContent) {
      throw new BadRequestException(
        'Message content cannot be empty.',
      );
    }

    if (trimmedContent.length > 5000) {
      throw new BadRequestException(
        'Message cannot exceed 5000 characters.',
      );
    }

    const conversation = await this.getAuthorizedConversation(
      senderId,
      receiverId,
    );

    await this.assertChatAccepted(senderId, receiverId);

    const message = this.messageRepository.create({
      senderId,
      receiverId,
      type: MessageType.TEXT,
      content: trimmedContent,
      attachmentUrl: null,
      attachmentName: null,
      isRead: false,
      readAt: null,
      isEdited: false,
      editedAt: null,
      deletedAt: null,
    });

    const savedMessage = await this.messageRepository.save(message);

    conversation.lastMessageAt = savedMessage.createdAt;
    await this.conversationRepository.save(conversation);

    return savedMessage;
  }

  /**
   * Fetch messages between two users.
   * Both directions are included.
   */
  async getMessages(
    userId: string,
    otherUserId: string,
    page = 1,
    limit = 30,
  ) {
    const conversation = await this.getAuthorizedConversation(
      userId,
      otherUserId,
    );

    await this.assertChatAccepted(userId, otherUserId);

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));

    const [messages, total] =
      await this.messageRepository.findAndCount({
        where: [
          {
            senderId: userId,
            receiverId: otherUserId,
            deletedAt: IsNull(),
          },
          {
            senderId: otherUserId,
            receiverId: userId,
            deletedAt: IsNull(),
          },
        ],
        order: {
          createdAt: 'DESC',
        },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      });

    return {
      conversationId: conversation.id,
      messages: messages.reverse(),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * Verify conversation membership before joining a socket room.
   */
  async assertConversationMember(
    conversationId: string,
    userId: string,
  ): Promise<Conversation> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    if (
      conversation.userOneId !== userId &&
      conversation.userTwoId !== userId
    ) {
      throw new ForbiddenException(
        'You cannot access this conversation.',
      );
    }

    return conversation;
  }

  /**
   * Mark received messages as read.
   */
  async markMessagesAsRead(
    readerId: string,
    senderId: string,
  ): Promise<{ affected: number }> {
    await this.getAuthorizedConversation(readerId, senderId);
    await this.assertChatAccepted(readerId, senderId);

    const result = await this.messageRepository.update(
      {
        senderId,
        receiverId: readerId,
        isRead: false,
        deletedAt: IsNull(),
      },
      {
        isRead: true,
        readAt: new Date(),
      },
    );

    return {
      affected: result.affected ?? 0,
    };
  }
}