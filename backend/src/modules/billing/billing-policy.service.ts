import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { generateUuidV7 } from '../../utils';
import { BillingCommandNotAllowedException } from './billing.errors';

export const BILLING_DAY_MS = 86_400_000;
export const BILLING_REFUND_WINDOW_MS = 7 * BILLING_DAY_MS;

export function canRefundPurchase(paidAt: Date, requestedAt: Date): boolean {
  const elapsed = requestedAt.getTime() - paidAt.getTime();
  return elapsed >= 0 && elapsed <= BILLING_REFUND_WINDOW_MS;
}

type TicketInput = {
  organizationId: string;
  subscriptionId: string;
  requestedBy?: string;
  kind: 'PLAN_CHANGE' | 'CANCELLATION' | 'REFUND_REVIEW';
  targetPlanCode?: string;
  targetInterval?: string;
  reference?: string;
};

@Injectable()
export class BillingPolicyService {
  constructor(private readonly rls: RlsTransaction) {}

  async ticket(input: TicketInput) {
    return this.rls.run((tx) => this.insertTicket(tx, input));
  }

  async insertTicket(tx: PrismaTransactionClient, input: TicketInput) {
    const reference = input.reference ?? '';
    const [ticket] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO billing_support_tickets
        (id, organization_id, subscription_id, requested_by, kind, target_plan_code, target_interval, reference)
      VALUES
        (${generateUuidV7()}::uuid, ${input.organizationId}::uuid, ${input.subscriptionId}::uuid,
         ${input.requestedBy ?? null}::uuid, ${input.kind}, ${input.targetPlanCode ?? null}, ${input.targetInterval ?? null}, ${reference})
      ON CONFLICT (subscription_id, kind, reference) WHERE status = 'OPEN'
      DO UPDATE SET reference = EXCLUDED.reference
      RETURNING id`;
    return { kind: 'SUPPORT_TICKET' as const, ticketId: ticket!.id };
  }

  pendingUpgrade(subscriptionId: string) {
    return this.rls.run((tx) =>
      tx.billingPlanUpgrade.findFirst({
        where: { subscriptionId, status: 'OPEN' },
      }),
    );
  }

  async assertNoPendingPayment(subscriptionId: string) {
    const pending = await this.rls.run(
      async (tx) =>
        (await tx.billingPlanUpgrade.findFirst({
          where: { subscriptionId, status: 'OPEN' },
        })) ??
        tx.billingRefundRequest.findUnique({ where: { subscriptionId } }),
    );
    if (pending)
      throw new BillingCommandNotAllowedException(
        'Finalize a solicitação de cobrança que já está em andamento.',
      );
  }

  async locked<T>(
    subscriptionId: string,
    version: number,
    work: () => Promise<T>,
  ) {
    return this.rls.runAmbient(
      async (tx) => {
        await this.lockSubscription(tx, subscriptionId, version);
        await this.assertNoPendingPayment(subscriptionId);
        return work();
      },
      { timeout: 30_000 },
    );
  }

  refundRequest(subscriptionId: string) {
    return this.rls.run((tx) =>
      tx.billingRefundRequest.findUnique({ where: { subscriptionId } }),
    );
  }

  async reserveUpgrade(input: {
    organizationId: string;
    subscriptionId: string;
    subscriptionVersion: number;
    requestedBy?: string;
    previousPeriodStart: Date;
    previousPeriodEnd: Date;
    priceId: string;
    catalogVersion: number;
    entitlements: Prisma.InputJsonValue;
  }) {
    return this.rls.runAmbient(async (tx) => {
      await this.lockSubscription(
        tx,
        input.subscriptionId,
        input.subscriptionVersion,
      );
      const existing = await tx.billingPlanUpgrade.findFirst({
        where: { subscriptionId: input.subscriptionId, status: 'OPEN' },
      });
      const refund = await tx.billingRefundRequest.findUnique({
        where: { subscriptionId: input.subscriptionId },
      });
      if (
        refund ||
        (existing &&
          (existing.priceId !== input.priceId ||
            existing.catalogVersion !== input.catalogVersion))
      ) {
        throw new BillingCommandNotAllowedException(
          'Já existe uma solicitação de cobrança em andamento.',
        );
      }
      return (
        existing ??
        tx.billingPlanUpgrade.create({
          data: { ...input, id: generateUuidV7() },
        })
      );
    });
  }

  attachUpgradeInvoice(id: string, invoiceId: string) {
    return this.rls.run((tx) =>
      tx.billingPlanUpgrade.updateMany({
        where: { id, OR: [{ invoiceId: null }, { invoiceId }] },
        data: { invoiceId },
      }),
    );
  }

  async finishUpgrade(id: string, status: 'APPLIED' | 'EXPIRED') {
    await this.rls.run((tx) =>
      tx.billingPlanUpgrade.updateMany({
        where: { id, status: 'OPEN' },
        data: { status },
      }),
    );
  }

  expireVoidedUpgrade(subscriptionId: string, invoiceId: string) {
    return this.rls.run((tx) =>
      tx.billingPlanUpgrade.updateMany({
        where: { subscriptionId, invoiceId, status: 'OPEN' },
        data: { status: 'EXPIRED' },
      }),
    );
  }

  purchaseInvoiceId(subscriptionId: string, anchor: Date) {
    return this.rls.run(async (tx) => {
      const purchase = await tx.billingInvoice.findFirst({
        where: {
          subscriptionId,
          status: 'PAID',
          amountPaidMinor: { gt: 0 },
          paidAt: { gte: anchor },
          OR: [
            { periodStart: { lte: anchor }, periodEnd: { gt: anchor } },
            {
              billingReason: {
                in: [
                  'subscription_update',
                  'subscription_create',
                  'subscription_cycle',
                ],
              },
              providerCreatedAt: {
                gte: anchor,
                lt: new Date(anchor.getTime() + BILLING_DAY_MS),
              },
            },
          ],
        },
        orderBy: [{ paidAt: 'asc' }, { providerCreatedAt: 'asc' }],
        select: { providerInvoiceId: true },
      });
      return purchase?.providerInvoiceId ?? null;
    });
  }

  async reserveRefund(input: {
    organizationId: string;
    subscriptionId: string;
    subscriptionVersion: number;
    requestedBy?: string;
    invoiceId: string;
    paymentIntentId: string;
    amountMinor: number;
    requestedAt: Date;
  }) {
    return this.rls.runAmbient(async (tx) => {
      const { subscriptionVersion, requestedAt, ...data } = input;
      await this.lockSubscription(
        tx,
        input.subscriptionId,
        subscriptionVersion,
      );
      const previous = await tx.billingRefundRequest.findUnique({
        where: { subscriptionId: input.subscriptionId },
      });
      if (previous) return previous;
      await this.assertNoPendingPayment(input.subscriptionId);
      return tx.billingRefundRequest.create({
        data: { ...data, id: generateUuidV7(), createdAt: requestedAt },
      });
    });
  }

  async reviewFailedRefund(
    subscriptionId: string,
    requestId: string,
    invoiceId: string,
    refundId: string,
  ) {
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return;
    await this.rls.run(async (tx) => {
      const request = await tx.billingRefundRequest.findFirst({
        where: {
          id: requestId,
          subscriptionId,
          invoiceId,
          OR: [{ refundId }, { refundId: null }],
        },
      });
      if (!request || request.status === 'REVIEW') return;
      await tx.billingRefundRequest.update({
        where: { id: request.id },
        data: { status: 'REVIEW', refundId },
      });
      await this.insertTicket(tx, {
        organizationId: request.organizationId,
        subscriptionId,
        requestedBy: request.requestedBy ?? undefined,
        kind: 'REFUND_REVIEW',
        reference: invoiceId,
      });
    });
  }

  private async lockSubscription(
    tx: PrismaTransactionClient,
    id: string,
    version: number,
  ) {
    const [subscription] = await tx.$queryRaw<{ version: number }[]>`
      SELECT version FROM organization_subscriptions WHERE id = ${id}::uuid FOR UPDATE`;
    if (subscription?.version !== version)
      throw new BillingCommandNotAllowedException(
        'A assinatura foi atualizada. Revise os dados e tente novamente.',
      );
  }

  listTickets(status: 'OPEN' | 'RESOLVED', after?: string) {
    return this.rls.run(async (tx) => {
      const rows = await tx.billingSupportTicket.findMany({
        where: { status, ...(after ? { id: { lt: after } } : {}) },
        orderBy: { id: 'desc' },
        take: 51,
        select: {
          id: true,
          organizationId: true,
          subscriptionId: true,
          requestedBy: true,
          kind: true,
          targetPlanCode: true,
          targetInterval: true,
          reference: true,
          status: true,
          resolvedBy: true,
          resolvedAt: true,
          resolution: true,
          emailSentAt: true,
          emailAttempts: true,
          nextEmailAt: true,
          createdAt: true,
        },
      });
      const tickets = rows.slice(0, 50);
      return {
        tickets,
        nextCursor: rows.length > 50 ? tickets.at(-1)!.id : null,
      };
    });
  }

  async resolveTicket(id: string, userId: string, resolution: string) {
    const result = await this.rls.run((tx) =>
      tx.billingSupportTicket.updateMany({
        where: { id, status: 'OPEN' },
        data: {
          status: 'RESOLVED',
          resolvedBy: userId,
          resolvedAt: new Date(),
          resolution,
        },
      }),
    );
    if (!result.count)
      throw new BillingCommandNotAllowedException('O chamado não está aberto.');
    return { id, status: 'RESOLVED' as const };
  }
}
