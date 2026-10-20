/**
 * Apresentação de plano e cobrança.
 *
 * Tudo aqui recebe números que o servidor já decidiu e devolve texto. Nenhuma
 * função deste arquivo calcula valor contratual: o equivalente mensal é uma
 * divisão do preço que o servidor publicou, mostrada ao lado dele, e o que a
 * empresa paga continua sendo o total.
 */
import {
  BILLING_INTERVAL_MONTHS,
  ENTITLEMENT_RESOURCE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  type PlanLimit,
  type ResourceEntitlement,
} from "@/types/billing";

const MOEDA = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const INTEIRO = new Intl.NumberFormat("pt-BR");

/** Centavos para moeda. O inteiro é a autoridade; isto é vitrine. */
export function formatCentavos(amountMinor: number): string {
  return MOEDA.format(amountMinor / 100);
}

export function formatQuantidade(valor: number): string {
  return INTEIRO.format(valor);
}

/**
 * O teto, em texto.
 *
 * Ilimitado nunca aparece como `null`, `-1` nem número mágico — a palavra é a
 * informação.
 */
export function formatLimite(limit: PlanLimit): string {
  return limit.unlimited ? "Ilimitado" : formatQuantidade(limit.value);
}

/** "14 de 20" ou "347 · ilimitado". */
export function formatConsumo(item: ResourceEntitlement): string {
  return item.limit.unlimited
    ? `${formatQuantidade(item.current)} · ilimitado`
    : `${formatQuantidade(item.current)} de ${formatQuantidade(item.limit.value)}`;
}

/**
 * Quanto da cota já foi usada, de 0 a 100.
 *
 * `null` para ilimitado: uma barra de proporção sobre um teto que não existe
 * não significaria nada. E o valor é preso em 100 — passar do teto é decisão
 * do servidor, e a barra não deve transbordar para contar isso.
 */
export function percentualDeUso(item: ResourceEntitlement): number | null {
  if (item.limit.unlimited) return null;
  if (item.limit.value === 0) return item.current > 0 ? 100 : 0;
  return Math.min(100, Math.round((item.current / item.limit.value) * 100));
}

/**
 * A faixa visual do consumo.
 *
 * Apresentação, e só. Nenhuma decisão de cobrança ou de bloqueio sai daqui —
 * quem recusa a próxima criação é o servidor, no momento da escrita.
 */
export function faixaDeUso(percentual: number | null): "normal" | "atencao" | "alto" {
  if (percentual === null) return "normal";
  if (percentual >= 90) return "alto";
  if (percentual >= 70) return "atencao";
  return "normal";
}

export function rotuloDoRecurso(resource: string): string {
  return ENTITLEMENT_RESOURCE_LABELS[resource] ?? resource;
}

/**
 * O estado da assinatura em português.
 *
 * Estado que esta tabela não conhece vira texto neutro em vez do código cru:
 * mostrar `GRACE_PERIOD` para quem está tentando entender a própria conta não
 * ajuda ninguém.
 */
export function rotuloDoStatus(status: string): string {
  return SUBSCRIPTION_STATUS_LABELS[status] ?? "Assinatura";
}

/**
 * O equivalente mensal de um preço plurianual.
 *
 * Derivação de apresentação sobre o valor que o servidor publicou — o total
 * cobrado continua sendo o total, e aparece junto. `null` no mensal, onde a
 * conta não diria nada.
 */
export function equivalenteMensal(
  amountMinor: number,
  interval: string,
): string | null {
  const meses = BILLING_INTERVAL_MONTHS[interval];
  if (!meses || meses <= 1) return null;
  return formatCentavos(Math.round(amountMinor / meses));
}

/** "Renova em 12 dias" — a data vem do servidor, a contagem é apresentação. */
export function diasAte(iso: string, agora: Date = new Date()): number {
  const alvo = new Date(iso).getTime();
  return Math.max(0, Math.ceil((alvo - agora.getTime()) / 86_400_000));
}
