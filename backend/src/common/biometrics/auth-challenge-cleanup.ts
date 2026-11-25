import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../database';
import { runsMaintenance } from '../../runtime/process-role';

@Injectable()
export class AuthChallengeCleanup implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthChallengeCleanup.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (!runsMaintenance()) return;
    this.timer = setInterval(() => {
      this.running ??= this.clean()
        .catch(() =>
          this.logger.warn({ event: 'auth_challenge_cleanup_failed' }),
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

  private async clean(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(6047, 2) AS acquired`;
      if (!lock?.acquired) return;
      // Each call deletes at most 100 previously expired challenges.
      for (let batch = 0; batch < 8; batch++) {
        await tx.$executeRaw`SELECT public.app_identity_cleanup_challenges()`;
      }
    });
  }
}
