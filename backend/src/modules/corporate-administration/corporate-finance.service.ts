import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { SubscriptionService } from '../subscription-plans/subscriptions/subscription.service';
import type { CorporateCall } from './corporate-access.guard';
import type {
  FinanceDetailDto,
  FinanceInvoiceListDto,
  FinanceModeDto,
  FinancePaymentListDto,
  FinancePeriodDto,
} from './corporate-finance.dto';
import {
  invoiceDate,
  invoiceScope,
  invoiceView,
  pagedRows,
  paymentRecords,
  paymentView,
  periodSummary,
  type FinancePeriod,
} from './corporate-finance.queries';
import { authorizedCorporateReference } from './corporate-request';
import {
  FINANCE_INVOICES_READ,
  FINANCE_ORGANIZATIONS_READ,
  FINANCE_OVERVIEW_READ,
  FINANCE_PAYMENTS_READ,
  type CorporateCapability,
} from './technical-credential.service';

const dayMs = 86_400_000;
const source = 'ORBIT_STRIPE_RECONCILIATION';
const paymentIdFormat =
  /^(?:(receipt)_([0-9a-f-]{36})_[0-9a-f]{64}|(attempt|refund|dispute)_([0-9a-f-]{36}))$/;
const uuidFormat =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Operation =
  | 'OVERVIEW'
  | 'INVOICES'
  | 'INVOICE'
  | 'PAYMENTS'
  | 'PAYMENT'
  | 'ORGANIZATION'
  | 'ORGANIZATION_INVOICES'
  | 'ORGANIZATION_PAYMENTS';
type PageRow = { total: number; id: string | null } & Record<string, unknown>;
type Summary = {
  month: Date | null;
  draftCount: number | null;
  openCount: number | null;
  paidCount: number | null;
  voidCount: number | null;
  uncollectibleCount: number | null;
  unknownCount: number | null;
  unattributedInvoiceCount: number | null;
  settledWithoutReceiptEvidenceCount: number | null;
  overdueOrganizationCount: number | null;
  confirmedReceiptCount: number | null;
  invoiceObservedAt: Date | null;
  paymentObservedAt: Date | null;
  subtotalMinor: string | null;
  billedMinor: string | null;
  discountMinor: string | null;
  openMinor: string | null;
  pendingMinor: string | null;
  overdueMinor: string | null;
  uncollectibleMinor: string | null;
  confirmedReceivedMinor: string | null;
  recordedRefundMinor: string | null;
};
type Organization = {
  id: string;
  displayName: string;
  operationalStatus: string;
};
function periodOf(query: FinancePeriodDto): FinancePeriod {
  const start = new Date(query.from + 'T00:00:00.000Z');
  const end = new Date(query.to + 'T00:00:00.000Z');
  const duration = end.getTime() - start.getTime();
  if (
    !Number.isFinite(duration) ||
    start.getUTCFullYear() < 1 ||
    duration <= 0 ||
    duration > 366 * dayMs
  ) {
    throw new BadRequestException('Informe um período de 1 a 366 dias em UTC.');
  }
  return { ...query, start, end };
}

function pageOf(query: { page?: string; pageSize?: string }) {
  return {
    page: Number(query.page ?? 1),
    pageSize: Number(query.pageSize ?? 25),
  };
}

function pageResult(rows: PageRow[]) {
  let total = 0;
  const items: Record<string, unknown>[] = [];
  for (const { total: count, ...item } of rows) {
    total = count;
    if (item.id !== null) items.push(item);
  }
  return { total, items };
}

function summaryView(row: Summary) {
  return {
    subtotalMinor: row.subtotalMinor,
    billedMinor: row.billedMinor,
    discountMinor: row.discountMinor,
    openMinor: row.openMinor,
    pendingMinor: row.pendingMinor,
    overdueMinor: row.overdueMinor,
    uncollectibleMinor: row.uncollectibleMinor,
    confirmedReceivedMinor: row.confirmedReceivedMinor,
    recordedRefundMinor: row.recordedRefundMinor,
    netConfirmedMinor: null,
    invoices: {
      DRAFT: row.draftCount ?? 0,
      OPEN: row.openCount ?? 0,
      PAID: row.paidCount ?? 0,
      VOID: row.voidCount ?? 0,
      UNCOLLECTIBLE: row.uncollectibleCount ?? 0,
      UNKNOWN: row.unknownCount ?? 0,
    },
    overdueOrganizationCount: row.overdueOrganizationCount ?? 0,
    coverage: {
      unattributedInvoiceCount: row.unattributedInvoiceCount ?? 0,
      settledWithoutReceiptEvidenceCount:
        row.settledWithoutReceiptEvidenceCount ?? 0,
      confirmedReceiptCount: row.confirmedReceiptCount ?? 0,
      invoiceObservedAt: row.invoiceObservedAt,
      paymentObservedAt: row.paymentObservedAt,
    },
  };
}

@Injectable()
export class CorporateFinanceService {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly subscriptions: SubscriptionService,
  ) {}

  overview(
    call: CorporateCall,
    reference: unknown,
    query: FinancePeriodDto,
    organizationId?: string,
  ) {
    const period = periodOf(query);
    return this.read(
      call,
      reference,
      organizationId ? FINANCE_ORGANIZATIONS_READ : FINANCE_OVERVIEW_READ,
      organizationId ? 'ORGANIZATION' : 'OVERVIEW',
      query.mode,
      organizationId,
      organizationId ?? null,
      async (tx, asOf, organization) => {
        const [total, ...monthly] = await tx.$queryRaw<Summary[]>(
          periodSummary(period, asOf),
        );
        if (!total) throw new Error('Missing finance summary row');
        const summary = {
          ...this.observation(query, asOf, period),
          totals: summaryView(total),
          monthly: monthly.map((row) => ({
            month: row.month!.toISOString().slice(0, 7),
            ...summaryView(row),
          })),
        };
        if (!organization) return summary;
        return {
          ...summary,
          organization,
          ...(await this.organizationSubscription(
            tx,
            organization.id,
            query,
            asOf,
          )),
          balanceStatus: total.overdueMinor
            ? 'OVERDUE'
            : total.openMinor
              ? 'PENDING'
              : total.uncollectibleMinor
                ? 'UNCOLLECTIBLE'
                : total.billedMinor !== null
                  ? 'NO_OPEN_BALANCE'
                  : 'INSUFFICIENT_EVIDENCE',
        };
      },
    );
  }

  invoices(
    call: CorporateCall,
    reference: unknown,
    query: FinanceInvoiceListDto,
    organizationId?: string,
  ) {
    const period = periodOf(query);
    const pagination = pageOf(query);
    const term = query.search?.trim();
    return this.read(
      call,
      reference,
      FINANCE_INVOICES_READ,
      organizationId ? 'ORGANIZATION_INVOICES' : 'INVOICES',
      query.mode,
      organizationId,
      organizationId ?? null,
      async (tx, asOf) => {
        const scope = Prisma.sql`
          ${invoiceScope(query.mode, period)}
          AND ${invoiceDate} >= ${period.start} AND ${invoiceDate} < ${period.end}
          ${query.status ? Prisma.sql`AND i.status = ${query.status}` : Prisma.empty}
          ${term ? Prisma.sql`AND (i.id::text = lower(${term}) OR position(lower(${term}) in lower(i.invoice_number)) > 0)` : Prisma.empty}
        `;
        const rows = await tx.$queryRaw<PageRow[]>(
          pagedRows(
            this.invoiceRows(scope, asOf),
            'invoice',
            pagination.page,
            pagination.pageSize,
            query.sort,
          ),
        );
        const result = pageResult(rows);
        return {
          ...this.observation(query, asOf, period),
          ...pagination,
          ...result,
          items: await this.organizationNames(tx, query, result.items),
        };
      },
    );
  }

  invoice(
    call: CorporateCall,
    reference: unknown,
    query: FinanceDetailDto,
    id: string,
  ) {
    return this.read(
      call,
      reference,
      FINANCE_INVOICES_READ,
      'INVOICE',
      query.mode,
      undefined,
      id,
      async (tx, asOf) => {
        const [invoice] = await tx.$queryRaw<Record<string, unknown>[]>(
          this.invoiceRows(invoiceScope(query.mode, undefined, id), asOf),
        );
        if (!invoice) return null;
        const [item] = await this.organizationNames(tx, query, [invoice]);
        return { ...this.observation(query, asOf), invoice: item };
      },
    );
  }

  payments(
    call: CorporateCall,
    reference: unknown,
    query: FinancePaymentListDto,
    organizationId?: string,
  ) {
    const period = periodOf(query);
    const pagination = pageOf(query);
    return this.read(
      call,
      reference,
      FINANCE_PAYMENTS_READ,
      organizationId ? 'ORGANIZATION_PAYMENTS' : 'PAYMENTS',
      query.mode,
      organizationId,
      organizationId ?? null,
      async (tx, asOf) => {
        const rows = await tx.$queryRaw<PageRow[]>(
          pagedRows(
            Prisma.sql`
          WITH ${paymentRecords(invoiceScope(query.mode, period), period, query.kind)}
          SELECT ${paymentView} FROM payment_facts
          WHERE "occurredAt" >= ${period.start} AND "occurredAt" < ${period.end}
          ${query.status ? Prisma.sql`AND status = ${query.status}` : Prisma.empty}
          ${query.invoiceId ? Prisma.sql`AND "invoiceId" = ${query.invoiceId}::uuid` : Prisma.empty}
        `,
            'payment',
            pagination.page,
            pagination.pageSize,
            query.sort,
          ),
        );
        const result = pageResult(rows);
        return {
          ...this.observation(query, asOf, period),
          ...pagination,
          ...result,
          items: await this.organizationNames(tx, query, result.items),
        };
      },
    );
  }

  payment(
    call: CorporateCall,
    reference: unknown,
    query: FinanceDetailDto,
    id: string,
  ) {
    const match = paymentIdFormat.exec(id);
    const uuid = match?.[2] ?? match?.[4];
    if (!uuid || !uuidFormat.test(uuid))
      throw new BadRequestException('Identificador financeiro inválido.');
    const kind = match![1] === 'receipt' ? 'RECEIPT' : match![3]!.toUpperCase();
    return this.read(
      call,
      reference,
      FINANCE_PAYMENTS_READ,
      'PAYMENT',
      query.mode,
      undefined,
      uuid,
      async (tx, asOf) => {
        const scope = invoiceScope(
          query.mode,
          undefined,
          kind === 'RECEIPT' ? uuid : undefined,
        );
        const [payment] = await tx.$queryRaw<
          Record<string, unknown>[]
        >(Prisma.sql`
          WITH ${paymentRecords(scope, undefined, kind, kind === 'RECEIPT' ? undefined : uuid)}
          SELECT ${paymentView} FROM payment_facts WHERE id = ${id}
        `);
        if (!payment) return null;
        const [item] = await this.organizationNames(tx, query, [payment]);
        return { ...this.observation(query, asOf), payment: item };
      },
    );
  }

  private async organizationNames(
    tx: PrismaTransactionClient,
    query: Pick<FinanceDetailDto, 'includeOrganizationName'>,
    items: Record<string, unknown>[],
  ) {
    if (!query.includeOrganizationName || !items.length) return items;
    const ids = [...new Set(items.map((item) => String(item.organizationId)))];
    await tx.$queryRaw`SELECT set_config('app.corporate_finance_labels', 'true', true)`;
    const rows = await tx.organization.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, displayName: true },
    });
    const names = new Map(rows.map((row) => [row.id, row.displayName]));
    return items.map((item) => ({
      ...item,
      organizationName: names.get(String(item.organizationId)) ?? null,
    }));
  }

  private invoiceRows(scope: Prisma.Sql, asOf: Date) {
    return Prisma.sql`
      WITH ${paymentRecords(scope, undefined, 'RECEIPT')},
      invoice_receipts AS (
        SELECT "invoiceId", sum("amountMinor")::text AS "confirmedReceivedMinor"
        FROM payment_facts GROUP BY "invoiceId"
      )
      SELECT ${invoiceView(asOf)}
      FROM public.billing_invoices i
      LEFT JOIN invoice_receipts receipts ON receipts."invoiceId" = i.id
      WHERE ${scope}
    `;
  }

  private observation(
    query: FinanceModeDto,
    asOf: Date,
    period?: FinancePeriod,
  ) {
    return {
      source,
      mode: query.mode,
      asOf,
      ...(period
        ? {
            currency: period.currency,
            from: period.from,
            to: period.to,
            planCode: period.planCode ?? null,
          }
        : {}),
    };
  }

  private async organizationSubscription(
    tx: PrismaTransactionClient,
    organizationId: string,
    query: FinancePeriodDto,
    asOf: Date,
  ) {
    // The ambient transaction preserves the corporate RLS scope in the
    // canonical read, including when the latest contract has already ended.
    const contract = await this.subscriptions.currentOrLast(
      organizationId,
      asOf,
    );
    if (!contract) {
      return {
        subscription: null,
        nextChargeAt: null,
        subscriptionCoverage: 'NO_SUBSCRIPTION',
      };
    }
    const linked = contract.providerSubscriptionId !== null;
    if (linked) {
      const binding =
        contract.provider === 'STRIPE' && contract.providerCustomerId
          ? await tx.billingCustomer.findFirst({
              where: {
                organizationId,
                provider: 'STRIPE',
                mode: query.mode,
                providerCustomerId: contract.providerCustomerId,
              },
              select: { id: true },
            })
          : null;
      if (!binding) {
        return {
          subscription: null,
          nextChargeAt: null,
          subscriptionCoverage: 'UNVERIFIED_MODE',
        };
      }
    }
    const [charge] =
      linked && !contract.endedAt
        ? await tx.$queryRaw<{ nextChargeAt: Date | null }[]>`
      SELECT min(next_payment_attempt_at) AS "nextChargeAt"
      FROM public.billing_invoices
      WHERE provider = 'STRIPE' AND mode = ${query.mode} AND currency = ${query.currency.toLowerCase()}
        AND organization_id = ${organizationId}::uuid AND subscription_id = ${contract.id}::uuid
        AND status = 'OPEN' AND amount_remaining_minor > 0 AND collection_method = 'charge_automatically'
        AND next_payment_attempt_at >= ${asOf}
    `
        : [];
    return {
      subscription: {
        id: contract.id,
        planCode: contract.planCode,
        status: contract.effectiveStatus,
        billingInterval: contract.billingInterval,
        currentPeriodStart: contract.currentPeriodStart,
        currentPeriodEnd: contract.currentPeriodEnd,
        endedAt: contract.endedAt,
        cancelAtPeriodEnd: contract.cancelAtPeriodEnd,
        trialEndsAt: contract.trialEndsAt,
        graceEndsAt: contract.graceEndsAt,
        providerUpdatedAt: contract.providerUpdatedAt,
        providerMode: linked ? query.mode : null,
      },
      subscriptionCoverage: linked ? 'MATCHED_MODE' : 'ORBIT_ONLY',
      nextChargeAt: charge?.nextChargeAt ?? null,
    };
  }

  private async read<T>(
    call: CorporateCall,
    reference: unknown,
    capability: CorporateCapability,
    operation: Operation,
    mode: FinanceModeDto['mode'],
    organizationId: string | undefined,
    entityId: string | null,
    work: (
      tx: PrismaTransactionClient,
      asOf: Date,
      organization: Organization | null,
    ) => Promise<T | null>,
  ): Promise<T> {
    const audit = authorizedCorporateReference(
      call,
      reference,
      capability,
      false,
    );
    if (organizationId)
      authorizedCorporateReference(
        call,
        reference,
        FINANCE_ORGANIZATIONS_READ,
        false,
      );
    const result = await this.rls.runAmbient(
      async (tx) => {
        const [{ asOf }] = await tx.$queryRaw<[{ asOf: Date }]>`
        SELECT transaction_timestamp() AS "asOf",
          set_config('app.corporate_finance_principal', ${audit.technicalPrincipalId}, true),
          set_config('app.corporate_finance_mode', ${mode}, true),
          set_config('app.corporate_finance_organization', ${organizationId ?? ''}, true),
          set_config('statement_timeout', '5s', true)
      `;
        const organization = organizationId
          ? await tx.organization.findFirst({
              where: { id: organizationId, deletedAt: null },
              select: { id: true, displayName: true, status: true },
            })
          : null;
        const value =
          organizationId && !organization
            ? null
            : await work(
                tx,
                asOf,
                organization
                  ? {
                      id: organization.id,
                      displayName: organization.displayName,
                      operationalStatus: organization.status,
                    }
                  : null,
              );
        await tx.auditLog.createMany({
          data: {
            entityType: 'SAAS_FINANCE',
            entityId,
            action: 'CORPORATE_FINANCE_READ',
            requestId: audit.correlationId,
            metadata: {
              ...audit,
              operation,
              mode,
              outcome: value === null ? 'NOT_FOUND' : 'CONFIRMED',
            },
          },
        });
        return value;
      },
      { timeout: 12_000 },
    );
    if (result === null) throw new NotFoundException();
    return result;
  }
}
