"use client";

/**
 * Visão mensal.
 *
 * A grade cobre da semana do dia 1 à semana do último dia — por isso a
 * consulta pede a **janela da grade**, e não a do mês: sem isso as bordas
 * apareceriam vazias, sugerindo que não há nada agendado quando há.
 *
 * Cada célula mostra os primeiros eventos e declara quantos ficaram de fora,
 * em vez de esconder silenciosamente.
 */
import { belongsToMonth, dayNumber, type DayBucket } from "@/lib/scheduling";
import { cn } from "@/lib/utils";
import { EventBlock } from "./event-block";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MAX_PER_CELL = 3;

export function MonthView({
  days,
  buckets,
  reference,
  timeZone,
  conflicts,
  selectedEventId,
  todayKey,
  onSelect,
  onOpenDay,
}: {
  days: readonly string[];
  buckets: ReadonlyMap<string, DayBucket>;
  reference: Date;
  timeZone: string;
  conflicts: ReadonlyMap<string, number>;
  selectedEventId: string | null;
  todayKey: string;
  onSelect: (eventId: string) => void;
  onOpenDay: (dayKey: string) => void;
}) {
  return (
    <div
      /**
       * A semana rola dentro do painel, não some nele.
       *
       * `overflow-hidden` existia para as bordas arredondadas, e numa tela de
       * 375px cortava trinta pixels da grade — os dois últimos dias ficavam
       * inalcançáveis, sem barra e sem aviso. Rolar na horizontal mantém a
       * grade inteira ao alcance e o corte onde ele é decoração.
       */
      className="glass-panel overflow-x-auto rounded-xl"
    >
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="px-2 py-2 text-center text-[10px] font-medium text-muted-foreground uppercase"
          >
            {weekday}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((dayKey) => {
          const bucket = buckets.get(dayKey);
          const entries = [...(bucket?.allDay ?? []), ...(bucket?.timed ?? [])];
          const visible = entries.slice(0, MAX_PER_CELL);
          const hidden = entries.length - visible.length;
          const inMonth = belongsToMonth(dayKey, reference, timeZone);

          return (
            <div
              key={dayKey}
              className={cn(
                "min-h-28 space-y-1 border-t border-l border-border p-1 first:border-l-0",
                !inMonth && "bg-surface-strong/20",
              )}
            >
              <button
                type="button"
                onClick={() => onOpenDay(dayKey)}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs tabular-nums transition-colors hover:bg-surface-strong",
                  dayKey === todayKey
                    ? "bg-primary font-semibold text-primary-foreground"
                    : inMonth
                      ? "text-foreground"
                      : "text-muted-foreground",
                )}
                aria-label={`Abrir ${dayKey}`}
              >
                {dayNumber(dayKey)}
              </button>

              {visible.map((segment) => (
                <EventBlock
                  key={`${segment.occurrence.occurrenceId}-${dayKey}`}
                  segment={segment}
                  timeZone={timeZone}
                  conflictCount={conflicts.get(segment.occurrence.eventId) ?? 0}
                  selected={selectedEventId === segment.occurrence.eventId}
                  onSelect={onSelect}
                  variant="inline"
                />
              ))}

              {hidden > 0 ? (
                <button
                  type="button"
                  onClick={() => onOpenDay(dayKey)}
                  className="w-full px-1 text-left text-[10px] text-muted-foreground hover:underline"
                >
                  + {hidden} evento(s)
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
