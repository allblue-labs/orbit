import { runsMaintenance } from '../../runtime/process-role';
import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PublicContactRepository } from './public-contact.repository';
import { EmailService } from '../email/email.service';
import { supportContactEmail } from './support-contact.template';
@Injectable()
export class PublicContactWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private active: Promise<boolean> | null = null;
  private stopping = false;
  private prunedAt = 0;
  private readonly logger = new Logger(PublicContactWorker.name);
  constructor(
    private readonly repository: PublicContactRepository,
    private readonly email: EmailService,
  ) {}
  onModuleInit() {
    if (
      !runsMaintenance() ||
      (process.env.PUBLIC_CONTACT_DELIVERY_ENABLED ?? 'true').trim() !== 'true'
    )
      return;
    this.timer = setInterval(() => void this.tick(), 2000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.active;
  }
  async tick() {
    if (this.stopping || this.active) return false;
    this.active = this.process().catch(() => {
      this.logger.error(
        JSON.stringify({
          event: 'public_contact_delivery_failed',
          code: 'CONTACT_WORKER_ERROR',
        }),
      );
      return false;
    });
    try {
      return await this.active;
    } finally {
      this.active = null;
    }
  }
  private async process() {
    if (Date.now() - this.prunedAt > 3_600_000) {
      await this.repository.prune();
      this.prunedAt = Date.now();
    }
    const row = await this.repository.claim();
    if (!row) return false;
    if (row.attempts > 6 || row.expiresAt.getTime() <= Date.now()) {
      await this.repository.finish(row, 'FAILED');
      return true;
    }
    let content;
    try {
      content = this.repository.decrypt(row);
    } catch {
      await this.repository.finish(row, 'FAILED');
      return true;
    }
    const result = await this.email.send({
      to: content.recipient,
      replyTo: content.email,
      category: 'SUPPORT',
      contactSubmissionId: row.id,
      ...supportContactEmail(content),
    });
    const status =
      result.status === 'SENT'
        ? 'ACCEPTED'
        : result.status === 'SKIPPED'
          ? 'SKIPPED'
          : result.retryable && row.attempts < 6
            ? 'PENDING'
            : 'FAILED';
    await this.repository.finish(
      row,
      status,
      new Date(
        Date.now() + Math.min(3_600_000, 30_000 * 2 ** (row.attempts - 1)),
      ),
    );
    this.logger.log(
      JSON.stringify({
        event: 'public_contact_delivery',
        submissionId: row.id,
        status,
        attempt: row.attempts,
      }),
    );
    return true;
  }
}
