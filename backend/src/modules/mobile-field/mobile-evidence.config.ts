const positive = (key: string, fallback: number, ceiling: number): number => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), ceiling)
    : fallback;
};

export const mobileEvidencePolicy = () => ({
  imageMaxBytes: positive(
    'FIELD_EVIDENCE_IMAGE_MAX_BYTES',
    10_000_000,
    50_000_000,
  ),
  documentMaxBytes: positive(
    'FIELD_EVIDENCE_DOCUMENT_MAX_BYTES',
    20_000_000,
    100_000_000,
  ),
  pendingUploadTtlHours: positive(
    'FIELD_EVIDENCE_PENDING_UPLOAD_TTL_HOURS',
    24,
    168,
  ),
  cleanupBatchSize: positive('FIELD_EVIDENCE_CLEANUP_BATCH_SIZE', 500, 2_000),
  operationMaximumFiles: positive(
    'FIELD_EVIDENCE_OPERATION_MAX_FILES',
    20,
    100,
  ),
  pmocMaximumFiles: 6,
  rvtMaximumFiles: positive('FIELD_EVIDENCE_RVT_MAX_FILES', 20, 100),
});

export const evidenceIntentExpiry = (): Date =>
  new Date(
    Date.now() + mobileEvidencePolicy().pendingUploadTtlHours * 3_600_000,
  );
