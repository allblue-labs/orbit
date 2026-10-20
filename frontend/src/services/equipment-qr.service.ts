/**
 * Serviços da identidade QR — `/api/v1/assets`.
 *
 * ```text
 * assets
 * ├── :id/qr                        resumo administrativo
 * ├── :id/qr/render                 etiqueta (SVG, PNG, PDF)
 * ├── :id/qr/rotate                 nova identidade
 * ├── :id/qr/revoke                 substitui a identidade
 * ├── :id/service-order-preparation contexto para abrir atendimento
 * └── qr/:token                     resolve o contexto de campo
 * ```
 *
 * O que **não** está aqui: `ensure`. O banco cria a identidade por gatilho a
 * cada equipamento inserido, então não há o que gerar — um botão "gerar QR"
 * ofereceria uma escolha que não existe.
 */
import { apiClient } from "@/api/client";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import type { QueryParams, RequestOptions } from "@/types/api";
import type {
  EquipmentFieldDetails,
  EquipmentQrLabel,
  EquipmentQrRenderQuery,
  EquipmentQrRevocation,
  EquipmentQrSummary,
  EquipmentServiceOrderPreparation,
} from "@/types/equipment-qr";

const ASSETS = "assets";
const equipment = (id: string) => `/assets/${encodeURIComponent(id)}`;

/**
 * O nome do arquivo é o que o servidor mandou.
 *
 * `Content-Disposition` traz `equipment-<código>-qr.<ext>` — o código do
 * equipamento, nunca o token. Inventar um nome aqui arriscaria colocar o token
 * no sistema de arquivos de quem baixou, e perderia a convenção do backend.
 */
function fileNameFrom(header: string | null, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1]?.trim() || fallback;
}

export const equipmentQrService = {
  summary: (
    equipmentId: string,
    options?: RequestOptions,
  ): Promise<EquipmentQrSummary> =>
    apiClient.get<EquipmentQrSummary>(`${equipment(equipmentId)}/qr`, options),

  /**
   * A etiqueta, como bytes.
   *
   * Passa pelo cliente canônico (`apiClient.raw`), que atravessa o BFF com a
   * sessão em cookie `HttpOnly`. Um `fetch` paralelo teria de carregar
   * credencial por conta própria — é assim que aparece um segundo caminho de
   * autenticação, e depois um buraco.
   */
  label: async (
    equipmentId: string,
    query: EquipmentQrRenderQuery,
    options?: RequestOptions,
  ): Promise<EquipmentQrLabel> => {
    const response = await apiClient.raw(
      `${equipment(equipmentId)}/qr/render`,
      {
        ...options,
        query: query as QueryParams,
      },
    );
    if (!response.ok) {
      throw new Error(`Falha ao gerar a etiqueta (HTTP ${response.status})`);
    }
    const blob = await response.blob();
    return {
      blob,
      contentType: response.headers.get("content-type") ?? blob.type,
      fileName: fileNameFrom(
        response.headers.get("content-disposition"),
        `etiqueta-qr.${query.format ?? "svg"}`,
      ),
    };
  },

  rotate: (equipmentId: string): Promise<EquipmentQrSummary> =>
    apiClient.post<EquipmentQrSummary>(
      `${equipment(equipmentId)}/qr/rotate`,
      {},
    ),

  revoke: (equipmentId: string): Promise<EquipmentQrRevocation> =>
    apiClient.post<EquipmentQrRevocation>(
      `${equipment(equipmentId)}/qr/revoke`,
      {},
    ),

  /**
   * Resolve o token.
   *
   * O token é **opaco**: não é decodificado, interpretado nem usado para
   * derivar identidade. Vai como veio na URL e volta um Read Model.
   */
  resolve: (
    token: string,
    options?: RequestOptions,
  ): Promise<EquipmentFieldDetails> =>
    apiClient.get<EquipmentFieldDetails>(
      `/assets/qr/${encodeURIComponent(token)}`,
      options,
    ),

  /** Prepara um atendimento. Não cria: o próprio contrato devolve `operationCreated: false`. */
  serviceOrderPreparation: (
    equipmentId: string,
    options?: RequestOptions,
  ): Promise<EquipmentServiceOrderPreparation> =>
    apiClient.get<EquipmentServiceOrderPreparation>(
      `${equipment(equipmentId)}/service-order-preparation`,
      options,
    ),

  keys: {
    qr: (equipmentId: string): QueryKey =>
      queryKeys.query(ASSETS, "qr", { equipmentId }),
    /**
     * A resolução é indexada pelo token porque é ele que identifica a consulta.
     * Depois de rotacionar, esta key some do cache junto com a identidade que
     * ela representava — servir o contexto do token antigo seria mostrar um
     * equipamento por uma etiqueta que já não resolve.
     */
    resolution: (token: string): QueryKey =>
      queryKeys.query(ASSETS, "qr-resolution", { token }),
    preparation: (equipmentId: string): QueryKey =>
      queryKeys.query(ASSETS, "service-order-preparation", { equipmentId }),
  },
} as const;
