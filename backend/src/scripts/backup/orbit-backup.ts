import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Client } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const critical = [
  'users',
  'organizations',
  'customers',
  'assets',
  'operations',
  'quotes',
  'background_jobs',
  'storage_files',
  'organization_subscriptions',
  '_prisma_migrations',
] as const;
const suffix =
  /^(daily|weekly)\/[0-9]{8}T[0-9]{6}Z-[a-f0-9-]{36}\/complete\.json$/;
const safeRole = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const format = 'orbit-postgres-age-v1';
const timeout = 3_600_000;

interface Archive {
  bytes: number;
  sha256: string;
}
interface Manifest {
  format: typeof format;
  createdAt: string;
  revision: string;
  postgresVersion: number;
  tables: Record<string, string>;
  migrations: string[];
  objectOwners: string[];
  retention: { tenantPurges: string; storageDeletions: string };
}
interface Marker {
  format: typeof format;
  createdAt: string;
  dump: Archive;
  manifest: Archive;
  retentionLedger: Archive;
}

function env(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error('missing_configuration');
  return value;
}

function storage() {
  const endpoint = new URL(env('ORBIT_BACKUP_R2_ENDPOINT'));
  const local =
    process.env.NODE_ENV === 'test' &&
    ['127.0.0.1', 'localhost', 'orbit-s3-test'].includes(endpoint.hostname);
  if (
    !local &&
    (endpoint.protocol !== 'https:' ||
      !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname) ||
      endpoint.origin !== endpoint.href.slice(0, -1))
  )
    throw new Error('invalid_backup_endpoint');
  const bucket = env('ORBIT_BACKUP_R2_BUCKET');
  if (
    (!local &&
      (bucket !== 'orbit-production-backups' ||
        process.env.ORBIT_BACKUP_DEPLOYMENT !== 'production')) ||
    (local && bucket !== 'orbit-e2e-backups')
  )
    throw new Error('invalid_backup_bucket');
  const client = new S3Client({
    region: 'auto',
    endpoint: endpoint.origin,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env('ORBIT_BACKUP_R2_ACCESS_KEY_ID'),
      secretAccessKey: env('ORBIT_BACKUP_R2_SECRET_ACCESS_KEY'),
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return { client, bucket };
}

function connection(mode: 'backup' | 'restore') {
  const url = new URL(env('DIRECT_DATABASE_URL'));
  const name = url.pathname.slice(1);
  const user = decodeURIComponent(url.username);
  const test = process.env.NODE_ENV === 'test';
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.password ||
    url.hostname === 'pgbouncer' ||
    url.port === '6432' ||
    !safeRole.test(user) ||
    !/^[A-Za-z0-9_]{1,63}$/.test(name) ||
    url.search ||
    url.hash
  )
    throw new Error('invalid_direct_database_configuration');
  if (mode === 'backup' && user !== 'orbit_backup')
    throw new Error('backup_role_required');
  if (
    mode === 'restore' &&
    (user !== 'orbit_restore_admin' ||
      !/^orbit_restore_[a-f0-9]{12,}$/.test(name) ||
      (!test && (url.hostname !== 'orbit-restore-db' || url.port !== '5432')))
  )
    throw new Error('disposable_restore_target_required');
  return {
    client: new Client({
      host: url.hostname,
      port: Number(url.port || '5432'),
      user,
      password: decodeURIComponent(url.password),
      database: name,
      application_name: 'orbit-backup',
      connectionTimeoutMillis: 5_000,
    }),
    commandEnv: {
      PATH: process.env.PATH,
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGDATABASE: name,
      PGUSER: user,
      PGPASSWORD: decodeURIComponent(url.password),
      LC_ALL: 'C',
    },
  };
}

function child(
  command: string,
  args: string[],
  commandEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH },
) {
  const process = spawn(command, args, {
    env: commandEnv,
    stdio: ['pipe', 'pipe', 'ignore'],
    timeout,
  });
  const done = new Promise<void>((resolve, reject) => {
    process.once('error', () => reject(new Error('child_process_failed')));
    process.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('child_process_failed')),
    );
  });
  return { process, done };
}

function crypto(mode: 'encrypt' | 'decrypt') {
  return child('orbit-backup-crypto', [
    mode,
    env('ORBIT_BACKUP_PASSPHRASE_FILE'),
  ]);
}

async function usingChildren(
  children: { process: ChildProcess; done: Promise<void> }[],
  streams: Promise<unknown>[],
) {
  try {
    await Promise.all([...children.map((item) => item.done), ...streams]);
  } finally {
    for (const item of children)
      if (item.process.exitCode === null) item.process.kill();
  }
}

async function archive(source: AsyncIterable<Uint8Array>): Promise<Archive> {
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of source) {
    bytes += chunk.length;
    digest.update(chunk);
  }
  return { sha256: digest.digest('hex'), bytes };
}
const equal = (first: Archive, second: Archive) =>
  first.bytes === second.bytes && first.sha256 === second.sha256;

async function counts(db: Client) {
  const {
    rows: [row],
  } = await db.query<Record<string, string>>(
    `SELECT ${critical.map((table) => `(SELECT count(*)::text FROM public."${table}") AS "${table}"`).join(',')}`,
  );
  return row!;
}

async function migrations(db: Client): Promise<string[]> {
  const { rows } = await db.query<{ migration_name: string }>(
    'SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
  );
  const pending = await db.query(
    'SELECT 1 FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL LIMIT 1',
  );
  if (pending.rowCount) throw new Error('incomplete_source_migration');
  return rows.map((row) => row.migration_name);
}

async function encryptDump(directory: string) {
  const { client, commandEnv } = connection('backup');
  const dump = resolve(directory, 'database.dump.age');
  const info = resolve(directory, 'metadata.json.age');
  const ledger = resolve(directory, 'retention-ledger.jsonl.age');
  const createdAt = new Date().toISOString();
  let manifest: Manifest;
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '30s'");
    const {
      rows: [source],
    } = await client.query<{
      snapshot: string;
      version: string;
      read_only: boolean;
      backup_role: boolean;
    }>(`
      SELECT pg_export_snapshot() AS snapshot,
        current_setting('server_version_num') AS version,
        current_setting('transaction_read_only')='on' AS read_only,
        (SELECT rolbypassrls AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication
           FROM pg_roles WHERE rolname=current_user) AS backup_role
    `);
    if (!source?.read_only || !source.backup_role)
      throw new Error('unexpected_backup_role');
    const { rows: roleRows } = await client.query<{ name: string }>(`
      SELECT rolname::text AS name FROM pg_roles
      WHERE rolname ~ '^orbit_' OR oid IN (SELECT datdba FROM pg_database WHERE datname=current_database())
      UNION SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE pronamespace='public'::regnamespace
      UNION SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relnamespace='public'::regnamespace
    `);
    if (roleRows.some(({ name }) => !safeRole.test(name)))
      throw new Error('invalid_source_role_name');
    const {
      rows: [retention],
    } = await client.query<Manifest['retention']>(`
      SELECT (SELECT count(*)::text FROM tenant_data_purges WHERE database_purged_at IS NOT NULL) AS "tenantPurges",
             (SELECT count(*)::text FROM storage_deletion_jobs WHERE reason='RETENTION') AS "storageDeletions"
    `);
    manifest = {
      format,
      createdAt,
      revision: process.env.ORBIT_COMMIT_SHA ?? 'unknown',
      postgresVersion: Number(source.version),
      tables: await counts(client),
      migrations: await migrations(client),
      objectOwners: roleRows.map(({ name }) => name),
      retention: retention!,
    };
    const pgDump = child(
      'pg_dump',
      [
        '--format=custom',
        '--compress=6',
        '--schema=public',
        '--lock-wait-timeout=10s',
        '--no-password',
        '--snapshot=' + source.snapshot,
      ],
      commandEnv,
    );
    const age = crypto('encrypt');
    await usingChildren(
      [pgDump, age],
      [
        pipeline(pgDump.process.stdout, age.process.stdin),
        pipeline(age.process.stdout, createWriteStream(dump, { mode: 0o600 })),
      ],
    );
    // Use the same exported snapshot for the independently recoverable ledger.
    if (!/^[0-9A-F-]+$/i.test(source.snapshot))
      throw new Error('invalid_pg_snapshot');
    const records = child(
      'psql',
      [
        '-XqAt',
        '-w',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        `
      BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
      SET TRANSACTION SNAPSHOT '${source.snapshot}';
      SET LOCAL statement_timeout = '30s';
      SELECT jsonb_build_object('kind','purge','organizationId',organization_id,'id',id,
        'retentionEndsAt',retention_ends_at,'databasePurgedAt',database_purged_at,
        'completedAt',completed_at,'status',status)
      FROM tenant_data_purges WHERE database_purged_at IS NOT NULL
      UNION ALL
      SELECT jsonb_build_object('kind','object','organizationId',organization_id,'purgeId',purge_id,
        'provider',provider,'bucket',bucket,'objectKey',object_key,'status',status)
      FROM storage_deletion_jobs WHERE reason='RETENTION';
      COMMIT;
    `,
      ],
      commandEnv,
    );
    const ledgerCrypto = crypto('encrypt');
    await usingChildren(
      [records, ledgerCrypto],
      [
        pipeline(records.process.stdout, ledgerCrypto.process.stdin),
        pipeline(
          ledgerCrypto.process.stdout,
          createWriteStream(ledger, { mode: 0o600 }),
        ),
      ],
    );
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
  const age = crypto('encrypt');
  await usingChildren(
    [age],
    [
      pipeline(Readable.from([JSON.stringify(manifest)]), age.process.stdin),
      pipeline(age.process.stdout, createWriteStream(info, { mode: 0o600 })),
    ],
  );
  return { dump, info, ledger, createdAt };
}

async function upload(
  client: S3Client,
  bucket: string,
  key: string,
  file: string,
) {
  const expected = await archive(createReadStream(file));
  const transfer = new Upload({
    client,
    queueSize: 2,
    partSize: 16 * 1024 * 1024,
    leavePartsOnError: false,
    params: {
      Bucket: bucket,
      Key: key,
      Body: createReadStream(file),
      ContentLength: expected.bytes,
      ContentType: 'application/octet-stream',
      CacheControl: 'private, no-store',
    },
  });
  await transfer.done();
  const stored = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { abortSignal: AbortSignal.timeout(timeout) },
  );
  if (!stored.Body || !equal(expected, await archive(stored.Body as Readable)))
    throw new Error('backup_readback_checksum_mismatch');
  return expected;
}

async function backup(
  client: S3Client,
  bucket: string,
  directory: string,
  cadence: string,
) {
  if (cadence !== 'daily' && cadence !== 'weekly')
    throw new Error('invalid_cadence');
  const { dump, info, ledger, createdAt } = await encryptDump(directory);
  const stamp = createdAt.slice(0, 19).replace(/[-:]/g, '') + 'Z';
  const prefix = `${cadence}/${stamp}-${randomUUID()}/`;
  const marker: Marker = {
    format,
    createdAt,
    dump: await upload(client, bucket, prefix + 'database.dump.age', dump),
    manifest: await upload(client, bucket, prefix + 'metadata.json.age', info),
    retentionLedger: await upload(
      client,
      bucket,
      prefix + 'retention-ledger.jsonl.age',
      ledger,
    ),
  };
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: prefix + 'complete.json',
      Body: JSON.stringify(marker),
      ContentType: 'application/json',
      CacheControl: 'private, no-store',
    }),
    { abortSignal: AbortSignal.timeout(30_000) },
  );
  console.log(
    JSON.stringify({
      event: 'orbit_backup_complete',
      cadence,
      createdAt,
      bytes: marker.dump.bytes,
    }),
  );
}

async function latest(client: S3Client, bucket: string) {
  let token: string | undefined;
  let selected: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
    for (const { Key } of page.Contents ?? []) {
      if (
        Key &&
        suffix.test(Key) &&
        (!selected || Key.split('/')[1]! > selected.split('/')[1]!)
      )
        selected = Key;
    }
    token = page.NextContinuationToken;
  } while (token);
  if (!selected) throw new Error('no_complete_backup');
  return selected;
}

async function download(
  client: S3Client,
  bucket: string,
  key: string,
  target: string,
  expected: Archive,
) {
  if (
    !/^[a-f0-9]{64}$/.test(expected.sha256) ||
    !Number.isSafeInteger(expected.bytes) ||
    expected.bytes < 1
  )
    throw new Error('invalid_backup_manifest');
  const stored = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { abortSignal: AbortSignal.timeout(timeout) },
  );
  if (!stored.Body || stored.ContentLength !== expected.bytes)
    throw new Error('backup_download_size_mismatch');
  await pipeline(
    stored.Body as Readable,
    createWriteStream(target, { mode: 0o600 }),
  );
  if (!equal(await archive(createReadStream(target)), expected))
    throw new Error('backup_download_checksum_mismatch');
}

async function restore(
  client: S3Client,
  bucket: string,
  directory: string,
  suppliedKey?: string,
) {
  const started = performance.now();
  const key = suppliedKey ?? (await latest(client, bucket));
  if (!suffix.test(key)) throw new Error('invalid_backup_key');
  const { Body, ContentLength } = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { abortSignal: AbortSignal.timeout(30_000) },
  );
  if (!Body || !ContentLength || ContentLength > 4096)
    throw new Error('invalid_complete_marker');
  const marker = JSON.parse(await Body.transformToString()) as Marker;
  if (marker.format !== format) throw new Error('incompatible_backup_format');
  const prefix = key.slice(0, -'complete.json'.length);
  const dump = resolve(directory, 'database.dump.age');
  const info = resolve(directory, 'metadata.json.age');
  await download(
    client,
    bucket,
    prefix + 'database.dump.age',
    dump,
    marker.dump,
  );
  await download(
    client,
    bucket,
    prefix + 'metadata.json.age',
    info,
    marker.manifest,
  );
  const ledger = resolve(directory, 'retention-ledger.jsonl.age');
  await download(
    client,
    bucket,
    prefix + 'retention-ledger.jsonl.age',
    ledger,
    marker.retentionLedger,
  );
  if ((await stat(info)).size > 512 * 1024)
    throw new Error('metadata_limit_exceeded');
  const metadata = crypto('decrypt');
  const chunks: Buffer[] = [];
  await usingChildren(
    [metadata],
    [
      pipeline(createReadStream(info), metadata.process.stdin),
      (async () => {
        for await (const chunk of metadata.process.stdout) {
          if (!Buffer.isBuffer(chunk))
            throw new Error('invalid_metadata_stream');
          chunks.push(chunk);
        }
      })(),
    ],
  );
  const manifest = JSON.parse(Buffer.concat(chunks).toString()) as Manifest;
  if (
    manifest.format !== format ||
    manifest.createdAt !== marker.createdAt ||
    manifest.objectOwners.some((role) => !safeRole.test(role))
  )
    throw new Error('invalid_source_manifest');

  const ledgerProcess = crypto('decrypt');
  const ledgerCounts = { purge: 0n, object: 0n };
  await usingChildren(
    [ledgerProcess],
    [
      pipeline(createReadStream(ledger), ledgerProcess.process.stdin),
      (async () => {
        const lines = createInterface({
          input: ledgerProcess.process.stdout,
          crlfDelay: Infinity,
        });
        for await (const line of lines) {
          const entry = JSON.parse(line) as { kind: string };
          if (entry.kind !== 'purge' && entry.kind !== 'object')
            throw new Error('invalid_retention_ledger_record');
          ledgerCounts[entry.kind]++;
        }
      })(),
    ],
  );
  if (
    ledgerCounts.purge.toString() !== manifest.retention.tenantPurges ||
    ledgerCounts.object.toString() !== manifest.retention.storageDeletions
  )
    throw new Error('retention_ledger_count_mismatch');

  const { client: db, commandEnv } = connection('restore');
  await db.connect();
  try {
    const {
      rows: [safety],
    } = await db.query<{ empty: boolean; version: string }>(`
      SELECT NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace) AS empty,
        current_setting('server_version_num') AS version
    `);
    if (
      !safety?.empty ||
      Math.floor(Number(safety.version) / 10000) !==
        Math.floor(manifest.postgresVersion / 10000)
    )
      throw new Error('invalid_disposable_restore_schema');
    for (const role of manifest.objectOwners) {
      const { rowCount } = await db.query(
        'SELECT 1 FROM pg_roles WHERE rolname=$1',
        [role],
      );
      if (!rowCount)
        await db.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    }
    const age = crypto('decrypt');
    const pgRestore = child(
      'pg_restore',
      [
        '--dbname=' + commandEnv.PGDATABASE,
        '--clean',
        '--if-exists',
        '--exit-on-error',
        '--single-transaction',
        '--no-password',
      ],
      commandEnv,
    );
    pgRestore.process.stdout?.resume();
    await usingChildren(
      [age, pgRestore],
      [
        pipeline(createReadStream(dump), age.process.stdin),
        pipeline(age.process.stdout, pgRestore.process.stdin),
      ],
    );
    const actual = await counts(db);
    if (critical.some((table) => actual[table] !== manifest.tables[table]))
      throw new Error('restored_row_count_mismatch');
    if (
      JSON.stringify(await migrations(db)) !==
      JSON.stringify(manifest.migrations)
    )
      throw new Error('restored_migrations_mismatch');
    const {
      rows: [proof],
    } = await db.query<{ missing: boolean; invalid: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p')
          AND relname NOT IN ('_prisma_migrations','modules','pmoc_plan_name_options')
          AND NOT (relrowsecurity AND relforcerowsecurity)
      ) AS missing, EXISTS (
        SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND NOT convalidated
      ) AS invalid
    `);
    if (!proof || proof.missing || proof.invalid)
      throw new Error('restored_rls_or_foreign_key_invalid');
    console.log(
      JSON.stringify({
        event: 'orbit_backup_restore_verified',
        criticalTables: critical.length,
        migrations: manifest.migrations.length,
        createdAt: manifest.createdAt,
        durationMs: Math.round(performance.now() - started),
      }),
    );
  } finally {
    await db.end();
  }
}

async function main() {
  process.umask(0o077);
  const [action, choice] = process.argv.slice(2);
  const { client, bucket } = storage();
  const directory = await mkdtemp(
    resolve(env('ORBIT_BACKUP_SCRATCH'), 'orbit-backup-'),
  );
  try {
    if (action === 'backup')
      return await backup(client, bucket, directory, choice ?? 'daily');
    if (action === 'verify')
      return await restore(client, bucket, directory, choice);
    throw new Error('invalid_operation');
  } finally {
    client.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  const code =
    error instanceof Error && /^[a-z][a-z0-9_]{0,70}$/.test(error.message)
      ? error.message
      : 'backup_operation_failed';
  console.error(JSON.stringify({ event: 'orbit_backup_error', code }));
  process.exitCode = 1;
});
