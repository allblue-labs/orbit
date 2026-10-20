/**
 * A central de documentos emitidos.
 *
 * Uma rota, duas origens. O recorte é todo do servidor — inclusive a união —, e é
 * por isso que `meta.total` continua sendo o total: somar duas listas paginadas no
 * navegador daria contagem e páginas falsas, que foi o defeito que esta tela já
 * teve uma vez.
 */
import { apiClient } from "@/api/client";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import type { QueryParams, RequestOptions } from "@/types/api";
import type {
  IssuedDocumentList,
  IssuedDocumentQuery,
} from "@/types/issued-documents";

const RESOURCE = "issued-documents";
const BASE_PATH = "/issued-documents";

export const issuedDocumentsService = {
  basePath: BASE_PATH,

  list: (
    query?: IssuedDocumentQuery,
    options?: RequestOptions,
  ): Promise<IssuedDocumentList> =>
    apiClient.get<IssuedDocumentList>(BASE_PATH, {
      ...options,
      query: query as QueryParams | undefined,
    }),

  keys: {
    module: (): QueryKey => queryKeys.module(RESOURCE),
    list: (query?: IssuedDocumentQuery): QueryKey =>
      queryKeys.list(RESOURCE, query as QueryParams | undefined),
  },
} as const;
