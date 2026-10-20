"use client";

/**
 * Grade de horas — base das visões de dia e semana.
 *
 * Uma grade com N colunas: a visão do dia usa uma, a da semana usa sete. Não
 * há dois componentes de calendário, e acrescentar uma visão de "3 dias" seria
 * passar `days` com três chaves.
 *
 * **Sem biblioteca de calendário.** O que a grade precisa — posicionar blocos
 * por minuto e distribuir sobreposições em faixas — são vinte linhas de
 * aritmética sobre dados que o backend já entregou prontos. Uma dependência
 * externa traria seu próprio modelo de evento, seu próprio tratamento de fuso
 * e seu próprio calendário de recorrência, justamente as três coisas que aqui
 * pertencem ao servidor.
 *
 * As sobreposições desenhadas aqui são **layout**, não detecção de conflito:
 * quem diz que dois eventos conflitam é `GET /scheduling/conflicts`.
 */
import type { DayBucket, DaySegment } from "@/lib/scheduling";
import { cn } from "@/lib/utils";
import { laneGeometry } from "@/lib/scheduling-lane-geometry";
import { EventBlock } from "./event-block";

const HOUR_HEIGHT = 48;
const MINUTES_IN_DAY = 24 * 60;
/** Primeira hora visível ao abrir — a grade rola sozinha até aqui. */
const FOCUS_HOUR = 7;

export interface TimeGridProps {
  days: readonly string[];
  buckets: ReadonlyMap<string, DayBucket>;
  timeZone: string;
  conflicts: ReadonlyMap<string, number>;
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
  /** Cabeçalho de cada coluna. Ausente na visão de um dia só. */
  renderHeader?: (dayKey: string) => React.ReactNode;
}

export function TimeGrid({
  days,
  buckets,
  timeZone,
  conflicts,
  selectedEventId,
  onSelect,
  renderHeader,
}: TimeGridProps) {
  const allDayRows = days.map((day) => buckets.get(day)?.allDay ?? []);
  const hasAllDay = allDayRows.some((row) => row.length > 0);

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
      {renderHeader ? (
        <div
          className="grid border-b border-border"
          style={{ gridTemplateColumns: `4rem repeat(${days.length}, 1fr)` }}
        >
          <div />
          {days.map((day) => (
            <div key={day} className="border-l border-border px-2 py-2">
              {renderHeader(day)}
            </div>
          ))}
        </div>
      ) : null}

      {hasAllDay ? (
        <div
          className="grid border-b border-border bg-surface-strong/30"
          style={{ gridTemplateColumns: `4rem repeat(${days.length}, 1fr)` }}
        >
          <div className="px-2 py-2 text-[10px] text-muted-foreground uppercase">
            Dia todo
          </div>
          {days.map((day, index) => (
            <div key={day} className="space-y-1 border-l border-border p-1">
              {allDayRows[index].map((segment) => (
                <EventBlock
                  key={`${segment.occurrence.occurrenceId}-allday`}
                  segment={segment}
                  timeZone={timeZone}
                  conflictCount={conflicts.get(segment.occurrence.eventId) ?? 0}
                  selected={selectedEventId === segment.occurrence.eventId}
                  onSelect={onSelect}
                  variant="inline"
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}

      <div
        className="max-h-[36rem] overflow-y-auto"
        ref={(node) => {
          /**
           * Rola até a manhã ao montar. Callback de ref em vez de efeito: é
           * um ajuste de apresentação no nó, não estado de React.
           */
          if (node && node.scrollTop === 0) {
            node.scrollTop = FOCUS_HOUR * HOUR_HEIGHT;
          }
        }}
      >
        <div
          className="grid"
          style={{ gridTemplateColumns: `4rem repeat(${days.length}, 1fr)` }}
        >
          <HourGutter />
          {days.map((day) => (
            <DayColumn
              key={day}
              segments={buckets.get(day)?.timed ?? []}
              timeZone={timeZone}
              conflicts={conflicts}
              selectedEventId={selectedEventId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function HourGutter() {
  return (
    <div className="relative" style={{ height: 24 * HOUR_HEIGHT }}>
      {Array.from({ length: 24 }, (_, hour) => (
        <div
          key={hour}
          className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
          style={{ top: hour * HOUR_HEIGHT }}
        >
          {hour === 0 ? "" : `${String(hour).padStart(2, "0")}:00`}
        </div>
      ))}
    </div>
  );
}

function DayColumn({
  segments,
  timeZone,
  conflicts,
  selectedEventId,
  onSelect,
}: {
  segments: readonly DaySegment[];
  timeZone: string;
  conflicts: ReadonlyMap<string, number>;
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
}) {
  const lanes = assignLanes(segments);

  return (
    <div
      className="relative border-l border-border"
      style={{ height: 24 * HOUR_HEIGHT }}
    >
      {Array.from({ length: 24 }, (_, hour) => (
        <div
          key={hour}
          className={cn(
            "absolute inset-x-0 border-t",
            hour % 6 === 0 ? "border-border" : "border-border/40",
          )}
          style={{ top: hour * HOUR_HEIGHT }}
        />
      ))}

      {lanes.map(({ segment, lane, lanes: total }) => {
        const top = (segment.startMinute / MINUTES_IN_DAY) * 24 * HOUR_HEIGHT;
        const rawHeight =
          ((segment.endMinute - segment.startMinute) / MINUTES_IN_DAY) *
          24 *
          HOUR_HEIGHT;

        const { left, width } = laneGeometry(lane, total);

        return (
          <div
            key={`${segment.occurrence.occurrenceId}-${segment.startMinute}`}
            className="absolute px-0.5 focus-within:z-20 hover:z-20"
            style={{
              top,
              /** Altura mínima para o bloco continuar legível. */
              height: Math.max(rawHeight, 22),
              left,
              width,
              /** Quem começa mais tarde fica por cima, como na leitura. */
              zIndex: lane + 1,
            }}
          >
            <EventBlock
              segment={segment}
              timeZone={timeZone}
              conflictCount={conflicts.get(segment.occurrence.eventId) ?? 0}
              selected={selectedEventId === segment.occurrence.eventId}
              onSelect={onSelect}
              variant="grid"
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Distribui segmentos sobrepostos em faixas lado a lado.
 *
 * Algoritmo de varredura: cada segmento ocupa a primeira faixa livre naquele
 * instante. É posicionamento visual — o número de faixas de um grupo define a
 * largura de cada bloco.
 */
function assignLanes(
  segments: readonly DaySegment[],
): readonly { segment: DaySegment; lane: number; lanes: number }[] {
  const ordered = [...segments].sort(
    (left, right) => left.startMinute - right.startMinute,
  );
  const result: { segment: DaySegment; lane: number; lanes: number }[] = [];

  let group: typeof result = [];
  let groupEnd = -1;

  const closeGroup = () => {
    const total = Math.max(1, ...group.map((entry) => entry.lane + 1));
    for (const entry of group) entry.lanes = total;
    group = [];
  };

  for (const segment of ordered) {
    if (segment.startMinute >= groupEnd) {
      closeGroup();
      groupEnd = segment.endMinute;
    } else {
      groupEnd = Math.max(groupEnd, segment.endMinute);
    }

    const taken = new Set(
      group
        .filter((entry) => entry.segment.endMinute > segment.startMinute)
        .map((entry) => entry.lane),
    );
    let lane = 0;
    while (taken.has(lane)) lane += 1;

    const entry = { segment, lane, lanes: lane + 1 };
    group.push(entry);
    result.push(entry);
  }
  closeGroup();

  return result;
}
