export const DATA_RETENTION_DAYS = 30;
export const DATA_RETENTION_MS = DATA_RETENTION_DAYS * 24 * 60 * 60_000;
export function retentionDeadline(accessEndsAt: Date): Date {
  return new Date(accessEndsAt.getTime() + DATA_RETENTION_MS);
}
