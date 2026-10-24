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
  type OperationHistoryEntry,
  type OperationTimeline,
} from "@/types/operations";
import { presentOperationHistory } from "../operation-history.presentation";

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
  FIELD_OPERATION_STARTED: "success",
  FIELD_OPERATION_COMPLETED: "success",
  CUSTOMER_ACKNOWLEDGEMENT_CAPTURED: "success",
  ASSIGNMENT_AUTHORIZED: "success",
  ASSIGNMENT_AUTHORIZATION_REVOKED: "warning",
  AUXILIARY_TECHNICIAN_ADDED: "success",
  AUXILIARY_TECHNICIAN_REMOVED: "warning",
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
            items={timeline.events.map((event) => {
              const presentation = presentOperationHistory(event);
              return {
                title: presentation.title,
                timestamp: formatDateTime(event.createdAt),
                description: [
                  presentation.explanation,
                  event.user?.displayName ?? "Sistema",
                ]
                  .filter(Boolean)
                  .join(" · "),
                tone: ACTION_TONE[event.action] ?? "default",
              };
            })}
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
            {entries.map((entry) => {
              const presentation = presentOperationHistory(entry);
              return (
                <li
                  key={entry.id}
                  className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">{presentation.title}</p>
                    {presentation.explanation ? (
                      <p className="text-sm text-muted-foreground">
                        {presentation.explanation}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {entry.user?.displayName ?? "Sistema"}
                    </p>
                  </div>
                  <time className="shrink-0 font-mono text-xs text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </PanelState>
    </PanelFrame>
  );
}
