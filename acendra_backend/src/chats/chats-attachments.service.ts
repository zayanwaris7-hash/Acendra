import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import { ChatsGateway } from './chats.gateway.js';
import { ChatsService } from './chats.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';

import {
  Message,
  MessageType,
} from '../entities/chats.entity.js';

import { Conversation } from '../entities/conversation.entity.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

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
  private readonly logger = new Logger(
    ChatsAttachmentsService.name,
  );

  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,

    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,

    private readonly chatsService: ChatsService,

    private readonly cloudinaryService: CloudinaryService,

    private readonly chatsGateway: ChatsGateway,
  ) {}

  /**
   * Upload a document and save it as a chat message.
   */
  async uploadDocument(
    senderId: string,
    receiverId: string,
    file: Express.Multer.File,
  ) {
    // 1. Validate the uploaded file.
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

    // 2. Verify that the users have an authorized conversation.
    const conversation =
      await this.chatsService.getAuthorizedConversation(
        senderId,
        receiverId,
      );

    await this.chatsService.assertChatAccepted(
      senderId,
      receiverId,
    );

    // 3. Upload the document to Cloudinary.
    const publicId = randomUUID();

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
      // 4. Create the attachment message in the database.
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

      // 5. Update the conversation's latest message time.
      conversation.lastMessageAt =
        savedMessage.createdAt;

      await this.conversationRepository.save(
        conversation,
      );

      // 6. Notify both users in real time.
      // ChatsGateway.emitNewMessage should emit to:
      // user:${senderId} and user:${receiverId}.
      this.chatsGateway.emitNewMessage(
        conversation.id,
        senderId,
        receiverId,
        savedMessage,
      );

      this.logger.log(
        `Document message saved for conversation ${conversation.id}`,
      );

      // 7. Return the saved message to the HTTP caller.
      return {
        message: 'Document sent successfully.',
        conversationId: conversation.id,
        data: savedMessage,
      };
    } catch (error) {
      // Remove the uploaded asset if database persistence fails.
      try {
        await this.cloudinaryService.deleteAsset(
          uploaded.publicId,
          'raw',
        );
      } catch (cleanupError) {
        this.logger.error(
          `Failed to clean up uploaded document ${uploaded.publicId}`,
          cleanupError instanceof Error
            ? cleanupError.stack
            : undefined,
        );
      }

      // Preserve NestJS HTTP exceptions if one was thrown.
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(
        'Failed to save the document chat message.',
        error instanceof Error
          ? error.stack
          : undefined,
      );

      throw new InternalServerErrorException(
        'The document was uploaded, but the chat message could not be saved.',
      );
    }
  }
}
