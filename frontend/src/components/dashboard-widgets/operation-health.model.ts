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
 *
 * ## Por categoria
 *
 * As barras são agrupadas pelo que o gerente olha em cada momento: a fila em
 * aberto (agora), o volume do mês contra o mesmo trecho do mês anterior, e os
 * prazos e contratos (prazo cumprido, PMOC, RVT). O volume é contagem — barras
 * pareadas dos dois meses, não percentual — e por isso tem regra própria.
 */
import type { AnalyticsKpi } from "@/types/dashboard";

export type HealthTone = "ok" | "attention" | "critical";

export type HealthCategory = "queue" | "contracts";

export const HEALTH_CATEGORY_LABELS: Record<HealthCategory | "volume", string> = {
  queue: "Fila em aberto",
  volume: "Volume do mês",
  contracts: "Prazos e contratos",
};

const PERGUNTAS: ReadonlyArray<{
  id: string;
  label: string;
  /** O problema, dado o que falta: "3 atrasados". */
  gap: (missing: number) => string;
  area: "operations" | "pmoc" | "rvt";
  category: HealthCategory;
}> = [
  {
    id: "operations.backlog_punctuality",
    label: "Atendimentos em aberto sem atraso",
    gap: (n) => `${n} ${n === 1 ? "atrasado" : "atrasados"}`,
    area: "operations",
    category: "queue",
  },
  {
    id: "technicians.backlog_coverage",
    label: "Em aberto com técnico definido",
    gap: (n) => `${n} sem técnico`,
    area: "operations",
    category: "queue",
  },
  {
    id: "operations.backlog_scheduling",
    label: "Em aberto com data marcada",
    gap: (n) => `${n} sem data`,
    area: "operations",
    category: "queue",
  },
  {
    id: "operations.sla_compliance",
    label: "Concluídos dentro do prazo",
    gap: (n) => `${n} fora do prazo`,
    area: "operations",
    category: "contracts",
  },
  {
    id: "pmoc.compliance",
    label: "Ciclos de PMOC em dia",
    gap: (n) => `${n} ${n === 1 ? "vencido" : "vencidos"}`,
    area: "pmoc",
    category: "contracts",
  },
  {
    id: "rvt.compliance",
    label: "Visitas de RVT em dia",
    gap: (n) => `${n} ${n === 1 ? "atrasada" : "atrasadas"}`,
    area: "rvt",
    category: "contracts",
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
  category: HealthCategory;
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
      category: pergunta.category,
    });
  }
  return {
    bars,
    withoutData,
    attention: bars.filter((bar) => bar.tone !== "ok").length,
  };
}

/** Barras de uma categoria, na ordem das perguntas. */
export function barsOf(bars: readonly HealthBar[], category: HealthCategory) {
  return bars.filter((bar) => bar.category === category);
}

/* ------------------------------------------------------------------ */
/* Volume do mês: contagens deste mês × mesmo trecho do mês anterior.  */
/* ------------------------------------------------------------------ */

const VOLUME: ReadonlyArray<{ id: string; label: string }> = [
  { id: "operations.total", label: "Demandas abertas" },
  { id: "operations.completed", label: "Atendimentos concluídos" },
];

export interface VolumeRow {
  id: string;
  label: string;
  current: number;
  previous: number | null;
  /** Variação em %; `null` quando o mês anterior foi zero ou não veio. */
  delta: number | null;
}

export function monthVolume(
  current: readonly AnalyticsKpi[],
  previous: readonly AnalyticsKpi[],
): VolumeRow[] {
  return VOLUME.flatMap(({ id, label }) => {
    const now = current.find((item) => item.id === id);
    if (!now) return [];
    const before = previous.find((item) => item.id === id)?.value ?? null;
    if (now.value === 0 && !before) return [];
    const delta =
      before === null || before === 0
        ? null
        : Math.round(((now.value - before) / before) * 100);
    return [{ id, label, current: now.value, previous: before, delta }];
  });
}

/** "+20%", "−8%", "igual", "novo". */
export function volumeDeltaText(row: VolumeRow): string {
  if (row.previous === null) return "sem base anterior";
  if (row.current === row.previous) return "igual";
  if (row.delta === null) return "novo";
  return `${row.delta > 0 ? "+" : "−"}${Math.abs(row.delta)}%`;
}
