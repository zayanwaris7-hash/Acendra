import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Patch,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ChatsService } from './chats.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard.js';
import { ChatsRequestsService } from './chats-requests.service.js';

// Replace this with the path to your existing JWT guard.

interface AuthenticatedRequest {
  user: {
    id: string;
    sub?: string;
  };
}

@ApiTags('Chats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
  constructor(
    private readonly chatsService: ChatsService,
    private readonly chatsRequestsService: ChatsRequestsService,
  ) {}

  @Get(':otherUserId/messages')
  @ApiOperation({
    summary: 'Get messages exchanged with another user',
  })
  async getMessages(
    @Req() req: AuthenticatedRequest,
    @Param('otherUserId', ParseUUIDPipe) otherUserId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '30',
  ) {
    const userId = req.user.id ?? req.user.sub;

    if (!userId) {
      throw new Error('Authenticated user ID is missing.');
    }

    return this.chatsService.getMessages(
      userId,
      otherUserId,
      Number(page),
      Number(limit),
    );
  }

  @Patch(':otherUserId/read')
  @ApiOperation({
    summary: 'Mark messages received from a user as read',
  })
  async markAsRead(
    @Req() req: AuthenticatedRequest,
    @Param('otherUserId', ParseUUIDPipe) otherUserId: string,
  ) {
    const userId = req.user.id ?? req.user.sub;

    if (!userId) {
      throw new Error('Authenticated user ID is missing.');
    }

    return this.chatsService.markMessagesAsRead(
      userId,
      otherUserId,
    );
  }

  @Get('requests/:requestId')
async getChatRequest(
  @Req() req: AuthenticatedRequest,
  @Param('requestId', ParseUUIDPipe) requestId: string,
) {
  const userId = req.user.id ?? req.user.sub;

  if (!userId) {
    throw new UnauthorizedException();
  }

  return this.chatsRequestsService.getRequestById(
    requestId,
    userId,
  );
}
}