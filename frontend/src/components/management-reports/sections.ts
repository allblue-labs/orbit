/**
 * Os apelidos das abas de Relatórios.
 *
 * Módulo próprio e sem `"use client"` pela mesma razão das seções de Operações:
 * a página de redirecionamento (`/documentos`) é Server Component, e importar um
 * valor de um módulo cliente devolveria uma referência de cliente — o destino
 * sairia como `?secao=undefined` sem erro de tipo nenhum.
 *
 * Os apelidos são públicos: entram em link guardado e em favorito.
 */
export const REPORTS_SECTIONS = {
  overview: "visao-geral",
  generate: "gerar",
  history: "historico",
  documents: "emitidos",
  templates: "modelos",
} as const;

export type ReportsSection =
  (typeof REPORTS_SECTIONS)[keyof typeof REPORTS_SECTIONS];
