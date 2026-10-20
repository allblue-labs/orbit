"use client";

/**
 * Lista cronológica.
 *
 * A ordem vem do backend (`startsAt asc`) e é preservada; o agrupamento por
 * dia usa a chave local, a mesma das grades — assim a lista e o calendário
 * nunca discordam sobre em que dia um evento está.
 */
import { CalendarClock, Link2 } from "lucide-react";

import { EmptyState } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import {
  formatInZone,
  formatZonedTime,
  type DayBucket,
} from "@/lib/scheduling";
import { cn } from "@/lib/utils";
import { assignmentAuthorityLabel } from "@/registry";
import type { SchedulingOccurrence } from "@/types/scheduling";
import {
  ConflictSeverityBadge,
  EventPriorityBadge,
  EventStatusBadge,
  eventTypeLabel,
} from "../event-badges";

export function ListView({
  days,
  buckets,
  timeZone,
  conflicts,
  selectedEventId,
  todayKey,
  onSelect,
}: {
  days: readonly string[];
  buckets: ReadonlyMap<string, DayBucket>;
  timeZone: string;
  conflicts: ReadonlyMap<string, number>;
  selectedEventId: string | null;
  todayKey: string;
  onSelect: (eventId: string) => void;
}) {
  const populated = days.filter((day) => {
    const bucket = buckets.get(day);
    return (bucket?.allDay.length ?? 0) + (bucket?.timed.length ?? 0) > 0;
  });

  if (populated.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock className="size-5" />}
        title="Nenhum evento no período"
        description="Ajuste os filtros ou avance para o próximo intervalo."
      />
    );
  }

  return (
    <div className="space-y-6">
      {populated.map((dayKey) => {
        const bucket = buckets.get(dayKey);
        const entries = [...(bucket?.allDay ?? []), ...(bucket?.timed ?? [])];

        return (
          <section key={dayKey} className="space-y-2">
            <h3
              className={cn(
                "text-sm font-medium",
                dayKey === todayKey && "text-primary",
              )}
            >
              {formatInZone(`${dayKey}T12:00:00Z`, timeZone, {
                weekday: "long",
                day: "2-digit",
                month: "long",
              })}
            </h3>

            <ul className="space-y-2">
              {entries.map((segment) => (
                <OccurrenceRow
                  key={`${segment.occurrence.occurrenceId}-${dayKey}`}
                  occurrence={segment.occurrence}
                  timeZone={timeZone}
                  conflictCount={conflicts.get(segment.occurrence.eventId) ?? 0}
                  selected={selectedEventId === segment.occurrence.eventId}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function OccurrenceRow({
  occurrence,
  timeZone,
  conflictCount,
  selected,
  onSelect,
}: {
  occurrence: SchedulingOccurrence;
  timeZone: string;
  conflictCount: number;
  selected: boolean;
  onSelect: (eventId: string) => void;
}) {
  const linked =
    occurrence.source.entityId !== null &&
    occurrence.source.module === "operations";

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(occurrence.eventId)}
        className={cn(
          "flex w-full flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
          selected
            ? "border-primary/60 bg-primary/10"
            : "border-border hover:bg-surface-strong",
        )}
      >
        <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">
          {occurrence.allDay
            ? "Dia todo"
            : `${formatZonedTime(occurrence.startsAt, timeZone)} – ${formatZonedTime(occurrence.endsAt, timeZone)}`}
        </span>

        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">
              {occurrence.title}
            </span>
            <EventPriorityBadge priority={occurrence.priority} />
            {occurrence.recurring ? (
              <Badge variant="secondary" className="text-[10px]">
                recorrente
              </Badge>
            ) : null}
            {linked ? (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Link2 className="size-2.5" aria-hidden />
                operação
              </Badge>
            ) : null}
          </span>
          <span className="block text-xs text-muted-foreground">
            {eventTypeLabel(occurrence.type)}
            {occurrence.segment ? ` · ${occurrence.segment}` : ""}
            {occurrence.allocations.length > 0
              ? ` · ${occurrence.allocations.length} alocação(ões)`
              : ""}
            {/**
             * Quem manda no vínculo da equipe.
             *
             * `OPERATION` significa que a Agenda **reflete** o atendimento: o
             * backend espelha responsável e auxiliares como alocações. Dizer
             * isso responde de antemão por que a equipe não se edita aqui — e
             * evita abrir uma segunda forma de mudar a mesma coisa.
             */}
            {assignmentAuthorityLabel(occurrence.assignmentAuthority)
              ? ` · ${assignmentAuthorityLabel(occurrence.assignmentAuthority)}`
              : ""}
          </span>
        </span>

        {conflictCount > 0 ? (
          <ConflictSeverityBadge severity="WARNING" />
        ) : null}
        <EventStatusBadge status={occurrence.status} />
      </button>
    </li>
  );
}
