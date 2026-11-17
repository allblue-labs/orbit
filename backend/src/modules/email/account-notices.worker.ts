import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AccountNoticesService } from './account-notices.service';
/** Bounded, non-marketing scan. The durable outbox deduplicates across replicas/restarts. */
@Injectable()
export class AccountNoticesWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private active: Promise<void> | null = null;
  private stopping = false;
  private cursor?: string;
  private readonly logger = new Logger(AccountNoticesWorker.name);
  constructor(private readonly notices: AccountNoticesService) {}
  onModuleInit() {
    if ((process.env.JOBS_WORKER_ENABLED ?? 'true').trim() === 'false') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
    void this.tick();
  }
  async tick() {
    if (this.stopping || this.active) return;
    this.active = (async () => {
      const deadline = Date.now() + 20000;
      for (let page = 0; page < 4 && Date.now() < deadline; page++) {
        this.cursor = await this.notices.scan(new Date(), this.cursor);
        if (!this.cursor) break;
      }
    })().catch(() =>
      this.logger.error(
        'Account email notice scan deferred; retry on next cycle',
      ),
    );
    try {
      await this.active;
    } finally {
      this.active = null;
    }
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }
}
