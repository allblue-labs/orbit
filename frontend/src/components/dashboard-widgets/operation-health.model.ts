/**
 * Saúde da operação — o que está em ordem e o que pede atenção, em números.
 *
 * ## Por que não mais um índice de 0 a 100
 *
 * O índice era uma média de percentuais com pesos que mudavam conforme havia
 * dado — "73/100" não dizia o que fazer. Cada barra agora é uma pergunta que
 * um gerente de operação de climatização faz todo dia, com a resposta em
 * contagem ("9 de 12") e o problema dito em palavra ("3 atrasados").
 *
 * As medidas vêm prontas do Analytics (numerador e denominador); aqui só se
 * escolhe a pergunta, a frase e a cor.
 */
import type { AnalyticsKpi } from "@/types/dashboard";

export type HealthTone = "ok" | "attention" | "critical";

const PERGUNTAS: ReadonlyArray<{
  id: string;
  label: string;
  /** O problema, dado o que falta: "3 atrasados". */
  gap: (missing: number) => string;
  area: "operations" | "pmoc" | "rvt";
}> = [
  {
    id: "operations.backlog_punctuality",
    label: "Atendimentos em aberto sem atraso",
    gap: (n) => `${n} ${n === 1 ? "atrasado" : "atrasados"}`,
    area: "operations",
  },
  {
    id: "technicians.backlog_coverage",
    label: "Em aberto com técnico definido",
    gap: (n) => `${n} sem técnico`,
    area: "operations",
  },
  {
    id: "operations.backlog_scheduling",
    label: "Em aberto com data marcada",
    gap: (n) => `${n} sem data`,
    area: "operations",
  },
  {
    id: "operations.sla_compliance",
    label: "Concluídos dentro do prazo",
    gap: (n) => `${n} fora do prazo`,
    area: "operations",
  },
  {
    id: "pmoc.compliance",
    label: "Ciclos de PMOC em dia",
    gap: (n) => `${n} ${n === 1 ? "vencido" : "vencidos"}`,
    area: "pmoc",
  },
  {
    id: "rvt.compliance",
    label: "Visitas de RVT em dia",
    gap: (n) => `${n} ${n === 1 ? "atrasada" : "atrasadas"}`,
    area: "rvt",
  },
];

export interface HealthBar {
  id: string;
  label: string;
  percent: number;
  numerator: number;
  denominator: number;
  tone: HealthTone;
  /** O problema em palavra, ou `null` quando está tudo certo. */
  gap: string | null;
  area: "operations" | "pmoc" | "rvt";
}

export function toneFor(percent: number): HealthTone {
  return percent >= 90 ? "ok" : percent >= 70 ? "attention" : "critical";
}

/** As barras com base de cálculo, e os nomes das que ficaram sem dado. */
export function operationHealth(metrics: readonly AnalyticsKpi[]): {
  bars: HealthBar[];
  withoutData: string[];
  attention: number;
} {
  const bars: HealthBar[] = [];
  const withoutData: string[] = [];
  for (const pergunta of PERGUNTAS) {
    const metric = metrics.find((item) => item.id === pergunta.id);
    const basis = metric?.basis;
    if (!metric || !basis || basis.denominator <= 0) {
      withoutData.push(pergunta.label);
      continue;
    }
    const percent = Math.round((basis.numerator / basis.denominator) * 100);
    const missing = basis.denominator - basis.numerator;
    bars.push({
      id: pergunta.id,
      label: pergunta.label,
      percent,
      numerator: basis.numerator,
      denominator: basis.denominator,
      tone: toneFor(percent),
      gap: missing > 0 ? pergunta.gap(missing) : null,
      area: pergunta.area,
    });
  }
  return {
    bars,
    withoutData,
    attention: bars.filter((bar) => bar.tone !== "ok").length,
  };
}
