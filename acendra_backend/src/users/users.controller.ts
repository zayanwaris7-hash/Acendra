
import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import type { Request } from 'express';

import { UsersService } from './users.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard.js';
import type { UsersResponse } from './users.service.js';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    sub?: string;
    email?: string;
  };
}

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get all users',
    description:
      'Retrieves a paginated list of users. Requires JWT authentication. Results are cached in Redis.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 20,
    description: 'Users per page (default: 20, maximum: 100)',
  })
  @ApiOkResponse({
    description: 'Users retrieved successfully.',
    schema: {
      example: {
        data: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            name: 'John Doe',
            username: 'johndoe',
            avatarUrl: 'https://example.com/avatar.jpg',
            status: 'ACTIVE',
            createdAt: '2026-10-20T10:30:00.000Z',
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 100,
          totalPages: 5,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token.',
  })
  async getAllUsers(
    @Req() req: AuthenticatedRequest,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ): Promise<UsersResponse> {
    const userId = req.user?.id ?? req.user?.sub;

    if (!userId) {
      throw new UnauthorizedException(
        'Authenticated user ID not found.',
      );
    }

    return this.usersService.getAllUsers(
      Number(page),
      Number(limit),
      userId
    );
  }
}
 