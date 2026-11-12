/**
 * Offline, restartable migration. Defaults to inspection only.
 * Run with the administrative DATABASE_URL in the migrator container, never HTTP runtime.
 * Originals and existing document hashes are preserved byte for byte; source volumes are read-only.
 */
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve, sep, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { generateUuidV7 } from '../utils';
import { loadStorageConfig } from '../modules/storage/storage.config';
import { S3CompatibleStorageProvider } from '../modules/storage/providers/s3-compatible.storage';
import {
  ImageOptimizationService,
  IMAGE_CACHE_CONTROL,
} from '../modules/storage/image-optimization.service';

interface LegacyFile {
  id: string;
  bucket: string;
  object_key: string;
  mime_type: string;
  sha256: string | null;
  provider: string;
  metadata: { purpose?: string };
}
interface LegacyAttachment {
  id: string;
  storage_key: string;
  mime_type: string;
  sha256: string | null;
  organization_id: string;
}
interface LegacyLink {
  id: string;
  document_bucket: string;
  document_object_key: string;
  document_sha256: string;
}
interface LegacyLogo {
  id: string;
  organization_id: string;
  logo_url: string;
}

const apply = process.argv.includes('--apply');
const hash = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const root = resolve(process.env.LEGACY_STORAGE_ROOT ?? '/legacy');
function sourcePath(kind: string, ...parts: string[]): string {
  const base = resolve(root, kind);
  const path = resolve(base, ...parts);
  if (!path.startsWith(`${base}${sep}`))
    throw new Error('Invalid legacy object path');
  return path;
}
async function main() {
  if (apply && process.env.STORAGE_MIGRATION_OFFLINE !== 'true')
    throw new Error(
      'Stop API/workers and set STORAGE_MIGRATION_OFFLINE=true before applying',
    );
  const config = loadStorageConfig();
  if (config.provider !== 'R2' || !config.s3)
    throw new Error('Migration requires R2 configuration');
  const storage = new S3CompatibleStorageProvider(
    'R2',
    config.bucket,
    config.s3,
  );
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const images = new ImageOptimizationService();
  let inspected = 0,
    migrated = 0;
  const copy = async (
    bucket: string,
    key: string,
    body: Buffer,
    mime: string,
    checksum: string | null,
    publicImage = false,
  ) => {
    if (checksum && hash(body) !== checksum)
      throw new Error('Legacy file hash mismatch; migration stopped');
    inspected++;
    if (!apply) return;
    await storage.put({
      bucket,
      objectKey: key,
      body,
      mimeType: mime,
      cacheControl: publicImage ? IMAGE_CACHE_CONTROL : 'private, no-store',
    });
    // A HEAD is insufficient: verify the actual bytes before changing a reference.
    if (hash(await storage.get({ bucket, objectKey: key })) !== hash(body))
      throw new Error('R2 verification failed; source/reference preserved');
  };
  try {
    await client.query(
      "SELECT set_config('app.is_platform_admin', 'true', false)",
    );
    // Keyset pages keep memory proportional to one file, not the complete tenant database.
    let cursor = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const { rows } = await client.query<LegacyFile>(
        `SELECT * FROM storage_files WHERE (provider='LOCAL' OR (provider='S3' AND metadata->>'source'='PMOC_CONTRACT_SIGNATURE')) AND status='AVAILABLE' AND deleted_at IS NULL AND id > $1::uuid ORDER BY id LIMIT 100`,
        [cursor],
      );
      for (const file of rows) {
        const body = await readFile(
          sourcePath('objects', file.bucket, file.object_key),
        );
        const publicImage =
          file.metadata?.purpose === 'USER_AVATAR' ||
          file.object_key.includes('/avatars/');
        const bucket = publicImage ? config.publicBucket! : config.bucket;
        // Preserve the key: frozen snapshots can reference it independently of storage_files.
        await copy(
          bucket,
          file.object_key,
          body,
          file.mime_type,
          file.sha256,
          publicImage,
        );
        if (apply) {
          await client.query(
            "UPDATE storage_files SET provider='R2', bucket=$1 WHERE id=$2 AND provider=$3",
            [bucket, file.id, file.provider],
          );
          migrated++;
        }
      }
      if (rows.length < 100) break;
      cursor = rows[rows.length - 1]!.id;
    }
    for (const kind of ['attachments', 'documents'] as const) {
      let cursor = '00000000-0000-0000-0000-000000000000';
      for (;;) {
        const sql =
          kind === 'attachments'
            ? `SELECT a.id,a.storage_key,a.mime_type,a.checksum AS sha256,o.organization_id FROM operation_attachments a JOIN operations o ON o.id=a.operation_id WHERE a.storage_key NOT LIKE '%/%' AND a.id > $1::uuid ORDER BY a.id LIMIT 100`
            : `SELECT id,storage_key,mime_type,sha256,organization_id FROM generated_documents WHERE storage_key NOT LIKE '%/%' AND id > $1::uuid ORDER BY id LIMIT 100`;
        const { rows } = await client.query<LegacyAttachment>(sql, [cursor]);
        for (const file of rows) {
          const body = await readFile(
            sourcePath(
              kind === 'attachments' ? 'operations' : 'documents',
              basename(file.storage_key),
            ),
          );
          // Preserve old keys: snapshots and deletion jobs may also use them.
          await copy(
            config.bucket,
            file.storage_key,
            body,
            file.mime_type,
            file.sha256,
          );
          if (apply) {
            if (kind === 'documents')
              await client.query(
                'UPDATE generated_documents SET storage_bucket=$1 WHERE id=$2',
                [config.bucket, file.id],
              );
            migrated++;
          }
        }
        if (rows.length < 100) break;
        cursor = rows[rows.length - 1]!.id;
      }
    }
    const links = await client.query<LegacyLink>(
      `SELECT id,document_bucket,document_object_key,document_sha256 FROM pmoc_plan_signature_links
      WHERE document_object_key IS NOT NULL AND document_bucket <> $1`,
      [config.bucket],
    );
    for (const link of links.rows) {
      const body = await readFile(
        sourcePath('objects', link.document_bucket, link.document_object_key),
      );
      await copy(
        config.bucket,
        link.document_object_key,
        body,
        'application/pdf',
        link.document_sha256,
      );
      if (apply) {
        await client.query(
          'UPDATE pmoc_plan_signature_links SET document_bucket=$1 WHERE id=$2',
          [config.bucket, link.id],
        );
        migrated++;
      }
    }
    for (const table of ['organizations', 'business_units'] as const) {
      let cursor = '00000000-0000-0000-0000-000000000000';
      for (;;) {
        const { rows } = await client.query<LegacyLogo>(
          `SELECT id,logo_url,${table === 'organizations' ? 'id' : 'organization_id'} AS organization_id FROM ${table} WHERE logo_url LIKE 'data:image/%' AND id > $1::uuid ORDER BY id LIMIT 100`,
          [cursor],
        );
        for (const row of rows) {
          const match =
            /^data:(image\/(?:png|jpeg|webp|heic));base64,([A-Za-z0-9+/=]+)$/.exec(
              row.logo_url,
            );
          if (!match) throw new Error('Invalid legacy logo');
          const body = await images.optimize(
            Buffer.from(match[2]!, 'base64'),
            match[1]!,
            true,
          );
          const key = `logos/${row.organization_id}/${row.id}/0-${row.id}.webp`;
          await copy(config.publicBucket!, key, body, 'image/webp', null, true);
          if (apply) {
            await client.query('BEGIN');
            try {
              await client.query(
                `INSERT INTO storage_files (id,organization_id,provider,bucket,object_key,file_name,mime_type,size_bytes,sha256,status,metadata)
                VALUES ($1,$2,'R2',$3,$4,'logo.webp','image/webp',$5,$6,'AVAILABLE',$7::jsonb)
                ON CONFLICT (provider,bucket,object_key) DO NOTHING`,
                [
                  generateUuidV7(),
                  row.organization_id,
                  config.publicBucket,
                  key,
                  body.length,
                  hash(body),
                  JSON.stringify({ purpose: 'BRAND_LOGO', ownerId: row.id }),
                ],
              );
              await client.query(
                `UPDATE ${table} SET logo_url=$1 WHERE id=$2 AND logo_url=$3`,
                [`${config.publicUrl}/${key}`, row.id, row.logo_url],
              );
              await client.query('COMMIT');
              migrated++;
            } catch (error) {
              await client.query('ROLLBACK');
              throw error;
            }
          }
        }
        if (rows.length < 100) break;
        cursor = rows[rows.length - 1]!.id;
      }
    }
    // Frozen snapshots keep old bucket/key references. R2_LEGACY_PRIVATE_BUCKETS
    // maps those bucket aliases to the private bucket without changing signed content.
    console.log(
      JSON.stringify({
        mode: apply ? 'APPLY' : 'INSPECT',
        inspected,
        migrated,
        sourcesDeleted: 0,
      }),
    );
  } finally {
    client.release();
    await pool.end();
    storage.onModuleDestroy();
  }
}
void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      stage: 'r2-migration-failed',
      errorClass: error instanceof Error ? error.name : 'Unknown',
      message:
        error instanceof Error && !('code' in error)
          ? error.message
          : 'Database or storage error; no source files were deleted',
    }),
  );
  process.exitCode = 1;
});
