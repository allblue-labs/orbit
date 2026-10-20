"use client";

/**
 * Orbit Intelligence da execução.
 *
 * A fonte é `execution.insights`, que o backend devolve embutido no detalhe.
 * Cada item traz `kind`, `severity`, `source`, `title`, `description`,
 * `payload` e `resolvedAt`.
 *
 * `kind` e `severity` são `varchar` livres — sem `CHECK` no banco e sem enum no
 * contrato. O painel agrupa pelos tipos convencionados (inconsistência,
 * alerta, recomendação, observação) e **mostra qualquer outro tipo no seu
 * próprio grupo, com a chave crua**, em vez de jogá-lo em "outros" ou
 * descartá-lo.
 *
 * **Nada é gerado aqui.** O painel só apresenta o que o servidor produziu, e
 * `source` diz quem produziu cada item.
 */
import { useMemo } from "react";
import {
  CircleAlert,
  Lightbulb,
  MessageSquare,
  TriangleAlert,
} from "lucide-react";

import { PanelFrame } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/formatters";
import type {
  ArtifactExecution,
  ArtifactExecutionInsight,
} from "@/types/artifact-executions";
import { InsightSeverityBadge } from "../execution-badges";

/** Tipos convencionados. Um `kind` fora desta lista ganha grupo próprio. */
const KNOWN_KINDS: Readonly<
  Record<string, { label: string; Icon: typeof Lightbulb }>
> = {
  INCONSISTENCY: { label: "Inconsistências", Icon: CircleAlert },
  ALERT: { label: "Alertas", Icon: TriangleAlert },
  RECOMMENDATION: { label: "Recomendações", Icon: Lightbulb },
  OBSERVATION: { label: "Observações", Icon: MessageSquare },
};

export function IntelligenceSection({
  execution,
}: {
  execution: ArtifactExecution;
}) {
  const groups = useMemo(() => groupByKind(execution.insights), [execution]);

  return (
    <PanelFrame
      panelId="artifact-execution-intelligence"
      title="Orbit Intelligence"
      description="Gerado para esta execução"
    >
      {groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhuma observação registrada para esta execução.
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => {
            const known = KNOWN_KINDS[group.kind];
            const Icon = known?.Icon ?? Lightbulb;
            return (
              <section key={group.kind} className="space-y-2">
                <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
                  <Icon className="size-3.5" aria-hidden />
                  {known?.label ?? group.kind}
                  <span className="tabular-nums">({group.items.length})</span>
                </h3>
                <ul className="space-y-2">
                  {group.items.map((insight) => (
                    <InsightRow key={insight.id} insight={insight} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </PanelFrame>
  );
}

function InsightRow({ insight }: { insight: ArtifactExecutionInsight }) {
  return (
    <li className="space-y-1 rounded-lg border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <InsightSeverityBadge severity={insight.severity} />
        <span className="text-sm font-medium">{insight.title}</span>
        {insight.resolvedAt ? (
          <Badge variant="secondary" className="text-[10px]">
            resolvido
          </Badge>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{insight.description}</p>
      <p className="text-[10px] text-muted-foreground">
        {insight.source} · {formatDateTime(insight.createdAt)}
      </p>
    </li>
  );
}

function groupByKind(
  insights: readonly ArtifactExecutionInsight[],
): readonly { kind: string; items: readonly ArtifactExecutionInsight[] }[] {
  const groups = new Map<string, ArtifactExecutionInsight[]>();
  for (const insight of insights) {
    const current = groups.get(insight.kind) ?? [];
    current.push(insight);
    groups.set(insight.kind, current);
  }

  /** Tipos conhecidos primeiro, na ordem convencionada; o resto depois. */
  const order = Object.keys(KNOWN_KINDS);
  return [...groups.entries()]
    .map(([kind, items]) => ({ kind, items }))
    .sort((a, b) => {
      const indexA = order.indexOf(a.kind);
      const indexB = order.indexOf(b.kind);
      if (indexA === indexB) return a.kind.localeCompare(b.kind);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });
}
