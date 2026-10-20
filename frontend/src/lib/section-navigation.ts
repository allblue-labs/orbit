/**
 * A seção aberta vive na URL.
 *
 * As abas de Perfil e Configurações eram estado local: recarregar voltava para
 * a primeira, e `/configuracoes?secao=seguranca` abria "Organização" — o
 * parâmetro era ignorado. Com a seção na URL, o endereço passa a descrever o
 * que está na tela, e voltar no navegador desfaz a troca de aba como desfaz
 * qualquer navegação.
 *
 * O parâmetro se chama `secao` e o valor é um apelido legível — `seguranca`,
 * `preferencias` —, não o enum interno de nenhum contrato: é endereço que se
 * copia e se cola numa conversa.
 */

/** O apelido é estável e público; mudá-lo quebra links que alguém guardou. */
export type SectionSlug = string;

export const SECTION_PARAM = "secao";

/**
 * A seção pedida, quando é uma das que existem.
 *
 * Apelido desconhecido cai na primeira seção em vez de deixar a tela vazia —
 * um link antigo para uma aba que saiu do produto continua abrindo a página.
 */
export function resolveSection(
  requested: string | null | undefined,
  available: readonly SectionSlug[],
  fallback: SectionSlug = available[0],
): SectionSlug {
  if (!requested) return fallback;
  return available.includes(requested) ? requested : fallback;
}

/**
 * O endereço da seção, preservando o resto da consulta.
 *
 * Outros parâmetros continuam onde estavam: quem chega com um filtro na URL
 * não o perde ao trocar de aba.
 */
export function sectionHref(
  pathname: string,
  section: SectionSlug,
  current?: URLSearchParams | null,
): string {
  const params = new URLSearchParams(current ?? undefined);
  params.set(SECTION_PARAM, section);
  return `${pathname}?${params.toString()}`;
}
