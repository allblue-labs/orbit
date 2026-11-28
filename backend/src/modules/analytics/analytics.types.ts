import type { TrendPoint } from './analytics.read-models';

export type AnalyticsGranularity = 'DAY' | 'WEEK' | 'MONTH';
export type AnalyticsRange = {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  granularity: AnalyticsGranularity;
  businessUnitId?: string;
};

export type OperationCounts = {
  cohort: number;
  scheduled: number;
  assigned: number;
  delivered: number;
  withDeadline: number;
  onTime: number;
};

export type OperationBacklog = {
  open: number;
  overdue: number;
  openWithDeadline: number;
  unassigned: number;
  unscheduled: number;
};

export type CommitmentCounts = {
  total: number;
  overdue: number;
  onTime: number;
};
export type PeriodCounts<T> = { current: T; previous: T };
export type AnalyticsSnapshot = {
  range: AnalyticsRange;
  operations: PeriodCounts<OperationCounts> &
    OperationBacklog & {
      completedCohort: number;
      activeTechnicians: number;
    };
  pmoc: PeriodCounts<CommitmentCounts>;
  rvt: PeriodCounts<CommitmentCounts>;
  equipmentRegistered: number;
  trends: {
    created: TrendPoint[];
    completed: TrendPoint[];
    pmoc: TrendPoint[];
  };
};
