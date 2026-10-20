"use client";

/**
 * A proposta copiada de um atendimento concluído.
 *
 * Uma requisição, não seis: o servidor já sabe copiar cliente, endereço,
 * equipamentos e os materiais consumidos. Refazer isso no navegador duplicaria a
 * lógica de cópia, e as duas divergiriam na primeira vez que uma mudasse.
 */
import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useQuoteWrite } from "@/hooks/quotes/use-quotes";
import { quotesService } from "@/services/quotes.service";
import type { CreateQuoteFromOperationInput } from "@/types/quotes";

export function useCreateQuoteFromOperation() {
  const write = useQuoteWrite();
  return useApiMutation(
    (input: CreateQuoteFromOperationInput) =>
      quotesService.createFromOperation(input),
    write,
  );
}
