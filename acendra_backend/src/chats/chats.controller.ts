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
  Post,
  Body,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { ChatsService } from './chats.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard.js';
import { ChatsRequestsService } from './chats-requests.service.js';
import { SendChatRequestDto } from './dtos/send-chat-request.dto.js';
import { RespondChatRequestDto } from './dtos/respond-request-chat.js';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    sub?: string;
    email?: string;
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
  ) { }

  @Get(':otherUserId/messages')
  @ApiOperation({ summary: 'Get messages with another user' })
  @ApiParam({ name: 'otherUserId', description: 'Other user UUID' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 30 })
  @ApiOkResponse({ description: 'Messages retrieved successfully' })
  @ApiBadRequestResponse({ description: 'Invalid user UUID or pagination' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async getMessages(
    @Req() req: AuthenticatedRequest,
    @Param('otherUserId', ParseUUIDPipe) otherUserId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '30',
  ) {
    const userId = req.user.id ?? req.user.sub;

    if (!userId) {
      throw new UnauthorizedException();
    }

    return this.chatsService.getMessages(
      userId,
      otherUserId,
      Number(page),
      Number(limit),
    );
  }

  @Patch(':otherUserId/read')
  @ApiOperation({ summary: 'Mark messages from a user as read' })
  @ApiParam({ name: 'otherUserId', description: 'Other user UUID' })
  @ApiOkResponse({ description: 'Messages marked as read' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async markAsRead(
    @Req() req: AuthenticatedRequest,
    @Param('otherUserId', ParseUUIDPipe) otherUserId: string,
  ) {
    const userId = req.user.id ?? req.user.sub;

    if (!userId) {
      throw new UnauthorizedException();
    }

    return this.chatsService.markMessagesAsRead(userId, otherUserId);
  }

  @Post('requests')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Send a chat request' })
  @ApiBody({ type: SendChatRequestDto })
  @ApiCreatedResponse({ description: 'Chat request created successfully' })
  @ApiBadRequestResponse({ description: 'Invalid request data' })
  @ApiConflictResponse({ description: 'A request or conversation already exists' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async sendChatRequest(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SendChatRequestDto,
  ) {
    console.log('Authorization header:', !!req.headers.authorization);
    console.log('Authenticated user:', req.user);

    const userId = req.user?.id ?? req.user?.sub;

    if (!userId) {
      throw new UnauthorizedException(
        'req.user is missing. Check JwtAuthGuard and JwtStrategy.',
      );
    }

    return this.chatsRequestsService.sendRequest(
      userId,
      dto.receiverId,
      dto.message,
    );
  }

  @Get('requests/incoming')
  @ApiOperation({ summary: 'Get incoming pending chat requests' })
  @ApiOkResponse({ description: 'Incoming requests retrieved successfully' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async getIncomingRequests(@Req() req: AuthenticatedRequest) {
    const userId = req.user.id ?? req.user.sub;

    if (!userId) {
      throw new UnauthorizedException();
    }

    return this.chatsRequestsService.getIncomingRequests(userId);
  }

  @Get('requests/outgoing')
  @ApiOperation({ summary: 'Get outgoing chat requests' })
  @ApiOkResponse({ description: 'Outgoing requests retrieved successfully' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async getOutgoingRequests(@Req() req: AuthenticatedRequest) {
    const userId = req.user.id ?? req.user.sub;

    if (!userId) {
      throw new UnauthorizedException();
    }

    return this.chatsRequestsService.getOutgoingRequests(userId);
  }

  @Get('requests/:requestId')
  @ApiOperation({ summary: 'Get a chat request by ID' })
  @ApiParam({ name: 'requestId', description: 'Chat request UUID' })
  @ApiOkResponse({ description: 'Chat request retrieved successfully' })
  @ApiBadRequestResponse({ description: 'Invalid request UUID' })
  @ApiNotFoundResponse({ description: 'Request not found or inaccessible' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async getChatRequest(
    @Req() req: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    const userId = req.user.id ?? req.user.sub;

    if (!userId) {
      throw new UnauthorizedException();
    }

    return this.chatsRequestsService.getRequestById(requestId, userId);
  }

  @Patch('requests/:requestId/respond')
  @ApiOperation({ summary: 'Accept or reject a chat request' })
  @ApiParam({ name: 'requestId', description: 'Chat request UUID' })
  @ApiBody({ type: RespondChatRequestDto })
  @ApiOkResponse({ description: 'Chat request response processed successfully' })
  @ApiBadRequestResponse({ description: 'Invalid UUID or status' })
  @ApiNotFoundResponse({ description: 'Chat request not found' })
  @ApiConflictResponse({ description: 'Request already processed' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async respondToChatRequest(
    @Req() req: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: RespondChatRequestDto,
  ) {
    const userId = req.user.id ?? req.user.sub;

    if (!userId) {
      throw new UnauthorizedException();
    }

    return this.chatsRequestsService.respondToRequest(
      requestId,
      userId,
      dto.status,
    );
  }
}