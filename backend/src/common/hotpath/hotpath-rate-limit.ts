import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { RateLimitException } from '../../exceptions';
import { HotpathRedis, hotpathInteger } from './hotpath-redis';

const CONSUME_WINDOW = `
  for i, key in ipairs(KEYS) do
    local attempts = tonumber(redis.call('GET', key) or '0')
    if attempts >= tonumber(ARGV[i + 1]) then
      return math.max(1, math.ceil(redis.call('PTTL', key) / 1000))
    end
  end
  for _, key in ipairs(KEYS) do
    if redis.call('INCR', key) == 1 then redis.call('PEXPIRE', key, ARGV[1]) end
  end
  return 0
`;
const MAX_LOCAL_COUNTERS = 10_000;

export interface RateBudget {
  key: string;
  maximum: number;
}

@Injectable()
export class HotpathRateLimit {
  private readonly counters = new Map<
    string,
    { attempts: number; expiresAt: number }
  >();
  constructor(private readonly redis: HotpathRedis) {}

  async distributed(budgets: RateBudget[], windowMs: number): Promise<boolean> {
    const retry = await this.redis.command<number>([
      'EVAL',
      CONSUME_WINDOW,
      String(budgets.length),
      ...budgets.map(({ key }) => `orbit:v1:rate:${key}`),
      String(windowMs),
      ...budgets.map(({ maximum }) => String(maximum)),
    ]);
    if (retry === undefined) return false;
    if (retry > 0) throw new RateLimitException(retry);
    return true;
  }

  async authenticated(
    organizationId: string,
    actorId: string,
    actorType: 'internal' | 'portal',
  ) {
    const key = `authenticated:${organizationId}`;
    const budgets: RateBudget[] = [
      {
        key,
        maximum: hotpathInteger('REDIS_HOTPATH_TENANT_RATE_MAX', 1800, 100_000),
      },
      {
        key: `${key}:${actorType}:${actorId}`,
        maximum: hotpathInteger('REDIS_HOTPATH_USER_RATE_MAX', 240, 100_000),
      },
    ];
    const windowMs = 60_000;
    if (!(await this.distributed(budgets, windowMs)))
      this.local(budgets, windowMs);
  }

  private local(budgets: RateBudget[], windowMs: number) {
    const now = Date.now();
    for (const { key, maximum } of budgets) {
      const counter = this.counters.get(key);
      if (counter && counter.expiresAt > now && counter.attempts >= maximum)
        throw new RateLimitException(
          Math.ceil((counter.expiresAt - now) / 1_000),
        );
    }
    for (const { key } of budgets) {
      const counter = this.counters.get(key);
      if (counter && counter.expiresAt > now) {
        counter.attempts++;
        continue;
      }
      this.counters.delete(key);
      if (this.counters.size >= MAX_LOCAL_COUNTERS) {
        const oldest = this.counters.keys().next().value;
        if (oldest) this.counters.delete(oldest);
      }
      this.counters.set(key, { attempts: 1, expiresAt: now + windowMs });
    }
  }
}

export function opaqueRateKey(secret: string, fields: string[]): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify(fields))
    .digest('hex');
}
