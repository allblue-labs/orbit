import type { PrismaTransactionClient } from '../../../database/prisma.types';
export interface MediaLocator {
  kind: string;
  id: string;
  provider: string | null;
  bucket: string | null;
  objectKey: string;
  checksum: string | null;
}
/** Includes soft-deleted/reserved files and source uploads. A file UUID is never an object key. */
export function mediaInventory(
  tx: PrismaTransactionClient,
  organizationId: string,
): Promise<MediaLocator[]> {
  return tx.$queryRaw<MediaLocator[]>`
    SELECT 'storage' AS kind,id::text,provider,bucket,object_key AS "objectKey",sha256::text AS checksum
      FROM storage_files WHERE organization_id=${organizationId}::uuid
    UNION ALL
    SELECT 'source',id::text,provider,metadata->>'sourceBucket',metadata->>'sourceObjectKey',NULL
      FROM storage_files WHERE organization_id=${organizationId}::uuid
      AND jsonb_typeof(metadata->'sourceObjectKey')='string'
      AND (metadata->>'sourceObjectKey'<>object_key OR metadata->>'sourceBucket'<>bucket)
    UNION ALL
    SELECT 'operation',a.id::text,a.storage_provider,a.storage_bucket,a.storage_key,a.checksum::text
      FROM operation_attachments a JOIN operations o ON o.id=a.operation_id WHERE o.organization_id=${organizationId}::uuid
    UNION ALL
    SELECT 'document',id::text,storage_provider,storage_bucket,storage_key,sha256::text
      FROM generated_documents WHERE organization_id=${organizationId}::uuid
    UNION ALL
    SELECT 'pmoc',id::text,document_provider,document_bucket,document_object_key,document_sha256::text
      FROM pmoc_plan_signature_links WHERE organization_id=${organizationId}::uuid AND document_object_key IS NOT NULL
    UNION ALL
    SELECT 'artifact',id::text,storage_provider,storage_bucket,storage_key,checksum::text
      FROM artifact_execution_attachments WHERE organization_id=${organizationId}::uuid AND file_id IS NULL`;
}
/** Preserve unresolved payments and in-flight media writes until reconciliation/drain. */
export async function hasPurgeBarrier(
  tx: PrismaTransactionClient,
  organizationId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ pending: boolean }[]>`SELECT EXISTS (
    SELECT 1 FROM billing_webhook_events e WHERE e.processing_status IN ('PENDING','PROCESSING','DEAD_LETTER')
    AND (e.provider_subscription_id IN (SELECT provider_subscription_id FROM organization_subscriptions WHERE organization_id=${organizationId}::uuid)
      OR e.provider_object_id IN (SELECT provider_session_id FROM billing_checkout_attempts WHERE organization_id=${organizationId}::uuid)
      OR e.provider_object_id IN (SELECT provider_subscription_id FROM organization_subscriptions WHERE organization_id=${organizationId}::uuid)
      OR e.provider_object_id IN (SELECT provider_invoice_id FROM billing_invoices WHERE organization_id=${organizationId}::uuid)
      OR e.provider_subscription_id IN (SELECT provider_subscription_id FROM billing_checkout_attempts WHERE organization_id=${organizationId}::uuid))
    ) OR EXISTS (SELECT 1 FROM storage_upload_admissions WHERE organization_id=${organizationId}::uuid AND expires_at>clock_timestamp())
    OR EXISTS (SELECT 1 FROM background_jobs WHERE organization_id=${organizationId}::uuid AND status='RUNNING') AS pending`;
  return rows[0]?.pending ?? true;
}
