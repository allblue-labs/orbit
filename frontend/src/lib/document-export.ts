/**
 * Exportação assíncrona de documento — o laço do lado do cliente.
 *
 * O servidor responde 202 com um identificador; aqui se consulta a situação
 * até `COMPLETED` e se abre a URL assinada (300 s) que vem junto. O arquivo
 * não passa pelo nosso servidor: o navegador baixa direto do armazenamento.
 *
 * ## Polling leve
 *
 * Primeira consulta em 1,5 s, depois o intervalo cresce 1,5× até 5 s; desiste
 * em 2 minutos. Um PDF comum fica pronto em poucos segundos, e o limite cobre
 * o tempo máximo de geração do servidor (120 s) com folga para a fila.
 *
 * As regras moram aqui, sem rede, para serem testadas sem servidor.
 */
import { ApiError } from "@/lib/api-error";
import type {
  DocumentExportAcceptedReadModel,
  DocumentExportReadModel,
} from "@/types/contracts/modules/document-exports/document-export.read-models";

export const EXPORT_FIRST_DELAY_MS = 1_500;
export const EXPORT_MAX_DELAY_MS = 5_000;
export const EXPORT_TIMEOUT_MS = 120_000;

/** Espera antes da consulta de número `attempt` (0, 1, 2…). */
export function exportPollDelay(attempt: number): number {
  return Math.min(
    Math.round(EXPORT_FIRST_DELAY_MS * 1.5 ** Math.max(0, attempt)),
    EXPORT_MAX_DELAY_MS,
  );
}

export type ExportFailure = "FAILED" | "RATE_LIMITED" | "TIMEOUT";

const MESSAGES: Record<ExportFailure, string> = {
  FAILED:
    "Não foi possível gerar o documento. Tente novamente em instantes.",
  RATE_LIMITED:
    "Há muitos documentos sendo gerados agora na sua empresa. Aguarde um instante e tente de novo.",
  TIMEOUT:
    "O documento está demorando mais que o normal para ficar pronto. Tente novamente em alguns minutos.",
};

/** Erro com a frase certa para a pessoa — exibido pelas telas como os demais. */
export function exportError(failure: ExportFailure, cause?: unknown): ApiError {
  return new ApiError({
    kind: "http",
    status: failure === "RATE_LIMITED" ? 429 : failure === "TIMEOUT" ? 504 : 500,
    code: `DOCUMENT_EXPORT_${failure}`,
    message: MESSAGES[failure],
    cause,
  });
}

export interface ExportLoop {
  /** Pede a exportação (`POST …/exports`). */
  request: () => Promise<DocumentExportAcceptedReadModel>;
  /** Consulta a situação. */
  poll: (exportId: string) => Promise<DocumentExportReadModel>;
  /** Substituível no teste. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Pede e acompanha até o documento ficar pronto.
 *
 * Devolve a situação `COMPLETED`, com a URL de download. `FAILED`, 429 e
 * tempo esgotado viram `ApiError` com mensagem própria.
 */
export async function runDocumentExport({
  request,
  poll,
  sleep = wait,
  now = Date.now,
  signal,
}: ExportLoop): Promise<DocumentExportReadModel> {
  let accepted: DocumentExportAcceptedReadModel;
  try {
    accepted = await request();
  } catch (error) {
    if (error instanceof ApiError && error.status === 429)
      throw exportError("RATE_LIMITED", error);
    throw error;
  }

  const started = now();
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw exportError("TIMEOUT", signal.reason);
    if (now() - started >= EXPORT_TIMEOUT_MS) throw exportError("TIMEOUT");
    await sleep(exportPollDelay(attempt));
    const status = await poll(accepted.exportId);
    if (status.status === "COMPLETED" && status.download) return status;
    if (status.status === "FAILED") throw exportError("FAILED");
  }
}
