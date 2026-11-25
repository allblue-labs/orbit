import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createClient, type RedisArgument } from 'redis';
import { AsyncLocalStorage } from 'node:async_hooks';

const CIRCUIT_COOLDOWN_MS = 5_000;

@Injectable()
export class HotpathRedis implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HotpathRedis.name);
  private client?: Pick<
    ReturnType<typeof createClient>,
    'isOpen' | 'isReady' | 'destroy' | 'sendCommand'
  >;
  private retryAt = 0;
  private probing = false;
  private readonly budget = new AsyncLocalStorage<{ remainingMs: number }>();
  private readonly timeoutMs = hotpathInteger(
    'REDIS_HOTPATH_TIMEOUT_MS',
    150,
    1_000,
  );

  onModuleInit(): void {
    if (process.env.REDIS_HOTPATH_ENABLED !== 'true') return;
    const password = process.env.REDIS_HOTPATH_PASSWORD;
    if (!password || !/^[a-f0-9]{32,128}$/i.test(password)) {
      this.logger.warn({
        event: 'hotpath_redis_disabled',
        reason: 'invalid_password_format',
      });
      return;
    }
    const client = createClient({
      password,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 256,
      socket: {
        host: process.env.REDIS_HOTPATH_HOST || 'redis-hotpath',
        port: hotpathInteger('REDIS_HOTPATH_PORT', 6379, 65_535),
        connectTimeout: this.timeoutMs,
        reconnectStrategy: (retries) =>
          Math.min(250 * 2 ** Math.min(retries, 5), 5_000),
      },
    });
    this.client = client;
    client.on('error', () => this.trip('connection'));
    void client.connect().catch(() => this.trip('connection'));
  }

  onModuleDestroy(): void {
    if (this.client?.isOpen) this.client.destroy();
  }

  get readiness(): 'disabled' | 'ok' | 'degraded' {
    if (process.env.REDIS_HOTPATH_ENABLED !== 'true') return 'disabled';
    return this.client?.isReady && this.retryAt === 0 ? 'ok' : 'degraded';
  }

  get available(): boolean {
    return (
      this.client?.isReady === true &&
      Date.now() >= this.retryAt &&
      (this.budget.getStore()?.remainingMs ?? this.timeoutMs) >= 1
    );
  }

  withRequest<T>(next: () => T): T {
    return this.client
      ? this.budget.run({ remainingMs: this.timeoutMs }, next)
      : next();
  }

  async command<T>(args: RedisArgument[]): Promise<T | undefined> {
    const client = this.client;
    if (!client || !this.available || this.probing) return;
    const budget = this.budget.getStore();
    const timeoutMs = Math.floor(budget?.remainingMs ?? this.timeoutMs);
    const startedAt = performance.now();
    const probe = this.retryAt !== 0;
    if (probe) this.probing = true;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([
        client.sendCommand<T>(args, { abortSignal: abort.signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(new Error('Redis deadline'));
          }, timeoutMs);
        }),
      ]);
      if (probe) {
        this.retryAt = 0;
        this.logger.log({ event: 'hotpath_redis_recovered' });
      }
      return reply;
    } catch {
      this.trip(abort.signal.aborted ? 'timeout' : 'command');
    } finally {
      clearTimeout(timer);
      if (budget) budget.remainingMs -= performance.now() - startedAt;
      if (probe) this.probing = false;
    }
  }

  private trip(reason: string): void {
    const now = Date.now();
    if (!this.retryAt || this.probing) {
      this.logger.warn({
        event: 'hotpath_redis_degraded',
        reason,
        retryInMs: CIRCUIT_COOLDOWN_MS,
      });
    }
    if (this.retryAt <= now) this.retryAt = now + CIRCUIT_COOLDOWN_MS;
  }
}

export function hotpathInteger(
  key: string,
  fallback: number,
  maximum: number,
): number {
  const value = Number(process.env[key] ?? fallback);
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum
    ? value
    : fallback;
}
