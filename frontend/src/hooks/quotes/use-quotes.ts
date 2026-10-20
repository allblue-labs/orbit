"use client";

/**
 * Query Layer do Commercial Engine.
 *
 * ## Cadência
 *
 * Proposta muda por ato de quem está olhando — `CACHE.fresh`. A exceção é a
 * **expiração**: o servidor marca `EXPIRED` ao ler, então uma lista aberta há
 * meia hora pode estar mostrando como enviado o que já venceu. `CACHE.live`
 * na listagem resolve isso sem que ninguém precise recarregar a página.
 *
 * ## Nenhum optimistic update
 *
 * Enviar, aprovar, recusar, cancelar e converter podem ser recusados por
 * regra comercial ou perdidos numa corrida — o backend usa o estado de origem
 * no `where` e devolve 409 para o segundo clique. Antecipar mostraria um
 * orçamento aprovado que o servidor vai negar, e alguém decidiria em cima
 * disso.
 *
 * ## A resposta confirmada é a fonte
 *
 * Toda escrita devolve o orçamento inteiro, já recalculado. O resultado vai
 * direto para o cache do detalhe (`setQueryData`) — não é antecipação, é o
 * estado que o servidor acabou de confirmar. As listagens e o Financeiro são
 * invalidados porque totais e situações mudaram junto.
 */
import { useQueryClient } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { CACHE } from "@/hooks/api/cache-policy";
import { artifactExecutionsService } from "@/services/artifact-executions.service";
import { financialService } from "@/services/financial.service";
import { operationsService } from "@/services/operations.service";
import { quotesService } from "@/services/quotes.service";
import type { FinancialEntryQuery } from "@/types/financial";
import type {
  AddQuoteItemInput,
  ConvertQuoteInput,
  CreateQuoteInput,
  Quote,
  QuoteQuery,
  QuoteReasonInput,
  UpdateQuoteInput,
  UpdateQuoteItemInput,
} from "@/types/quotes";

export const QUOTES_REFRESH = {
  /** O servidor expira sozinho ao ler; a lista precisa acompanhar. */
  list: CACHE.live,
  detail: CACHE.fresh,
  forecast: CACHE.fresh,
} as const;

/* ------------------------------------------------------------------ */
/* Leituras                                                            */
/* ------------------------------------------------------------------ */

export function useQuotes(query?: QuoteQuery) {
  return useApiQuery(
    quotesService.keys.list(query),
    ({ signal }) => quotesService.list(query, { signal }),
    QUOTES_REFRESH.list,
  );
}

export function useQuote(id: string | null) {
  return useApiQuery(
    quotesService.keys.detail(id ?? "none"),
    ({ signal }) => quotesService.get(id as string, { signal }),
    { ...QUOTES_REFRESH.detail, enabled: Boolean(id) },
  );
}

/**
 * Contagem de uma situação, pelo servidor.
 *
 * `limit: 1` e o número vem de `meta.total` — a mesma técnica do Catálogo e do
 * Execution Center, pelo mesmo motivo: **não existe Analytics comercial**, e
 * contar a página daria o tamanho da página, não o do funil.
 */
export function useQuoteCount(query: QuoteQuery) {
  const scoped: QuoteQuery = { ...query, page: 1, limit: 1 };
  const result = useApiQuery(
    quotesService.keys.list(scoped),
    ({ signal }) => quotesService.list(scoped, { signal }),
    QUOTES_REFRESH.list,
  );

  return {
    total: result.data?.meta.total,
    isPending: result.isPending,
    failed: Boolean(result.error),
  };
}

/**
 * A previsão financeira **deste** orçamento.
 *
 * Recorte do servidor por `source=QUOTE` e `sourceEntityId`. Buscar
 * lançamentos e filtrar no cliente erraria assim que o resultado passasse de
 * uma página — e seria construir no navegador um vínculo que o backend já
 * publica.
 *
 * Devolve o lançamento ou `null`: o job que o cria roda em segundo plano, e
 * durante alguns segundos após a aprovação não existe nada para mostrar. A
 * ausência é um estado legítimo, não um erro.
 */
export function useQuoteForecast(quoteId: string | null, enabled = true) {
  const query: FinancialEntryQuery = {
    source: "QUOTE",
    sourceEntityId: quoteId ?? undefined,
    limit: 1,
  };

  const result = useApiQuery(
    financialService.keys.entries(query),
    ({ signal }) => financialService.entries(query, { signal }),
    { ...QUOTES_REFRESH.forecast, enabled: Boolean(quoteId) && enabled },
  );

  return {
    entry: result.data?.data[0] ?? null,
    isPending: result.isPending,
    error: result.error,
    refetch: result.refetch,
  };
}

/* ------------------------------------------------------------------ */
/* Escritas                                                            */
/* ------------------------------------------------------------------ */

/**
 * O que muda quando um orçamento muda.
 *
 * O detalhe recebe a resposta confirmada; listagens, contadores, o Financeiro
 * e as operações são invalidados. O Financeiro entra porque aprovar e cancelar
 * mexem na receita prevista; as operações, porque converter cria uma.
 */
/**
 * Exportado porque o wizard também escreve.
 *
 * A invalidação depois de gravar uma proposta é a mesma, venha de onde vier — e
 * uma segunda cópia esqueceria de invalidar o Financeiro na primeira vez que
 * alguém mexesse numa delas.
 */
export function useQuoteWrite() {
  const queryClient = useQueryClient();

  return {
    onSuccess: async (quote: Quote) => {
      queryClient.setQueryData(quotesService.keys.detail(quote.id), quote);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: quotesService.keys.lists() }),
        queryClient.invalidateQueries({
          queryKey: financialService.keys.all(),
        }),
        /** A raiz do módulo: converter cria operação e muda listagens e detalhes. */
        queryClient.invalidateQueries({
          queryKey: operationsService.keys.module(),
        }),
      ]);
    },
  };
}

export function useCreateQuote() {
  const write = useQuoteWrite();
  return useApiMutation(
    (input: CreateQuoteInput) => quotesService.create(input),
    write,
  );
}

export function useUpdateQuote(id: string) {
  const write = useQuoteWrite();
  return useApiMutation(
    (input: UpdateQuoteInput) => quotesService.update(id, input),
    write,
  );
}

export function useRemoveQuote() {
  const queryClient = useQueryClient();
  return useApiMutation((id: string) => quotesService.remove(id), {
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: quotesService.keys.lists(),
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Itens                                                               */
/* ------------------------------------------------------------------ */

export function useAddQuoteItem(id: string) {
  const write = useQuoteWrite();
  return useApiMutation(
    (input: AddQuoteItemInput) => quotesService.addItem(id, input),
    write,
  );
}

export function useUpdateQuoteItem(id: string) {
  const write = useQuoteWrite();
  return useApiMutation(
    ({ itemId, input }: { itemId: string; input: UpdateQuoteItemInput }) =>
      quotesService.updateItem(id, itemId, input),
    write,
  );
}

export function useRemoveQuoteItem(id: string) {
  const write = useQuoteWrite();
  return useApiMutation(
    (itemId: string) => quotesService.removeItem(id, itemId),
    write,
  );
}

/* ------------------------------------------------------------------ */
/* Transições                                                          */
/* ------------------------------------------------------------------ */

/**
 * Uma transição, escolhida por nome.
 *
 * As cinco compartilham invalidação e a serialização por escopo — dois cliques
 * no mesmo botão não viram duas requisições concorrentes, que é justamente o
 * caso em que o backend devolve 409.
 */
export function useQuoteTransition(id: string) {
  const write = useQuoteWrite();

  return useApiMutation(
    ({
      action,
      reason,
      convert,
    }: {
      action: "send" | "approve" | "reject" | "cancel" | "convert";
      reason?: string;
      convert?: ConvertQuoteInput;
    }) => {
      const input: QuoteReasonInput = { reason: reason ?? "" };
      switch (action) {
        case "send":
          return quotesService.send(id);
        case "approve":
          return quotesService.approve(id);
        case "reject":
          return quotesService.reject(id, input);
        case "cancel":
          return quotesService.cancel(id, input);
        case "convert":
          return quotesService.convert(id, convert);
      }
    },
    { ...write, scope: { id: `quote-transition-${id}` } },
  );
}

/**
 * Baixa a proposta impressa.
 *
 * Mutação, e não consulta: produz um efeito — o arquivo salvo — e repetir é
 * pedir de novo, não reler um cache. Como consulta, o React Query guardaria o
 * blob e o segundo clique não baixaria nada.
 *
 * `scope` por proposta: baixar uma não trava o botão da linha de baixo.
 */
export function useQuoteDocument(id: string) {
  return useApiMutation(() => quotesService.document(id), {
    scope: { id: `quote-document-${id}` },
  });
}

/**
 * Emite o documento oficial da proposta.
 *
 * Devolve a execução criada, e é por isso que quem chama navega para ela: o
 * documento ainda precisa da assinatura do proponente, e é na tela da execução
 * que se assina e se emite. Igual ao recibo.
 *
 * Invalida as execuções porque a central de documentos emitidos acabou de ganhar
 * uma linha — sem isso, a aba abriria sem o documento que a pessoa acabou de
 * emitir e pareceria que a emissão não funcionou.
 */
export function useIssueQuoteDocument(id: string) {
  return useApiMutation(() => quotesService.issueDocument(id), {
    scope: { id: `quote-issue-document-${id}` },
    invalidate: [artifactExecutionsService.keys.module()],
  });
}
