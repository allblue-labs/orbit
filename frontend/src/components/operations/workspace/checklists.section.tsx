"use client";

/**
 * Checklists da operação.
 *
 * `GET /checklist-executions?operationId=` devolve as execuções com o
 * snapshot do template e as respostas gravadas. O progresso é calculado pelo
 * backend (`progress`); o frontend não recalcula.
 */
import { ClipboardCheck } from "lucide-react";

import { PanelFrame, PanelState, type PanelQuery } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

import { useDateFormatters } from "@/hooks/use-date-formatters";
import { cn } from "@/lib/utils";
import type { PaginatedResult } from "@/types/api";
import type { ChecklistExecution } from "@/types/operations";

const STATUS_LABELS: Readonly<Record<string, string>> = {
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};

const STATUS_CLASSES: Readonly<Record<string, string>> = {
  IN_PROGRESS: "bg-warning/15 text-warning",
  COMPLETED: "bg-success/15 text-success",
  CANCELLED: "bg-destructive/15 text-destructive",
};

export function ChecklistsSection({
  query,
}: {
  query: PanelQuery<PaginatedResult<ChecklistExecution>>;
}) {
  const { formatDateTime } = useDateFormatters();
  return (
    <PanelFrame
      panelId="operation-checklists"
      title="Checklists"
      description="Execuções vinculadas à operação"
      actions={
        query.data ? (
          <Badge variant="secondary">{query.data.meta.total}</Badge>
        ) : null
      }
    >
      <PanelState
        query={query}
        loadingRows={3}
        emptyMessage="Nenhum checklist iniciado para esta operação."
        isEmpty={(page) => page.data.length === 0}
      >
        {(page) => (
          <ul className="space-y-4">
            {page.data.map((execution) => (
              <li key={execution.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <ClipboardCheck
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {execution.template.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        v{execution.templateVersion} ·{" "}
                        {execution.createdBy.displayName}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                      STATUS_CLASSES[execution.status] ??
                        "bg-surface-strong text-muted-foreground",
                    )}
                  >
                    {STATUS_LABELS[execution.status] ?? execution.status}
                  </span>
                </div>
                <Progress
                  value={execution.progress}
                  aria-label={`Progresso de ${execution.template.name}`}
                />
                <p className="text-xs text-muted-foreground">
                  {execution.progress}% ·{" "}
                  {execution.completedAt
                    ? `concluído em ${formatDateTime(execution.completedAt)}`
                    : `atualizado em ${formatDateTime(execution.updatedAt)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PanelState>
    </PanelFrame>
  );
}
