/**
 * Este mês contra o mesmo trecho do mês anterior — o que mudou, em números.
 *
 * ## Por que não mais o radar
 *
 * O radar pedia para comparar áreas de dois polígonos sobre cinco eixos de
 * percentual — e ninguém decide nada olhando área. Quem gerencia uma operação
 * de climatização quer ler, por linha: quanto foi, quanto tinha sido, e se
 * melhorou. Contagens e percentuais lado a lado, com a variação dita em
 * palavra e cor.
 *
 * ## Sem dado não é zero
 *
 * Percentual sem base (nenhum PMOC venceu no mês) é "sem dados", não 0%. A
 * linha só some quando os dois meses estão sem dado.
 */
import type { AnalyticsKpi } from "@/types/dashboard";

export type ComparisonKind = "count" | "rate";

/** `up`: subir é bom. `neutral`: volume, nem bom nem ruim por si. */
type Better = "up" | "neutral";

export const COMPARISON_METRICS: ReadonlyArray<{
  id: string;
  label: string;
  kind: ComparisonKind;
  better: Better;
}> = [
  { id: "operations.total", label: "Demandas abertas", kind: "count", better: "neutral" },
  { id: "operations.completed", label: "Atendimentos concluídos", kind: "count", better: "up" },
  { id: "operations.sla_compliance", label: "Concluídos no prazo", kind: "rate", better: "up" },
  { id: "technicians.assignment_coverage", label: "Demandas com técnico", kind: "rate", better: "up" },
  { id: "pmoc.compliance", label: "PMOC em dia", kind: "rate", better: "up" },
  { id: "rvt.compliance", label: "Visitas de RVT em dia", kind: "rate", better: "up" },
];

export type Trend = "better" | "worse" | "same" | "neutral" | "none";

export interface ComparisonRow {
  id: string;
  label: string;
  kind: ComparisonKind;
  current: number | null;
  previous: number | null;
  /** "8 de 10" quando é percentual com base. */
  currentBasis: string | null;
  /** Contagem: variação em %; percentual: em pontos. `null` sem os dois lados. */
  delta: number | null;
  trend: Trend;
}

function read(items: readonly AnalyticsKpi[], id: string, kind: ComparisonKind) {
  const item = items.find((metric) => metric.id === id);
  if (!item) return { value: null, basis: null };
  if (kind === "rate" && !(item.sampleSize ?? item.basis?.denominator ?? 0))
    return { value: null, basis: null };
  return {
    value: item.value,
    basis: item.basis ? `${item.basis.numerator} de ${item.basis.denominator}` : null,
  };
}

export function comparisonRows(
  current: readonly AnalyticsKpi[],
  previous: readonly AnalyticsKpi[],
): ComparisonRow[] {
  return COMPARISON_METRICS.flatMap((metric) => {
    const now = read(current, metric.id, metric.kind);
    const before = read(previous, metric.id, metric.kind);
    if (now.value === null && before.value === null) return [];
    let delta: number | null = null;
    if (now.value !== null && before.value !== null) {
      delta =
        metric.kind === "rate"
          ? Math.round(now.value - before.value)
          : before.value === 0
            ? now.value === 0
              ? 0
              : null
            : Math.round(((now.value - before.value) / before.value) * 100);
    }
    const subiu =
      now.value !== null && before.value !== null
        ? Math.sign(now.value - before.value)
        : null;
    const trend: Trend =
      subiu === null
        ? "none"
        : subiu === 0
          ? "same"
          : metric.better === "neutral"
            ? "neutral"
            : subiu > 0
              ? "better"
              : "worse";
    return [
      {
        id: metric.id,
        label: metric.label,
        kind: metric.kind,
        current: now.value,
        previous: before.value,
        currentBasis: metric.kind === "rate" ? now.basis : null,
        delta,
        trend,
      },
    ];
  });
}

/** A variação em texto: "+12%", "−8 pts", "igual", "novo". */
export function deltaText(row: ComparisonRow): string {
  if (row.trend === "none") return row.previous === null ? "sem base anterior" : "sem dados";
  if (row.trend === "same") return "igual";
  if (row.delta === null) return "novo";
  const sinal = row.delta > 0 ? "+" : "−";
  const valor = Math.abs(row.delta);
  return row.kind === "rate" ? `${sinal}${valor} pts` : `${sinal}${valor}%`;
}
