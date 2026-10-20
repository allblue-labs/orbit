"use client";

/**
 * Bloco de uma ocorrência.
 *
 * É o único componente que sabe desenhar um evento; as quatro visões o
 * reutilizam em variantes diferentes. Ele recebe um `DaySegment` — já
 * recortado no dia — e não conhece endpoint algum.
 *
 * Marcas que ele apresenta, todas vindas do servidor:
 *
 * - **continuação** (`↑`/`↓`) quando a ocorrência atravessa a meia-noite;
 * - **recorrência**, de `occurrence.recurring`;
 * - **conflito**, da contagem que `GET /scheduling/conflicts` produziu;
 * - **fuso diferente**, quando o evento foi criado em outro fuso que não o da
 *   visão — nesse caso o horário local do evento é exibido junto.
 */
import { AlertTriangle, ArrowDown, ArrowUp, Globe, Repeat } from "lucide-react";

import type { DaySegment } from "@/lib/scheduling";
import { formatZonedTime } from "@/lib/scheduling";
import { cn } from "@/lib/utils";
import { eventStatusAccent, eventTypeLabel } from "../event-badges";

export function EventBlock({
  segment,
  timeZone,
  conflictCount,
  selected,
  onSelect,
  variant,
}: {
  segment: DaySegment;
  timeZone: string;
  conflictCount: number;
  selected: boolean;
  onSelect: (eventId: string) => void;
  variant: "grid" | "inline";
}) {
  const { occurrence } = segment;
  const compact =
    variant === "grid" && segment.endMinute - segment.startMinute < 45;
  const foreignZone = occurrence.timezone !== timeZone;

  return (
    <button
      type="button"
      onClick={() => onSelect(occurrence.eventId)}
      title={occurrence.title}
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md border-l-2 px-1.5 py-1 text-left transition-colors",
        eventStatusAccent(occurrence.status),
        selected
          ? "bg-primary/20 ring-1 ring-primary/60"
          : "bg-surface-strong/80 hover:bg-surface-strong",
        occurrence.status === "CANCELLED" && "opacity-60",
      )}
    >
      <span className="flex min-w-0 items-center gap-1">
        {segment.continuesBefore ? (
          <ArrowUp
            className="size-3 shrink-0 text-muted-foreground"
            aria-label="Começou no dia anterior"
          />
        ) : null}
        <span className="truncate text-xs font-medium">{occurrence.title}</span>
        {occurrence.recurring ? (
          <Repeat
            className="size-3 shrink-0 text-muted-foreground"
            aria-label="Recorrente"
          />
        ) : null}
        {conflictCount > 0 ? (
          <AlertTriangle
            className="size-3 shrink-0 text-amber-400"
            aria-label={`${conflictCount} conflito(s)`}
          />
        ) : null}
        {segment.continuesAfter ? (
          <ArrowDown
            className="size-3 shrink-0 text-muted-foreground"
            aria-label="Continua no dia seguinte"
          />
        ) : null}
      </span>

      {compact ? null : (
        <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
          {/*
            * O horário vai num elemento próprio para poder encurtar com
            * reticências. Solto, era texto anónimo dentro de um flex: não
            * encolhia, e o `overflow-hidden` do bloco cortava-o em silêncio.
            */}
          <span className="truncate">
            {occurrence.allDay ? (
              "Dia todo"
            ) : (
              <>
                {formatZonedTime(occurrence.startsAt, timeZone)}–
                {formatZonedTime(occurrence.endsAt, timeZone)}
              </>
            )}
          </span>
          {foreignZone ? (
            <span
              className="flex items-center gap-0.5"
              title={`Evento criado em ${occurrence.timezone}`}
            >
              <Globe className="size-2.5" aria-hidden />
              {formatZonedTime(occurrence.startsAt, occurrence.timezone)}
            </span>
          ) : null}
          <span className="truncate">· {eventTypeLabel(occurrence.type)}</span>
        </span>
      )}
    </button>
  );
}
