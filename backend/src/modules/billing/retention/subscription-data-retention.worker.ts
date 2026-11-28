import { runsMaintenance } from '../../../runtime/process-role';
import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { SubscriptionDataRetentionService } from './subscription-data-retention.service';
@Injectable()
export class SubscriptionDataRetentionWorker
  implements OnModuleInit, OnModuleDestroy
{
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<void> | null = null;
  private stopping = false;
  private readonly logger = new Logger(SubscriptionDataRetentionWorker.name);
  constructor(private readonly retention: SubscriptionDataRetentionService) {}
  onModuleInit() {
    if (
      !runsMaintenance() ||
      process.env.SUBSCRIPTION_DATA_RETENTION_ENABLED?.trim() !== 'true'
    )
      return;
    this.timer = setInterval(() => void this.tick(), 5 * 60_000);
    this.timer.unref();
    void this.tick();
  }
  async tick(): Promise<void> {
    if (this.stopping || this.active) return;
    this.active = this.retention
      .run()
      .catch(() =>
        this.logger.error('Retention cycle failed; it will be retried'),
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
