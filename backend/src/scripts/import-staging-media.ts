import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { directDatabaseUrl } from './direct-database-url';
import { LocalFilesystemStorageProvider } from '../modules/storage/providers/local-filesystem.storage';
import { S3CompatibleStorageProvider } from '../modules/storage/providers/s3-compatible.storage';

interface Reference {
  bucket: string;
  object_key: string;
  sha256: string | null;
}

const privateBucket = 'orbit-assets-private';
const publicBucket = 'orbit-assets';
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

const references = `
  SELECT bucket, object_key, sha256 FROM storage_files
  WHERE provider='R2' AND status='AVAILABLE' AND deleted_at IS NULL
  UNION
  SELECT storage_bucket, storage_key, checksum FROM operation_attachments
  WHERE storage_provider='R2' AND deleted_at IS NULL
  UNION
  SELECT storage_bucket, storage_key, checksum FROM artifact_execution_attachments
  WHERE storage_provider='R2' AND file_id IS NULL AND deleted_at IS NULL
  UNION
  SELECT storage_bucket, storage_key, sha256 FROM generated_documents
  WHERE storage_provider='R2'
  UNION
  SELECT document_bucket, document_object_key, document_sha256
  FROM pmoc_plan_signature_links WHERE document_provider='R2' AND document_object_key IS NOT NULL
  UNION
  SELECT avatar_bucket, avatar_object_key, NULL FROM customer_portal_identities
  WHERE avatar_object_key IS NOT NULL AND avatar_bucket IN ('orbit-assets', 'orbit-assets-private')
  UNION
  SELECT signature_bucket, signature_object_key, NULL FROM customer_portal_identities
  WHERE signature_object_key IS NOT NULL AND signature_bucket IN ('orbit-assets', 'orbit-assets-private')
`;

async function main() {
  const connectionString = directDatabaseUrl();
  const database = new URL(connectionString);
  if (
    process.env.ORBIT_DEPLOYMENT !== 'staging' ||
    database.hostname !== 'postgres' ||
    database.pathname !== '/orbit_staging'
  )
    throw new Error('staging_database_required');

  const endpoint = process.env.ORBIT_IMPORT_R2_ENDPOINT;
  const accessKeyId = process.env.ORBIT_IMPORT_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.ORBIT_IMPORT_R2_SECRET_ACCESS_KEY;
  if (
    !endpoint ||
    !/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint) ||
    !accessKeyId ||
    !secretAccessKey
  )
    throw new Error('missing_import_credentials');

  const client = new Client({
    connectionString,
    application_name: 'orbit-staging-media-import',
  });
  const local = new LocalFilesystemStorageProvider(
    privateBucket,
    '/app/staging-media',
    '',
    '',
  );
  const source = new S3CompatibleStorageProvider('R2', privateBucket, {
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    accessKeyId,
    secretAccessKey,
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    // The job is offline. Advisory locking also serializes accidental parallel imports.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('orbit-staging-media-import'))",
    );
    await client.query(
      "SELECT set_config('app.is_platform_admin','true',true)",
    );
    const { rows } = await client.query<Reference>(references);
    let verified = 0;
    for (const { bucket, object_key, sha256 } of rows) {
      if (
        ![privateBucket, publicBucket].includes(bucket) ||
        !object_key ||
        object_key
          .split('/')
          .some((segment) => !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(segment))
      )
        throw new Error('unexpected_storage_reference');
      const ref = { bucket, objectKey: object_key };
      const existing = await local.head(ref);
      if (existing && sha256 && hash(await local.get(ref)) === sha256) {
        verified++;
        continue;
      }
      const body = await source.get(ref);
      const digest = hash(body);
      if (sha256 && sha256 !== digest)
        throw new Error('source_checksum_mismatch');
      if (!existing)
        await local.put({ ...ref, body, mimeType: 'application/octet-stream' });
      if (hash(await local.get(ref)) !== digest)
        throw new Error('local_checksum_mismatch');
      verified++;
    }

    // Keep all keys, bucket names and document hashes. Only the locator changes.
    await client.query(`
      UPDATE storage_files SET provider='LOCAL' WHERE provider='R2';
      UPDATE operation_attachments SET storage_provider='LOCAL' WHERE storage_provider='R2';
      UPDATE artifact_execution_attachments SET storage_provider='LOCAL' WHERE storage_provider='R2';
      UPDATE generated_documents SET storage_provider='LOCAL' WHERE storage_provider='R2';
      UPDATE pmoc_plan_signature_links SET document_provider='LOCAL' WHERE document_provider='R2';
      UPDATE storage_deletion_jobs SET provider='LOCAL' WHERE provider='R2' AND status<>'COMPLETE';
      UPDATE organizations SET logo_url='r2-object:' || substr(logo_url, length('https://cdn-orbit.allblue-labs.com/') + 1)
      WHERE logo_url LIKE 'https://cdn-orbit.allblue-labs.com/logos/%';
      UPDATE business_units SET logo_url='r2-object:' || substr(logo_url, length('https://cdn-orbit.allblue-labs.com/') + 1)
      WHERE logo_url LIKE 'https://cdn-orbit.allblue-labs.com/logos/%'
    `);
    await client.query('COMMIT');
    console.log(
      JSON.stringify({
        event: 'orbit_staging_media_import_complete',
        verified,
      }),
    );
  } finally {
    await client.end();
    source.onApplicationShutdown();
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'orbit_staging_media_import_failed',
      reason:
        error instanceof Error && /^[a-z_]+$/.test(error.message)
          ? error.message
          : 'storage_or_database_failure',
    }),
  );
  process.exitCode = 1;
});
