export function directDatabaseUrl(): string {
  const value =
    process.env.DIRECT_DATABASE_URL?.trim() ||
    (process.env.NODE_ENV === 'production'
      ? undefined
      : process.env.DATABASE_URL?.trim());
  if (!value)
    throw new Error(
      'DIRECT_DATABASE_URL is required for administrative commands',
    );
  const url = new URL(value);
  if (
    url.hostname === 'pgbouncer' ||
    url.port === '6432' ||
    url.searchParams.has('pgbouncer')
  )
    throw new Error(
      'DIRECT_DATABASE_URL must use the direct PostgreSQL connection',
    );
  return value;
}
