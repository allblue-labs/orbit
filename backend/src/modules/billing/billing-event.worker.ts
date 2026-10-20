/**
 * Aciona a inbox de cobrança sem acoplar processamento ao webhook HTTP.
 *
 * A exclusão entre réplicas não mora neste timer; mora no lease atômico do
 * banco. O timer apenas garante que uma instância viva continue drenando.
 */
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { BillingReconciliationService } from './billing-reconciliation.service';

@Injectable()
export class BillingEventWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingEventWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<void> | null = null;
  private stopping = false;

  constructor(private readonly reconciliation: BillingReconciliationService) {}

  onModuleInit(): void {
    const globallyEnabled =
      (process.env.JOBS_WORKER_ENABLED ?? 'true').trim() !== 'false';
    const billingEnabled =
      (process.env.BILLING_EVENTS_WORKER_ENABLED ?? 'true').trim() !== 'false';
    if (!globallyEnabled || !billingEnabled) {
      this.logger.log('[billing-events] worker disabled');
      return;
    }

    const configured = Number(
      process.env.BILLING_EVENTS_POLL_INTERVAL_MS ?? 2_000,
    );
    const interval = Number.isFinite(configured)
      ? Math.max(500, configured)
      : 2_000;
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref?.();
    void this.tick();
    this.logger.log(`[billing-events] worker active (${interval}ms)`);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.active;
  }

  async tick(): Promise<void> {
    if (this.stopping || this.active) return;
    const work = this.reconciliation
      .drainInbox()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.logger.error(
          JSON.stringify({
            stage: 'billing-event-worker-failed',
            errorCategory:
              error instanceof Error ? error.name.slice(0, 80) : 'UNKNOWN',
          }),
        );
      });
    this.active = work;
    try {
      await work;
    } finally {
      if (this.active === work) this.active = null;
    }
  }
}
