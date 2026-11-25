/**
 * Radar comparativo — este mês contra o mesmo trecho do mês anterior.
 *
 * ## Só percentuais em que "maior é melhor"
 *
 * Um radar só se lê quando todos os eixos falam a mesma língua: de 0 a 100,
 * e quanto mais para fora, melhor. Por isso os seis eixos são taxas de
 * qualidade da rotina de climatização — prazo, conclusão, técnico, agenda,
 * PMOC e RVT. Contagens (quantas demandas, quantas concluídas) ficam fora do
 * radar: escala própria, e moram na Saúde da operação.
 *
 * ## O radar não fala sozinho
 *
 * Ao lado do desenho vai a leitura: o valor deste mês, a base ("8 de 10") e a
 * variação em pontos, com cor de melhorou/piorou, e um resumo em uma frase.
 *
 * ## Sem base não é zero
 *
 * Um eixo sem denominador no mês (nenhum PMOC venceu) é "sem base", não 0%.
 * Ele sai do desenho e é listado à parte; um polígono só é desenhado quando
 * tem valor em todos os eixos exibidos.
 */
import type { AnalyticsKpi } from "@/types/dashboard";

export const RADAR_AXES: ReadonlyArray<{
  id: string;
  /** Rótulo curto, no eixo. */
  axis: string;
  /** A pergunta inteira, na leitura ao lado. */
  label: string;
}> = [
  { id: "operations.sla_compliance", axis: "No prazo", label: "Concluídos no prazo" },
  { id: "operations.completion_rate", axis: "Conclusão", label: "Demandas do mês concluídas" },
  { id: "technicians.assignment_coverage", axis: "Com técnico", label: "Demandas com técnico" },
  { id: "operations.scheduling_coverage", axis: "Com agenda", label: "Demandas com data" },
  { id: "pmoc.compliance", axis: "PMOC", label: "PMOC em dia" },
  { id: "rvt.compliance", axis: "RVT", label: "Visitas de RVT em dia" },
];

export type RadarTrend = "better" | "worse" | "same" | "none";

export interface RadarRow {
  id: string;
  axis: string;
  label: string;
  current: number | null;
  previous: number | null;
  /** "8 de 10" deste mês, quando há base. */
  currentBasis: string | null;
  /** Diferença em pontos percentuais; `null` sem os dois lados. */
  delta: number | null;
  trend: RadarTrend;
}

function measured(items: readonly AnalyticsKpi[], id: string) {
  const item = items.find((metric) => metric.id === id);
  const denominator = item?.basis?.denominator ?? item?.sampleSize ?? 0;
  if (!item || item.unit !== "%" || !denominator) return null;
  return {
    value: Math.round(item.value),
    basis: item.basis ? `${item.basis.numerator} de ${item.basis.denominator}` : null,
  };
}

/** Todos os eixos com dado em pelo menos um dos meses. */
export function radarRows(
  current: readonly AnalyticsKpi[],
  previous: readonly AnalyticsKpi[],
): RadarRow[] {
  return RADAR_AXES.flatMap(({ id, axis, label }) => {
    const now = measured(current, id);
    const before = measured(previous, id);
    if (!now && !before) return [];
    const delta = now && before ? now.value - before.value : null;
    const trend: RadarTrend =
      delta === null ? "none" : delta > 0 ? "better" : delta < 0 ? "worse" : "same";
    return [
      {
        id,
        axis,
        label,
        current: now?.value ?? null,
        previous: before?.value ?? null,
        currentBasis: now?.basis ?? null,
        delta,
        trend,
      },
    ];
  });
}

/**
 * O que vai para o desenho.
 *
 * Preferência: eixos medidos nos dois meses (a comparação é justa); senão, os
 * medidos neste mês. Com menos de três eixos não há polígono — o radar dá
 * lugar só à leitura.
 */
export function radarShape(rows: readonly RadarRow[]): {
  axes: RadarRow[];
  drawCurrent: boolean;
  drawPrevious: boolean;
} {
  const both = rows.filter((row) => row.current !== null && row.previous !== null);
  const axes = both.length >= 3 ? both : rows.filter((row) => row.current !== null);
  if (axes.length < 3) return { axes: [], drawCurrent: false, drawPrevious: false };
  return {
    axes,
    drawCurrent: true,
    drawPrevious: axes.every((row) => row.previous !== null),
  };
}

/** "Melhorou em 3 de 5 indicadores; piorou em 1." */
export function radarSummary(rows: readonly RadarRow[]): string | null {
  const compared = rows.filter((row) => row.trend !== "none");
  if (compared.length === 0) return null;
  const better = compared.filter((row) => row.trend === "better").length;
  const worse = compared.filter((row) => row.trend === "worse").length;
  const total = compared.length;
  const de = `de ${total} ${total === 1 ? "indicador" : "indicadores"}`;
  if (better === 0 && worse === 0) return `Estável nos ${total} indicadores comparáveis.`;
  if (worse === 0) return `Melhorou em ${better} ${de}.`;
  if (better === 0) return `Piorou em ${worse} ${de}.`;
  return `Melhorou em ${better} e piorou em ${worse} ${de}.`;
}

/** "+5 pts", "−3 pts", "igual", "sem anterior". */
export function radarDeltaText(row: RadarRow): string {
  if (row.delta === null) return row.previous === null ? "sem anterior" : "sem base";
  if (row.delta === 0) return "igual";
  return `${row.delta > 0 ? "+" : "−"}${Math.abs(row.delta)} pts`;
}
