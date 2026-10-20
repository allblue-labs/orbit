/**
 * O que a lista de propostas diz quando não há linha nenhuma.
 *
 * ## Por que isto é um módulo, e não duas interpolações no JSX
 *
 * Porque passou a ter uma decisão dentro. Enquanto a situação era aba, cada uma
 * trazia o seu texto fixo. Virando filtro, um texto fixo diria "nenhuma
 * proposta, crie um orçamento" para quem tem trinta propostas e filtrou pelas
 * aprovadas — e ainda ofereceria o botão de criar como solução.
 *
 * A decisão também tem uma armadilha de idioma: os rótulos de situação são
 * masculinos (`Aprovado`, `Enviado`), então "nenhuma **proposta** aprovado" é o
 * resultado natural de juntar os dois sem pensar. Aqui a frase se forma com
 * "orçamento", que concorda — e é a palavra que `ResultSummary` já usa na mesma
 * tela. Ficando num módulo, dá para provar isso em teste.
 */
import { QUOTE_STATUS_DESCRIPTIONS, QUOTE_STATUS_LABELS } from "@/types/quotes";
import type { QuoteStatus } from "@/types/quotes";

export interface QuotesEmptyCopy {
  readonly title: string;
  /** `false` quando o vazio é recorte: criar não é a saída. */
  readonly offersCreate: boolean;
  readonly description: string;
}

export function quotesEmptyCopy(input: {
  /** Há algum recorte em vigor — busca, situação, cliente, validade. */
  readonly isFiltered: boolean;
  /** A situação em vigor, venha do filtro ou de quem embute a lista. */
  readonly status?: QuoteStatus;
  /** O texto de quem chama, para a carteira realmente vazia. */
  readonly emptyTitle: string;
  readonly emptyDescription: string;
}): QuotesEmptyCopy {
  if (!input.isFiltered)
    return {
      title: input.emptyTitle,
      description: input.emptyDescription,
      offersCreate: true,
    };

  /*
   * Com situação escolhida, o nome dela entra na frase e a descrição explica o
   * que aquela situação significa — é o que cada aba ensinava, agora no lugar
   * onde a pergunta foi feita.
   *
   * Sem situação, o recorte é outro e não dá para nomeá-lo sem adivinhar qual:
   * "com esses filtros" é o que se pode afirmar.
   */
  const rotulo = input.status
    ? (QUOTE_STATUS_LABELS[input.status] ?? "").toLocaleLowerCase("pt-BR")
    : "com esses filtros";

  return {
    title: `Nenhum orçamento ${rotulo}`.trimEnd(),
    description:
      (input.status ? QUOTE_STATUS_DESCRIPTIONS[input.status] : undefined) ??
      "Ajuste a busca ou os filtros.",
    offersCreate: false,
  };
}
