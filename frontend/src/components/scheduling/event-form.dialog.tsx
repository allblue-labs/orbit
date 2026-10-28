"use client";

/**
 * Criação e edição de evento.
 *
 * ## Datas
 *
 * O campo `datetime-local` devolve hora de parede sem fuso ("2026-02-03T09:00").
 * Interpretá-la com `new Date(...)` a leria no fuso do **navegador** — o que
 * agendaria 9h de Recife como 9h de Lisboa para quem abrisse a tela de lá. A
 * conversão passa por `instantFromZoned`, no fuso da visão, e sai em ISO com
 * fuso explícito, que é o que o DTO espera.
 *
 * ## Conflitos
 *
 * Quem detecta conflito é o backend, e ele recusa com 409 quando há conflito
 * crítico. O formulário apresenta a recusa e oferece reenviar com
 * `allowConflicts: true` — a bandeira que o próprio contrato define para
 * "ciente do conflito, siga assim". Nenhuma sobreposição é avaliada aqui.
 *
 * ## Recorrência
 *
 * O formulário monta a **regra**; expandir é do `RecurrenceEngine`. Por isso
 * não há preview de ocorrências futuras: seria o frontend adivinhando o que o
 * servidor vai calcular.
 *
 * ## Correção do seletor de calendário (PR-12)
 *
 * O seletor não funcionava, por duas causas independentes:
 *
 * 1. **Organização sem nenhum calendário.** `CreateEventDto.calendarId` é
 *    obrigatório e nada cria um calendário no cadastro da organização — nem o
 *    backend, nem qualquer tela. O seletor abria vazio, o botão ficava
 *    desabilitado e não havia saída. Verificado no banco: duas das três
 *    organizações existentes têm zero calendários. Agora, quando a lista está
 *    vazia, o próprio diálogo oferece criar o primeiro calendário
 *    (`POST /scheduling/calendars`, endpoint que já existia e que nenhuma tela
 *    consumia) para quem tem `scheduling.calendars.create`.
 *
 * 2. **Diálogo aberto antes de os calendários chegarem.** O estado inicial
 *    escolhia o calendário padrão uma única vez, na montagem. Abrindo o
 *    diálogo com a consulta ainda em voo, `calendarId` ficava vazio **para
 *    sempre**, mesmo depois de a lista carregar. Agora a escolha padrão é
 *    adotada quando a lista chega, por ajuste durante a renderização — o
 *    mesmo padrão do Artifact Studio, já que `set-state-in-effect` é erro
 *    neste repositório.
 */
import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateSchedulingEvent,
  useUpdateSchedulingEvent,
} from "@/hooks/scheduling/use-scheduling";
import { ApiError } from "@/lib/api-error";
import { instantFromZoned, zonedParts } from "@/lib/scheduling";
import { useSession } from "@/providers/session-provider";
import {
  RECURRENCE_FREQUENCIES,
  SCHEDULING_EVENT_STATUSES,
  SCHEDULING_LIMITS,
  SCHEDULING_PRIORITIES,
  SUGGESTED_EVENT_TYPES,
  type CreateSchedulingEventInput,
  type RecurrenceFrequency,
  type SchedulingCalendar,
  type SchedulingEventDetail,
  type SchedulingEventStatus,
  type SchedulingPriority,
} from "@/types/scheduling";
import { CalendarSetup } from "./calendar-setup";
import { eventStatusLabel } from "./event-badges";

/** Origem dos eventos nascidos na agenda — `sourceModule` é obrigatório. */
const MANUAL_SOURCE = { module: "scheduling", entityType: "MANUAL" } as const;

const WEEKDAYS = [
  { value: 0, label: "D" },
  { value: 1, label: "S" },
  { value: 2, label: "T" },
  { value: 3, label: "Q" },
  { value: 4, label: "Q" },
  { value: 5, label: "S" },
  { value: 6, label: "S" },
];

export function EventFormDialog({
  open,
  editing,
  calendars,
  timeZone,
  defaultDayKey,
  onOpenChange,
}: {
  open: boolean;
  /** Evento em edição, ou `null` para criação. */
  editing: SchedulingEventDetail | null;
  calendars: readonly SchedulingCalendar[];
  timeZone: string;
  /** Dia (`AAAA-MM-DD`) pré-selecionado ao criar a partir da grade. */
  defaultDayKey: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open ? (
          <EventForm
            editing={editing}
            calendars={calendars}
            timeZone={timeZone}
            defaultDayKey={defaultDayKey}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface FormState {
  calendarId: string;
  businessUnitId: string;
  title: string;
  type: string;
  status: SchedulingEventStatus;
  priority: SchedulingPriority;
  startLocal: string;
  endLocal: string;
  allDay: boolean;
  description: string;
  recurring: boolean;
  frequency: RecurrenceFrequency;
  interval: string;
  byWeekday: readonly number[];
  count: string;
}

function EventForm({
  editing,
  calendars,
  timeZone,
  defaultDayKey,
  onClose,
}: {
  editing: SchedulingEventDetail | null;
  calendars: readonly SchedulingCalendar[];
  timeZone: string;
  defaultDayKey: string;
  onClose: () => void;
}) {
  const session = useSession();
  const create = useCreateSchedulingEvent();
  const update = useUpdateSchedulingEvent(editing?.id ?? "");
  const mutation = editing ? update : create;

  const [form, setForm] = useState<FormState>(() =>
    initialState(editing, calendars, timeZone, defaultDayKey),
  );
  const [acknowledgeConflicts, setAcknowledgeConflicts] = useState(false);

  /**
   * Adoção tardia do calendário padrão.
   *
   * Se o diálogo abriu antes de `GET /scheduling/calendars` responder, o
   * estado inicial nasceu sem calendário. Ajuste durante a renderização — sem
   * efeito, sem render em cascata — para adotar o padrão assim que a lista
   * chega. Só age quando ainda não há escolha: o que o usuário selecionou
   * nunca é sobrescrito.
   */
  const fallbackCalendar = defaultCalendarOf(calendars);
  if (!form.calendarId && fallbackCalendar) {
    setForm((current) => ({
      ...current,
      calendarId: fallbackCalendar.id,
      businessUnitId:
        current.businessUnitId || (fallbackCalendar.businessUnitId ?? ""),
    }));
  }

  const edit = (patch: Partial<FormState>) => {
    setAcknowledgeConflicts(false);
    setForm((current) => ({ ...current, ...patch }));
  };

  const conflictRefusal =
    mutation.error instanceof ApiError && mutation.error.status === 409
      ? mutation.error.message
      : null;

  const submit = () => {
    const payload = buildPayload(form, timeZone, acknowledgeConflicts);
    if (!payload) return;

    if (editing) {
      const recurrence = editing.recurrence;
      const unchangedRecurrence =
        recurrence &&
        form.recurring &&
        form.frequency === recurrence.frequency &&
        (Number(form.interval) || 1) === recurrence.interval &&
        (Number(form.count) || null) === recurrence.count &&
        JSON.stringify([...form.byWeekday].sort()) ===
          JSON.stringify([...recurrence.byWeekday].sort());
      update.mutate(
        {
          ...payload,
          // Changing display preference or editing a title must not rewrite the
          // event's timezone or its existing recurrence rules and exceptions.
          timezone: editing.timezone,
          recurrence: unchangedRecurrence
            ? undefined
            : payload.recurrence
              ? {
                  ...payload.recurrence,
                  timezone: recurrence?.timezone ?? timeZone,
                }
              : undefined,
          clearRecurrence: Boolean(recurrence && !form.recurring) || undefined,
        },
        { onSuccess: onClose },
      );
      return;
    }
    create.mutate(payload, { onSuccess: onClose });
  };

  const valid =
    form.calendarId.length > 0 &&
    form.title.trim().length >= SCHEDULING_LIMITS.titleMinLength &&
    form.type.trim().length > 0 &&
    form.startLocal.length > 0 &&
    form.endLocal.length > 0 &&
    form.endLocal > form.startLocal;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {editing ? "Editar evento" : "Novo evento na agenda"}
        </DialogTitle>
        <DialogDescription>
          Horários no fuso {timeZone}. Janela, conflitos e disponibilidade são
          conferidos ao salvar.
          {editing?.recurrence && editing.recurrence.timezone !== timeZone
            ? ` A repetição mantém o fuso de origem ${editing.recurrence.timezone}.`
            : ""}
        </DialogDescription>
      </DialogHeader>

      {calendars.length === 0 ? (
        <CalendarSetup
          timeZone={timeZone}
          businessUnitId={
            session.businessUnits.find((unit) => unit.isPrimary)?.id
          }
          isFirst
          onCreated={(calendar) => edit({ calendarId: calendar.id })}
        />
      ) : null}

      <p className="text-xs text-muted-foreground">
        Os campos identificados como obrigatórios precisam ser preenchidos para
        criar o evento. Os demais são opcionais. O fim deve ser posterior ao
        início.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="event-title" required>
            Título
          </Label>
          <Input
            id="event-title"
            required
            aria-required="true"
            value={form.title}
            maxLength={SCHEDULING_LIMITS.titleMaxLength}
            onChange={(event) => edit({ title: event.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="event-calendar" required>
            Calendário
          </Label>
          <Select
            value={form.calendarId}
            disabled={calendars.length === 0}
            onValueChange={(value) => edit({ calendarId: value })}
          >
            <SelectTrigger id="event-calendar" aria-required="true">
              <SelectValue
                placeholder={
                  calendars.length === 0 ? "Nenhum disponível" : "Selecione"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {calendars.map((calendar) => (
                <SelectItem key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="event-type" required>
            Tipo
          </Label>
          <Input
            id="event-type"
            required
            aria-required="true"
            list="event-type-options"
            value={form.type}
            maxLength={SCHEDULING_LIMITS.typeMaxLength}
            onChange={(event) =>
              edit({ type: event.target.value.toUpperCase() })
            }
            className="font-mono text-sm"
          />
          <datalist id="event-type-options">
            {SUGGESTED_EVENT_TYPES.map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">
            Texto livre: apenas o formato é conferido.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="event-start" required>
            Início
          </Label>
          <Input
            id="event-start"
            required
            aria-required="true"
            type="datetime-local"
            value={form.startLocal}
            onChange={(event) => edit({ startLocal: event.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="event-end" required>
            Fim
          </Label>
          <Input
            id="event-end"
            required
            aria-required="true"
            type="datetime-local"
            value={form.endLocal}
            onChange={(event) => edit({ endLocal: event.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="event-status">Status</Label>
          <Select
            value={form.status}
            onValueChange={(value) =>
              edit({ status: value as SchedulingEventStatus })
            }
          >
            <SelectTrigger id="event-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCHEDULING_EVENT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {eventStatusLabel(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="event-priority">Prioridade</Label>
          <Select
            value={form.priority}
            onValueChange={(value) =>
              edit({ priority: value as SchedulingPriority })
            }
          >
            <SelectTrigger id="event-priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCHEDULING_PRIORITIES.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {priority}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="event-unit">Organização</Label>
          <Select
            value={form.businessUnitId || "__none__"}
            onValueChange={(value) =>
              edit({ businessUnitId: value === "__none__" ? "" : value })
            }
          >
            <SelectTrigger id="event-unit">
              <SelectValue placeholder="Sem organização" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sem organização</SelectItem>
              {session.businessUnits.map((unit) => (
                <SelectItem key={unit.id} value={unit.id}>
                  {unit.tradeName ?? unit.legalName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-2 self-end text-sm">
          <Checkbox
            checked={form.allDay}
            onCheckedChange={(checked) => edit({ allDay: checked === true })}
          />
          Dia inteiro
        </label>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="event-description">Descrição</Label>
          <Textarea
            id="event-description"
            rows={3}
            value={form.description}
            maxLength={SCHEDULING_LIMITS.descriptionMaxLength}
            onChange={(event) => edit({ description: event.target.value })}
          />
        </div>

        <RecurrenceFields form={form} onChange={edit} />
      </div>

      {conflictRefusal ? (
        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <p className="flex items-start gap-2 text-sm">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-amber-400"
              aria-hidden
            />
            {conflictRefusal}
          </p>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={acknowledgeConflicts}
              onCheckedChange={(checked) =>
                setAcknowledgeConflicts(checked === true)
              }
            />
            Agendar mesmo assim, ciente do conflito
          </label>
        </div>
      ) : (
        <MutationError error={mutation.error} />
      )}

      <DialogFooter>
        {!valid ? (
          <p
            role="status"
            className="mr-auto max-w-sm text-xs text-muted-foreground"
          >
            Preencha os campos obrigatórios. O título precisa ter ao menos dois
            caracteres e o fim deve ser posterior ao início.
          </p>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={!valid || mutation.isPending}>
          {mutation.isPending
            ? "Salvando…"
            : editing
              ? "Salvar alterações"
              : "Criar evento"}
        </Button>
      </DialogFooter>
    </>
  );
}

function RecurrenceFields({
  form,
  onChange,
}: {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-3 sm:col-span-2">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={form.recurring}
          onCheckedChange={(checked) =>
            onChange({ recurring: checked === true })
          }
        />
        Evento recorrente
      </label>

      {form.recurring ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="event-frequency" required>
              Frequência
            </Label>
            <Select
              value={form.frequency}
              onValueChange={(value) =>
                onChange({ frequency: value as RecurrenceFrequency })
              }
            >
              <SelectTrigger id="event-frequency" aria-required="true">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECURRENCE_FREQUENCIES.filter(
                  (frequency) => frequency !== "CUSTOM",
                ).map((frequency) => (
                  <SelectItem key={frequency} value={frequency}>
                    {frequency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-interval">Intervalo</Label>
            <Input
              id="event-interval"
              inputMode="numeric"
              value={form.interval}
              onChange={(event) => onChange({ interval: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-count">Repetições</Label>
            <Input
              id="event-count"
              inputMode="numeric"
              placeholder="sem limite"
              value={form.count}
              onChange={(event) => onChange({ count: event.target.value })}
            />
          </div>

          {form.frequency === "WEEKLY" ? (
            <div className="space-y-2 sm:col-span-3">
              <Label>Dias da semana</Label>
              <div className="flex gap-1">
                {WEEKDAYS.map((weekday) => {
                  const active = form.byWeekday.includes(weekday.value);
                  return (
                    <button
                      key={weekday.value}
                      type="button"
                      onClick={() =>
                        onChange({
                          byWeekday: active
                            ? form.byWeekday.filter(
                                (day) => day !== weekday.value,
                              )
                            : [...form.byWeekday, weekday.value],
                        })
                      }
                      aria-pressed={active}
                      className={
                        active
                          ? "size-8 rounded-md bg-primary text-sm text-primary-foreground"
                          : "size-8 rounded-md border border-border text-sm text-muted-foreground"
                      }
                    >
                      {weekday.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground sm:col-span-3">
            As ocorrências são geradas a partir desta regra.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Calendário padrão da organização, ou o primeiro da lista. */
function defaultCalendarOf(
  calendars: readonly SchedulingCalendar[],
): SchedulingCalendar | undefined {
  return calendars.find((calendar) => calendar.isDefault) ?? calendars[0];
}

function initialState(
  editing: SchedulingEventDetail | null,
  calendars: readonly SchedulingCalendar[],
  timeZone: string,
  defaultDayKey: string,
): FormState {
  if (editing) {
    return {
      calendarId: editing.calendarId,
      businessUnitId: editing.businessUnitId ?? "",
      title: editing.title,
      type: editing.type,
      status: editing.status as SchedulingEventStatus,
      priority: editing.priority as SchedulingPriority,
      startLocal: toLocalInput(editing.startsAt, timeZone),
      endLocal: toLocalInput(editing.endsAt, timeZone),
      allDay: editing.allDay,
      description: editing.description ?? "",
      recurring: editing.recurrence !== null,
      frequency: (editing.recurrence?.frequency ??
        "WEEKLY") as RecurrenceFrequency,
      interval: String(editing.recurrence?.interval ?? 1),
      byWeekday: editing.recurrence?.byWeekday ?? [],
      count: editing.recurrence?.count ? String(editing.recurrence.count) : "",
    };
  }

  const defaultCalendar = defaultCalendarOf(calendars);

  return {
    calendarId: defaultCalendar?.id ?? "",
    businessUnitId: defaultCalendar?.businessUnitId ?? "",
    title: "",
    type: "VISITA_TECNICA",
    status: "CONFIRMED",
    priority: "NORMAL",
    startLocal: `${defaultDayKey}T09:00`,
    endLocal: `${defaultDayKey}T10:00`,
    allDay: false,
    description: "",
    recurring: false,
    frequency: "WEEKLY",
    interval: "1",
    byWeekday: [],
    count: "",
  };
}

/** Instante → valor de `datetime-local` na hora de parede do fuso da visão. */
function toLocalInput(iso: string, timeZone: string): string {
  const parts = zonedParts(new Date(iso), timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Valor de `datetime-local` → instante ISO, lido no fuso da visão. */
function toInstant(local: string, timeZone: string): string {
  const [date, time] = local.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = (time ?? "00:00").split(":").map(Number);
  return instantFromZoned(
    { year, month, day, hour, minute },
    timeZone,
  ).toISOString();
}

function buildPayload(
  form: FormState,
  timeZone: string,
  allowConflicts: boolean,
): CreateSchedulingEventInput | null {
  if (!form.calendarId) return null;

  return {
    calendarId: form.calendarId,
    businessUnitId: form.businessUnitId || undefined,
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    type: form.type.trim().toUpperCase(),
    status: form.status,
    priority: form.priority,
    startsAt: toInstant(form.startLocal, timeZone),
    endsAt: toInstant(form.endLocal, timeZone),
    allDay: form.allDay,
    timezone: timeZone,
    sourceModule: MANUAL_SOURCE.module,
    sourceEntityType: MANUAL_SOURCE.entityType,
    allowConflicts: allowConflicts || undefined,
    recurrence: form.recurring
      ? {
          frequency: form.frequency,
          interval: Number(form.interval) || 1,
          byWeekday:
            form.frequency === "WEEKLY" && form.byWeekday.length > 0
              ? [...form.byWeekday].sort()
              : undefined,
          count: form.count ? Number(form.count) : undefined,
          timezone: timeZone,
        }
      : undefined,
  };
}
