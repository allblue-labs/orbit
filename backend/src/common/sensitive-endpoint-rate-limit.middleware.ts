import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RateLimitException } from '../exceptions';

type Counter = { count: number; resetAt: number };

const SENSITIVE_PATH =
  /^\/(?:api\/v1\/)?(?:identity\/(?:login|register|refresh|password\/(?:forgot|reset))|portal\/auth\/(?:login|refresh|activate|password\/reset-(?:request|confirm))|billing\/(?:checkout|portal-session))$/;
const MAX_KEYS = 10_000;

/** Per-process abuse brake for public and money-moving entry points. */
@Injectable()
export class SensitiveEndpointRateLimitMiddleware implements NestMiddleware {
  private readonly counters = new Map<string, Counter>();

  use(request: Request, _response: Response, next: NextFunction): void {
    if (process.env.NODE_ENV === 'test' || !SENSITIVE_PATH.test(request.path)) {
      next();
      return;
    }

    const windowMs = this.positiveInt('AUTH_RATE_LIMIT_WINDOW_MS', 60_000);
    const maximum = this.positiveInt('AUTH_RATE_LIMIT_MAX', 20);
    const now = Date.now();
    const key = `${request.ip}:${request.method}:${request.path}`;
    let counter = this.counters.get(key);
    if (!counter || counter.resetAt <= now) {
      this.prune(now);
      counter = { count: 0, resetAt: now + windowMs };
      this.counters.set(key, counter);
    }
    counter.count += 1;
    if (counter.count > maximum) {
      throw new RateLimitException(
        Math.max(1, Math.ceil((counter.resetAt - now) / 1_000)),
      );
    }
    next();
  }

  private positiveInt(key: string, fallback: number): number {
    const value = Number(process.env[key] ?? fallback);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  private prune(now: number): void {
    for (const [key, counter] of this.counters) {
      if (counter.resetAt <= now || this.counters.size >= MAX_KEYS) {
        this.counters.delete(key);
      }
      if (this.counters.size < MAX_KEYS) break;
    }
  }
}
