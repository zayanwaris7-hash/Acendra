import {
  Injectable,
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();

    this.logger.log(
      `Authorization header present: ${Boolean(
        request.headers.authorization,
      )}`,
    );

    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      const reason = err?.message ?? info?.message ?? 'Invalid access token';

      this.logger.warn(`Authentication failed: ${reason}`);

      throw new UnauthorizedException(reason);
    }

    return user;
  }
}