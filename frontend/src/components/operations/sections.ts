/**
 * Os apelidos das abas de Operações.
 *
 * ## Módulo próprio, sem `"use client"`
 *
 * As páginas de redirecionamento (`/pmoc`, `/rvt`) são Server Components e
 * precisam destas strings para montar o destino. Importar um valor de um módulo
 * marcado como cliente devolve uma **referência de cliente**, não o valor — e o
 * redirecionamento saía como `?secao=undefined`, silenciosamente, porque nada
 * nisso é erro de tipo.
 *
 * Aqui é TypeScript comum, que serve aos dois lados.
 *
 * Os apelidos são públicos: entram em link guardado e em favorito, e mudá-los
 * quebra endereço que alguém anotou.
 */
export const OPERATIONS_SECTIONS = {
  overview: "atendimentos",
  pmoc: "pmoc",
  rvt: "rvt",
  authorization: "autorizacao",
} as const;

export type OperationsSection =
  (typeof OPERATIONS_SECTIONS)[keyof typeof OPERATIONS_SECTIONS];
