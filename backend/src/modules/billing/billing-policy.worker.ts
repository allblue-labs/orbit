import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { generateUuidV7 } from '../../utils';
import { runsMaintenance } from '../../runtime/process-role';
import { EmailService } from '../email/email.service';
import { brandedEmail, escapeEmailHtml } from '../email/email-layout';
import { BillingPolicyService } from './billing-policy.service';
import { BillingCommandNotAllowedException } from './billing.errors';
import { BillingReconciliationService } from './billing-reconciliation.service';
import { BillingRepository } from './billing.repository';
import { BILLING_PROVIDER, type BillingProvider } from './billing.types';

type RefundWork = {
  id: string;
  organizationId: string;
  subscriptionId: string;
  requestedBy: string | null;
  invoiceId: string;
  paymentIntentId: string;
  amountMinor: number;
  attempts: number;
  createdAt: Date;
  providerSubscriptionId: string;
  providerCustomerId: string;
};

const INTERVAL_MS = 60_000;
const SUPPORT_ADDRESS = 'suporte-orbit@allblue-labs.com';
const MAX_REFUND_RETRY_AGE_MS = 12 * 60 * 60 * 1000;

@Injectable()
export class BillingPolicyWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingPolicyWorker.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;

  constructor(
    private readonly repository: BillingRepository,
    private readonly policies: BillingPolicyService,
    private readonly email: EmailService,
    private readonly reconciliation: BillingReconciliationService,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
  ) {}

  onModuleInit() {
    if (!runsMaintenance()) return;
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
    void this.tick();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }

  tick(): Promise<void> {
    if (this.active) return this.active;
    this.active = Promise.allSettled([
      this.sendReminders(),
      this.sendSupportEmail(),
      this.processRefunds(),
    ])
      .then((outcomes) => {
        for (const [index, outcome] of outcomes.entries()) {
          if (outcome.status === 'rejected')
            this.logger.error(
              `Etapa ${['avisos de renovação', 'e-mails de suporte', 'estornos'][index]} falhou. A fila permanece disponível para nova tentativa.`,
            );
        }
      })
      .finally(() => {
        this.active = undefined;
      });
    return this.active;
  }

  // Cada janela usa uma chave independente. Reinícios e workers concorrentes
  // não repetem a notificação. Janelas passadas nunca são enviadas em bloco.
  async sendReminders(at = new Date()) {
    await this.repository.comoPlataforma(async (tx) => {
      const recipients = await tx.$queryRaw<
        {
          organizationId: string;
          userId: string;
          dedupeKey: string;
          effectiveAt: Date;
        }[]
      >`
      WITH scheduled AS (
        SELECT id, organization_id, pending_effective_at, pending_plan_code,
          CASE
            WHEN pending_effective_at - ${at}::timestamptz <= INTERVAL '24 hours' THEN 1
            WHEN pending_effective_at - ${at}::timestamptz <= INTERVAL '72 hours' THEN 3
            ELSE 7
          END AS window
        FROM organization_subscriptions
        WHERE ended_at IS NULL AND status = 'ACTIVE'
          AND billing_interval = 'MONTHLY' AND pending_billing_interval = 'MONTHLY'
          AND provider_subscription_id IS NOT NULL AND cancel_at_period_end = FALSE
          AND pending_plan_code IS NOT NULL AND pending_effective_at > ${at}
          AND pending_effective_at <= ${at}::timestamptz + INTERVAL '168 hours'
      ), recipients AS (
        SELECT s.*, m.user_id,
          concat('plan-renewal:', s.id, ':', extract(epoch FROM s.pending_effective_at), ':', s.pending_plan_code, ':', s.window, ':', m.user_id) AS dedupe_key
        FROM scheduled s
        JOIN organizations o ON o.id = s.organization_id
        JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = o.owner_user_id
          AND m.status = 'ACTIVE' AND m.deleted_at IS NULL
      )
      SELECT r.organization_id AS "organizationId", r.user_id AS "userId",
        r.dedupe_key AS "dedupeKey", r.pending_effective_at AS "effectiveAt"
      FROM recipients r JOIN organization_subscriptions s ON s.id = r.id
      WHERE s.pending_effective_at = r.pending_effective_at
        AND s.pending_plan_code = r.pending_plan_code AND s.cancel_at_period_end = FALSE
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.organization_id = r.organization_id AND n.dedupe_key = r.dedupe_key
        )
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.recipient_user_id = r.user_id AND n.organization_id = r.organization_id
            AND n.type = 'SUBSCRIPTION_DOWNGRADE_REMINDER'
            AND n.sent_at > ${at}::timestamptz - INTERVAL '24 hours'
        )
      ORDER BY r.pending_effective_at, r.id
      LIMIT 200 FOR UPDATE OF s SKIP LOCKED
      `;
      if (!recipients.length) return;
      await tx.notification.createMany({
        skipDuplicates: true,
        data: recipients.map((recipient) => ({
          id: generateUuidV7(),
          organizationId: recipient.organizationId,
          recipientUserId: recipient.userId,
          type: 'SUBSCRIPTION_DOWNGRADE_REMINDER',
          dedupeKey: recipient.dedupeKey,
          channels: ['IN_APP'],
          title: 'Seu plano muda na próxima renovação',
          body: 'Seus recursos e limites podem diminuir na renovação. Confira a data e os detalhes em Configurações, na aba Plano e assinatura.',
          status: 'SENT',
          payload: { effectiveAt: recipient.effectiveAt.toISOString() },
          sentAt: at,
        })),
      });
    });
  }

  private async sendSupportEmail() {
    const tickets = await this.repository.comoPlataforma(
      (tx) => tx.$queryRaw<
        {
          id: string;
          organizationId: string;
          kind: string;
          emailAttempts: number;
        }[]
      >`
      WITH claimed AS (
        SELECT id FROM billing_support_tickets
        WHERE email_sent_at IS NULL AND next_email_at <= now() AND email_attempts < 8
        ORDER BY next_email_at, id LIMIT 10 FOR UPDATE SKIP LOCKED
      )
      UPDATE billing_support_tickets t
      SET next_email_at = now() + INTERVAL '5 minutes', email_attempts = email_attempts + 1
      FROM claimed WHERE t.id = claimed.id
      RETURNING t.id, t.organization_id AS "organizationId", t.kind, t.email_attempts AS "emailAttempts"
    `,
    );
    const subjects: Record<string, string> = {
      PLAN_CHANGE: 'Solicitação de troca de plano',
      CANCELLATION: 'Solicitação de cancelamento',
      REFUND_REVIEW: 'Estorno precisa de acompanhamento',
    };
    await Promise.all(
      tickets.map(async (ticket) => {
        const subject = subjects[ticket.kind] ?? 'Solicitação de cobrança';
        const result = await this.email.send({
          category: 'SUPPORT',
          to: SUPPORT_ADDRESS,
          ...brandedEmail(
            `Orbit · ${subject}`,
            `${subject}\n\nChamado: ${ticket.id}\nOrganização: ${ticket.organizationId}\n\nConsulte os detalhes na administração da plataforma.`,
            `<p>Chamado <strong>${escapeEmailHtml(ticket.id)}</strong></p>
<p>Organização <strong>${escapeEmailHtml(ticket.organizationId)}</strong></p>
<p>Consulte os detalhes na administração da plataforma.</p>`,
          ),
        });
        if (result.status !== 'SENT')
          this.logger.warn(
            `Aviso do chamado ${ticket.id} pendente (tentativa ${ticket.emailAttempts}).`,
          );
        await this.repository.comoPlataforma(async (tx) => {
          await tx.billingSupportTicket.updateMany({
            where: {
              id: ticket.id,
              emailSentAt: null,
              emailAttempts: ticket.emailAttempts,
            },
            data:
              result.status === 'SENT'
                ? { emailSentAt: new Date() }
                : {
                    nextEmailAt: new Date(
                      Date.now() +
                        Math.min(2 ** ticket.emailAttempts, 60) * INTERVAL_MS,
                    ),
                  },
          });
        });
      }),
    );
  }

  private async processRefunds() {
    const refundAndCancel = this.provider.refundAndCancel?.bind(this.provider);
    if (!refundAndCancel || !this.provider.isEnabled()) return;

    const requests = await this.repository.comoPlataforma(
      (tx) => tx.$queryRaw<RefundWork[]>`
      WITH claimed AS (
        SELECT id FROM billing_refund_requests
        WHERE status = 'OPEN' AND next_attempt_at <= now()
        ORDER BY next_attempt_at, id LIMIT 5 FOR UPDATE SKIP LOCKED
      )
      UPDATE billing_refund_requests r
      SET next_attempt_at = now() + INTERVAL '5 minutes', attempts = attempts + 1
      FROM claimed, organization_subscriptions s
      WHERE r.id = claimed.id AND s.id = r.subscription_id AND s.organization_id = r.organization_id
      RETURNING r.id, r.organization_id AS "organizationId", r.subscription_id AS "subscriptionId",
        r.requested_by AS "requestedBy", r.invoice_id AS "invoiceId", r.payment_intent_id AS "paymentIntentId",
        r.amount_minor AS "amountMinor", r.attempts, r.created_at AS "createdAt",
        s.provider_subscription_id AS "providerSubscriptionId", s.provider_customer_id AS "providerCustomerId"
    `,
    );
    await Promise.all(
      requests.map(async (request) => {
        try {
          if (
            Date.now() - request.createdAt.getTime() >
              MAX_REFUND_RETRY_AGE_MS ||
            !request.providerSubscriptionId ||
            !request.providerCustomerId
          ) {
            await this.reviewRefund(request);
            return;
          }
          const result = await refundAndCancel({
            ...request,
            requestId: request.id,
          });
          if (
            !['succeeded', 'pending', 'requires_action'].includes(result.status)
          ) {
            await this.reviewRefund(request);
            return;
          }
          await this.repository.comoPlataforma((tx) =>
            tx.billingRefundRequest.updateMany({
              where: {
                id: request.id,
                status: 'OPEN',
                attempts: request.attempts,
              },
              data: { status: 'SUBMITTED', refundId: result.refundId },
            }),
          );
          await this.reconciliation.reconcileProviderSubscription(
            request.providerSubscriptionId,
            null,
          );
        } catch (error) {
          if (error instanceof BillingCommandNotAllowedException) {
            await this.reviewRefund(request);
            return;
          }
          // A chave do pedido permite repetir depois de queda entre estorno e cancelamento.
          this.logger.warn(
            `Cancelamento com estorno ${request.id} aguarda reconciliação (tentativa ${request.attempts}).`,
          );
        }
      }),
    );
  }

  private async reviewRefund(request: RefundWork) {
    await this.repository.comoPlataforma(async (tx) => {
      const updated = await tx.billingRefundRequest.updateMany({
        where: { id: request.id, status: 'OPEN', attempts: request.attempts },
        data: { status: 'REVIEW' },
      });
      if (updated.count)
        await this.policies.insertTicket(tx, {
          organizationId: request.organizationId,
          subscriptionId: request.subscriptionId,
          requestedBy: request.requestedBy ?? undefined,
          kind: 'REFUND_REVIEW',
          reference: request.invoiceId,
        });
    });
  }
}
