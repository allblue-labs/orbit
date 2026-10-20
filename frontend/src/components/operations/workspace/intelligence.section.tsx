"use client";

/**
 * Orbit Intelligence da operação — `GET /ai-executions?operationId=`.
 *
 * É o único caminho real de IA por operação: o backend permite vincular e
 * filtrar `AiExecution` por `operationId`. Nada é gerado no frontend — o que
 * aparece é o que o agente produziu.
 *
 * **Contrato**: `AiExecution.output` é JSON livre, cujo formato depende do
 * agente e do `purpose`. O backend não publica um schema de saída (resumo,
 * inconsistências, alertas, recomendações). A seção lê os campos quando eles
 * existem, com verificação em tempo de execução, e cai para a exibição do JSON
 * bruto quando não reconhece a forma — em vez de assumir uma estrutura que o
 * backend não garante.
 */
import { Bot, Sparkles, TriangleAlert } from "lucide-react";

import { PanelFrame, PanelState, type PanelQuery } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { PaginatedResult } from "@/types/api";
import type { AiExecution } from "@/types/operations";

const STATUS_CLASSES: Readonly<Record<string, string>> = {
  COMPLETED: "bg-success/15 text-success",
  SUCCEEDED: "bg-success/15 text-success",
  RUNNING: "bg-warning/15 text-warning",
  PENDING: "bg-surface-strong text-muted-foreground",
  FAILED: "bg-destructive/15 text-destructive",
  CANCELLED: "bg-destructive/15 text-destructive",
};

/** Campos que reconhecemos em `output`, quando o agente os produz. */
interface KnownOutput {
  summary?: string;
  insights?: readonly string[];
  inconsistencies?: readonly string[];
  alerts?: readonly string[];
  recommendations?: readonly string[];
}

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** Extrai o que for reconhecível sem assumir formato. */
function readOutput(output: unknown): KnownOutput | null {
  if (typeof output !== "object" || output === null) return null;
  const record = output as Record<string, unknown>;
  const known: KnownOutput = {
    summary: typeof record.summary === "string" ? record.summary : undefined,
    insights: isStringArray(record.insights) ? record.insights : undefined,
    inconsistencies: isStringArray(record.inconsistencies)
      ? record.inconsistencies
      : undefined,
    alerts: isStringArray(record.alerts) ? record.alerts : undefined,
    recommendations: isStringArray(record.recommendations)
      ? record.recommendations
      : undefined,
  };
  return Object.values(known).some((value) => value !== undefined)
    ? known
    : null;
}

export function IntelligenceSection({
  query,
}: {
  query: PanelQuery<PaginatedResult<AiExecution>>;
}) {
  return (
    <PanelFrame
      panelId="operation-intelligence"
      title="Orbit Intelligence"
      description="Análises de IA vinculadas a esta operação"
      actions={
        query.data ? (
          <Badge variant="secondary">
            <Bot className="size-3" aria-hidden />
            {query.data.meta.total}
          </Badge>
        ) : null
      }
    >
      <PanelState
        query={query}
        loadingRows={3}
        emptyMessage="Nenhuma análise de IA foi executada para esta operação."
        isEmpty={(page) => page.data.length === 0}
      >
        {(page) => (
          <ul className="space-y-5">
            {page.data.map((execution) => (
              <ExecutionCard key={execution.id} execution={execution} />
            ))}
          </ul>
        )}
      </PanelState>
    </PanelFrame>
  );
}

function ExecutionCard({ execution }: { execution: AiExecution }) {
  const output = readOutput(execution.output);

  return (
    <li className="space-y-3 border-b border-border pb-5 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate text-sm font-medium">
            {execution.purpose}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {execution.model ? (
            <Badge variant="outline" className="font-mono text-[11px]">
              {execution.model}
            </Badge>
          ) : null}
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
              STATUS_CLASSES[execution.status] ??
                "bg-surface-strong text-muted-foreground",
            )}
          >
            {execution.status}
          </span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {formatDateTime(execution.completedAt ?? execution.createdAt)}
        {execution.durationMs ? ` · ${execution.durationMs} ms` : null}
      </p>

      {output ? (
        <div className="space-y-3">
          {output.summary ? (
            <p className="text-sm whitespace-pre-wrap">{output.summary}</p>
          ) : null}
          <OutputList
            title="Inconsistências"
            items={output.inconsistencies}
            tone="warning"
          />
          <OutputList title="Alertas" items={output.alerts} tone="warning" />
          <OutputList title="Recomendações" items={output.recommendations} />
          <OutputList title="Indicadores" items={output.insights} />
        </div>
      ) : execution.output ? (
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Saída sem formato reconhecido — ver JSON
          </summary>
          <pre className="glass mt-2 max-h-56 overflow-auto rounded-lg p-3 font-mono text-xs">
            {JSON.stringify(execution.output, null, 2)}
          </pre>
        </details>
      ) : (
        <p className="text-xs text-muted-foreground">
          Execução sem saída registrada.
        </p>
      )}

      {execution.error ? (
        <p className="flex items-start gap-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Falha registrada nesta análise.
        </p>
      ) : null}
    </li>
  );
}

function OutputList({
  title,
  items,
  tone,
}: {
  title: string;
  items: readonly string[] | undefined;
  tone?: "warning";
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li
            key={item}
            className={cn(
              "text-sm",
              tone === "warning" ? "text-warning" : "text-muted-foreground",
            )}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
