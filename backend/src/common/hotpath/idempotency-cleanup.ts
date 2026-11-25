import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../database';
import { runsMaintenance } from '../../runtime/process-role';

@Injectable()
export class IdempotencyCleanup implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdempotencyCleanup.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (!runsMaintenance()) return;
    this.timer = setInterval(() => {
      this.running ??= this.clean()
        .catch(() =>
          this.logger.warn({ event: 'hotpath_idempotency_cleanup_failed' }),
        )
        .finally(() => {
          this.running = undefined;
        });
    }, 60_000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }

  private async clean() {
    await this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(6047, 1) AS acquired`;
      if (!lock?.acquired) return;
      await tx.$queryRaw`SELECT set_config('app.hotpath_cleanup', 'true', true)`;
      await tx.$executeRaw`
        DELETE FROM public.http_idempotency_records
        WHERE scope_hash IN (
          SELECT scope_hash FROM public.http_idempotency_records
          WHERE expires_at <= statement_timestamp()
          ORDER BY expires_at LIMIT 2000
        )`;
    });
  }
}
