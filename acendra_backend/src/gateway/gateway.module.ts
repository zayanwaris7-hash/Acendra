import { Module } from '@nestjs/common';
import { ChatGateway } from './chat/chat.gateway.js';

@Module({
  providers: [ChatGateway]
})
export class GatewayModule {}
