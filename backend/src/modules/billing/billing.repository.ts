/**
 * O acesso ao banco da cobrança.
 *
 * Duas fronteiras diferentes convivem aqui. `billing_customers` é dado de
 * inquilino e passa pela RLS normal. A caixa de entrada de eventos é
 * infraestrutura da plataforma — o evento chega antes de sabermos de quem ele
 * é — e por isso é lida e escrita declarando contexto de plataforma, na
 * transação daquela operação.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { generateUuidV7 } from '../../utils';
import type {
  BillingMode,
  BillingProviderName,
  ProviderFinancialAdjustment,
  ProviderInvoice,
} from './billing.types';

export interface BillingCustomerRow {
  id: string;
  organizationId: string;
  provider: string;
  mode: string;
  providerCustomerId: string;
}

export interface BillingCheckoutAttemptRow {
  id: string;
  organizationId: string;
  subscriptionId: string;
  billingCustomerId: string;
  provider: string;
  mode: string;
  planCode: string;
  billingInterval: string;
  status: string;
  idempotencyKey: string;
  providerSessionId: string | null;
  providerSubscriptionId: string | null;
  expiresAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClaimedBillingEvent {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  providerObjectId: string | null;
  providerSubscriptionId: string | null;
  apiVersion: string | null;
  providerCreatedAt: Date;
  receivedAt: Date;
  processingStatus: string;
  attempts: number;
  processingToken: string;
}

export interface BillingInvoiceRow {
  id: string;
  organizationId: string;
  subscriptionId: string;
  invoiceNumber: string | null;
  status: string;
  currency: string;
  totalMinor: number;
  amountPaidMinor: number;
  amountRemainingMinor: number;
  creditNotesMinor: number;
  attemptCount: number;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date | null;
  nextPaymentAttemptAt: Date | null;
  paidAt: Date | null;
  providerCreatedAt: Date;
  adjustments: BillingFinancialAdjustmentRow[];
}

export interface BillingFinancialAdjustmentRow {
  id: string;
  type: string;
  status: string;
  amountMinor: number;
  currency: string;
  reason: string | null;
  occurredAt: Date;
}

@Injectable()
export class BillingRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsTransaction,
  ) {}

  /** O nome comercial da organização, para o cliente do provedor. */
  async organizationName(organizationId: string): Promise<string> {
    const organizacao = await this.rls.run((tx) =>
      tx.organization.findUnique({
        where: { id: organizationId },
        select: { displayName: true },
      }),
    );
    return organizacao?.displayName ?? organizationId;
  }

  findCustomer(
    organizationId: string,
    provider: BillingProviderName,
    mode: BillingMode,
  ): Promise<BillingCustomerRow | null> {
    return this.rls.run((tx) =>
      tx.billingCustomer.findFirst({
        where: { organizationId, provider, mode },
      }),
    );
  }

  /**
   * Grava o vínculo, ou devolve o que já existia.
   *
   * O índice único é quem decide: duas requisições concorrentes criando o
   * cliente resultam num vínculo canônico só, e a segunda encontra o primeiro
   * em vez de gravar um paralelo.
   */
  async linkCustomer(input: {
    organizationId: string;
    provider: BillingProviderName;
    mode: BillingMode;
    providerCustomerId: string;
  }): Promise<BillingCustomerRow> {
    return this.rls.run(async (tx) => {
      try {
        return await tx.billingCustomer.create({
          data: { id: generateUuidV7(), ...input },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return tx.billingCustomer.findFirstOrThrow({
            where: {
              organizationId: input.organizationId,
              provider: input.provider,
              mode: input.mode,
            },
          });
        }
        throw error;
      }
    });
  }

  /**
   * Cria a intenção antes da chamada de rede.
   *
   * O índice parcial garante uma única tentativa ativa por organização. A
   * leitura após P2002 transforma concorrência em replay da mesma intenção.
   */
  async beginCheckoutAttempt(input: {
    id: string;
    organizationId: string;
    subscriptionId: string;
    billingCustomerId: string;
    provider: BillingProviderName;
    mode: BillingMode;
    planCode: string;
    billingInterval: string;
    idempotencyKey: string;
  }): Promise<{ attempt: BillingCheckoutAttemptRow; created: boolean }> {
    return this.rls.run(async (tx) => {
      try {
        const attempt = await tx.billingCheckoutAttempt.create({
          data: { ...input, status: 'CREATING' },
        });
        return { attempt, created: true };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const attempt = await tx.billingCheckoutAttempt.findFirst({
            where: {
              organizationId: input.organizationId,
              provider: input.provider,
              mode: input.mode,
              status: { in: ['CREATING', 'OPEN'] },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (attempt) return { attempt, created: false };
        }
        throw error;
      }
    });
  }

  async openCheckoutAttempt(input: {
    id: string;
    providerSessionId: string;
    expiresAt: Date | null;
  }): Promise<void> {
    await this.rls.run(async (tx) => {
      const { count } = await tx.billingCheckoutAttempt.updateMany({
        where: { id: input.id, status: { in: ['CREATING', 'OPEN'] } },
        data: {
          status: 'OPEN',
          providerSessionId: input.providerSessionId,
          expiresAt: input.expiresAt,
        },
      });
      if (count === 0) {
        const current = await tx.billingCheckoutAttempt.findUnique({
          where: { id: input.id },
        });
        if (
          current?.status !== 'COMPLETED' ||
          current.providerSessionId !== input.providerSessionId
        ) {
          throw new Error('Checkout attempt is no longer active');
        }
      }
    });
  }

  async expireCheckoutAttempt(id: string): Promise<void> {
    await this.rls.run((tx) =>
      tx.billingCheckoutAttempt.updateMany({
        where: { id, status: { in: ['CREATING', 'OPEN'] } },
        data: { status: 'EXPIRED' },
      }),
    );
  }

  /** Resolve a correlação sob contexto de plataforma; nenhum payload decide tenant. */
  findCheckoutAttemptForFulfillment(input: {
    provider: BillingProviderName;
    providerSessionId: string;
    checkoutAttemptId: string | null;
  }) {
    return this.comoPlataforma((tx) =>
      tx.billingCheckoutAttempt.findFirst({
        where: {
          provider: input.provider,
          OR: [
            { providerSessionId: input.providerSessionId },
            ...(input.checkoutAttemptId
              ? [{ id: input.checkoutAttemptId }]
              : []),
          ],
        },
        include: { billingCustomer: true },
      }),
    );
  }

  async completeCheckoutAttempt(input: {
    id: string;
    providerSessionId: string;
    providerSubscriptionId: string;
  }): Promise<void> {
    await this.comoPlataforma(async (tx) => {
      const { count } = await tx.billingCheckoutAttempt.updateMany({
        where: {
          id: input.id,
          status: { in: ['CREATING', 'OPEN'] },
          OR: [
            { providerSessionId: null },
            { providerSessionId: input.providerSessionId },
          ],
        },
        data: {
          status: 'COMPLETED',
          providerSessionId: input.providerSessionId,
          providerSubscriptionId: input.providerSubscriptionId,
          completedAt: new Date(),
          failedAt: null,
          failureCode: null,
        },
      });
      if (count === 0) {
        const current = await tx.billingCheckoutAttempt.findUnique({
          where: { id: input.id },
        });
        if (
          current?.status !== 'COMPLETED' ||
          current.providerSessionId !== input.providerSessionId ||
          current.providerSubscriptionId !== input.providerSubscriptionId
        ) {
          throw new Error('Checkout correlation conflict');
        }
      }
    });
  }

  /** Atualiza a projeção e acrescenta uma observação imutável no mesmo commit. */
  async recordInvoice(input: {
    organizationId: string;
    subscriptionId: string;
    provider: BillingProviderName;
    mode: BillingMode;
    providerEventId: string;
    invoice: ProviderInvoice;
  }): Promise<void> {
    await this.rls.run(async (tx) => {
      const current = await tx.billingInvoice.findFirst({
        where: {
          organizationId: input.organizationId,
          provider: input.provider,
          providerInvoiceId: input.invoice.providerInvoiceId,
        },
      });
      const data = {
        subscriptionId: input.subscriptionId,
        mode: input.mode,
        invoiceNumber: input.invoice.number,
        status: input.invoice.status,
        currency: input.invoice.currency,
        subtotalMinor: input.invoice.subtotalMinor,
        discountMinor: input.invoice.discountMinor,
        taxMinor: input.invoice.taxMinor,
        totalMinor: input.invoice.totalMinor,
        amountDueMinor: input.invoice.amountDueMinor,
        amountPaidMinor: input.invoice.amountPaidMinor,
        amountRemainingMinor: input.invoice.amountRemainingMinor,
        creditNotesMinor: input.invoice.creditNotesMinor,
        attempted: input.invoice.attempted,
        attemptCount: input.invoice.attemptCount,
        billingReason: input.invoice.billingReason,
        collectionMethod: input.invoice.collectionMethod,
        hostedInvoiceUrl: input.invoice.hostedInvoiceUrl,
        invoicePdfUrl: input.invoice.invoicePdfUrl,
        periodStart: input.invoice.periodStart,
        periodEnd: input.invoice.periodEnd,
        dueAt: input.invoice.dueAt,
        nextPaymentAttemptAt: input.invoice.nextPaymentAttemptAt,
        finalizedAt: input.invoice.finalizedAt,
        paidAt: input.invoice.paidAt,
        voidedAt: input.invoice.voidedAt,
        markedUncollectibleAt: input.invoice.markedUncollectibleAt,
        providerCreatedAt: input.invoice.providerCreatedAt,
        providerObservedAt: input.invoice.providerObservedAt,
        lastProviderEventId: input.providerEventId,
      };

      const invoice = current
        ? await tx.billingInvoice.update({
            where: { id: current.id },
            data: { ...data, version: { increment: 1 } },
          })
        : await tx.billingInvoice.create({
            data: {
              id: generateUuidV7(),
              organizationId: input.organizationId,
              provider: input.provider,
              providerInvoiceId: input.invoice.providerInvoiceId,
              ...data,
            },
          });

      try {
        await tx.billingInvoiceTransition.create({
          data: {
            id: generateUuidV7(),
            organizationId: input.organizationId,
            billingInvoiceId: invoice.id,
            provider: input.provider,
            providerEventId: input.providerEventId,
            status: input.invoice.status,
            totalMinor: input.invoice.totalMinor,
            amountPaidMinor: input.invoice.amountPaidMinor,
            amountRemainingMinor: input.invoice.amountRemainingMinor,
            attemptCount: input.invoice.attemptCount,
            observedAt: input.invoice.providerObservedAt,
          },
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        ) {
          throw error;
        }
        /** Replay do mesmo evento: projeção convergiu e o ledger já existe. */
      }
    });
  }

  async recordFinancialAdjustment(input: {
    organizationId: string;
    provider: BillingProviderName;
    providerEventId: string;
    adjustment: ProviderFinancialAdjustment;
  }): Promise<void> {
    await this.rls.run(async (tx) => {
      const invoice = await tx.billingInvoice.findFirst({
        where: {
          organizationId: input.organizationId,
          provider: input.provider,
          providerInvoiceId: input.adjustment.providerInvoiceId,
        },
        select: { id: true },
      });
      if (!invoice) throw new Error('BILLING_ADJUSTMENT_INVOICE_NOT_FOUND');

      const current = await tx.billingFinancialAdjustment.findFirst({
        where: {
          organizationId: input.organizationId,
          provider: input.provider,
          type: input.adjustment.type,
          providerObjectId: input.adjustment.providerObjectId,
        },
      });
      const data = {
        billingInvoiceId: invoice.id,
        status: input.adjustment.status,
        amountMinor: input.adjustment.amountMinor,
        currency: input.adjustment.currency,
        reason: input.adjustment.reason,
        occurredAt: input.adjustment.occurredAt,
        providerObservedAt: input.adjustment.providerObservedAt,
        lastProviderEventId: input.providerEventId,
      };
      if (current) {
        await tx.billingFinancialAdjustment.update({
          where: { id: current.id },
          data: { ...data, version: { increment: 1 } },
        });
      } else {
        await tx.billingFinancialAdjustment.create({
          data: {
            id: generateUuidV7(),
            organizationId: input.organizationId,
            provider: input.provider,
            type: input.adjustment.type,
            providerObjectId: input.adjustment.providerObjectId,
            ...data,
          },
        });
      }
    });
  }

  recentInvoices(
    organizationId: string,
    take = 12,
  ): Promise<BillingInvoiceRow[]> {
    const boundedTake = Math.min(Math.max(take, 1), 24);
    return this.rls.run((tx) =>
      tx.billingInvoice.findMany({
        where: { organizationId },
        orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
        take: boundedTake,
        select: {
          id: true,
          organizationId: true,
          subscriptionId: true,
          invoiceNumber: true,
          status: true,
          currency: true,
          totalMinor: true,
          amountPaidMinor: true,
          amountRemainingMinor: true,
          creditNotesMinor: true,
          attemptCount: true,
          hostedInvoiceUrl: true,
          invoicePdfUrl: true,
          periodStart: true,
          periodEnd: true,
          dueAt: true,
          nextPaymentAttemptAt: true,
          paidAt: true,
          providerCreatedAt: true,
          adjustments: {
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            select: {
              id: true,
              type: true,
              status: true,
              amountMinor: true,
              currency: true,
              reason: true,
              occurredAt: true,
            },
          },
        },
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Caixa de entrada — contexto de plataforma                         */
  /* ---------------------------------------------------------------- */

  /**
   * Uma transação que se declara da plataforma.
   *
   * A caixa de entrada não pertence a inquilino nenhum: um evento chega
   * identificado pelo provedor, e só depois de reconciliado sabemos de quem
   * era. Uma política por inquilino esconderia todo evento do próprio
   * processador. O contexto vale enquanto esta transação existir, e o alcance
   * real é o do código abaixo — que só conhece uma tabela.
   */
  private comoPlataforma<T>(
    work: (tx: PrismaTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT set_config('app.is_platform_admin', 'true', true)`,
      );
      return work(tx);
    });
  }

  /**
   * Registra o evento recebido.
   *
   * Devolve `false` quando ele já estava lá. É o índice único respondendo, e
   * não uma consulta anterior: dez entregas simultâneas do mesmo evento
   * produzem uma linha e um efeito.
   */
  async recordEvent(input: {
    provider: BillingProviderName;
    providerEventId: string;
    eventType: string;
    providerObjectId: string | null;
    providerSubscriptionId: string | null;
    apiVersion: string | null;
    providerCreatedAt: Date;
  }): Promise<boolean> {
    return this.comoPlataforma(async (tx) => {
      const inseridas = await tx.$executeRaw`
        INSERT INTO "billing_webhook_events"
          ("id", "provider", "provider_event_id", "event_type",
           "provider_object_id", "provider_subscription_id", "api_version",
           "provider_created_at", "received_at", "processing_status",
           "attempts", "created_at", "updated_at")
        VALUES
          (${generateUuidV7()}::uuid, ${input.provider}, ${input.providerEventId},
           ${input.eventType}, ${input.providerObjectId},
           ${input.providerSubscriptionId}, ${input.apiVersion},
           ${input.providerCreatedAt}::timestamptz, now(), 'PENDING', 0,
           now(), now())
        ON CONFLICT ("provider", "provider_event_id") DO NOTHING
      `;
      return inseridas > 0;
    });
  }

  /**
   * Reivindica um evento com lease e `SKIP LOCKED`.
   *
   * Duas réplicas podem drenar a mesma tabela, mas nunca recebem a mesma linha.
   * Um processo que morre perde o lease e a linha volta a ser elegível.
   */
  claimNextEvent(input: {
    leaseMs: number;
    maxAttempts: number;
  }): Promise<ClaimedBillingEvent | null> {
    return this.comoPlataforma(async (tx) => {
      await tx.$executeRaw`
        UPDATE "billing_webhook_events"
        SET "processing_status" = 'DEAD_LETTER',
            "dead_lettered_at" = now(),
            "processed_at" = now(),
            "processing_token" = NULL,
            "lease_expires_at" = NULL,
            "last_error_code" = COALESCE("last_error_code", 'RETRY_EXHAUSTED'),
            "updated_at" = now()
        WHERE "attempts" >= ${input.maxAttempts}
          AND (
            "processing_status" = 'PENDING'
            OR (
              "processing_status" = 'PROCESSING'
              AND "lease_expires_at" <= now()
            )
          )
      `;

      const token = generateUuidV7();
      const leaseExpiresAt = new Date(Date.now() + input.leaseMs);
      const rows = await tx.$queryRaw<ClaimedBillingEvent[]>`
        WITH candidate AS (
          SELECT "id"
          FROM "billing_webhook_events"
          WHERE "attempts" < ${input.maxAttempts}
            AND (
              (
                "processing_status" = 'PENDING'
                AND "next_attempt_at" <= now()
              )
              OR (
                "processing_status" = 'PROCESSING'
                AND "lease_expires_at" <= now()
              )
            )
          ORDER BY "received_at" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "billing_webhook_events" AS event
        SET "processing_status" = 'PROCESSING',
            "attempts" = event."attempts" + 1,
            "processing_token" = ${token}::uuid,
            "processing_started_at" = now(),
            "lease_expires_at" = ${leaseExpiresAt}::timestamptz,
            "updated_at" = now()
        FROM candidate
        WHERE event."id" = candidate."id"
        RETURNING
          event."id",
          event."provider",
          event."provider_event_id" AS "providerEventId",
          event."event_type" AS "eventType",
          event."provider_object_id" AS "providerObjectId",
          event."provider_subscription_id" AS "providerSubscriptionId",
          event."api_version" AS "apiVersion",
          event."provider_created_at" AS "providerCreatedAt",
          event."received_at" AS "receivedAt",
          event."processing_status" AS "processingStatus",
          event."attempts",
          event."processing_token"::text AS "processingToken"
      `;
      return rows[0] ?? null;
    });
  }

  async finishClaimedEvent(input: {
    id: string;
    processingToken: string;
    status: 'PROCESSED' | 'IGNORED';
    lastErrorCode?: string;
  }): Promise<void> {
    await this.comoPlataforma(async (tx) => {
      const { count } = await tx.billingWebhookEvent.updateMany({
        where: {
          id: input.id,
          processingStatus: 'PROCESSING',
          processingToken: input.processingToken,
        },
        data: {
          processingStatus: input.status,
          processedAt: new Date(),
          processingToken: null,
          leaseExpiresAt: null,
          lastErrorCode: input.lastErrorCode ?? null,
        },
      });
      if (count !== 1) throw new Error('Billing event lease was lost');
    });
  }

  async retryClaimedEvent(input: {
    id: string;
    processingToken: string;
    errorCode: string;
    nextAttemptAt: Date;
    deadLetter: boolean;
  }): Promise<void> {
    await this.comoPlataforma(async (tx) => {
      const now = new Date();
      const { count } = await tx.billingWebhookEvent.updateMany({
        where: {
          id: input.id,
          processingStatus: 'PROCESSING',
          processingToken: input.processingToken,
        },
        data: {
          processingStatus: input.deadLetter ? 'DEAD_LETTER' : 'PENDING',
          nextAttemptAt: input.nextAttemptAt,
          processingToken: null,
          leaseExpiresAt: null,
          processedAt: input.deadLetter ? now : null,
          deadLetteredAt: input.deadLetter ? now : null,
          lastErrorCode: input.errorCode.slice(0, 80),
        },
      });
      if (count !== 1) throw new Error('Billing event lease was lost');
    });
  }

  /**
   * A assinatura ligada a um identificador do provedor.
   *
   * Consulta de plataforma: o worker está reconciliando um evento e ainda não
   * declarou inquilino nenhum — é justamente esta consulta que descobre qual é.
   */
  findSubscriptionByProviderId(providerSubscriptionId: string) {
    return this.comoPlataforma((tx) =>
      tx.organizationSubscription.findFirst({
        where: { providerSubscriptionId, endedAt: null },
      }),
    );
  }

  /** Correlação histórica para faturas que podem chegar após o encerramento. */
  findSubscriptionForLedgerByProviderId(providerSubscriptionId: string) {
    return this.comoPlataforma((tx) =>
      tx.organizationSubscription.findFirst({
        where: { providerSubscriptionId },
      }),
    );
  }

  /** Assinaturas vinculadas ao provedor, para a varredura periódica. */
  linkedSubscriptions(take: number, after?: string) {
    return this.comoPlataforma((tx) =>
      tx.organizationSubscription.findMany({
        where: {
          endedAt: null,
          providerSubscriptionId: { not: null },
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: 'asc' },
        take,
      }),
    );
  }
}
