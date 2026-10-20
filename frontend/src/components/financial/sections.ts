/**
 * Os apelidos das abas do Financeiro.
 *
 * ## Módulo próprio, sem `"use client"`
 *
 * As páginas de redirecionamento (`/orcamentos`) são Server Components e precisam
 * destas strings para montar o destino. Importar um valor de um módulo marcado
 * como cliente devolve uma **referência de cliente**, não o valor — e o
 * redirecionamento sairia como `?secao=undefined`, silenciosamente, porque nada
 * nisso é erro de tipo.
 *
 * Os apelidos são públicos: entram em link guardado e em favorito, e mudá-los
 * quebra endereço que alguém anotou.
 */
export const FINANCIAL_SECTIONS = {
  overview: "visao-geral",
  quotes: "orcamentos",
  receipts: "recibos",
  entries: "lancamentos",
  income: "receitas",
  expense: "despesas",
  commissions: "comissao",
  categories: "categorias",
} as const;

export type FinancialSection =
  (typeof FINANCIAL_SECTIONS)[keyof typeof FINANCIAL_SECTIONS];

/**
 * As seções do Financeiro, na ordem em que aparecem.
 *
 * ## Por que isto é uma função, e não uma lista escrita na tela
 *
 * A aba só funciona se o apelido dela estiver **registrado**: `useSectionFromUrl`
 * resolve o que a URL pede contra esta lista e, não achando, cai na primeira. Foi o
 * que aconteceu com Recibos — a aba aparecia, o endereço mudava, e a seleção voltava
 * para a Visão geral. Uma aba visível e inalcançável.
 *
 * Com a lista aqui, há um só lugar onde uma seção nova entra, e há teste que cobra
 * que o conjunto esteja completo. Na tela, ela ficava ao lado do JSX e era fácil
 * acrescentar o gatilho esquecendo o apelido.
 */
export function financialSectionList(options: {
  readonly canQuotes: boolean;
}): readonly FinancialSection[] {
  return [
    FINANCIAL_SECTIONS.overview,
    /* Orçamento pede a capability dele: hoje os planos concedem as duas juntas, mas
       a que sair de um plano no futuro será uma delas — e aí a aba precisa
       desaparecer, não abrir para dar erro. */
    ...(options.canQuotes ? [FINANCIAL_SECTIONS.quotes] : []),
    FINANCIAL_SECTIONS.receipts,
    FINANCIAL_SECTIONS.entries,
    FINANCIAL_SECTIONS.income,
    FINANCIAL_SECTIONS.expense,
    FINANCIAL_SECTIONS.commissions,
    FINANCIAL_SECTIONS.categories,
  ];
}
