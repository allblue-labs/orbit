import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import type { CorporateCall } from './corporate-access.guard';
import type {
  AnalyticsLifecycleDto,
  AnalyticsPeriodDto,
  AnalyticsRecurringDto,
} from './corporate-analytics.dto';
import {
  customerLifecycle,
  delinquency,
  recurringMinorDenominator,
  recurringRevenue,
  trialConversion,
  trialObservationDays,
} from './corporate-analytics.queries';
import { authorizedCorporateReference } from './corporate-request';
import {
  ANALYTICS_DELINQUENCY_READ,
  ANALYTICS_LIFECYCLE_READ,
  ANALYTICS_REVENUE_READ,
  ANALYTICS_TRIALS_READ,
} from './technical-credential.service';

const capability = {
  REVENUE: ANALYTICS_REVENUE_READ,
  LIFECYCLE: ANALYTICS_LIFECYCLE_READ,
  TRIALS: ANALYTICS_TRIALS_READ,
  DELINQUENCY: ANALYTICS_DELINQUENCY_READ,
} as const;
type Operation = keyof typeof capability;
type RevenueRow = {
  planCode: string | null;
  billingInterval: string | null;
  candidateOrganizations: number;
  unknownTermsOrganizations: number;
  unverifiedPaymentOrganizations: number;
  confirmedEligibleOrganizations: number;
  unpricedOrganizations: number;
  pricedOrganizations: number;
  oldestObservationAt: Date | null;
  latestObservationAt: Date | null;
  grossMonthlyScaledMinor: string | null;
  discountMonthlyScaledMinor: string | null;
  monthlyRecurringScaledMinor: string | null;
};
type TrialRow = {
  startedOrganizations: number;
  scheduledInProgressOrganizations: number;
  scheduledEndedOrganizations: number;
  confirmedConvertedOrganizations: number;
  eligibleOrganizations: number;
  confirmedEligibleConversions: number;
};
type DelinquencyRow = {
  eligibleOrganizations: number;
  overdueOrganizations: number;
  undatedOpenOrganizations: number;
  unattributedInvoices: number;
  observedRatePercent: string | null;
};
type LifecycleRow = {
  firstObservedPaidOrganizations: number;
  organizationsWithFirstReceiptForAContract: number;
  recordedPaidCancellations: number;
  observedReactivatedOrganizations: number;
};

function periodOf(query: AnalyticsPeriodDto) {
  const start = new Date(query.from + 'T00:00:00.000Z');
  const end = new Date(query.to + 'T00:00:00.000Z');
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (!(days >= 1 && days <= 366))
    throw new BadRequestException('Informe um período de 1 a 366 dias em UTC.');
  return { ...query, start, end };
}

function revenueView(row: RevenueRow) {
  const {
    candidateOrganizations,
    unknownTermsOrganizations,
    unverifiedPaymentOrganizations,
    unpricedOrganizations,
    pricedOrganizations,
    oldestObservationAt,
    latestObservationAt,
    confirmedEligibleOrganizations,
  } = row;
  const unknownPopulation =
    unknownTermsOrganizations + unverifiedPaymentOrganizations > 0;
  const complete = !unknownPopulation && unpricedOrganizations === 0;
  return {
    // These are always exact aggregates of the priced subset. Only a complete
    // empty population proves a zero in the requested scope.
    grossMonthlyScaledMinor: complete
      ? (row.grossMonthlyScaledMinor ?? '0')
      : row.grossMonthlyScaledMinor,
    discountMonthlyScaledMinor: complete
      ? (row.discountMonthlyScaledMinor ?? '0')
      : row.discountMonthlyScaledMinor,
    monthlyRecurringScaledMinor: complete
      ? (row.monthlyRecurringScaledMinor ?? '0')
      : row.monthlyRecurringScaledMinor,
    eligibleOrganizations: unknownPopulation
      ? null
      : confirmedEligibleOrganizations,
    confirmedEligibleOrganizations,
    coverage: {
      status: complete
        ? 'AVAILABLE'
        : pricedOrganizations
          ? 'PARTIAL'
          : 'UNAVAILABLE',
      candidateOrganizations,
      unknownTermsOrganizations,
      unverifiedPaymentOrganizations,
      unpricedOrganizations,
      pricedOrganizations,
      oldestObservationAt,
      latestObservationAt,
    },
  };
}

@Injectable()
export class CorporateAnalyticsService {
  constructor(private readonly rls: RlsTransaction) {}

  revenue(
    call: CorporateCall,
    reference: unknown,
    query: AnalyticsRecurringDto,
  ) {
    return this.read(
      call,
      reference,
      'REVENUE',
      query.mode,
      async (tx, asOf) => {
        const [total, ...rows] = await tx.$queryRaw<RevenueRow[]>(
          recurringRevenue(query.mode, query.currency, asOf, query.planCode),
        );
        if (!total) throw new Error('Recurring revenue aggregate missing');
        const totals = revenueView(total);
        return {
          ...this.observation(
            query,
            asOf,
            'ORBIT_STRIPE_RECURRING_OBSERVATION',
          ),
          scale: recurringMinorDenominator,
          totals,
          breakdown: rows.map((row) => ({
            planCode: row.planCode,
            billingInterval: row.billingInterval,
            ...revenueView(row),
          })),
        };
      },
    );
  }

  lifecycle(
    call: CorporateCall,
    reference: unknown,
    query: AnalyticsLifecycleDto,
  ) {
    const period = periodOf(query);
    return this.read(
      call,
      reference,
      'LIFECYCLE',
      query.mode,
      async (tx, asOf) => {
        const observed = await this.aggregate<LifecycleRow>(
          tx,
          customerLifecycle(period, asOf),
        );
        return {
          ...this.observation(
            query,
            asOf,
            'ORBIT_RECEIPTS_AND_RECORDED_CANCELLATIONS',
          ),
          observed,
          openingPaidOrganizations: null,
          closingPaidOrganizations: null,
          lostOpeningOrganizations: null,
          retainedOpeningOrganizations: null,
          openingMrrScaledMinor: null,
          lostOpeningMrrScaledMinor: null,
          expansionMrrScaledMinor: null,
          contractionMrrScaledMinor: null,
          coverage: {
            status: 'PARTIAL',
            reason: 'EFFECTIVE_PAID_HISTORY_UNAVAILABLE',
          },
        };
      },
    );
  }

  trials(call: CorporateCall, reference: unknown, query: AnalyticsPeriodDto) {
    const period = periodOf(query);
    return this.read(
      call,
      reference,
      'TRIALS',
      query.mode,
      async (tx, asOf) => {
        const counts = await this.aggregate<TrialRow>(
          tx,
          trialConversion(period, asOf),
        );
        return {
          ...this.observation(query, asOf, 'ORBIT_TRIAL_GRANTS_AND_RECEIPTS'),
          ...counts,
          observationWindowDays: trialObservationDays,
          // The denominator is Orbit-local, and receipt coverage is scoped to
          // the requested Stripe mode and currency. An exact rate is unavailable.
          conversionRatePercent: null,
          coverage: {
            status: 'PARTIAL',
            reason: 'LOCAL_COHORT_SCOPED_RECEIPT_EVIDENCE',
          },
        };
      },
    );
  }

  delinquency(
    call: CorporateCall,
    reference: unknown,
    query: AnalyticsPeriodDto,
  ) {
    const period = periodOf(query);
    return this.read(
      call,
      reference,
      'DELINQUENCY',
      query.mode,
      async (tx, asOf) => {
        const { undatedOpenOrganizations, unattributedInvoices, ...counts } =
          await this.aggregate<DelinquencyRow>(tx, delinquency(period, asOf));
        return {
          ...this.observation(query, asOf, 'ORBIT_STRIPE_RECONCILIATION'),
          ...counts,
          eligibility: 'ORGANIZATIONS_WITH_POSITIVE_ISSUED_INVOICE',
          coverage: {
            status:
              undatedOpenOrganizations ||
              (query.planCode && unattributedInvoices)
                ? 'PARTIAL'
                : 'AVAILABLE',
            undatedOpenOrganizations,
            unattributedInvoices,
            historicalPlanFilter: query.planCode !== undefined,
          },
        };
      },
    );
  }

  private async aggregate<T>(
    tx: PrismaTransactionClient,
    sql: Prisma.Sql,
  ): Promise<T> {
    const [row] = await tx.$queryRaw<T[]>(sql);
    if (!row) throw new Error('Commercial analytics aggregate missing');
    return row;
  }

  private observation(
    query: AnalyticsRecurringDto | AnalyticsPeriodDto,
    asOf: Date,
    source: string,
  ) {
    return {
      source,
      asOf,
      mode: query.mode,
      currency: query.currency,
      planCode: query.planCode ?? null,
      period: 'from' in query ? { from: query.from, to: query.to } : null,
    };
  }

  private read<T>(
    call: CorporateCall,
    reference: unknown,
    operation: Operation,
    mode: AnalyticsRecurringDto['mode'],
    work: (tx: PrismaTransactionClient, asOf: Date) => Promise<T>,
  ) {
    const audit = authorizedCorporateReference(
      call,
      reference,
      capability[operation],
      false,
    );
    return this.rls.runAmbient(
      async (tx) => {
        const [{ asOf }] = await tx.$queryRaw<[{ asOf: Date }]>`
        SELECT transaction_timestamp() AS "asOf",
          set_config('app.corporate_analytics_principal', ${audit.technicalPrincipalId}, true),
          set_config('app.corporate_analytics_operation', ${operation}, true),
          set_config('app.corporate_analytics_mode', ${mode}, true),
          set_config('statement_timeout', '5s', true)
      `;
        const result = await work(tx, asOf);
        await tx.auditLog.createMany({
          data: {
            entityType: 'SAAS_ANALYTICS',
            action: 'CORPORATE_ANALYTICS_READ',
            requestId: audit.correlationId,
            metadata: { ...audit, operation, mode, outcome: 'CONFIRMED' },
          },
        });
        return result;
      },
      { timeout: 12_000 },
    );
  }
}
