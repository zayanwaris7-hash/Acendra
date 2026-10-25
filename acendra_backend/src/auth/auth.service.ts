import {
    ConflictException,
    Injectable,
    InternalServerErrorException,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, QueryFailedError } from 'typeorm';
import { randomInt, createHash, createHmac } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity.js';
import { RedisService } from '../redis/redis.service.js';
import { MailService } from '../mail/mail.service.js';
import { RegisterDto } from './dtos/register-user.dto.js';

import {
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'node:crypto';

import { VerifyOtpDto } from './dtos/verify-otp.dts.js';
import { ResendOtpDto } from './dtos/resend-otp.sto.js';
import { LoginDto } from './dtos/login.dto.js';
import { RefreshTokenDto } from './dtos/refresh-token.dto.js';


@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    private readonly otpTtlSeconds = 300;

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly redisService: RedisService,
        private readonly mailService: MailService,
        private readonly configService: ConfigService,
        private readonly jwtService: JwtService,
    ) { }



    
async verifyOtp(dto: VerifyOtpDto) {
  const email = dto.email.trim().toLowerCase();

  const user = await this.userRepository.findOne({
    where: { email },
  });

  if (!user) {
    throw new BadRequestException('Invalid or expired verification code.');
  }

  if (user.isEmailVerified) {
    return {
      success: true,
      message: 'Email is already verified.',
    };
  }

  const key = this.getVerificationKey(email);
  const storedHash = await this.redisService.get<string>(key);

  if (!storedHash) {
    throw new BadRequestException('Invalid or expired verification code.');
  }

  const suppliedHash = this.hashOtp(email, dto.otp);

  const valid =
    storedHash.length === suppliedHash.length &&
    timingSafeEqual(
      Buffer.from(storedHash, 'hex'),
      Buffer.from(suppliedHash, 'hex'),
    );

  if (!valid) {
    throw new BadRequestException('Invalid or expired verification code.');
  }

  user.isEmailVerified = true;
  user.emailVerifiedAt = new Date();
  user.status = 'ACTIVE';

  await this.userRepository.save(user);
  await this.redisService.del(key);

  return {
    success: true,
    message: 'Email verified successfully. You can now log in.',
  };
}

async resendOtp(dto: ResendOtpDto) {
  const email = dto.email.trim().toLowerCase();

  const user = await this.userRepository.findOne({
    where: { email },
  });

  if (!user) {
    throw new NotFoundException('Account not found.');
  }

  if (user.isEmailVerified) {
    throw new BadRequestException('Email is already verified.');
  }

  const otp = randomInt(100000, 1000000).toString();
  const key = this.getVerificationKey(email);
  const hash = this.hashOtp(email, otp);

  await this.redisService.set(key, hash, this.otpTtlSeconds);

  try {
    await this.mailService.sendVerificationOtp(
      user.email,
      user.name,
      otp,
    );
  } catch (error) {
    await this.redisService.del(key);
    throw error;
  }

  return {
    success: true,
    message: 'A new verification code has been sent.',
    data: { otpExpiresInSeconds: this.otpTtlSeconds },
  };
}

async login(dto: LoginDto) {
  const email = dto.email.trim().toLowerCase();

  const user = await this.userRepository.findOne({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      isEmailVerified: true,
      status: true,
    },
  });

  // Use a generic response to avoid revealing whether an email exists.
  if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
    throw new UnauthorizedException('Invalid email or password.');
  }

  if (!user.isEmailVerified) {
    throw new ForbiddenException('Please verify your email before logging in.');
  }

  if (user.status !== 'ACTIVE') {
    throw new ForbiddenException('This account is not active.');
  }

  return this.issueTokens(user.id, user.email);
}

private async issueTokens(userId: string, email: string) {
  const refreshSecret =
    this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');

  const accessToken = await this.jwtService.signAsync(
    { sub: userId, email },
    { expiresIn: '15m' },
  );

  const refreshToken = await this.jwtService.signAsync(
    { sub: userId, type: 'refresh' },
    { secret: refreshSecret, expiresIn: '7d' },
  );

  const refreshHash = createHash('sha256')
    .update(refreshToken)
    .digest('hex');

  await this.redisService.set(
    `auth:refresh:${userId}`,
    refreshHash,
    7 * 24 * 60 * 60,
  );

  return {
    success: true,
    message: 'Authentication successful.',
    data: {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 900,
    },
  };
}

async refreshTokens(dto: RefreshTokenDto) {
  const refreshSecret =
    this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');

  let payload: { sub: string; type?: string };

  try {
    payload = await this.jwtService.verifyAsync(dto.refreshToken, {
      secret: refreshSecret,
    });
  } catch {
    throw new UnauthorizedException('Invalid or expired refresh token.');
  }

  if (!payload.sub || payload.type !== 'refresh') {
    throw new UnauthorizedException('Invalid refresh token.');
  }

  const key = `auth:refresh:${payload.sub}`;
  const storedHash = await this.redisService.get<string>(key);

  const suppliedHash = createHash('sha256')
    .update(dto.refreshToken)
    .digest('hex');

  if (
    !storedHash ||
    storedHash.length !== suppliedHash.length ||
    !timingSafeEqual(
      Buffer.from(storedHash, 'hex'),
      Buffer.from(suppliedHash, 'hex'),
    )
  ) {
    throw new UnauthorizedException('Refresh token is invalid or revoked.');
  }

  const user = await this.userRepository.findOne({
    where: { id: payload.sub },
  });

  if (!user || !user.isEmailVerified || user.status !== 'ACTIVE') {
    throw new UnauthorizedException('Account is unavailable.');
  }

  // Rotates the refresh token: the previous token stops working.
  return this.issueTokens(user.id, user.email);
}

    async register(dto: RegisterDto) {
        const email = dto.email.trim().toLowerCase();
        const username = dto.username?.trim().toLowerCase() ?? null;

        // Check whether the email is already registered.
        const existingEmail = await this.userRepository.findOne({
            where: { email },
            select: {
                id: true,
                email: true,
                isEmailVerified: true,
                status: true,
            },
        });

        if (existingEmail) {
            throw new ConflictException(
                'An account with this email already exists.',
            );
        }

        // Check username uniqueness only if a username was supplied.
        if (username) {
            const existingUsername = await this.userRepository.findOne({
                where: { username },
                select: {
                    id: true,
                    email: true,
                }
            });

            if (existingUsername) {
                throw new ConflictException('This username is already taken.');
            }
        }

        // bcrypt cost factor 12; never store the raw password.
        const passwordHash = await bcrypt.hash(dto.password, 12);

        const user = this.userRepository.create({
            name: dto.name.trim(),
            email,
            username,
            passwordHash,
            isEmailVerified: false,
            emailVerifiedAt: null,
            status: 'PENDING_VERIFICATION',
        });

        let savedUser: User;

        try {
            savedUser = await this.userRepository.save(user);
        } catch (error: unknown) {
            // A unique constraint is still necessary because two requests
            // can pass the existence checks concurrently.
            const dbError = error as {
                code?: string;
                driverError?: { code?: string; constraint?: string };
            };

            const postgresCode =
                dbError.driverError?.code ?? dbError.code;

            if (error instanceof QueryFailedError && postgresCode === '23505') {
                throw new ConflictException(
                    'The email or username is already registered.',
                );
            }

            this.logger.error('Unable to create a new user.');

            throw new InternalServerErrorException(
                'Unable to complete registration.',
            );
        }

        // Generate a cryptographically secure six-digit OTP.
        const otp = randomInt(100000, 1000000).toString();

        // Hash the OTP with a server-side secret before storing it.
        const otpHash = this.hashOtp(email, otp);

        const redisKey = this.getVerificationKey(email);

        try {
            await this.redisService.set(
                redisKey,
                otpHash,
                this.otpTtlSeconds,
            );
        } catch {
            this.logger.error('Unable to store email verification challenge.');

            throw new ServiceUnavailableException(
                'Registration was created, but verification could not be started. Please try again later.',
            );
        }

        try {
            await this.mailService.sendVerificationOtp(
                savedUser.email,
                savedUser.name,
                otp,
            );
        } catch (error) {

            try {
                await this.redisService.del(redisKey);
            } catch {
                this.logger.warn(
                    'Unable to clean up a failed email verification challenge.',
                );
            }

            throw error;
        }

        return {
            success: true,
            message:
                'Registration successful. Check your email for the verification code.',
            data: {
                userId: savedUser.id,
                email: savedUser.email,
                isEmailVerified: savedUser.isEmailVerified,
                verificationRequired: true,
                otpExpiresInSeconds: this.otpTtlSeconds,
            },
        };
    }

    private hashOtp(email: string, otp: string): string {
        const secret =
            this.configService.getOrThrow<string>('OTP_HASH_SECRET');

        return createHmac('sha256', secret)
            .update(`${email}:${otp}`)
            .digest('hex');
    }

    private getVerificationKey(email: string): string {
        // Avoid placing the raw email address in Redis key names.
        const emailHash = createHash('sha256')
            .update(email)
            .digest('hex');

        return `auth:otp:verify-email:${emailHash}`;
    }
}