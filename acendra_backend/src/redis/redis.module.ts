import { Module } from '@nestjs/common';
import { RedisService } from './redis.service.js';

@Module({
  providers: [RedisService]
})
export class RedisModule {}
