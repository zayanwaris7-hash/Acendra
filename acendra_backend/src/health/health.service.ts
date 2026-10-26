import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  @Cron('*/10 * * * *')
  checkServer() {
    this.logger.log('Scheduled health check executed');
  }
}