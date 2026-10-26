import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { User } from '../entities/user.entity.js';
import { RedisModule } from '../redis/redis.module.js';
import { MailModule } from '../mail/mail.module.js';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './strategies/jwt.strategies.js';
import { JwtAuthGuard } from './guards/jwt-auth/jwt-auth.guard.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    RedisModule,
    MailModule,
    ConfigModule,

    PassportModule.register({
      defaultStrategy: 'jwt',
    }),

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
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
  ],
})
export class AuthModule {}