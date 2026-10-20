"use client";

/**
 * A execução do plano do wizard.
 *
 * Mora com o wizard, e não em `hooks/quotes`: é o único lugar que monta uma
 * proposta em quatro requisições encadeadas, e o tipo do plano é do wizard. Um
 * hook em `hooks/` importando tipo de `components/` inverteria as camadas.
 */
import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useQuoteWrite } from "@/hooks/quotes/use-quotes";
import { quotesService } from "@/services/quotes.service";
import type { Quote } from "@/types/quotes";
import type { SubmissionPlan } from "./quote-wizard.model";

/**
 * Executa o plano do wizard.
 *
 * ## Por que uma mutação e não seis
 *
 * A criação é uma sequência que o contrato impõe: a proposta nasce vazia, os
 * itens entram um a um, o desconto vem num `PATCH` e o envio é outra rota. Seis
 * mutações na tela obrigariam o componente a orquestrar a ordem e a decidir o
 * que fazer quando a terceira falha — lógica de transação dentro de um botão.
 *
 * ## Falhar no meio deixa um rascunho, não lixo
 *
 * Não há transação possível aqui: são requisições independentes. O que se pode
 * garantir é que o resultado parcial seja **útil** — a proposta fica em `DRAFT`,
 * com o que entrou, editável na página. E o erro diz em que passo parou, porque
 * "não foi possível criar o orçamento" depois de gravar sete itens manda a pessoa
 * recomeçar do zero sem saber que não precisa.
 *
 * O `id` da proposta criada vai no erro justamente para a tela poder oferecer
 * abri-la em vez de refazer tudo.
 */
export class QuoteWizardFailure extends Error {
  constructor(
    readonly stage: "create" | "items" | "discount" | "send",
    readonly quoteId: string | null,
    readonly cause: unknown,
  ) {
    super(
      quoteId
        ? `A proposta foi criada, mas houve falha ao ${STAGE_LABEL[stage]}.`
        : `Não foi possível criar a proposta.`,
    );
    this.name = "QuoteWizardFailure";
  }
}

const STAGE_LABEL: Readonly<Record<QuoteWizardFailure["stage"], string>> = {
  create: "criar a proposta",
  items: "acrescentar os itens",
  discount: "aplicar o desconto",
  send: "enviar ao cliente",
};

export function useQuoteWizardSubmit() {
  const write = useQuoteWrite();

  return useApiMutation(async (plan: SubmissionPlan) => {
    let quote: Quote;
    try {
      quote = await quotesService.create(plan.create);
    } catch (error) {
      throw new QuoteWizardFailure("create", null, error);
    }

    try {
      for (const item of plan.items) {
        quote = await quotesService.addItem(quote.id, item);
      }
    } catch (error) {
      throw new QuoteWizardFailure("items", quote.id, error);
    }

    if (plan.update) {
      try {
        quote = await quotesService.update(quote.id, plan.update);
      } catch (error) {
        throw new QuoteWizardFailure("discount", quote.id, error);
      }
    }

    if (plan.send) {
      try {
        quote = await quotesService.send(quote.id);
      } catch (error) {
        /* O envio é o único passo cuja falha deixa algo perfeitamente usável: a
           proposta está completa, só não foi ao cliente. Quem abrir a página
           encontra o botão Enviar ativo. */
        throw new QuoteWizardFailure("send", quote.id, error);
      }
    }

    return quote;
  }, write);
}
