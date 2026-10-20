/**
 * Situações de ciclo de vida, em português.
 *
 * Vários recursos do Orbit compartilham o mesmo vocabulário — ativo, inativo,
 * suspenso, pendente — e cada tela que o traduzia por conta própria era uma
 * chance a mais de a mesma situação aparecer com dois nomes. Aqui a tradução
 * existe uma vez.
 *
 * Não é um sistema de tradução: é a apresentação de um vocabulário de domínio,
 * ao lado dos demais registries. Situações específicas de um módulo — as de
 * atendimento, de PMOC, de documento — continuam nos seus próprios arquivos,
 * porque significam coisas diferentes.
 */

/** O que cada situação quer dizer para quem opera. */
const LIFECYCLE_LABELS: Readonly<Record<string, string>> = {
  ACTIVE: "Ativa",
  INACTIVE: "Inativa",
  SUSPENDED: "Suspensa",
  PENDING: "Pendente",
  ERROR: "Com erro",
  CANCELLED: "Cancelada",
  ARCHIVED: "Arquivada",
  TRIAL: "Em avaliação",
  EXPIRED: "Expirada",
  BLOCKED: "Bloqueada",
  COMPLETED: "Concluída",
  FAILED: "Falhou",
  RUNNING: "Em andamento",
  QUEUED: "Na fila",
};

/**
 * Formas masculinas, para quando o sujeito da frase pede concordância.
 *
 * "Plano ativa" está errado em português, e concordância não é detalhe: é o
 * que separa um produto cuidado de uma tradução automática.
 */
const MASCULINE: Readonly<Record<string, string>> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  SUSPENDED: "Suspenso",
  CANCELLED: "Cancelado",
  ARCHIVED: "Arquivado",
  EXPIRED: "Expirado",
  BLOCKED: "Bloqueado",
  COMPLETED: "Concluído",
};

/**
 * A situação em linguagem de produto.
 *
 * Uma situação que este registro ainda não conhece vira texto legível — nunca
 * o identificador cru. Um valor novo publicado amanhã aparece como "Em
 * revisão", não como `EM_REVISAO`.
 */
export function lifecycleLabel(
  status: string | null | undefined,
  options: { gender?: "feminine" | "masculine" } = {},
): string {
  if (!status) return "—";
  const key = status.trim().toUpperCase();

  if (options.gender === "masculine" && MASCULINE[key]) return MASCULINE[key];
  if (LIFECYCLE_LABELS[key]) return LIFECYCLE_LABELS[key];

  return key
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}
