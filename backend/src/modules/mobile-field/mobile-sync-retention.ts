const DAY_MS = 86_400_000;

function positiveInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function mobileSyncRetention() {
  const maxOfflineReplayDays = positiveInteger(
    'MOBILE_SYNC_MAX_OFFLINE_REPLAY_DAYS',
    90,
  );
  const receiptDays = Math.max(
    maxOfflineReplayDays,
    positiveInteger('MOBILE_SYNC_RECEIPT_RETENTION_DAYS', 120),
  );
  const journalDays = positiveInteger(
    'MOBILE_SYNC_JOURNAL_RETENTION_DAYS',
    120,
  );
  const cleanupBatchSize = Math.min(
    5_000,
    positiveInteger('MOBILE_SYNC_CLEANUP_BATCH_SIZE', 500),
  );
  return { maxOfflineReplayDays, receiptDays, journalDays, cleanupBatchSize };
}

export function retentionDate(daysFromNow: number): Date {
  return new Date(Date.now() + daysFromNow * DAY_MS);
}

export function replayCutoff(): Date {
  return retentionDate(-mobileSyncRetention().maxOfflineReplayDays);
}
