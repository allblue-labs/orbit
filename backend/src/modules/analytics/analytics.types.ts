export type AnalyticsGranularity = 'DAY' | 'WEEK' | 'MONTH';
export type AnalyticsRange = {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  granularity: AnalyticsGranularity;
  businessUnitId?: string;
};

export type AnalyticsOperation = {
  id: string;
  status: string;
  scheduledEnd: Date | null;
  scheduledStart?: Date | null;
  responsibleFieldTechnicianId?: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  users: Array<{ user: { id: string; displayName: string } }>;
};

export type AnalyticsCommitment = {
  status: string;
  /** Planned date, retained for the existing trend series. */
  createdAt: Date;
  deadlineAt?: Date;
  finalizedAt: Date | null;
};

export type AnalyticsSnapshot = {
  organization: { id: string; segment: string };
  range: AnalyticsRange;
  operations: AnalyticsOperation[];
  previousOperations: AnalyticsOperation[];
  pmocs: AnalyticsCommitment[];
  previousPmocs?: AnalyticsCommitment[];
  rvts?: AnalyticsCommitment[];
  previousRvts?: AnalyticsCommitment[];
  assets: Array<{ status: string }>;
  customers: Array<{ status: string }>;
};
