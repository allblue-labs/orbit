import { Injectable, Logger, Optional } from '@nestjs/common';
import { HotpathRateLimit, opaqueRateKey } from './hotpath/hotpath-rate-limit';
import { PrismaService } from '../database';
import {
  InfrastructureException,
  RateLimitException,
  ServiceUnavailableException,
} from '../exceptions';

@Injectable()
export class AuthRateLimitService {
  private readonly logger = new Logger(AuthRateLimitService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly hotpath?: HotpathRateLimit,
  ) {}

  async check(action: string, origin: string, account?: string): Promise<void> {
    const secret = process.env.AUTH_RATE_LIMIT_SECRET ?? '';
    if (secret.length < 32)
      throw new InfrastructureException(
        'AUTH_RATE_LIMIT_SECRET must be configured',
      );
    const strict = action.startsWith('public/quotes/');
    const passkeyChallenge = action === 'passkey-challenge';
    const maximum = strict
      ? 8
      : this.number('AUTH_RATE_LIMIT_MAX', 20, 100_000);
    const originMaximum = passkeyChallenge
      ? 20
      : strict
        ? 30
        : this.number('AUTH_RATE_LIMIT_ORIGIN_MAX', 120, 100_000);
    const windowMs = passkeyChallenge
      ? 60_000
      : this.number('AUTH_RATE_LIMIT_WINDOW_MS', 60_000, 3_600_000);
    const budgets = [
      { scope: ['origin', origin], maximum: originMaximum },
      ...(passkeyChallenge ? [{ scope: ['global'], maximum: 300 }] : []),
      ...(account ? [{ scope: ['account', account], maximum }] : []),
    ].map(({ scope, maximum }) => ({
      key: opaqueRateKey(secret, [action, ...scope]),
      maximum,
    }));
    if (await this.hotpath?.distributed(budgets, windowMs)) return;
    for (const { key, maximum } of budgets) {
      let result: { allowed: boolean; retryAfterSeconds: number } | undefined;
      try {
        const rows = await this.prisma.$queryRaw<
          { allowed: boolean; retryAfterSeconds: number }[]
        >`
          SELECT allowed, retry_after_seconds AS "retryAfterSeconds"
          FROM app_auth_rate_limit_consume(${key}, ${maximum}, ${windowMs})`;
        result = rows[0];
      } catch {
        this.logger.error('Auth rate-limit storage unavailable');
        throw new ServiceUnavailableException(
          'Não foi possível concluir esta ação agora. Tente novamente em instantes.',
        );
      }
      if (!result)
        throw new ServiceUnavailableException(
          'Não foi possível concluir esta ação agora.',
        );
      if (!result.allowed)
        throw new RateLimitException(result.retryAfterSeconds);
    }
  }

  private number(key: string, fallback: number, maximum: number): number {
    const value = Number(process.env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new InfrastructureException(
        `${key} must be a positive integer no greater than ${maximum}`,
      );
    return value;
  }
}
