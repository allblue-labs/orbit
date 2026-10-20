/**
 * Consulta de endereço por CEP.
 *
 * Fala com a rota do BFF, não com o serviço externo — o navegador continua
 * conversando só com a nossa origem. Nenhuma regra vive aqui: a que rua um CEP
 * corresponde é resposta do servidor, e o que o formulário faz com ela é
 * decisão da tela.
 */
import { httpJson } from "@/api/http";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import { BFF_POSTAL_PATH } from "@/lib/env";
import { normalizePostalCode, type PostalAddress } from "@/lib/postal-code";
import type { RequestOptions } from "@/types/api";

const RESOURCE = "cep";

export const addressService = {
  byPostalCode: (
    postalCode: string,
    options?: RequestOptions,
  ): Promise<PostalAddress> =>
    httpJson<PostalAddress>({
      method: "GET",
      path: `/${normalizePostalCode(postalCode)}`,
      basePath: BFF_POSTAL_PATH,
      /** Ninguém espera duas vezes por um CEP: o campo segue editável. */
      retries: 0,
      ...options,
    }),

  keys: {
    byPostalCode: (postalCode: string): QueryKey =>
      queryKeys.detail(RESOURCE, normalizePostalCode(postalCode)),
  },
} as const;
