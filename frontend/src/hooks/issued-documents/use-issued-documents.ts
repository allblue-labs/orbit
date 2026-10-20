/**
 * A lista de documentos emitidos.
 *
 * `CACHE.live` pela mesma razão da listagem de execuções: a fila acompanha
 * documentos sendo produzidos agora, e quem está esperando um PDF sair não deve
 * precisar recarregar a página para vê-lo pronto.
 *
 * A página anterior fica visível durante a troca: sem isso, mudar de fila ou de
 * página pisca um estado vazio, que se lê como "não há nada" em vez de "estou
 * buscando".
 */
import { useApiQuery } from "@/hooks/api/use-api-query";
import { CACHE } from "@/hooks/api/cache-policy";
import { issuedDocumentsService } from "@/services/issued-documents.service";
import type { IssuedDocumentQuery } from "@/types/issued-documents";

export function useIssuedDocuments(query: IssuedDocumentQuery) {
  return useApiQuery(
    issuedDocumentsService.keys.list(query),
    ({ signal }) => issuedDocumentsService.list(query, { signal }),
    {
      ...CACHE.live,
      placeholderData: (previous) => previous,
    },
  );
}
