import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BillingRepository } from './billing.repository';
import { BillingReconciliationService } from './billing-reconciliation.service';
import {
  BILLING_PROVIDER,
  type BillingProvider,
  type ProviderEvent,
} from './billing.types';
import { BillingWorkBudget } from './billing-work-budget';

interface Cursor {
  from?: string;
  through?: string;
  highWater?: string;
  after?: string;
}
export interface RecoveryClaim {
  key: string;
  token: string;
  cursor: Cursor;
  attempts: number;
  stream: 'EVENTS' | 'SUBSCRIPTIONS';
}
function bounded(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(process.env[name]?.trim() || fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${name}`);
  return value;
}

/** Read-only Stripe discovery. Durable effects always go through the same inbox. */
@Injectable()
export class BillingRecoveryService {
  private readonly logger = new Logger(BillingRecoveryService.name);
  readonly settings = Object.freeze({
    enabled: (process.env.BILLING_RECOVERY_ENABLED ?? 'false') === 'true',
    pollMs: bounded('BILLING_RECOVERY_POLL_MS', 10_000, 1_000, 300_000),
    cycleMs: bounded('BILLING_RECOVERY_CYCLE_MS', 300_000, 10_000, 86_400_000),
    batch: bounded('BILLING_RECOVERY_BATCH', 25, 1, 25),
    windowDays: bounded('BILLING_RECOVERY_WINDOW_DAYS', 7, 1, 29),
    durationMs: bounded('BILLING_RECOVERY_DURATION_MS', 30_000, 1_000, 60_000),
    apiCalls: bounded('BILLING_RECOVERY_API_CALLS', 4, 1, 20),
  });
  constructor(
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    private readonly repository: BillingRepository,
    private readonly reconciliation: BillingReconciliationService,
  ) {}

  async claim(stream: RecoveryClaim['stream']): Promise<RecoveryClaim | null> {
    const mode = this.provider.mode;
    const key = `STRIPE:${mode}:${stream}`;
    const token = randomUUID();
    return this.repository.comoPlataforma(async (tx) => {
      await tx.$executeRaw`UPDATE billing_recovery_checkpoints SET status='DEAD_LETTER', token=NULL,
        lease_until=NULL,last_error_code='RETRY_EXHAUSTED' WHERE key=${key} AND attempts>=8 AND lease_until<=now()`;
      await tx.$executeRaw`INSERT INTO billing_recovery_checkpoints(key,mode,stream)
        VALUES(${key},${mode},${stream}) ON CONFLICT DO NOTHING`;
      const rows = await tx.$queryRaw<RecoveryClaim[]>`
        WITH candidate AS (SELECT key FROM billing_recovery_checkpoints
          WHERE key=${key} AND status<>'DEAD_LETTER' AND next_run_at<=now()
          AND (lease_until IS NULL OR lease_until<=now()) FOR UPDATE SKIP LOCKED)
        UPDATE billing_recovery_checkpoints c SET token=${token}::uuid,
          lease_until=now()+interval '2 minutes', status='RUNNING', attempts=attempts+1, updated_at=now()
        FROM candidate WHERE c.key=candidate.key RETURNING c.key,c.token,c.cursor,c.attempts,c.stream`;
      return rows[0] ?? null;
    });
  }

  /** Cursor and all inbox inserts commit together, fenced by the current lease. */
  async checkpoint(
    claim: RecoveryClaim,
    events: readonly ProviderEvent[],
    cursor: Cursor,
    done: boolean,
    durationMs: number,
  ): Promise<void> {
    await this.repository.comoPlataforma(async (tx) => {
      const locked = await tx.$queryRaw<
        { key: string }[]
      >`SELECT key FROM billing_recovery_checkpoints
        WHERE key=${claim.key} AND token=${claim.token}::uuid AND lease_until>clock_timestamp() FOR UPDATE`;
      if (!locked.length) throw new Error('BILLING_RECOVERY_LEASE_LOST');
      let inserted = 0;
      for (const event of events) {
        if (event.mode !== this.provider.mode)
          throw new Error('BILLING_MODE_MISMATCH');
        inserted += await tx.$executeRaw`INSERT INTO billing_webhook_events
          (id,provider,mode,source,provider_event_id,event_type,provider_object_id,provider_subscription_id,
           api_version,provider_created_at,received_at,processing_status,attempts,created_at,updated_at)
          VALUES (${randomUUID()}::uuid,'STRIPE',${this.provider.mode},'RECOVERY',${event.providerEventId},
          ${event.type},${event.objectId},${event.subscriptionId},${event.apiVersion},${event.createdAt},now(),'PENDING',0,now(),now())
          ON CONFLICT(provider,provider_event_id) DO NOTHING`;
      }
      await tx.$executeRaw`UPDATE billing_recovery_checkpoints SET cursor=${JSON.stringify(cursor)}::jsonb,
        token=NULL,lease_until=NULL,status='READY',attempts=0,last_error_code=NULL,
        next_run_at=now()+(${done ? this.settings.cycleMs : 0} * interval '1 millisecond'),
        last_completed_at=CASE WHEN ${done} THEN now() ELSE last_completed_at END,
        stats=jsonb_build_object('durationMs',${durationMs}::int,'examined',${events.length}::int,
         'enqueued',${inserted}::int,'duplicates',${events.length - inserted}::int,'partial',${!done}::boolean), updated_at=now()
        WHERE key=${claim.key} AND token=${claim.token}::uuid`;
    });
  }

  async fail(claim: RecoveryClaim, error: unknown): Promise<void> {
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/.test(error.message)
        ? error.message
        : 'PROVIDER_OR_STORAGE_ERROR';
    await this.repository.comoPlataforma(
      (tx) => tx.$executeRaw`UPDATE billing_recovery_checkpoints
      SET token=NULL,lease_until=NULL,status=${claim.attempts >= 8 ? 'DEAD_LETTER' : 'READY'},last_error_code=${code},
      next_run_at=now()+(${Math.min(3_600_000, 5000 * 2 ** (claim.attempts - 1))} * interval '1 millisecond'), updated_at=now()
      WHERE key=${claim.key} AND token=${claim.token}::uuid AND lease_until>clock_timestamp()`,
    );
    this.logger.warn(
      JSON.stringify({
        stage: 'billing-recovery-error',
        stream: claim.stream,
        code,
        attempt: claim.attempts,
      }),
    );
  }

  async run(): Promise<void> {
    if (!this.settings.enabled || !this.provider.isEnabled()) return;
    await BillingWorkBudget.run(
      this.settings.apiCalls,
      this.settings.durationMs,
      async () => {
        const started = Date.now();
        let worked = false;
        for (const stream of ['EVENTS', 'SUBSCRIPTIONS'] as const) {
          if (Date.now() - started >= this.settings.durationMs) break;
          const claim = await this.claim(stream);
          if (!claim) continue;
          worked = true;
          try {
            const now = new Date();
            const earliest = new Date(
              now.getTime() - this.settings.windowDays * 86_400_000,
            );
            const cursor: Cursor = { ...claim.cursor };
            if (stream === 'EVENTS') {
              if (!this.provider.listRecoveryEvents)
                throw new Error('BILLING_RECOVERY_UNSUPPORTED');
              // Never silently skip a gap beyond provider retention or the approved window.
              if (
                cursor.from &&
                new Date(cursor.from) < earliest &&
                now.getTime() - new Date(cursor.from).getTime() >
                  29 * 86_400_000
              )
                throw new Error('BILLING_HISTORY_WINDOW_EXPIRED');
              if (!cursor.from) {
                if (cursor.highWater && new Date(cursor.highWater) < earliest)
                  throw new Error('BILLING_HISTORY_WINDOW_EXPIRED');
                cursor.from = cursor.highWater
                  ? new Date(
                      new Date(cursor.highWater).getTime() - 60_000,
                    ).toISOString()
                  : earliest.toISOString();
                cursor.through = new Date(now.getTime() - 5_000).toISOString();
              }
              const page = await this.provider.listRecoveryEvents({
                from: new Date(cursor.from),
                through: new Date(cursor.through!),
                after: cursor.after,
                limit: this.settings.batch,
              });
              if (
                page.hasMore &&
                (!page.events.length ||
                  page.events.at(-1)?.providerEventId === cursor.after)
              )
                throw new Error('BILLING_INVALID_PROVIDER_PAGE');
              const next: Cursor = page.hasMore
                ? { ...cursor, after: page.events.at(-1)!.providerEventId }
                : { highWater: cursor.through };
              await this.checkpoint(
                claim,
                page.events,
                next,
                !page.hasMore,
                Date.now() - started,
              );
            } else {
              cursor.through ??= now.toISOString();
              const rows =
                await this.reconciliation.reconcileLinkedSubscriptions(
                  this.settings.batch,
                  cursor.after,
                );
              const events: ProviderEvent[] = rows.map((row) => ({
                mode: this.provider.mode,
                providerEventId: `orbit:${this.provider.mode}:${cursor.through}:${row.id}`,
                type: 'orbit.subscription.recovery',
                objectId: row.providerSubscriptionId,
                subscriptionId: row.providerSubscriptionId,
                apiVersion: null,
                createdAt: now,
              }));
              const done = rows.length < this.settings.batch;
              await this.checkpoint(
                claim,
                events,
                done ? {} : { ...cursor, after: rows.at(-1)!.id },
                done,
                Date.now() - started,
              );
            }
          } catch (error) {
            await this.fail(claim, error);
          }
        }
        if (worked)
          this.logger.log(
            JSON.stringify({
              stage: 'billing-recovery-status',
              ...(await this.diagnostics()),
            }),
          );
      },
    );
  }

  /** Internal operational diagnostic; deliberately no public/tenant HTTP endpoint. */
  async diagnostics() {
    return this.repository.comoPlataforma(async (tx) => {
      const checkpoints =
        await tx.$queryRaw`SELECT stream,status,attempts,last_error_code,last_completed_at,stats,
        extract(epoch from (now()-updated_at))::int AS age_seconds FROM billing_recovery_checkpoints WHERE mode=${this.provider.mode}`;
      const backlog =
        await tx.$queryRaw`SELECT processing_status,count(*)::int AS count,
        max(attempts)::int AS max_attempts, extract(epoch from (now()-min(received_at)))::int AS oldest_seconds
        FROM billing_webhook_events WHERE mode=${this.provider.mode} AND processing_status IN ('PENDING','PROCESSING','DEAD_LETTER') GROUP BY processing_status`;
      const outcomes =
        await tx.$queryRaw`SELECT event_type,reconciliation_outcome,
        count(*)::int AS count,max(processed_at) AS last_completed_at FROM billing_webhook_events
        WHERE mode=${this.provider.mode} AND source='RECOVERY' AND processing_status='PROCESSED' AND processed_at>=now()-interval '24 hours'
        GROUP BY event_type,reconciliation_outcome`;
      const errors =
        await tx.$queryRaw`SELECT last_error_code,count(*)::int AS count FROM billing_webhook_events
        WHERE mode=${this.provider.mode} AND last_error_code IS NOT NULL AND processing_status IN ('PENDING','PROCESSING','DEAD_LETTER') GROUP BY last_error_code`;
      const unclassified =
        await tx.$queryRaw`SELECT count(*)::int AS count FROM billing_webhook_events
        WHERE mode IS NULL AND processing_status IN ('PENDING','PROCESSING','DEAD_LETTER')`;
      return {
        unclassified,
        mode: this.provider.mode,
        config: this.settings,
        checkpoints,
        backlog,
        outcomes,
        errors,
      };
    });
  }
}

@Injectable()
export class BillingRecoveryWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<void> | null = null;
  private stopping = false;
  private readonly logger = new Logger(BillingRecoveryWorker.name);
  constructor(private readonly recovery: BillingRecoveryService) {}
  onModuleInit(): void {
    const enabled =
      (process.env.JOBS_WORKER_ENABLED ?? 'true') !== 'false' &&
      this.recovery.settings.enabled;
    this.logger.log(
      JSON.stringify({
        stage: 'billing-recovery-worker',
        enabled,
        settings: this.recovery.settings,
      }),
    );
    if (!enabled) return;
    this.timer = setInterval(
      () => void this.tick(),
      this.recovery.settings.pollMs,
    );
    this.timer.unref?.();
    void this.tick();
  }
  async tick(): Promise<void> {
    if (this.stopping || this.active) return;
    const work = this.recovery.run().catch(() => {
      this.logger.error('billing-recovery-worker-failed');
    });
    this.active = work;
    try {
      await work;
    } finally {
      this.active = null;
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }
}
