"use client";

/**
 * De onde vêm os valores que uma condição pode comparar.
 *
 * O backend publica **quais campos** cada gatilho oferece (`trigger.fields`),
 * mas não os valores possíveis de cada um — e não deveria: `kind` de operação
 * é um literal do domínio de operações, que já é contrato sincronizado. Aqui a
 * ponte é feita, e ela é a única coisa que este arquivo faz.
 *
 * **Nenhuma lista é escrita à mão.** `OperationKind`, `OperationStatus`,
 * `OperationPriority`, `InventoryStockStatus` e `ProductKind` vêm de
 * `contracts/literals`; as unidades vêm da sessão. Um valor novo no backend
 * aparece aqui sem ninguém editar nada — e `PREVENTIVE`, que não existe no
 * domínio, não aparece porque não existe.
 *
 * O mesmo nome de campo significa coisas diferentes em gatilhos diferentes:
 * `status` de operação é `IN_PROGRESS`, `status` de saldo é `OUT_OF_STOCK`.
 * Por isso a resolução recebe o `entityType` do gatilho, e não só o campo.
 */
import { CATALOG_KIND_LABELS } from "@/entities/catalog-labels";
import type { FilterOption } from "@/workspace";
import {
  InventoryStockStatus,
  OperationKind,
  OperationPriority,
  OperationStatus,
  ProductKind,
} from "@/types/contracts";
import { INVENTORY_STATUS_LABELS } from "@/types/inventory";
import {
  OPERATION_KIND_LABELS,
  OPERATION_PRIORITY_LABELS,
  OPERATION_STATUS_LABELS,
} from "@/types/operations";

export interface ScopeUnit {
  readonly id: string;
  readonly label: string;
}

function options(
  values: Readonly<Record<string, string>>,
  labels: Readonly<Record<string, string>>,
): readonly FilterOption[] {
  return Object.values(values).map((value) => ({
    value,
    label: labels[value] ?? value,
  }));
}

/**
 * Os valores de um campo, quando existe catálogo autoritativo.
 *
 * `null` significa "campo de texto livre" — é o caso de identificador
 * (`customerId`, `assetId`, `catalogItemId`), de chave de template e de valor
 * monetário. A ausência é declarada na interface, não disfarçada com uma lista
 * inventada.
 */
export function fieldOptions(
  entityType: string,
  field: string,
  units: readonly ScopeUnit[],
): readonly FilterOption[] | null {
  if (field === "businessUnitId") {
    return units.map((unit) => ({ value: unit.id, label: unit.label }));
  }

  if (entityType === "OPERATION") {
    if (field === "kind") return options(OperationKind, OPERATION_KIND_LABELS);
    if (field === "status" || field === "fromStatus") {
      return options(OperationStatus, OPERATION_STATUS_LABELS);
    }
    if (field === "priority") {
      return options(OperationPriority, OPERATION_PRIORITY_LABELS);
    }
  }

  if (entityType === "INVENTORY_BALANCE") {
    if (field === "status") {
      return options(InventoryStockStatus, INVENTORY_STATUS_LABELS);
    }
    /** Só `PRODUCT` e `PART` têm estoque, mas quem recorta é o servidor. */
    if (field === "kind") return options(ProductKind, CATALOG_KIND_LABELS);
  }

  return null;
}

/** O rótulo de um valor, para a leitura da regra. `null` quando é texto livre. */
export function valueLabel(
  entityType: string,
  field: string,
  value: string,
  units: readonly ScopeUnit[],
): string {
  const catalog = fieldOptions(entityType, field, units);
  if (!catalog) return value;
  return catalog.find((option) => option.value === value)?.label ?? value;
}

/**
 * O que dizer sobre um campo sem catálogo.
 *
 * O texto aparece sob o campo de valor. É curto de propósito: a alternativa
 * seria um seletor de cliente ou de equipamento dentro do editor de
 * automação, e essa busca não existe no contrato de automação — ver as lacunas
 * em `docs/automation-workspace.md`.
 */
export const FREE_FIELD_HINTS: Readonly<Record<string, string>> = {
  customerId: "Identificador do cliente, como aparece na URL da ficha dele.",
  assetId: "Identificador do equipamento.",
  operationId: "Identificador da ordem de serviço.",
  executionId: "Identificador da execução de artefato.",
  catalogItemId: "Identificador do item de catálogo.",
  artifactType: "Tipo do documento, como está no template — ex.: PMOC.",
  templateKey: "Chave do modelo, como aparece em Modelos de documento.",
  total: "Comparação exata de texto — ex.: 1500.00.",
  currency: "Código da moeda — ex.: BRL.",
};
