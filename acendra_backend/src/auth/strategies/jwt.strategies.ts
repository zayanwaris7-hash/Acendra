import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>(
        'JWT_ACCESS_SECRET',
      ),
    });

    console.log('JWT Strategy initialized');
  }

  async validate(payload: { sub: string; email?: string }) {
    if (!payload?.sub) {
      throw new Error('Invalid JWT payload: sub is missing');
    }

    return {
      id: payload.sub,
      sub: payload.sub,
      email: payload.email,
    };
  }
}