"use client";

/**
 * Query Layer do Inventory Engine.
 *
 * ## Nenhum optimistic update, e a razão é o 409
 *
 * O backend recusa saída que não cabe — e a recusa acontece **na instrução**,
 * sob bloqueio de linha. Antecipar o saldo mostraria uma quantidade que o
 * servidor vai negar, e alguém sairia para a rua contando com uma peça que não
 * existe. Toda escrita espera a resposta.
 *
 * Quando o servidor recusa por saldo insuficiente, o saldo exibido é
 * **revalidado**: o 409 significa que a projeção da tela está velha — outra
 * pessoa consumiu no intervalo — e insistir em mostrar o número antigo faria a
 * mensagem de erro parecer inexplicável.
 *
 * ## Cadência
 *
 * Estoque muda por ato de outra pessoa: o técnico dá baixa no celular enquanto
 * o comprador olha a lista. `CACHE.live` nos saldos, para que a tela acompanhe
 * sem ninguém recarregar.
 */
import { useQueryClient } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { CACHE } from "@/hooks/api/cache-policy";
import { inventoryService } from "@/services/inventory.service";
import { catalogService } from "@/services/catalog.service";
import type {
  InventoryAdjustmentInput,
  InventoryAnalyticsQuery,
  InventoryBalanceQuery,
  InventoryMinimumInput,
  InventoryMovementInput,
  InventoryMovementQuery,
  InventoryOperationMovementInput,
  InventoryTransferInput,
} from "@/types/inventory";

export const INVENTORY_REFRESH = {
  /** Outra pessoa dá baixa enquanto esta tela está aberta. */
  balances: CACHE.live,
  movements: CACHE.fresh,
  analytics: CACHE.fresh,
} as const;

/* ------------------------------------------------------------------ */
/* Leituras                                                            */
/* ------------------------------------------------------------------ */

export function useInventoryBalances(query?: InventoryBalanceQuery) {
  return useApiQuery(
    inventoryService.keys.balances(query),
    ({ signal }) => inventoryService.balances(query, { signal }),
    INVENTORY_REFRESH.balances,
  );
}

/**
 * Contagem de um recorte, pelo servidor.
 *
 * `limit: 1` e o número vem de `meta.total`. O Analytics de estoque já publica
 * `trackedItems`, `lowStockItems` e `outOfStockItems`; esta contagem existe
 * para recortes que o resumo não cobre — por unidade, por exemplo.
 */
export function useInventoryCount(query: InventoryBalanceQuery) {
  const scoped: InventoryBalanceQuery = { ...query, page: 1, limit: 1 };
  const result = useApiQuery(
    inventoryService.keys.balances(scoped),
    ({ signal }) => inventoryService.balances(scoped, { signal }),
    INVENTORY_REFRESH.balances,
  );
  return {
    total: result.data?.meta.total,
    isPending: result.isPending,
    failed: Boolean(result.error),
  };
}

/**
 * Saldos de um item, por unidade.
 *
 * `enabled` recebe `false` para `SERVICE`: o servidor recusa com 400, e
 * perguntar assim mesmo produziria um erro a cada abertura do detalhe de um
 * serviço.
 */
export function useInventoryItem(catalogItemId: string | null, enabled = true) {
  return useApiQuery(
    inventoryService.keys.item(catalogItemId ?? "none"),
    ({ signal }) => inventoryService.item(catalogItemId as string, { signal }),
    {
      ...INVENTORY_REFRESH.balances,
      enabled: Boolean(catalogItemId) && enabled,
    },
  );
}

export function useInventoryMovements(query?: InventoryMovementQuery) {
  return useApiQuery(
    inventoryService.keys.movements(query),
    ({ signal }) => inventoryService.movements(query, { signal }),
    INVENTORY_REFRESH.movements,
  );
}

export function useInventorySummary(query?: InventoryAnalyticsQuery) {
  return useApiQuery(
    inventoryService.keys.summary(query),
    ({ signal }) => inventoryService.summary(query, { signal }),
    INVENTORY_REFRESH.analytics,
  );
}

export function useInventoryConsumption(query?: InventoryAnalyticsQuery) {
  return useApiQuery(
    inventoryService.keys.consumption(query),
    ({ signal }) => inventoryService.consumption(query, { signal }),
    INVENTORY_REFRESH.analytics,
  );
}

/* ------------------------------------------------------------------ */
/* Escritas                                                            */
/* ------------------------------------------------------------------ */

/**
 * O que muda quando o estoque se move.
 *
 * Tudo: saldos, histórico, visão de item e analytics saem do mesmo ledger.
 * Invalidar item a item deixaria o gráfico contando uma história e a tabela
 * outra.
 *
 * `onError` invalida também — é o caso do **409 por saldo insuficiente**. A
 * recusa prova que a projeção da tela está velha, e revalidar é o que faz o
 * número exibido concordar com a mensagem de erro.
 */
function useInventoryWrite(scopeId: string) {
  const queryClient = useQueryClient();

  const revalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: catalogService.keys.lists(),
    });
    await queryClient.invalidateQueries({
      queryKey: inventoryService.keys.all(),
    });
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: inventoryService.keys.balanceLists(),
      }),
      queryClient.invalidateQueries({
        queryKey: inventoryService.keys.movementLists(),
      }),
      queryClient.invalidateQueries({
        queryKey: inventoryService.keys.summary(),
      }),
      queryClient.invalidateQueries({
        queryKey: inventoryService.keys.consumption(),
      }),
    ]);
  };

  return {
    onSuccess: revalidate,
    onError: revalidate,
    /** Dois cliques no mesmo botão não viram duas baixas concorrentes. */
    scope: { id: scopeId },
  };
}

export function useInventoryEntry() {
  const write = useInventoryWrite("inventory-write");
  return useApiMutation(
    (input: InventoryMovementInput) => inventoryService.entry(input),
    write,
  );
}

export function useInventoryConsume() {
  const write = useInventoryWrite("inventory-write");
  return useApiMutation(
    (input: InventoryOperationMovementInput) => inventoryService.consume(input),
    write,
  );
}

export function useInventoryReturn() {
  const write = useInventoryWrite("inventory-write");
  return useApiMutation(
    (input: InventoryOperationMovementInput) =>
      inventoryService.giveBack(input),
    write,
  );
}

export function useInventoryAdjust() {
  const write = useInventoryWrite("inventory-write");
  return useApiMutation(
    (input: InventoryAdjustmentInput) => inventoryService.adjust(input),
    write,
  );
}

export function useInventoryTransfer() {
  const write = useInventoryWrite("inventory-transfer");
  return useApiMutation(
    (input: InventoryTransferInput) => inventoryService.transfer(input),
    write,
  );
}

/** Mínimo não é movimento: invalida saldos, não histórico nem analytics. */
export function useInventoryMinimum() {
  const queryClient = useQueryClient();
  return useApiMutation(
    (input: InventoryMinimumInput) => inventoryService.setMinimum(input),
    {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: inventoryService.keys.balanceLists(),
          }),
          queryClient.invalidateQueries({
            queryKey: inventoryService.keys.all(),
          }),
          queryClient.invalidateQueries({
            queryKey: inventoryService.keys.summary(),
          }),
        ]);
      },
    },
  );
}
