import { runsMaintenance } from '../../../runtime/process-role';
import { EmailService } from '../../email/email.service';
import { AccountNoticesService } from '../../email/account-notices.service';
import { isAccountEmailPurpose } from '../../email/account-email-policy';
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
    private readonly email: EmailService,
    private readonly notices: AccountNoticesService,
  ) {}

  onModuleInit() {
    if (
      !runsMaintenance() ||
      (process.env.ACCOUNT_EMAIL_DELIVERY_ENABLED ?? 'true').trim() === 'false'
    )
      return;
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
    let message: {
      recipient: string;
      token: string;
      data?: Record<string, unknown>;
    };
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
      if (isAccountEmailPurpose(row.purpose)) {
        const prepared = await this.notices.prepare(row, message.data ?? {});
        if (!prepared) {
          await this.outbox.finish(row, 'SKIPPED', 'NOTICE_NO_LONGER_CURRENT');
          return true;
        }
        result = await this.email.send({
          to: message.recipient,
          identityDeliveryId: row.id,
          ...prepared,
        });
      } else if (
        row.purpose === 'EMAIL_VERIFICATION' &&
        message.data?.welcome === true
      ) {
        result = await this.delivery.deliver(
          'EMAIL_VERIFICATION',
          message.recipient,
          message.token,
          row.id,
          'WELCOME',
        );
      } else {
        result = await this.delivery.deliver(
          row.purpose as IdentityTokenPurpose,
          message.recipient,
          message.token,
          row.id,
        );
      }
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
