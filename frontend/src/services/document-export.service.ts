/**
 * Exportação assíncrona de documentos — pedir, acompanhar e baixar.
 *
 * Os serviços de orçamento, PMOC e equipamento usam isto no lugar da rota
 * síncrona antiga (que continua existindo no servidor para os apps em campo
 * que ainda não atualizaram). O arquivo é baixado direto do armazenamento,
 * pela URL assinada de 300 s.
 */
import { apiClient } from "@/api/client";
import { browserUrlFor } from "@/lib/backend-url";
import { runDocumentExport } from "@/lib/document-export";
import type { RequestOptions } from "@/types/api";
import type {
  DocumentExportAcceptedReadModel,
  DocumentExportReadModel,
} from "@/types/contracts/modules/document-exports/document-export.read-models";

export interface ExportedFile {
  fileName: string;
}

/** Entrega a URL ao navegador como download, com o nome do servidor. */
function saveFromUrl(url: string, fileName: string): void {
  const anchor = document.createElement("a");
  anchor.href = browserUrlFor(url);
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** A consulta autenticada, comum a orçamento, PMOC e equipamento. */
export const documentExportStatusPath = (exportId: string) =>
  `/document-exports/${encodeURIComponent(exportId)}`;

/**
 * Pede a exportação, acompanha até ficar pronta e baixa.
 *
 * `body` leva os parâmetros do documento (a etiqueta de QR); `options` segue
 * para as duas chamadas — o link público passa `retries: 0`, como já fazia na
 * rota síncrona.
 */
export async function exportAndSave({
  requestPath,
  statusPath = documentExportStatusPath,
  fallbackName,
  body = {},
  options,
}: {
  requestPath: string;
  statusPath?: (exportId: string) => string;
  fallbackName: string;
  body?: Record<string, unknown>;
  options?: RequestOptions;
}): Promise<ExportedFile> {
  const ready = await runDocumentExport({
    request: () =>
      apiClient.post<DocumentExportAcceptedReadModel>(
        requestPath,
        body,
        options,
      ),
    poll: (exportId) =>
      apiClient.get<DocumentExportReadModel>(statusPath(exportId), options),
  });
  const fileName = ready.fileName ?? fallbackName;
  saveFromUrl(ready.download!.url, fileName);
  return { fileName };
}
