"use client";

/**
 * Scheduling Workspace — composição.
 *
 * ## Fluxo
 *
 * ```
 * fuso da unidade ──> janela da visão ──> query key ──> hooks ──> BFF ──> backend
 *                                                  │
 *     ocorrências · conflitos · inteligência ◄──────┘
 *                          │
 *                 normalização por dia local
 *                          │
 *              dia · semana · mês · lista
 * ```
 *
 * A janela e o fuso entram na query key, então trocar de período ou de unidade
 * é uma consulta nova — e voltar ao período anterior reaproveita o cache.
 *
 * ## Componentes desacoplados da fonte
 *
 * As quatro visões recebem `ReadonlyMap<string, DayBucket>` e não sabem de
 * onde vieram os dados. É o que permitirá reaproveitá-las no aplicativo móvel
 * com cache offline, sem tocar em nenhuma grade.
 *
 * ## Dois arranjos, um workspace
 *
 * `layout="workspace"` é a visão de trabalho: grade e, ao lado, os painéis de
 * análise que o backend publica (conflitos, disponibilidade, inteligência).
 * `layout="calendar"` é a visão de calendário: a mesma grade ocupando a
 * largura inteira, sem a coluna de análise, para quem quer só enxergar a
 * semana. **Nenhum componente é duplicado** — muda a moldura, não a fonte nem
 * as visões.
 *
 * ## O que **não** acontece aqui
 *
 * Recorrência não é expandida, conflito não é detectado, disponibilidade não é
 * avaliada e recomendação não é gerada. Tudo isso são respostas do servidor —
 * este arquivo escolhe a janela, distribui o estado e desenha.
 */
import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";

import { EmptyState } from "@/components/feedback/states";
import { PanelError, PanelLoading } from "@/components/panels";
import {
  useSchedulingCalendars,
  useSchedulingConflicts,
  useSchedulingAvailability,
  useSchedulingIntelligence,
  useSchedulingOccurrences,
} from "@/hooks/scheduling/use-scheduling";
import {
  buildViewWindow,
  chronological,
  conflictsByEvent,
  describeWindow,
  enumerateDays,
  groupByDay,
  monthGridDays,
  shiftReference,
  startOfZonedDay,
  toIsoRange,
  zonedDateKey,
  type SchedulingView,
} from "@/lib/scheduling";
import { useSession } from "@/providers/session-provider";
import { useAction } from "@/actions";
import { useActiveScope } from "@/providers/use-active-scope";
import type {
  SchedulingEventDetail,
  SchedulingEventQuery,
} from "@/types/scheduling";
import { CalendarSetup } from "./calendar-setup";
import { EventDetailSheet } from "./event-detail.sheet";
import { EventFormDialog } from "./event-form.dialog";
import { AvailabilityPanel } from "./panels/availability.panel";
import { ConflictsPanel } from "./panels/conflicts.panel";
import { IntelligencePanel } from "./panels/intelligence.panel";
import { PRODUCT_CAPABILITY, PRODUCT_FEATURE } from "@/registry/product-access";
import {
  SchedulingFilters,
  type SchedulingFiltersValue,
} from "./scheduling-filters";
import { SchedulingToolbar } from "./scheduling-toolbar";
import { useSchedulingTimeZone } from "./use-scheduling-timezone";
import { ListView } from "./views/list-view";
import { MonthView } from "./views/month-view";
import { TimeGrid } from "./views/time-grid";

export type SchedulingLayout = "workspace" | "calendar";

export function SchedulingWorkspace({
  layout = "workspace",
  initialView = "WEEK",
}: {
  layout?: SchedulingLayout;
  initialView?: SchedulingView;
} = {}) {
  const session = useSession();
  const { businessUnitId } = useActiveScope();
  const { timeZone, origin: timeZoneOrigin } = useSchedulingTimeZone();

  const showAnalysisPanels = layout === "workspace";
  const [view, setView] = useState<SchedulingView>(initialView);
  const [reference, setReference] = useState(() => new Date());
  const [filters, setFilters] = useState<SchedulingFiltersValue>({});
  const [labels, setLabels] = useState<{ customer?: string; asset?: string }>(
    {},
  );
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SchedulingEventDetail | null>(null);
  const [formDayKey, setFormDayKey] = useState(() =>
    zonedDateKey(new Date(), timeZone),
  );

  /** Exigências declaradas no Action Registry, não repetidas aqui. */
  const canManage = useAction("scheduling-event.create").allowed;
  const canSeeIntelligence =
    showAnalysisPanels &&
    session.hasPermission("scheduling.intelligence.read") &&
    session.hasCapability("scheduling.intelligence") &&
    session.canUseProductFeature(
      PRODUCT_CAPABILITY.ORBIT_INTELLIGENCE,
      PRODUCT_FEATURE.SCHEDULING_INTELLIGENCE,
    );

  const window = useMemo(
    () => buildViewWindow(view, reference, timeZone),
    [view, reference, timeZone],
  );

  /**
   * A visão mensal consulta a **grade** inteira, não o mês: as bordas
   * pertencem a outros meses e precisam aparecer preenchidas.
   */
  const gridDays = useMemo(
    () => (view === "MONTH" ? monthGridDays(reference, timeZone) : window.days),
    [view, reference, timeZone, window.days],
  );

  const query = useMemo<SchedulingEventQuery>(() => {
    const range =
      view === "MONTH"
        ? {
            from: startOfZonedDay(
              new Date(`${gridDays[0]}T12:00:00Z`),
              timeZone,
            ).toISOString(),
            to: window.to.toISOString(),
          }
        : toIsoRange(window);

    return {
      ...range,
      businessUnitId: filters.businessUnitId ?? businessUnitId ?? undefined,
      calendarId: filters.calendarId,
      userId: filters.userId,
      customerId: filters.customerId,
      assetId: filters.assetId,
      status: filters.status,
    };
  }, [view, window, gridDays, timeZone, filters, businessUnitId]);

  const calendars = useSchedulingCalendars(query.businessUnitId);
  const occurrences = useSchedulingOccurrences(query);
  const conflicts = useSchedulingConflicts(query);
  const availability = useSchedulingAvailability(
    { businessUnitId: query.businessUnitId, userId: filters.userId },
    showAnalysisPanels,
  );
  const intelligence = useSchedulingIntelligence(query, canSeeIntelligence);

  const days = useMemo(
    () =>
      view === "MONTH"
        ? gridDays
        : enumerateDays(window.from, window.to, timeZone),
    [view, gridDays, window, timeZone],
  );

  const buckets = useMemo(
    () => groupByDay(occurrences.data ?? [], days, timeZone),
    [occurrences.data, days, timeZone],
  );

  const conflictIndex = useMemo(
    () => conflictsByEvent(conflicts.data ?? []),
    [conflicts.data],
  );

  const todayKey = zonedDateKey(new Date(), timeZone);
  const isEmpty =
    !occurrences.isPending &&
    !occurrences.error &&
    chronological(occurrences.data ?? []).length === 0;

  const openCreate = (dayKey?: string) => {
    setEditing(null);
    setFormDayKey(dayKey ?? todayKey);
    setFormOpen(true);
  };

  return (
    /** A gutter da página é do `SchedulingTabs`; aqui, só o ritmo interno. */
    <div className="space-y-6">
      <SchedulingToolbar
        view={view}
        periodLabel={describeWindow(view, window)}
        timeZone={timeZone}
        timeZoneOrigin={timeZoneOrigin}
        canManage={canManage}
        onViewChange={setView}
        onShift={(direction) =>
          setReference((current) =>
            shiftReference(view, current, direction, timeZone),
          )
        }
        onToday={() => setReference(new Date())}
        onCreate={() => openCreate()}
      />

      {calendars.data?.length === 0 ? (
        <CalendarSetup
          timeZone={timeZone}
          businessUnitId={query.businessUnitId}
          isFirst
        />
      ) : null}

      <SchedulingFilters
        value={filters}
        calendars={calendars.data ?? []}
        customerLabel={labels.customer}
        assetLabel={labels.asset}
        onChange={(patch, nextLabels) => {
          setFilters((current) => ({ ...current, ...patch }));
          if (nextLabels) {
            setLabels((current) => ({ ...current, ...nextLabels }));
          }
        }}
        onReset={() => {
          setFilters({});
          setLabels({});
        }}
      />

      <div
        className={
          showAnalysisPanels
            ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]"
            : "grid gap-6"
        }
      >
        <div className="min-w-0 space-y-4">
          {occurrences.isPending ? (
            <PanelLoading rows={8} />
          ) : occurrences.error ? (
            <PanelError
              error={occurrences.error}
              onRetry={() => void occurrences.refetch()}
            />
          ) : isEmpty && view !== "MONTH" ? (
            <EmptyState
              icon={<CalendarClock className="size-5" />}
              title="Nada agendado neste período"
              description="Ajuste os filtros, mude o período ou crie um evento."
            />
          ) : view === "MONTH" ? (
            <MonthView
              days={days}
              buckets={buckets}
              reference={reference}
              timeZone={timeZone}
              conflicts={conflictIndex}
              selectedEventId={selectedEventId}
              todayKey={todayKey}
              onSelect={setSelectedEventId}
              onOpenDay={(dayKey) => {
                setReference(
                  startOfZonedDay(new Date(`${dayKey}T12:00:00Z`), timeZone),
                );
                setView("DAY");
              }}
            />
          ) : view === "LIST" ? (
            <ListView
              days={days}
              buckets={buckets}
              timeZone={timeZone}
              conflicts={conflictIndex}
              selectedEventId={selectedEventId}
              todayKey={todayKey}
              onSelect={setSelectedEventId}
            />
          ) : (
            <TimeGrid
              days={days}
              buckets={buckets}
              timeZone={timeZone}
              conflicts={conflictIndex}
              selectedEventId={selectedEventId}
              onSelect={setSelectedEventId}
              renderHeader={
                view === "WEEK"
                  ? (dayKey) => (
                      <DayHeader
                        dayKey={dayKey}
                        timeZone={timeZone}
                        today={dayKey === todayKey}
                      />
                    )
                  : undefined
              }
            />
          )}
        </div>

        {showAnalysisPanels ? (
          <div className="min-w-0 space-y-6">
            <ConflictsPanel
              query={conflicts}
              timeZone={timeZone}
              onSelectEvent={setSelectedEventId}
            />
            <AvailabilityPanel query={availability} canManage={canManage} />
            {canSeeIntelligence ? (
              <IntelligencePanel query={intelligence} timeZone={timeZone} />
            ) : null}
          </div>
        ) : null}
      </div>

      <EventDetailSheet
        eventId={selectedEventId}
        timeZone={timeZone}
        canManage={canManage}
        onOpenChange={(open) => {
          if (!open) setSelectedEventId(null);
        }}
        onEdit={(event) => {
          setEditing(event);
          setSelectedEventId(null);
          setFormOpen(true);
        }}
      />

      <EventFormDialog
        open={formOpen}
        editing={editing}
        calendars={calendars.data ?? []}
        timeZone={timeZone}
        defaultDayKey={formDayKey}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}

function DayHeader({
  dayKey,
  timeZone,
  today,
}: {
  dayKey: string;
  timeZone: string;
  today: boolean;
}) {
  const label = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "short",
    day: "2-digit",
  }).format(new Date(`${dayKey}T12:00:00Z`));

  return (
    <p
      className={
        today
          ? "text-xs font-semibold text-primary"
          : "text-xs text-muted-foreground"
      }
    >
      {label}
    </p>
  );
}
