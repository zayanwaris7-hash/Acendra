
import {
  Injectable,
  Inject,
  Logger,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../entities/user.entity.js';
import { RedisService } from '../redis/redis.service.js';

export interface SafeUser {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: Date;
}

export interface UsersResponse {
  data: SafeUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  private readonly CACHE_VERSION_KEY = 'users:list:version';
  private readonly CACHE_TTL = 60;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    private readonly redisService: RedisService,
  ) {}

  /**
   * Get all users with pagination.
   * Redis cache is checked before querying PostgreSQL.
   */
async getAllUsers(
  page = 1,
  limit = 20,
  userId: string,
): Promise<UsersResponse> {
  // Validate pagination
  const currentPage = Math.max(
    1,
    Math.trunc(Number(page) || 1),
  );

  const pageSize = Math.min(
    100,
    Math.max(1, Math.trunc(Number(limit) || 20)),
  );

  const skip = (currentPage - 1) * pageSize;

  // Get current cache version
  let version = await this.redisService.get<number>(
    this.CACHE_VERSION_KEY,
  );

  if (version === null) {
    await this.redisService.set(this.CACHE_VERSION_KEY, 1);
    version = 1;
  }

  // Include userId to prevent cross-user cache results
  const cacheKey =
    `users:list:v${version}:user:${userId}:page:${currentPage}:limit:${pageSize}`;

  // Check Redis first
  const cachedData =
    await this.redisService.get<UsersResponse>(cacheKey);

  if (cachedData) {
    this.logger.debug(
      `Users cache HIT: user=${userId}, page=${currentPage}`,
    );

    return cachedData;
  }

  this.logger.debug(
    `Users cache MISS: user=${userId}, page=${currentPage}`,
  );

  // Fetch users excluding current user
  const [users, total] = await this.userRepository
    .createQueryBuilder('user')
    .select([
      'user.id',
      'user.name',
      'user.username',
      'user.avatarUrl',
      'user.status',
      'user.createdAt',
    ])
    .where('user.deletedAt IS NULL')
    .andWhere('user.id != :userId', { userId })
    .orderBy('user.createdAt', 'DESC')
    .skip(skip)
    .take(pageSize)
    .getManyAndCount();

  const totalPages = Math.ceil(total / pageSize);

  const response: UsersResponse = {
    data: users,
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      totalPages,
      hasNextPage: currentPage < totalPages,
      hasPreviousPage: currentPage > 1,
    },
  };

  // Save response in Redis
  await this.redisService.set(
    cacheKey,
    response,
    this.CACHE_TTL,
  );

  return response;
}

  /**
   * Invalidate all cached user-list pages.
   * Call this after creating, updating or deleting a user.
   */
  async invalidateUsersCache(): Promise<void> {
    await this.redisService.increment(
      this.CACHE_VERSION_KEY,
    );

    this.logger.log('Users list cache invalidated');
  }
}
