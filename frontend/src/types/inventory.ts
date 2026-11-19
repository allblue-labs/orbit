/**
 * Contratos do Inventory Engine.
 *
 * Nenhum Read Model é redeclarado: todos vêm de `contracts/modules/inventory`.
 * O que este arquivo acrescenta são os tipos de entrada e os rótulos.
 *
 * ## Quantidade é string, e continua string
 *
 * `Decimal(14,3)` chega como `"12.500"`. A conversão para número acontece uma
 * vez, na formatação — nunca para somar. Saldo, disponível e saldo-após vêm
 * calculados pelo servidor; o navegador não faz aritmética de estoque.
 *
 * ## O status é do servidor
 *
 * `OK`, `LOW` e `OUT_OF_STOCK` são publicados em cada saldo. Comparar
 * `available` com `minimumStock` no cliente criaria uma segunda régua, e as
 * duas discordariam sobre o que é "baixo" no primeiro empate.
 */
import type {
  InventoryBalanceReadModel,
  InventoryConsumptionPointReadModel,
  InventoryItemRefReadModel,
  InventoryMovementReadModel,
  InventorySummaryReadModel,
  InventoryTransferReadModel,
} from "./contracts/modules/inventory/inventory.read-models";
import type { InventoryMovementType, InventoryStockStatus } from "./contracts";

export type { InventoryMovementType, InventoryStockStatus };

export type InventoryBalance = InventoryBalanceReadModel;
export type InventoryMovement = InventoryMovementReadModel;
export type InventoryTransfer = InventoryTransferReadModel;
export type InventorySummary = InventorySummaryReadModel;
export type InventoryConsumptionPoint = InventoryConsumptionPointReadModel;
export type InventoryItemRef = InventoryItemRefReadModel;

/**
 * Resposta das escritas de movimento.
 *
 * `duplicated: true` significa que a origem já produziu este movimento —
 * retry, não erro. Nada foi criado, e o efeito já aconteceu.
 */
export interface InventoryMovementResult {
  duplicated: boolean;
  movement: InventoryMovement | null;
}

export interface InventoryTransferResult {
  transferId: string | null;
  duplicated?: boolean;
  out?: InventoryMovement;
  in?: InventoryMovement;
}

/** `GET /inventory/items/:id`. */
export interface InventoryItemView {
  item: { id: string; name: string; kind: string };
  balances: InventoryBalance[];
}

/* -------------------------------------------------------------------- */
/* Consultas                                                             */
/* -------------------------------------------------------------------- */

export interface InventoryBalanceQuery {
  search?: string;
  businessUnitId?: string;
  catalogItemId?: string;
  /** Somente `LOW` ou `OUT_OF_STOCK` — o recorte é do servidor. */
  lowStock?: boolean;
  page?: number;
  limit?: number;
}

export interface InventoryMovementQuery {
  search?: string;
  type?: InventoryMovementType;
  businessUnitId?: string;
  catalogItemId?: string;
  operationId?: string;
  source?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface InventoryAnalyticsQuery {
  from?: string;
  to?: string;
  businessUnitId?: string;
}

/* -------------------------------------------------------------------- */
/* Escritas                                                              */
/* -------------------------------------------------------------------- */

/**
 * Base de todo movimento.
 *
 * `quantity` é **sempre positiva**. A direção é do tipo, decidida pela rota —
 * o frontend nunca inverte sinal.
 */
export interface InventoryMovementInput {
  catalogItemId: string;
  businessUnitId?: string;
  quantity: number;
  reason?: string;
  notes?: string;
  /** Torna a chamada idempotente: repetir não cria um segundo movimento. */
  sourceEntityId?: string;
}

export interface InventoryOperationMovementInput extends InventoryMovementInput {
  operationId?: string;
}

/** Ajuste exige motivo — o servidor recusa sem ele. */
export interface InventoryAdjustmentInput extends InventoryMovementInput {
  direction: "IN" | "OUT";
  reason: string;
}

export interface InventoryTransferInput {
  catalogItemId: string;
  fromBusinessUnitId: string;
  toBusinessUnitId: string;
  quantity: number;
  reason?: string;
  notes?: string;
  sourceEntityId?: string;
}

export interface InventoryMinimumInput {
  catalogItemId: string;
  businessUnitId?: string;
  minimumStock: number;
}

/* -------------------------------------------------------------------- */
/* Rótulos                                                               */
/* -------------------------------------------------------------------- */

export const INVENTORY_STATUS_LABELS: Readonly<
  Record<InventoryStockStatus | string, string>
> = {
  OK: "Em dia",
  LOW: "Estoque baixo",
  OUT_OF_STOCK: "Sem estoque",
};

export const INVENTORY_TYPE_LABELS: Readonly<
  Record<InventoryMovementType | string, string>
> = {
  ENTRY: "Entrada",
  CONSUMPTION: "Consumo",
  SALE: "Venda",
  RETURN: "Devolução",
  ADJUSTMENT_IN: "Ajuste (sobra)",
  ADJUSTMENT_OUT: "Ajuste (falta)",
  TRANSFER_IN: "Transferência recebida",
  TRANSFER_OUT: "Transferência enviada",
};

/**
 * O que cada tipo significa no chão da oficina.
 *
 * A diferença entre ajuste e consumo é a que mais confunde: consumo é material
 * que foi usado num trabalho; ajuste é diferença encontrada na contagem, e é
 * por isso que só ele exige motivo.
 */
export const INVENTORY_TYPE_DESCRIPTIONS: Readonly<
  Record<InventoryMovementType | string, string>
> = {
  ENTRY: "Material que chegou à unidade.",
  CONSUMPTION: "Material usado em um trabalho.",
  SALE: "Produto vendido a um cliente.",
  RETURN: "Material que voltou da visita sem ser usado.",
  ADJUSTMENT_IN: "Sobra encontrada na contagem.",
  ADJUSTMENT_OUT: "Falta encontrada na contagem.",
  TRANSFER_IN: "Chegou de outra unidade.",
  TRANSFER_OUT: "Saiu para outra unidade.",
};

/** Tipos do Catálogo que têm estoque. `SERVICE` não se estoca. */
export const STOCKABLE_KINDS: readonly string[] = ["PRODUCT", "PART"];

export const isStockable = (kind: string): boolean =>
  STOCKABLE_KINDS.includes(kind);
