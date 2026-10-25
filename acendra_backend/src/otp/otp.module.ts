import { Module } from '@nestjs/common';
import { OtpService } from './otp.service.js';

@Module({
  providers: [OtpService]
})
export class OtpModule {}
