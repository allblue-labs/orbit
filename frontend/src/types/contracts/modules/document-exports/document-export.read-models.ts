/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

/**
 * Exportação assíncrona de documento — o contrato público.
 *
 * O pedido responde `202` com o identificador; o cliente consulta até
 * `COMPLETED` e recebe uma URL assinada de curta duração (300 s), gerada de
 * novo a cada consulta. O arquivo nunca passa pela API: o worker de documentos
 * o envia ao armazenamento, e o navegador ou o app baixa direto de lá.
 */
export const DOCUMENT_EXPORT_KINDS = [
  'QUOTE',
  'QUOTE_ACCEPTED',
  'PMOC_PLAN',
  'EQUIPMENT_QR',
] as const;
export type DocumentExportKind = (typeof DOCUMENT_EXPORT_KINDS)[number];

export const DOCUMENT_EXPORT_STATUSES = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;
export type DocumentExportStatus = (typeof DOCUMENT_EXPORT_STATUSES)[number];

/** Resposta do pedido (`202 Accepted`). */
export interface DocumentExportAcceptedReadModel {
  exportId: string;
  jobId: string;
  status: DocumentExportStatus;
}

export interface DocumentExportDownloadReadModel {
  url: string;
  /** Quando a URL deixa de valer. Consultar de novo gera outra. */
  expiresAt: string;
}

/** Situação de uma exportação. */
export interface DocumentExportReadModel {
  exportId: string;
  kind: DocumentExportKind;
  status: DocumentExportStatus;
  fileName: string | null;
  contentType: string | null;
  /** Código estável da falha, quando `FAILED`. */
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Depois disto o arquivo e o registro são removidos. */
  expiresAt: string;
  /** Presente só quando `COMPLETED`. */
  download: DocumentExportDownloadReadModel | null;
}
