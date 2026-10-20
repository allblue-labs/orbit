"use client";

/**
 * Query Layer da comissão.
 *
 * ## Cadência
 *
 * A comissão pendente é derivada de atendimento concluído e receita confirmada —
 * as duas coisas acontecem sem ninguém estar olhando esta tela. Por isso
 * `CACHE.live` na visão por técnico: o fechamento do mês não pode exigir F5 para
 * mostrar o atendimento que acabou de ser concluído.
 *
 * A política é `CACHE.catalog`: muda quando alguém configura.
 *
 * ## Nenhum optimistic update no pagamento
 *
 * Pagar pode ser recusado pelo servidor — política desligada, nada pendente, ou
 * a comissão paga por outra pessoa entre abrir a tela e clicar. Antecipar o
 * resultado mostraria por um instante um "pago" que o servidor vai negar, e em
 * dinheiro esse instante basta para alguém parar de cobrar.
 *
 * ## Uma invalidação, não quatro
 *
 * Pagar muda a lista, o resumo por técnico, o histórico e o total da janela.
 * Invalidar item a item deixaria a tabela dizendo "a pagar" e o histórico
 * dizendo "pago".
 */
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { CACHE } from "@/hooks/api/cache-policy";
import { commissionsService } from "@/services/commissions.service";
import type {
  CancelCommissionInput,
  CommissionListQuery,
  CommissionPaymentQuery,
  CommissionQuery,
  PayCommissionsInput,
  SaveCommissionPolicyInput,
} from "@/types/commissions";

export const COMMISSION_REFRESH = {
  /** Atendimento concluído e receita confirmada entram sem ninguém pedir. */
  overview: CACHE.live,
  list: CACHE.live,
  payments: CACHE.fresh,
  policy: CACHE.catalog,
} as const;

function useCommissionInvalidation() {
  const client = useQueryClient();
  return useCallback(
    () =>
      void client.invalidateQueries({
        queryKey: commissionsService.keys.all(),
      }),
    [client],
  );
}

export function useCommissionPolicy(enabled = true) {
  return useApiQuery(
    commissionsService.keys.policy(),
    ({ signal }) => commissionsService.policy({ signal }),
    { ...COMMISSION_REFRESH.policy, enabled },
  );
}

export function useCommissionOverview(query: CommissionQuery = {}) {
  return useApiQuery(
    commissionsService.keys.overview(query),
    ({ signal }) => commissionsService.overview(query, { signal }),
    COMMISSION_REFRESH.overview,
  );
}

export function useCommissions(query: CommissionListQuery, enabled = true) {
  return useApiQuery(
    commissionsService.keys.list(query),
    ({ signal }) => commissionsService.list(query, { signal }),
    { ...COMMISSION_REFRESH.list, enabled },
  );
}

export function useCommissionPayments(
  query: CommissionPaymentQuery,
  enabled = true,
) {
  return useApiQuery(
    commissionsService.keys.payments(query),
    ({ signal }) => commissionsService.payments(query, { signal }),
    { ...COMMISSION_REFRESH.payments, enabled },
  );
}

export function useSaveCommissionPolicy() {
  const invalidate = useCommissionInvalidation();
  return useApiMutation(
    (input: SaveCommissionPolicyInput) => commissionsService.savePolicy(input),
    { onSuccess: invalidate },
  );
}

export function usePayCommissions() {
  const invalidate = useCommissionInvalidation();
  return useApiMutation(
    (input: PayCommissionsInput) => commissionsService.pay(input),
    {
      onSuccess: invalidate,
      /**
       * Dois cliques não viram dois pagamentos.
       *
       * O índice único do banco recusaria o segundo, mas quem clicou veria um
       * erro no lugar de um recibo. O escopo serializa as tentativas antes de
       * chegarem ao servidor.
       */
      scope: { id: "commission-payment" },
    },
  );
}

export function useCancelCommission() {
  const invalidate = useCommissionInvalidation();
  return useApiMutation(
    (input: CancelCommissionInput) => commissionsService.cancel(input),
    { onSuccess: invalidate, scope: { id: "commission-decision" } },
  );
}

export function useRestoreCommission() {
  const invalidate = useCommissionInvalidation();
  return useApiMutation(
    (input: CancelCommissionInput) => commissionsService.restore(input),
    { onSuccess: invalidate, scope: { id: "commission-decision" } },
  );
}
