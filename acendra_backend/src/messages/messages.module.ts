import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from '../entities/chats.entity.js';

@Module({
  imports:[TypeOrmModule.forFeature([Message])],
  controllers: [MessagesController],
  providers: [MessagesService]
})
export class MessagesModule {}
