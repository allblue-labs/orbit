/**
 * Tipos da identidade QR do equipamento.
 *
 * Os Read Models vêm dos **contracts sincronizados**. O que este arquivo
 * acrescenta é só o que o contrato não publica: a query de renderização
 * (derivada de `EquipmentQrRenderQueryDto`) e o resultado da revogação, que o
 * backend devolve inline sem Read Model próprio.
 *
 * ## Três formas distintas, três tipos
 *
 * `GET /assets/:id/qr` devolve o **resumo administrativo** — situação e datas,
 * sem token. `GET /assets/qr/:token` devolve o **contexto de campo** — outra
 * forma inteiramente, com equipamento, cliente, PMOC e ações. E
 * `GET /assets/:id/service-order-preparation` devolve a **preparação**. Um
 * tipo só para os três esconderia que são respostas de perguntas diferentes.
 */
import type {
  EquipmentFieldAction,
  EquipmentFieldDetailsReadModel,
  EquipmentPmocContextReadModel,
  EquipmentQrSummaryReadModel,
  EquipmentServiceOrderPreparationReadModel,
} from "@/types/contracts/modules/organizations/business-units/equipaments/equipment-qr.read-models";
import type { LabelFormat } from "@/registry/equipment-qr";

export type EquipmentQrSummary = EquipmentQrSummaryReadModel;
export type EquipmentFieldDetails = EquipmentFieldDetailsReadModel;
export type EquipmentPmocContext = EquipmentPmocContextReadModel;
export type EquipmentServiceOrderPreparation =
  EquipmentServiceOrderPreparationReadModel;
export type { EquipmentFieldAction };

/** Espelha `EquipmentQrRenderQueryDto`. */
export interface EquipmentQrRenderQuery {
  format?: LabelFormat;
  preset?: "SMALL" | "STANDARD";
  /** A marca vem do backend; a tela só escolhe **qual** aplicar. */
  branding?: "NONE" | "ORGANIZATION" | "BUSINESS_UNIT";
}

/**
 * O que `POST /assets/:id/qr/revoke` devolve.
 *
 * `replacementCreated` não é detalhe: revogar **substitui** a identidade
 * atomicamente. Não existe equipamento sem QR, e a tela precisa dizer isso em
 * vez de sugerir que a etiqueta foi apagada.
 */
export interface EquipmentQrRevocation {
  revoked: boolean;
  replacementCreated: boolean;
  qr: EquipmentQrSummary;
}

/** Uma etiqueta baixada — bytes e o nome que o servidor escolheu. */
export interface EquipmentQrLabel {
  blob: Blob;
  fileName: string;
  contentType: string;
}
