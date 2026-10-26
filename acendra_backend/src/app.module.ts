import {
  Module,
  OnApplicationBootstrap,
  Logger,
} from '@nestjs/common';

import {
  ConfigModule,
  ConfigService,
} from '@nestjs/config';

import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import typeormConfig from './config/typeorm.config.js';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ChatsModule } from './chats/chats.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { GatewayModule } from './gateway/gateway.module.js';
import { OtpModule } from './otp/otp.module.js';
import { RedisModule } from './redis/redis.module.js';
import { MailModule } from './mail/mail.module.js';
import { CloudinaryModule } from './cloudinary/cloudinary.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [typeormConfig],
    }),

    // Enable NestJS cron jobs
    ScheduleModule.forRoot(),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = configService.get('typeorm');

        if (!config?.url) {
          throw new Error('DATABASE_URL is missing');
        }

        return config;
      },
    }),

    AuthModule,
    UsersModule,
    ChatsModule,
    MessagesModule,
    GatewayModule,
    OtpModule,
    RedisModule,
    MailModule,
    CloudinaryModule,
    HealthModule,
  ],

  controllers: [AppController],

  providers: [AppService],
})
export class AppModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppModule.name);

  constructor(private readonly dataSource: DataSource) {}

  onApplicationBootstrap() {
    if (this.dataSource.isInitialized) {
      this.logger.log(
        'Neon PostgreSQL connected successfully!',
      );

      this.logger.log(
        `Database: ${this.dataSource.options.type}`,
      );

      this.logger.log(
        `Schema synchronization: ${
          this.dataSource.options.synchronize ?? false
        }`,
      );
    } else {
      this.logger.error(
        'Database connection is not initialized.',
      );
    }
  }
}
