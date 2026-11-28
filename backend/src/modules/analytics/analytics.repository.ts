import { Injectable } from '@nestjs/common';
import { RlsTransaction } from '../../database';
import { EntityNotFoundException } from '../../exceptions';
import { commitmentAnalytics, operationAnalytics } from './analytics.queries';
import type { AnalyticsDomain, TrendPoint } from './analytics.read-models';
import type {
  AnalyticsRange,
  AnalyticsSnapshot,
  CommitmentCounts,
  OperationCounts,
  PeriodCounts,
} from './analytics.types';

const emptyOperations: OperationCounts = {
  cohort: 0,
  scheduled: 0,
  assigned: 0,
  delivered: 0,
  withDeadline: 0,
  onTime: 0,
};
const emptyCommitments: CommitmentCounts = { total: 0, overdue: 0, onTime: 0 };
type OperationSummary = AnalyticsSnapshot['operations'] & {
  createdTrend: TrendPoint[];
  completedTrend: TrendPoint[];
};
type CommitmentSummary = PeriodCounts<CommitmentCounts> & {
  trend: TrendPoint[];
};

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly rls: RlsTransaction) {}

  snapshot(
    organizationId: string,
    range: AnalyticsRange,
    domains: ReadonlySet<AnalyticsDomain>,
    includeTrends = true,
  ): Promise<AnalyticsSnapshot> {
    return this.rls.run(async (tx) => {
      const organization = await tx.organization.findFirst({
        where: { id: organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!organization)
        throw new EntityNotFoundException('Organization', organizationId);

      const technicians = domains.has('TECHNICIANS');
      const operations =
        domains.has('OPERATIONS') || technicians
          ? (
              await tx.$queryRaw<OperationSummary[]>(
                operationAnalytics(
                  organizationId,
                  range,
                  includeTrends && domains.has('OPERATIONS'),
                  technicians,
                ),
              )
            )[0]!
          : {
              current: emptyOperations,
              previous: emptyOperations,
              open: 0,
              overdue: 0,
              openWithDeadline: 0,
              unassigned: 0,
              unscheduled: 0,
              completedCohort: 0,
              activeTechnicians: 0,
              createdTrend: [],
              completedTrend: [],
            };
      const { createdTrend, completedTrend, ...operationCounts } = operations;

      const commitment = async (
        domain: 'PMOC' | 'RVT',
      ): Promise<CommitmentSummary> =>
        domains.has(domain)
          ? (
              await tx.$queryRaw<CommitmentSummary[]>(
                commitmentAnalytics(
                  domain,
                  organizationId,
                  range,
                  includeTrends,
                ),
              )
            )[0]!
          : {
              current: emptyCommitments,
              previous: emptyCommitments,
              trend: [],
            };
      const { trend: pmocTrend, ...pmoc } = await commitment('PMOC');
      const { current, previous } = await commitment('RVT');
      const equipmentRegistered = domains.has('EQUIPMENT')
        ? await tx.asset.count({
            where: {
              organizationId,
              businessUnitId: range.businessUnitId,
              deletedAt: null,
            },
          })
        : 0;

      return {
        range,
        operations: operationCounts,
        pmoc,
        rvt: { current, previous },
        equipmentRegistered,
        trends: {
          created: createdTrend,
          completed: completedTrend,
          pmoc: pmocTrend,
        },
      };
    });
  }
}
