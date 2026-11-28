import type { PrismaTransactionClient } from '../../database/prisma.types';
import type { StorageObjectRef } from './storage.types';

/** Conservative across providers for legacy rows whose original provider is unknown. */
export async function hasForeignObjectReference(
  tx: PrismaTransactionClient,
  organizationId: string,
  ref: StorageObjectRef,
  buckets: readonly string[] = [ref.bucket],
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ foreign: boolean }[]>`SELECT (
    EXISTS (SELECT 1 FROM storage_files WHERE organization_id<>${organizationId}::uuid
      AND ((bucket=ANY(${[...buckets]}::text[]) AND object_key=${ref.objectKey}) OR
        (metadata->>'sourceBucket'=ANY(${[...buckets]}::text[]) AND metadata->>'sourceObjectKey'=${ref.objectKey})))
    OR EXISTS (SELECT 1 FROM operation_attachments a JOIN operations o ON o.id=a.operation_id
      WHERE o.organization_id<>${organizationId}::uuid AND a.storage_key=${ref.objectKey}
        AND (a.storage_bucket IS NULL OR a.storage_bucket=ANY(${[...buckets]}::text[])))
    OR EXISTS (SELECT 1 FROM generated_documents WHERE organization_id<>${organizationId}::uuid
      AND storage_bucket=ANY(${[...buckets]}::text[]) AND storage_key=${ref.objectKey})
    OR EXISTS (SELECT 1 FROM pmoc_plan_signature_links WHERE organization_id<>${organizationId}::uuid
      AND document_bucket=ANY(${[...buckets]}::text[]) AND document_object_key=${ref.objectKey})
    OR EXISTS (SELECT 1 FROM artifact_execution_attachments WHERE organization_id<>${organizationId}::uuid
      AND file_id IS NULL AND storage_key=${ref.objectKey} AND (storage_bucket IS NULL OR storage_bucket=ANY(${[...buckets]}::text[])))
  ) AS foreign`;
  return rows[0]?.foreign ?? true;
}
