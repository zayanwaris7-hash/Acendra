import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';




import { ChatsService } from './chats.service.js';

// Adjust this import to your actual Cloudinary service location.
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { Message, MessageType } from '../entities/chats.entity.js';
import { Conversation } from '../entities/conversation.entity.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
]);

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

@Injectable()
export class ChatsAttachmentsService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,

    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,

    private readonly chatsService: ChatsService,

    private readonly cloudinaryService: CloudinaryService,
  ) {}

  /**
   * Upload a document and save it as a chat message.
   */
  async uploadDocument(
    senderId: string,
    receiverId: string,
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Please select a document.',
      );
    }

    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException(
        'The uploaded file is empty.',
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        'Maximum file size is 10 MB.',
      );
    }

    const extension = extname(
      file.originalname,
    ).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new BadRequestException(
        'Only PDF, DOC, DOCX, and TXT files are allowed.',
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Unsupported document MIME type.',
      );
    }

    // Verify conversation membership and accepted chat status.
    const conversation =
      await this.chatsService.getAuthorizedConversation(
        senderId,
        receiverId,
      );

    await this.chatsService.assertChatAccepted(
      senderId,
      receiverId,
    );

    // Generate an unpredictable asset ID.
    const publicId = `${randomUUID()}${extension}`;

    const uploaded =
      await this.cloudinaryService.uploadBuffer(
        file.buffer,
        {
          folder: `chat/${conversation.id}`,
          publicId,
          resourceType: 'raw',
          originalFilename: file.originalname,
        },
      );

    try {
      const attachmentMessage =
        this.messageRepository.create({
          senderId,
          receiverId,
          type: MessageType.FILE,
          content: null,
          attachmentUrl: uploaded.secureUrl,
          attachmentName: file.originalname,
          isRead: false,
          readAt: null,
          isEdited: false,
          editedAt: null,
          deletedAt: null,
        });

      const savedMessage =
        await this.messageRepository.save(
          attachmentMessage,
        );

      conversation.lastMessageAt =
        savedMessage.createdAt;

      await this.conversationRepository.save(
        conversation,
      );

      return {
        conversationId: conversation.id,
        message: savedMessage,
      };
    } catch {
      // Clean up the uploaded asset if saving the message fails.
      try {
        await this.cloudinaryService.deleteAsset(
          uploaded.publicId,
          'raw',
        );
      } catch {
        // Log cleanup failures in production.
      }

      throw new InternalServerErrorException(
        'Document uploaded, but the chat message could not be saved.',
      );
    }
  }
}