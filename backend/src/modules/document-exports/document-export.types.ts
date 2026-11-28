import type { DocumentExport } from '@prisma/client';
import type { BackgroundJobRecord } from '../jobs/background-job.types';
import type { DocumentExportKind } from './document-export.read-models';

/** Quanto tempo o arquivo exportado fica disponível. */
export const DOCUMENT_EXPORT_TTL_MS = 24 * 3_600_000;

/** Validade da URL de download. */
export const DOCUMENT_EXPORT_URL_TTL_SECONDS = 300;

/** O arquivo que um gerador produz. */
export interface GeneratedDocument {
  readonly bytes: Buffer;
  readonly fileName: string;
  readonly contentType: string;
}

/**
 * Quem sabe produzir um tipo de documento.
 *
 * Cada domínio registra o seu (orçamento, PMOC, equipamento) — o módulo de
 * exportação não importa domínio nenhum, e os domínios podem expor as rotas
 * de exportação sem dependência circular. O gerador roda **no worker**, já no
 * contexto do tenant reaberto a partir do job, e deve produzir exatamente o
 * mesmo arquivo da rota síncrona correspondente.
 */
export interface DocumentExportGenerator {
  readonly kinds: readonly DocumentExportKind[];
  generate(input: {
    readonly export: DocumentExport;
    readonly job: BackgroundJobRecord;
    readonly signal?: AbortSignal;
  }): Promise<GeneratedDocument>;
}

/** O que um domínio informa ao pedir uma exportação. */
export interface DocumentExportRequest {
  readonly kind: DocumentExportKind;
  readonly entityId: string;
  /** Unidade do documento; recorta quem pode consultar a exportação. */
  readonly businessUnitId: string | null;
  readonly params?: Record<string, unknown>;
  readonly acceptanceLinkId?: string;
}
