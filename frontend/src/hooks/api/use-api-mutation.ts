"use client";

/**
 * Hook de escrita.
 *
 * Sobre o `useMutation` padrão: erro tipado como `ApiError` e invalidação
 * declarativa das query keys afetadas — o padrão de escrita do Orbit é
 * "mutou, invalida", sem manipular cache manualmente.
 *
 * ```ts
 * const create = useApiMutation(
 *   (input: CreateOperationInput) => operationsService.create(input),
 *   { invalidate: [operationsService.keys.module()] },
 * );
 * ```
 */
import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";

import type { QueryKey } from "@/api/query-keys";
import type { ApiError } from "@/lib/api-error";
import { notifySuccess } from "@/lib/notify";

export interface ApiMutationOptions<
  TData,
  TVariables,
  TOnMutateResult = unknown,
> extends Omit<
  UseMutationOptions<TData, ApiError, TVariables, TOnMutateResult>,
  "mutationFn"
> {
  /** Keys invalidadas após o sucesso (prefixos são aceitos). */
  invalidate?: readonly QueryKey[];

  /**
   * O aviso de que deu certo.
   *
   * Uma frase curta no passado — "Cliente cadastrado", "Atendimento
   * cancelado" —, ou uma função quando o texto depende do que voltou.
   *
   * Opcional de propósito, e não um padrão genérico: "Salvo" em toda mutação
   * seria ruído onde a própria tela já muda à vista, e silêncio continua sendo
   * a resposta certa para o que se vê acontecer. O aviso é para o que termina
   * sem deixar rastro na tela — um diálogo que fecha, uma linha que some.
   *
   * O erro não é avisado por aqui: a maioria das telas mostra a recusa junto do
   * formulário, com o texto do servidor, e um aviso flutuante repetindo a mesma
   * frase duplicaria o ruído.
   */
  notify?: string | ((data: TData, variables: TVariables) => string);
}

export function useApiMutation<
  TData,
  TVariables = void,
  TOnMutateResult = unknown,
>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: ApiMutationOptions<TData, TVariables, TOnMutateResult> = {},
): UseMutationResult<TData, ApiError, TVariables, TOnMutateResult> {
  const queryClient = useQueryClient();
  const { invalidate, notify, onSuccess, ...rest } = options;

  return useMutation<TData, ApiError, TVariables, TOnMutateResult>({
    mutationFn,
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all(
        (invalidate ?? []).map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
      if (notify) {
        notifySuccess(
          typeof notify === "function" ? notify(data, variables) : notify,
        );
      }
      await onSuccess?.(data, variables, onMutateResult, context);
    },
    ...rest,
  });
}
