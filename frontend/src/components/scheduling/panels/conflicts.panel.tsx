"use client";

/**
 * Conflitos e indisponibilidades da janela.
 *
 * **Tudo vem de `GET /scheduling/conflicts`.** O backend cruza as ocorrências
 * expandidas entre si e contra as regras de disponibilidade, e classifica cada
 * achado em quatro tipos e duas severidades. O painel não compara horários.
 *
 * Vale notar o que a severidade significa no servidor: só conflito
 * `CRITICAL` bloqueia uma escrita (`assertConflicts`); `WARNING` é informado e
 * não impede. A interface preserva essa diferença em vez de tratar tudo como
 * erro.
 */
import { CalendarX2, ShieldAlert } from "lucide-react";

import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Button } from "@/components/ui/button";
import { formatZonedDateTime } from "@/lib/scheduling";
import type { SchedulingConflict } from "@/types/scheduling";
import type { useSchedulingConflicts } from "@/hooks/scheduling/use-scheduling";
import { ConflictSeverityBadge, conflictTypeLabel } from "../event-badges";

export function ConflictsPanel({
  query,
  timeZone,
  onSelectEvent,
}: {
  query: ReturnType<typeof useSchedulingConflicts>;
  timeZone: string;
  onSelectEvent: (eventId: string) => void;
}) {
  return (
    <PanelFrame
      panelId="scheduling-conflicts"
      title="Conflitos"
      description="Detectados no período visível"
    >
      <PanelState
        query={toPanelQuery(query)}
        loadingRows={3}
        isEmpty={(data) => data.length === 0}
        emptyMessage="Nenhum conflito no período."
      >
        {(conflicts) => (
          <ul className="space-y-2">
            {conflicts.map((conflict) => (
              <ConflictRow
                key={conflict.id}
                conflict={conflict}
                timeZone={timeZone}
                onSelectEvent={onSelectEvent}
              />
            ))}
          </ul>
        )}
      </PanelState>
    </PanelFrame>
  );
}

function ConflictRow({
  conflict,
  timeZone,
  onSelectEvent,
}: {
  conflict: SchedulingConflict;
  timeZone: string;
  onSelectEvent: (eventId: string) => void;
}) {
  const availability =
    conflict.type === "BLOCKED_AVAILABILITY" ||
    conflict.type === "OUTSIDE_AVAILABILITY";

  return (
    <li className="space-y-1 rounded-lg border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {availability ? (
          <CalendarX2
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        ) : (
          <ShieldAlert
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
        <span className="text-sm font-medium">
          {conflictTypeLabel(conflict.type)}
        </span>
        <ConflictSeverityBadge severity={conflict.severity} />
      </div>

      <p className="text-sm text-muted-foreground">{conflict.message}</p>
      <p className="text-xs text-muted-foreground">
        {formatZonedDateTime(conflict.startsAt, timeZone)} —{" "}
        {formatZonedDateTime(conflict.endsAt, timeZone)}
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        {conflict.eventId ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSelectEvent(conflict.eventId as string)}
          >
            Ver evento
          </Button>
        ) : null}
        {conflict.conflictingEventId ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSelectEvent(conflict.conflictingEventId as string)}
          >
            Ver o outro evento
          </Button>
        ) : null}
      </div>
    </li>
  );
}
