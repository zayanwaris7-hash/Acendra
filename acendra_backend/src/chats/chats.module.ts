import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { ChatsController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';
import { ChatsGateway } from './chats.gateway.js';
import { Message } from '../entities/chats.entity.js';
import { Conversation } from '../entities/conversation.entity.js';
import { ChatRequest } from '../entities/request.entity.js';
import { AuthModule } from '../auth/auth.module.js';
import { ChatsRequestsService } from './chats-requests.service.js';
import { ChatsAttachmentsService } from './chats-attachments.service.js';



@Module({
  imports: [
    ConfigModule,
    AuthModule,
    TypeOrmModule.forFeature([
      Message,
      Conversation,
      ChatRequest,
    ]),

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: '15m',
        },
      }),
    }),
  ],
  controllers: [ChatsController],
  providers: [
    ChatsService,
    ChatsGateway,
    ChatsRequestsService,
    ChatsAttachmentsService,
  ],
  exports: [
    ChatsService,
    ChatsGateway,
  ],
})
export class ChatsModule {}