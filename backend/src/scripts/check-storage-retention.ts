import { directDatabaseUrl } from './direct-database-url';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { mediaInventory } from '../modules/billing/retention/media-inventory';
import { loadStorageConfig } from '../modules/storage/storage.config';
import { createStorageProvider } from '../modules/storage/storage.module';

/** Offline operator tool: defaults to read-only. Never deletes files or discovers credentials. */
async function main() {
  const arg = (name: string) =>
    process.argv
      .find((value) => value.startsWith(`--${name}=`))
      ?.slice(name.length + 3);
  const organizationId = arg('organization');
  if (!organizationId || !/^[a-f0-9-]{36}$/i.test(organizationId))
    throw new Error(
      'Explicit organization UUID and administrative DIRECT_DATABASE_URL required',
    );
  const attest = process.argv.includes('--attest');
  const config = loadStorageConfig();
  const legacyBucket = arg('legacy-bucket');
  const allowedBuckets = new Set(
    [config.bucket, config.privateBucket, config.publicBucket].filter(Boolean),
  );
  if (
    attest &&
    (arg('legacy-provider') !== config.provider ||
      !legacyBucket ||
      !allowedBuckets.has(legacyBucket))
  )
    throw new Error(
      'Attestation requires the configured provider and an explicitly configured legacy bucket',
    );
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: directDatabaseUrl() }),
  });
  const storage = createStorageProvider(config);
  try {
    const inventory = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe('SET LOCAL row_security=off');
      return mediaInventory(tx, organizationId);
    });
    const outbox = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe('SET LOCAL row_security=off');
      return tx.storageDeletionJob.findMany({
        where: { organizationId },
        select: {
          id: true,
          provider: true,
          bucket: true,
          objectKey: true,
          status: true,
        },
      });
    });
    const counts = {
      registered: inventory.length,
      outboxRecords: outbox.length,
      completedObjectsStillPresent: 0,
      present: 0,
      missing: 0,
      unknownLocation: 0,
      providerMismatch: 0,
      unavailable: 0,
      attested: 0,
      scanned: 0,
      orphanCandidates: 0,
    };
    const records = [
      ...inventory,
      ...outbox.map((job) => ({ ...job, kind: 'outbox', checksum: null })),
    ];
    const completed = new Set(
      outbox.filter((job) => job.status === 'COMPLETE').map((job) => job.id),
    );
    for (const file of records) {
      const unknown = !file.provider || !file.bucket;
      if (unknown && !attest) {
        counts.unknownLocation++;
        continue;
      }
      if (file.provider && file.provider !== config.provider) {
        counts.providerMismatch++;
        continue;
      }
      const bucket = file.bucket ?? legacyBucket!;
      if (!allowedBuckets.has(bucket)) {
        counts.unknownLocation++;
        continue;
      }
      try {
        const ref = { bucket, objectKey: file.objectKey };
        const stat = await storage.head(ref);
        if (!stat) {
          counts.missing++;
          continue;
        }
        counts.present++;
        if (file.kind === 'outbox' && completed.has(file.id))
          counts.completedObjectsStillPresent++;
        if (!unknown || !attest) continue;
        // No empty/missing/hashless object is certified, nor an unbounded download.
        if (
          !file.checksum ||
          !/^[a-f0-9]{64}$/.test(file.checksum) ||
          stat.sizeBytes > 50 * 1024 * 1024
        ) {
          counts.unknownLocation++;
          continue;
        }
        const sha = createHash('sha256')
          .update(await storage.get(ref))
          .digest('hex');
        if (sha !== file.checksum) {
          counts.unknownLocation++;
          continue;
        }
        const definitions: Record<
          string,
          {
            table: string;
            provider: string;
            bucket: string;
            key: string;
            hash: string;
          }
        > = {
          operation: {
            table: 'operation_attachments',
            provider: 'storage_provider',
            bucket: 'storage_bucket',
            key: 'storage_key',
            hash: 'checksum',
          },
          document: {
            table: 'generated_documents',
            provider: 'storage_provider',
            bucket: 'storage_bucket',
            key: 'storage_key',
            hash: 'sha256',
          },
          artifact: {
            table: 'artifact_execution_attachments',
            provider: 'storage_provider',
            bucket: 'storage_bucket',
            key: 'storage_key',
            hash: 'checksum',
          },
          pmoc: {
            table: 'pmoc_plan_signature_links',
            provider: 'document_provider',
            bucket: 'document_bucket',
            key: 'document_object_key',
            hash: 'document_sha256',
          },
        };
        const d = definitions[file.kind];
        if (!d) {
          counts.unknownLocation++;
          continue;
        }
        // Identifiers are exclusively the fixed allowlist above. Values remain bound.
        const changed = await prisma.$executeRawUnsafe(
          `UPDATE ${d.table} SET ${d.provider}=$1,${d.bucket}=$2
          WHERE id=$3::uuid AND ${d.key}=$4 AND ${d.hash}=$5 AND ${d.provider} IS NULL`,
          config.provider,
          bucket,
          file.id,
          file.objectKey,
          sha,
        );
        counts.attested += changed;
      } catch {
        counts.unavailable++;
      }
    }
    const prefix = arg('scan-prefix');
    const scanBucket = arg('scan-bucket');
    if (prefix) {
      // Deliberately bounded and tenant-scoped; unreferenced objects are candidates, never deletion instructions.
      if (
        !new RegExp(`^[a-z0-9-]+/${organizationId}/$`, 'i').test(prefix) ||
        !scanBucket ||
        !allowedBuckets.has(scanBucket)
      )
        throw new Error(
          'Scan requires namespace/organizationUUID/ and a configured bucket',
        );
      const known = new Set(
        records.filter((f) => f.bucket === scanBucket).map((f) => f.objectKey),
      );
      const account = (key: string) => {
        counts.scanned++;
        if (!known.has(key)) counts.orphanCandidates++;
      };
      if (config.s3) {
        const s3 = new S3Client({
          ...config.s3,
          credentials: {
            accessKeyId: config.s3.accessKeyId,
            secretAccessKey: config.s3.secretAccessKey,
          },
          maxAttempts: 2,
        });
        try {
          let cursor: string | undefined;
          do {
            const page = await s3.send(
              new ListObjectsV2Command({
                Bucket: scanBucket,
                Prefix: prefix,
                MaxKeys: 1000,
                ContinuationToken: cursor,
              }),
              { abortSignal: AbortSignal.timeout(45_000) },
            );
            for (const object of page.Contents ?? [])
              if (object.Key) account(object.Key);
            cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
            if (counts.scanned >= 10000 && cursor)
              throw new Error('Scan bound exceeded; narrow the inventory');
          } while (cursor);
        } finally {
          s3.destroy();
        }
      } else {
        const base = resolve(config.localRoot, scanBucket),
          start = resolve(base, prefix);
        if (!start.startsWith(`${base}${sep}`))
          throw new Error('Invalid scan path');
        async function walk(path: string): Promise<void> {
          let entries;
          try {
            entries = await readdir(path, { withFileTypes: true });
          } catch (e) {
            if (
              e &&
              typeof e === 'object' &&
              'code' in e &&
              e.code === 'ENOENT'
            )
              return;
            throw e;
          }
          for (const entry of entries) {
            const child = resolve(path, entry.name);
            if (entry.isDirectory()) await walk(child);
            else if (entry.isFile())
              account(
                child
                  .slice(base.length + 1)
                  .split(sep)
                  .join('/'),
              );
            if (counts.scanned >= 10000) throw new Error('Scan bound exceeded');
          }
        }
        await walk(start);
      }
    }
    const [purges, jobs] = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe('SET LOCAL row_security=off');
      return [
        await tx.tenantDataPurge.groupBy({
          by: ['status'],
          where: { organizationId },
          _count: true,
        }),
        await tx.storageDeletionJob.groupBy({
          by: ['status'],
          where: { organizationId },
          _count: true,
        }),
      ];
    });
    console.log(
      JSON.stringify(
        {
          stage: 'storage-retention-preflight',
          mode: attest ? 'HASH_VERIFIED_LOCATION_ATTESTATION' : 'READ_ONLY',
          counts,
          purges,
          jobs,
        },
        null,
        2,
      ),
    );
    if (
      counts.unknownLocation ||
      counts.providerMismatch ||
      counts.unavailable ||
      counts.completedObjectsStillPresent
    )
      process.exitCode = 2;
  } finally {
    (
      storage as typeof storage & { onModuleDestroy?: () => void }
    ).onModuleDestroy?.();
    await prisma.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    'Storage retention preflight failed. Check explicit arguments, administrative visibility, schema and provider; no files were deleted.',
  );
  process.exitCode = 1;
});
