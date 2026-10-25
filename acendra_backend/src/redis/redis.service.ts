
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly redis: Redis;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>(
      'UPSTASH_REDIS_REST_URL',
    );

    const token = this.configService.get<string>(
      'UPSTASH_REDIS_REST_TOKEN',
    );

    if (!url || !token) {
      throw new Error(
        'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured',
      );
    }

    try {
      const parsedUrl = new URL(url);

      if (
        parsedUrl.protocol !== 'https:' ||
        !parsedUrl.hostname
      ) {
        throw new Error('Invalid Upstash Redis REST URL');
      }
    } catch {
      throw new Error(
        'UPSTASH_REDIS_REST_URL must be a valid HTTPS URL',
      );
    }

    this.redis = new Redis({
      url,
      token,
    });
  }

  /**
   * Store a value with an optional TTL in seconds.
   * TTL must be a positive integer.
   */
  async set<T>(
    key: string,
    value: T,
    ttlSeconds?: number,
  ): Promise<void> {
    this.validateKey(key);

    if (
      ttlSeconds !== undefined &&
      (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0)
    ) {
      throw new Error(
        'TTL must be a positive integer representing seconds',
      );
    }

    try {
      if (ttlSeconds !== undefined) {
        await this.redis.set(key, value, {
          ex: ttlSeconds,
        });
      } else {
        await this.redis.set(key, value);
      }
    } catch (error) {
      this.handleRedisError('SET', key, error);
    }
  }

  /**
   * Retrieve a typed value.
   * Returns null when the key does not exist.
   */
  async get<T>(key: string): Promise<T | null> {
    this.validateKey(key);

    try {
      const value = await this.redis.get<T>(key);

      return value ?? null;
    } catch (error) {
      this.handleRedisError('GET', key, error);
    }
  }

  /**
   * Delete a key.
   * Deleting a nonexistent key is safe.
   */
  async del(key: string): Promise<void> {
    this.validateKey(key);

    try {
      await this.redis.del(key);
    } catch (error) {
      this.handleRedisError('DEL', key, error);
    }
  }

  /**
   * Check whether Redis is reachable.
   * Useful for health checks and monitoring.
   */
  async ping(): Promise<boolean> {
    try {
      const response = await this.redis.ping();

      return response === 'PONG';
    } catch (error) {
      this.logger.error(
        `Redis health check failed: ${this.getErrorMessage(error)}`,
      );

      return false;
    }
  }

  /**
   * Validate keys to prevent accidental empty or invalid keys.
   */
  private validateKey(key: string): void {
    if (
      typeof key !== 'string' ||
      key.trim().length === 0 ||
      key.length > 512
    ) {
      throw new Error(
        'Redis key must be a nonempty string of at most 512 characters',
      );
    }
  }

  /**
   * Log operation context without exposing credentials or values.
   */
  private handleRedisError(
    operation: string,
    key: string,
    error: unknown,
  ): never {
    this.logger.error(
      `Redis ${operation} operation failed for key "${key}": ${this.getErrorMessage(error)}`,
    );

    throw new ServiceUnavailableException(
      'A temporary service dependency error occurred',
    );
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'Unknown Redis error';
  }

  /**
   * @upstash/redis is an HTTP-based client.
   * There is no persistent TCP connection to close here.
   */
  onModuleDestroy(): void {
    this.logger.log('RedisService module destroyed');
  }
}