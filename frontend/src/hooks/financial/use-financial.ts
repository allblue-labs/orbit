"use client";

/**
 * Query Layer do Financeiro.
 *
 * ## Cadência
 *
 * Lançamento manual muda por ato de quem está olhando — `CACHE.fresh`. Mas
 * lançamento de **recibo** aparece sozinho: o worker do backend o cria minutos
 * depois de o documento ser emitido, sem que ninguém nesta tela faça nada. Por
 * isso a listagem é `CACHE.live`, e não `fresh`: a receita que entrou precisa
 * aparecer sem exigir F5.
 *
 * Categorias e configuração são `CACHE.catalog`: mudam quando alguém configura.
 *
 * ## Nenhum optimistic update
 *
 * Confirmar, cancelar e editar podem ser **recusados por regra financeira** —
 * confirmar o que já está confirmado, editar o que veio de recibo, cancelar o
 * que já foi cancelado. Antecipar o resultado mostraria por um instante um
 * saldo que o servidor vai negar, e em dinheiro esse instante é o suficiente
 * para alguém tomar uma decisão errada. Toda escrita espera a resposta.
 *
 * ## Uma invalidação, não seis
 *
 * Qualquer escrita de lançamento invalida a raiz do módulo: listagem,
 * detalhe, resumo, distribuição e série mudam juntos. Invalidar item a item
 * deixaria o gráfico contando uma história e a tabela outra.
 */
import { useQueryClient } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { CACHE } from "@/hooks/api/cache-policy";
import { artifactExecutionsService } from "@/services/artifact-executions.service";
import { financialService } from "@/services/financial.service";
import type {
  CancelFinancialEntryInput,
  ConfirmFinancialEntryInput,
  CreateFinancialCategoryInput,
  CreateFinancialEntryInput,
  CreateReceiptInput,
  FinancialAnalyticsQuery,
  FinancialCategoryQuery,
  FinancialEntryQuery,
  UpdateFinancialCategoryInput,
  UpdateFinancialEntryInput,
  UpdateFinancialSettingsInput,
} from "@/types/financial";

export const FINANCIAL_REFRESH = {
  /** Recibo emitido vira lançamento sem ninguém pedir. */
  entries: CACHE.live,
  entry: CACHE.fresh,
  analytics: CACHE.fresh,
  categories: CACHE.catalog,
  settings: CACHE.catalog,
} as const;

/* ------------------------------------------------------------------ */
/* Leituras                                                            */
/* ------------------------------------------------------------------ */

export function useFinancialEntries(query?: FinancialEntryQuery) {
  return useApiQuery(
    financialService.keys.entries(query),
    ({ signal }) => financialService.entries(query, { signal }),
    FINANCIAL_REFRESH.entries,
  );
}

export function useFinancialEntry(id: string | null) {
  return useApiQuery(
    financialService.keys.entry(id ?? "none"),
    ({ signal }) => financialService.get(id as string, { signal }),
    { ...FINANCIAL_REFRESH.entry, enabled: Boolean(id) },
  );
}

export function useFinancialCategories(query?: FinancialCategoryQuery) {
  return useApiQuery(
    financialService.keys.categories(query),
    ({ signal }) => financialService.categories(query, { signal }),
    FINANCIAL_REFRESH.categories,
  );
}

export function useFinancialSummary(query?: FinancialAnalyticsQuery) {
  return useApiQuery(
    financialService.keys.summary(query),
    ({ signal }) => financialService.summary(query, { signal }),
    FINANCIAL_REFRESH.analytics,
  );
}

export function useFinancialBreakdown(query?: FinancialAnalyticsQuery) {
  return useApiQuery(
    financialService.keys.breakdown(query),
    ({ signal }) => financialService.breakdown(query, { signal }),
    FINANCIAL_REFRESH.analytics,
  );
}

export function useFinancialTimeline(query?: FinancialAnalyticsQuery) {
  return useApiQuery(
    financialService.keys.timeline(query),
    ({ signal }) => financialService.timeline(query, { signal }),
    FINANCIAL_REFRESH.analytics,
  );
}

export function useFinancialSettings() {
  return useApiQuery(
    financialService.keys.settings(),
    ({ signal }) => financialService.settings({ signal }),
    FINANCIAL_REFRESH.settings,
  );
}

/* ------------------------------------------------------------------ */
/* Recibos                                                             */
/* ------------------------------------------------------------------ */

/**
 * Emite o recibo.
 *
 * Invalida o Financeiro inteiro: o recibo emitido vira receita confirmada quando o
 * manifesto é publicado, e a lista de lançamentos ao lado precisa acompanhar. Também
 * invalida as execuções de artefato, que é onde a lista de recibos mora.
 */
export function useCreateReceipt() {
  const invalidate = useFinancialInvalidation();
  const queryClient = useQueryClient();

  return useApiMutation(
    (input: CreateReceiptInput) => financialService.createReceipt(input),
    {
      onSuccess: async () => {
        await invalidate();
        await queryClient.invalidateQueries({
          queryKey: artifactExecutionsService.keys.module(),
        });
      },
    },
  );
}

/* ------------------------------------------------------------------ */
/* Escritas — lançamentos                                              */
/* ------------------------------------------------------------------ */

/**
 * Invalida tudo que um lançamento afeta.
 *
 * Listagem, detalhe e os três relatórios saem da mesma base. Um saldo que não
 * acompanha a tabela ao lado é pior que um saldo desatualizado: parece
 * conferido.
 */
function useFinancialInvalidation() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: financialService.keys.all() }),
      queryClient.invalidateQueries({
        queryKey: financialService.keys.summary(),
      }),
      queryClient.invalidateQueries({
        queryKey: financialService.keys.breakdown(),
      }),
      queryClient.invalidateQueries({
        queryKey: financialService.keys.timeline(),
      }),
      /** O contador de lançamentos por categoria muda com a escrita. */
      queryClient.invalidateQueries({
        queryKey: financialService.keys.categories(),
      }),
    ]);
  };
}

export function useCreateFinancialEntry() {
  const invalidate = useFinancialInvalidation();
  return useApiMutation(
    (input: CreateFinancialEntryInput) => financialService.create(input),
    { onSuccess: invalidate },
  );
}

export function useUpdateFinancialEntry() {
  const invalidate = useFinancialInvalidation();
  return useApiMutation(
    ({ id, input }: { id: string; input: UpdateFinancialEntryInput }) =>
      financialService.update(id, input),
    { onSuccess: invalidate },
  );
}

export function useConfirmFinancialEntry() {
  const invalidate = useFinancialInvalidation();
  return useApiMutation(
    ({ id, input }: { id: string; input?: ConfirmFinancialEntryInput }) =>
      financialService.confirm(id, input),
    {
      onSuccess: invalidate,
      /** Dois cliques no mesmo botão não viram duas confirmações concorrentes. */
      scope: { id: "financial-entry-write" },
    },
  );
}

export function useCancelFinancialEntry() {
  const invalidate = useFinancialInvalidation();
  return useApiMutation(
    ({ id, input }: { id: string; input: CancelFinancialEntryInput }) =>
      financialService.cancel(id, input),
    { onSuccess: invalidate, scope: { id: "financial-entry-write" } },
  );
}

/* ------------------------------------------------------------------ */
/* Escritas — categorias e configuração                                */
/* ------------------------------------------------------------------ */

function useCategoriesInvalidation() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({
      queryKey: financialService.keys.categories(),
    });
  };
}

export function useCreateFinancialCategory() {
  const invalidate = useCategoriesInvalidation();
  return useApiMutation(
    (input: CreateFinancialCategoryInput) =>
      financialService.createCategory(input),
    { onSuccess: invalidate },
  );
}

export function useUpdateFinancialCategory() {
  const invalidate = useCategoriesInvalidation();
  return useApiMutation(
    ({ id, input }: { id: string; input: UpdateFinancialCategoryInput }) =>
      financialService.updateCategory(id, input),
    { onSuccess: invalidate },
  );
}

export function useRemoveFinancialCategory() {
  const invalidate = useCategoriesInvalidation();
  return useApiMutation((id: string) => financialService.removeCategory(id), {
    onSuccess: invalidate,
  });
}

export function useUpdateFinancialSettings() {
  const queryClient = useQueryClient();
  return useApiMutation(
    (input: UpdateFinancialSettingsInput) =>
      financialService.updateSettings(input),
    {
      onSuccess: (settings) => {
        /** Estado confirmado pelo servidor — não antecipação. */
        queryClient.setQueryData(financialService.keys.settings(), settings);
      },
    },
  );
}
