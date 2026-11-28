"use client";

/**
 * Lembretes usam os calendários ativos da unidade. A consulta por origem
 * mantém compromissos e operações fora da lista, mesmo em calendários compartilhados.
 */
import { useMemo, useState } from "react";
import { BellRing, CalendarClock, Pencil, Plus, Power } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { EmptyState } from "@/components/feedback/states";
import { PanelError, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useSchedulingCalendars,
  useSchedulingOccurrences,
  useUpdateSchedulingEvent,
} from "@/hooks/scheduling/use-scheduling";
import { addZonedMonths, formatZonedDateTime } from "@/lib/scheduling";
import { useAction } from "@/actions";
import { useActiveScope } from "@/providers/use-active-scope";
import type { SchedulingOccurrence } from "@/types/scheduling";
import {
  CalendarSetup,
  defaultCalendarOf,
  useCanCreateSchedulingCalendar,
} from "../calendar-setup";
import { useSchedulingTimeZone } from "../use-scheduling-timezone";
import { ReminderFormDialog } from "./reminder-form.dialog";

/**
 * Horizonte consultado.
 *
 * `EventQueryDto` exige `from` e `to`, e o serviço recusa janelas maiores que
 * **366 dias** ("Schedule range cannot exceed 366 days" — verificado). Então a
 * central olha do mês passado até onze meses à frente: doze meses, o máximo
 * que cabe em uma consulta. Um lembrete que dispara além disso continua
 * existindo; só não aparece nesta janela, e a tela diz qual janela é.
 */
const HORIZON_MONTHS = 11;

export function ReminderCenter() {
  const { businessUnitId } = useActiveScope();
  const { timeZone } = useSchedulingTimeZone();

  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [calendarId, setCalendarId] = useState<string>();
  const [creatingCalendar, setCreatingCalendar] = useState(false);

  const calendars = useSchedulingCalendars(businessUnitId ?? undefined);
  const activeCalendars = (calendars.data ?? []).filter(
    (calendar) => calendar.isActive,
  );
  const remindersCalendar =
    activeCalendars.find((calendar) => calendar.id === calendarId) ??
    defaultCalendarOf(activeCalendars);
  const canCreateCalendar = useCanCreateSchedulingCalendar();

  /**
   * Janela consultada — quantizada no dia para não gerar query key nova a
   * cada render.
   */
  const today = new Date().toISOString().slice(0, 10);
  const dateWindow = useMemo(() => {
    const reference = new Date(`${today}T12:00:00Z`);
    return {
      from: addZonedMonths(reference, -1, timeZone).toISOString(),
      to: addZonedMonths(reference, HORIZON_MONTHS, timeZone).toISOString(),
    };
  }, [today, timeZone]);

  const occurrences = useSchedulingOccurrences(
    {
      ...dateWindow,
      calendarId: remindersCalendar?.id,
      remindersOnly: "true",
      businessUnitId: businessUnitId ?? undefined,
    },
    Boolean(remindersCalendar),
  );

  /** Exigências declaradas no Action Registry, não repetidas aqui. */
  const canManage = useAction("scheduling-event.create").allowed;

  /**
   * Uma linha por regra, não por ocorrência.
   *
   * O backend expande a recorrência e devolve cada ocorrência da janela — o
   * que é certo para a grade e errado para uma central de configuração: um
   * lembrete trimestral apareceria oito vezes. A deduplicação é por `eventId`;
   * a contagem de ocorrências acompanha a linha.
   */
  const rules = useMemo(
    () =>
      dedupeByRule(
        occurrences.isPlaceholderData ? [] : (occurrences.data ?? []),
      ),
    [occurrences.data, occurrences.isPlaceholderData],
  );

  if (calendars.isPending) return <PanelLoading rows={4} />;
  if (calendars.error) {
    return (
      <PanelError
        error={calendars.error}
        onRetry={() => void calendars.refetch()}
      />
    );
  }

  if (!remindersCalendar) {
    return (
      <CalendarSetup
        timeZone={timeZone}
        businessUnitId={businessUnitId ?? undefined}
        isFirst
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-2">
          {activeCalendars.length > 1 ? (
            <>
              <Label htmlFor="reminders-calendar">
                Calendário dos lembretes
              </Label>
              <Select
                value={remindersCalendar.id}
                onValueChange={setCalendarId}
              >
                <SelectTrigger
                  id="reminders-calendar"
                  className="w-full min-w-48"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activeCalendars.map((calendar) => (
                    <SelectItem key={calendar.id} value={calendar.id}>
                      {calendar.name}
                      {calendar.isDefault ? " · padrão" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Lembretes em{" "}
              <span className="font-medium text-foreground">
                {remindersCalendar.name}
              </span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreateCalendar ? (
            <Button
              variant="outline"
              aria-expanded={creatingCalendar}
              onClick={() => setCreatingCalendar(!creatingCalendar)}
            >
              {!creatingCalendar ? <Plus className="size-4" /> : null}
              {creatingCalendar
                ? "Cancelar novo calendário"
                : "Novo calendário"}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              onClick={() => {
                setEditingEventId(null);
                setFormOpen(true);
              }}
            >
              <BellRing className="size-4" />
              Novo lembrete
            </Button>
          ) : null}
        </div>
      </div>

      {creatingCalendar && canCreateCalendar ? (
        <CalendarSetup
          timeZone={timeZone}
          businessUnitId={businessUnitId ?? undefined}
          suggestedName=""
          isFirst={false}
          onCreated={(calendar) => {
            setCalendarId(calendar.id);
            setCreatingCalendar(false);
          }}
        />
      ) : null}

      {occurrences.isPending || occurrences.isPlaceholderData ? (
        <PanelLoading rows={5} />
      ) : occurrences.error ? (
        <PanelError
          error={occurrences.error}
          onRetry={() => void occurrences.refetch()}
        />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-5" />}
          title="Nenhum lembrete nos próximos doze meses"
          description="Configure retornos de visita, renovação de contrato ou qualquer rotina que precise voltar à agenda."
        />
      ) : (
        <ul className="space-y-2">
          {rules.map((rule) => (
            <ReminderRow
              key={rule.eventId}
              rule={rule}
              timeZone={timeZone}
              canManage={canManage}
              onEdit={() => {
                setEditingEventId(rule.eventId);
                setFormOpen(true);
              }}
            />
          ))}
        </ul>
      )}

      <ReminderFormDialog
        open={formOpen}
        editingEventId={editingEventId}
        calendar={remindersCalendar}
        timeZone={timeZone}
        businessUnitId={businessUnitId ?? undefined}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingEventId(null);
        }}
      />
    </div>
  );
}

interface ReminderRule {
  readonly eventId: string;
  readonly title: string;
  readonly type: string;
  readonly status: string;
  /** O backend marca a ocorrência como parte de uma regra recorrente. */
  readonly recurring: boolean;
  /** Quantas ocorrências a regra produz na janela consultada. */
  readonly occurrences: number;
  /** Ocorrência mais próxima dentro da janela. */
  readonly nextAt: string;
}

function dedupeByRule(
  occurrences: readonly SchedulingOccurrence[],
): readonly ReminderRule[] {
  const byEvent = new Map<string, ReminderRule>();

  for (const occurrence of occurrences) {
    const existing = byEvent.get(occurrence.eventId);
    if (!existing) {
      byEvent.set(occurrence.eventId, {
        eventId: occurrence.eventId,
        title: occurrence.title,
        type: occurrence.type,
        status: occurrence.status,
        recurring: occurrence.recurring,
        occurrences: 1,
        nextAt: occurrence.startsAt,
      });
      continue;
    }
    byEvent.set(occurrence.eventId, {
      ...existing,
      occurrences: existing.occurrences + 1,
      nextAt:
        occurrence.startsAt < existing.nextAt
          ? occurrence.startsAt
          : existing.nextAt,
    });
  }

  return [...byEvent.values()].sort((left, right) =>
    left.nextAt.localeCompare(right.nextAt),
  );
}

function ReminderRow({
  rule,
  timeZone,
  canManage,
  onEdit,
}: {
  rule: ReminderRule;
  timeZone: string;
  canManage: boolean;
  onEdit: () => void;
}) {
  const toggle = useUpdateSchedulingEvent(rule.eventId);
  const active = rule.status !== "CANCELLED";

  return (
    <li className="flex flex-wrap items-start gap-3 rounded-lg border border-border px-3 py-3">
      <BellRing
        className={
          active
            ? "mt-0.5 size-4 text-primary"
            : "mt-0.5 size-4 text-muted-foreground"
        }
        aria-hidden
      />

      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{rule.title}</span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {rule.type}
          </Badge>
          {!active ? <Badge variant="secondary">Desativado</Badge> : null}
        </p>

        <p className="text-xs text-muted-foreground">
          Próximo em {formatZonedDateTime(rule.nextAt, timeZone)}
          {rule.recurring
            ? ` · recorrente · ${rule.occurrences} ocorrência(s) nesta janela`
            : " · sem repetição"}
        </p>

        <MutationError error={toggle.error} />
      </div>

      {canManage ? (
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={toggle.isPending}
            onClick={() =>
              toggle.mutate({ status: active ? "CANCELLED" : "CONFIRMED" })
            }
          >
            <Power className="size-4" />
            {active ? "Desativar" : "Ativar"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="size-4" />
            Editar
          </Button>
        </div>
      ) : null}
    </li>
  );
}
