"use client";

/**
 * Timeline e histórico.
 *
 * `GET /operations/:id/timeline` devolve `{ events, attachments }` — eventos
 * de histórico com autor e anexos com quem enviou. `GET /operations/:id/history`
 * devolve só os eventos.
 *
 * As duas seções existem porque respondem a perguntas diferentes: a timeline é
 * a leitura cronológica de tudo que aconteceu; o histórico é o registro de
 * auditoria com transições de status. Ambas se atualizam sozinhas, com
 * cadências diferentes.
 */
import { Badge } from "@/components/ui/badge";
import { Timeline } from "@/components/ui/timeline";
import { PanelFrame, PanelState, type PanelQuery } from "@/components/panels";

import { useDateFormatters } from "@/hooks/use-date-formatters";
import {
  OPERATION_HISTORY_LABELS,
  OPERATION_STATUS_LABELS,
  type OperationHistoryEntry,
  type OperationTimeline,
} from "@/types/operations";

/** Ações que representam desfecho positivo, negativo ou neutro. */
const ACTION_TONE: Readonly<
  Record<string, "default" | "success" | "warning" | "destructive">
> = {
  CREATED: "default",
  UPDATED: "default",
  STATUS_CHANGED: "warning",
  USER_ASSIGNED: "success",
  USER_UNASSIGNED: "warning",
  ATTACHMENT_ADDED: "default",
  ATTACHMENT_REMOVED: "warning",
  CHECKLIST_STARTED: "default",
  CHECKLIST_COMPLETED: "success",
  CHECKLIST_CANCELLED: "warning",
  DELETED: "destructive",
};

export function TimelineSection({
  query,
}: {
  query: PanelQuery<OperationTimeline>;
}) {
  const { formatDateTime } = useDateFormatters();
  return (
    <PanelFrame
      panelId="operation-timeline"
      title="Linha do tempo"
      description="Tudo que aconteceu na operação"
      actions={
        query.data ? (
          <Badge variant="secondary">{query.data.events.length}</Badge>
        ) : null
      }
    >
      <PanelState
        query={query}
        loadingRows={5}
        emptyMessage="Nenhum evento registrado."
        isEmpty={(timeline) => timeline.events.length === 0}
      >
        {(timeline) => (
          <Timeline
            items={timeline.events.map((event) => ({
              title: describe(event),
              timestamp: formatDateTime(event.createdAt),
              description: event.user?.displayName ?? "Sistema",
              tone: ACTION_TONE[event.action] ?? "default",
            }))}
          />
        )}
      </PanelState>
    </PanelFrame>
  );
}

export function HistorySection({
  query,
}: {
  query: PanelQuery<readonly OperationHistoryEntry[]>;
}) {
  const { formatDateTime } = useDateFormatters();
  return (
    <PanelFrame
      panelId="operation-history"
      title="Histórico"
      description="Registro de auditoria das mudanças"
    >
      <PanelState
        query={query}
        loadingRows={4}
        emptyMessage="Nenhuma alteração registrada."
        isEmpty={(entries) => entries.length === 0}
      >
        {(entries) => (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{describe(entry)}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.user?.displayName ?? "Sistema"}
                  </p>
                </div>
                <time className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatDateTime(entry.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </PanelState>
    </PanelFrame>
  );
}

/**
 * Descreve o evento.
 *
 * Para transições, mostra origem e destino — a informação que o backend
 * registra em `fromStatus`/`toStatus`.
 */
function describe(entry: OperationHistoryEntry): string {
  const label = OPERATION_HISTORY_LABELS[entry.action] ?? entry.action;
  if (entry.action !== "STATUS_CHANGED") return label;
  const from = entry.fromStatus
    ? (OPERATION_STATUS_LABELS[entry.fromStatus] ?? entry.fromStatus)
    : null;
  const to = entry.toStatus
    ? (OPERATION_STATUS_LABELS[entry.toStatus] ?? entry.toStatus)
    : null;
  if (from && to) return `${label}: ${from} → ${to}`;
  return to ? `${label}: ${to}` : label;
}
