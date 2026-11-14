import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { EmailSendResult } from '../../email/email.types';
import { backoffFor } from '../../jobs/background-job.queue';
import {
  IDENTITY_TOKEN_DELIVERY,
  type IIdentityTokenDelivery,
  type IdentityTokenPurpose,
} from '../domain/identity.types';
import {
  IdentityEmailOutbox,
  IDENTITY_EMAIL_MAX_ATTEMPTS,
} from './identity-email.outbox';

@Injectable()
export class IdentityEmailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdentityEmailWorker.name);
  private timer?: NodeJS.Timeout;
  private running: Promise<boolean> | null = null;
  private stopping = false;
  constructor(
    private readonly outbox: IdentityEmailOutbox,
    @Inject(IDENTITY_TOKEN_DELIVERY)
    private readonly delivery: IIdentityTokenDelivery,
  ) {}

  onModuleInit() {
    if ((process.env.JOBS_WORKER_ENABLED ?? 'true').trim() === 'false') return;
    const interval = Number(process.env.JOBS_POLL_INTERVAL_MS ?? 2000);
    this.timer = setInterval(
      () => {
        void this.tick();
      },
      Number.isFinite(interval) ? Math.max(250, interval) : 2000,
    );
    this.timer.unref?.();
  }
  async onModuleDestroy() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.running;
  }
  async tick(): Promise<boolean> {
    if (this.stopping || this.running) return false;
    this.running = this.process().catch(() => {
      // Never log arbitrary ORM, crypto or SDK errors; they can contain the link.
      this.logger.error(
        JSON.stringify({
          event: 'identity_email_worker_failed',
          code: 'IDENTITY_EMAIL_WORKER_ERROR',
        }),
      );
      return false;
    });
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }
  private async process(): Promise<boolean> {
    const row = await this.outbox.claim();
    if (!row) return false;
    const log = (status: string, code?: string) =>
      this.logger.log(
        JSON.stringify({
          event: 'identity_email_delivery',
          deliveryId: row.id,
          purpose: row.purpose,
          attempt: row.attempts,
          status,
          ...(code ? { code } : {}),
        }),
      );
    if (row.attempts > IDENTITY_EMAIL_MAX_ATTEMPTS) {
      await this.outbox.finish(row, 'FAILED', 'ATTEMPTS_EXHAUSTED');
      log('FAILED', 'ATTEMPTS_EXHAUSTED');
      return true;
    }
    let message: { recipient: string; token: string };
    try {
      message = this.outbox.decrypt(row);
    } catch {
      await this.outbox.finish(row, 'FAILED', 'PAYLOAD_UNREADABLE');
      log('FAILED', 'PAYLOAD_UNREADABLE');
      return true;
    }
    if (!(await this.outbox.eligible(row, message.recipient))) {
      await this.outbox.finish(row, 'SKIPPED', 'TOKEN_NOT_CURRENT');
      log('SKIPPED', 'TOKEN_NOT_CURRENT');
      return true;
    }
    let result: EmailSendResult;
    try {
      result = await this.delivery.deliver(
        row.purpose as IdentityTokenPurpose,
        message.recipient,
        message.token,
      );
    } catch {
      result = {
        status: 'FAILED',
        provider: 'ses',
        code: 'EMAIL_TRANSPORT_ERROR',
        retryable: true,
      };
    }
    if (result.status === 'SENT') {
      await this.outbox.finish(
        row,
        'ACCEPTED_BY_PROVIDER',
        null,
        result.providerMessageId,
      );
      log('ACCEPTED_BY_PROVIDER');
    } else if (result.status === 'SKIPPED') {
      await this.outbox.finish(row, 'SKIPPED', 'TRANSPORT_DISABLED');
      log('SKIPPED', 'TRANSPORT_DISABLED');
    } else {
      const code = /^[A-Z0-9_]{1,80}$/.test(result.code)
        ? result.code
        : 'EMAIL_TRANSPORT_ERROR';
      const retry =
        result.retryable && row.attempts < IDENTITY_EMAIL_MAX_ATTEMPTS;
      await this.outbox.finish(
        row,
        retry ? 'PENDING' : 'FAILED',
        code,
        undefined,
        retry ? new Date(Date.now() + backoffFor(row.attempts)) : undefined,
      );
      log(retry ? 'PENDING' : 'FAILED', code);
    }
    return true;
  }
}
