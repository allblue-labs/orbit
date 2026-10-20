"use client";

/**
 * Configuração de um lembrete.
 *
 * Escreve em `POST`/`PATCH /scheduling/events` — o mesmo contrato do evento
 * comum, com o calendário de lembretes fixado. O que muda em relação ao
 * formulário da agenda é o vocabulário: "quando lembrar" em vez de início e
 * fim, "repetir a cada" em vez de recorrência crua.
 *
 * ## Duração
 *
 * `endsAt` é obrigatório no DTO e um lembrete não tem duração real. O evento
 * é criado com trinta minutos a partir do horário escolhido — decisão de
 * apresentação, declarada na tela, não regra de negócio.
 *
 * ## Edição carrega o evento, não a ocorrência
 *
 * `GET /scheduling/events` devolve **ocorrências expandidas**, e a ocorrência
 * não carrega a regra de recorrência — só a marca `recurring`. Para editar,
 * o diálogo lê `GET /scheduling/events/:id`, que publica `recurrence` inteira.
 * Sem isso, salvar uma edição apagaria a regra que o usuário não viu.
 *
 * ## O que não é calculado aqui
 *
 * As ocorrências futuras. O formulário monta a regra; expandir é do
 * `RecurrenceEngine`. Os atalhos de 3, 6 e 12 meses apenas **preenchem a data
 * do primeiro disparo** — aritmética de calendário no fuso da unidade, não
 * previsão.
 */
import { useState } from "react";

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
import { PanelError, PanelLoading } from "@/components/panels";
import {
  useCreateSchedulingEvent,
  useSchedulingEvent,
  useUpdateSchedulingEvent,
} from "@/hooks/scheduling/use-scheduling";
import { addZonedMonths, instantFromZoned, zonedParts } from "@/lib/scheduling";
import {
  SCHEDULING_LIMITS,
  SUGGESTED_EVENT_TYPES,
  type CreateSchedulingEventInput,
  type RecurrenceFrequency,
  type SchedulingCalendar,
  type SchedulingEventDetail,
} from "@/types/scheduling";

/** Origem dos eventos nascidos na central. */
const REMINDER_SOURCE = {
  module: "scheduling",
  entityType: "REMINDER",
} as const;

/** Duração nominal do lembrete, em minutos. */
const REMINDER_MINUTES = 30;

const PERIOD_SHORTCUTS = [
  { months: 3, label: "3 meses" },
  { months: 6, label: "6 meses" },
  { months: 12, label: "12 meses" },
];

const FREQUENCY_LABELS: Readonly<Record<RecurrenceFrequency, string>> = {
  DAILY: "dias",
  WEEKLY: "semanas",
  MONTHLY: "meses",
  CUSTOM: "datas específicas",
};

const REPEATABLE: readonly RecurrenceFrequency[] = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
];

interface FormState {
  title: string;
  type: string;
  description: string;
  whenLocal: string;
  repeats: boolean;
  frequency: RecurrenceFrequency;
  interval: string;
  count: string;
  active: boolean;
}

export function ReminderFormDialog({
  open,
  editingEventId,
  calendar,
  timeZone,
  businessUnitId,
  onOpenChange,
}: {
  open: boolean;
  /** Evento em edição, ou `null` para criação. */
  editingEventId: string | null;
  calendar: SchedulingCalendar;
  timeZone: string;
  businessUnitId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {open ? (
          <ReminderFormLoader
            editingEventId={editingEventId}
            calendar={calendar}
            timeZone={timeZone}
            businessUnitId={businessUnitId}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Espera o evento completo antes de montar o formulário de edição. */
function ReminderFormLoader({
  editingEventId,
  calendar,
  timeZone,
  businessUnitId,
  onClose,
}: {
  editingEventId: string | null;
  calendar: SchedulingCalendar;
  timeZone: string;
  businessUnitId?: string;
  onClose: () => void;
}) {
  const event = useSchedulingEvent(editingEventId);

  if (editingEventId && event.isPending) return <PanelLoading rows={4} />;
  if (editingEventId && event.error) {
    return (
      <PanelError error={event.error} onRetry={() => void event.refetch()} />
    );
  }

  return (
    <ReminderForm
      editing={editingEventId ? (event.data ?? null) : null}
      calendar={calendar}
      timeZone={timeZone}
      businessUnitId={businessUnitId}
      onClose={onClose}
    />
  );
}

function ReminderForm({
  editing,
  calendar,
  timeZone,
  businessUnitId,
  onClose,
}: {
  editing: SchedulingEventDetail | null;
  calendar: SchedulingCalendar;
  timeZone: string;
  businessUnitId?: string;
  onClose: () => void;
}) {
  const create = useCreateSchedulingEvent();
  const update = useUpdateSchedulingEvent(editing?.id ?? "");
  const mutation = editing ? update : create;

  const [form, setForm] = useState<FormState>(() =>
    initialState(editing, timeZone),
  );

  const edit = (patch: Partial<FormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  const valid =
    form.title.trim().length >= SCHEDULING_LIMITS.titleMinLength &&
    form.type.trim().length > 0 &&
    form.whenLocal.length > 0;

  const submit = () => {
    const payload = buildPayload(form, calendar, timeZone, businessUnitId);
    if (editing) {
      update.mutate(payload, { onSuccess: onClose });
      return;
    }
    create.mutate(payload, { onSuccess: onClose });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {editing ? "Editar lembrete" : "Novo lembrete"}
        </DialogTitle>
        <DialogDescription>
          Cai no calendário {calendar.name}, no fuso {timeZone}. As ocorrências são geradas a partir da repetição.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="reminder-title">O que lembrar</Label>
          <Input
            id="reminder-title"
            value={form.title}
            maxLength={SCHEDULING_LIMITS.titleMaxLength}
            placeholder="Ex.: retorno após instalação"
            onChange={(event) => edit({ title: event.target.value })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="reminder-type">Tipo de operação</Label>
            <Input
              id="reminder-type"
              list="reminder-type-options"
              value={form.type}
              maxLength={SCHEDULING_LIMITS.typeMaxLength}
              onChange={(event) =>
                edit({ type: event.target.value.toUpperCase() })
              }
              className="font-mono text-sm"
            />
            <datalist id="reminder-type-options">
              {SUGGESTED_EVENT_TYPES.map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Texto livre: não há catálogo de tipos.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reminder-when">Quando lembrar</Label>
            <Input
              id="reminder-when"
              type="datetime-local"
              value={form.whenLocal}
              onChange={(event) => edit({ whenLocal: event.target.value })}
            />
            <div className="flex flex-wrap gap-1">
              {PERIOD_SHORTCUTS.map((shortcut) => (
                <Button
                  key={shortcut.months}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    edit({ whenLocal: inMonths(shortcut.months, timeZone) })
                  }
                >
                  daqui a {shortcut.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.repeats}
              onCheckedChange={(checked) => edit({ repeats: checked === true })}
            />
            Repetir
          </label>

          {form.repeats ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="reminder-interval">A cada</Label>
                <Input
                  id="reminder-interval"
                  inputMode="numeric"
                  value={form.interval}
                  onChange={(event) => edit({ interval: event.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="reminder-frequency">Unidade</Label>
                <Select
                  value={form.frequency}
                  onValueChange={(value) =>
                    edit({ frequency: value as RecurrenceFrequency })
                  }
                >
                  <SelectTrigger id="reminder-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REPEATABLE.map((frequency) => (
                      <SelectItem key={frequency} value={frequency}>
                        {FREQUENCY_LABELS[frequency]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reminder-count">Repetições</Label>
                <Input
                  id="reminder-count"
                  inputMode="numeric"
                  placeholder="sem limite"
                  value={form.count}
                  onChange={(event) => edit({ count: event.target.value })}
                />
              </div>
            </div>
          ) : null}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.active}
            onCheckedChange={(checked) => edit({ active: checked === true })}
          />
          Ativo
          <span className="text-xs text-muted-foreground">
            (desativar registra o evento como cancelado — é o estado que o
            contrato oferece)
          </span>
        </label>

        <div className="space-y-2">
          <Label htmlFor="reminder-description">Observação</Label>
          <Textarea
            id="reminder-description"
            rows={2}
            value={form.description}
            maxLength={SCHEDULING_LIMITS.descriptionMaxLength}
            onChange={(event) => edit({ description: event.target.value })}
          />
        </div>
      </div>

      <MutationError error={mutation.error} />

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={!valid || mutation.isPending}>
          {mutation.isPending
            ? "Salvando…"
            : editing
              ? "Salvar lembrete"
              : "Criar lembrete"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Valor de `datetime-local` para daqui a N meses, às 9h da unidade. */
function inMonths(months: number, timeZone: string): string {
  const target = addZonedMonths(new Date(), months, timeZone);
  const parts = zonedParts(target, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T09:00`;
}

function toLocalInput(iso: string, timeZone: string): string {
  const parts = zonedParts(new Date(iso), timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function toInstant(local: string, timeZone: string): Date {
  const [date, time] = local.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = (time ?? "09:00").split(":").map(Number);
  return instantFromZoned({ year, month, day, hour, minute }, timeZone);
}

function initialState(
  editing: SchedulingEventDetail | null,
  timeZone: string,
): FormState {
  if (editing) {
    return {
      title: editing.title,
      type: editing.type,
      description: editing.description ?? "",
      whenLocal: toLocalInput(editing.startsAt, timeZone),
      repeats: editing.recurrence !== null,
      frequency: (editing.recurrence?.frequency ??
        "MONTHLY") as RecurrenceFrequency,
      interval: String(editing.recurrence?.interval ?? 6),
      count: editing.recurrence?.count ? String(editing.recurrence.count) : "",
      active: editing.status !== "CANCELLED",
    };
  }

  return {
    title: "",
    type: "VISITA_TECNICA",
    description: "",
    whenLocal: inMonths(6, timeZone),
    repeats: false,
    frequency: "MONTHLY",
    interval: "6",
    count: "",
    active: true,
  };
}

function buildPayload(
  form: FormState,
  calendar: SchedulingCalendar,
  timeZone: string,
  businessUnitId?: string,
): CreateSchedulingEventInput {
  const startsAt = toInstant(form.whenLocal, timeZone);
  const endsAt = new Date(startsAt.getTime() + REMINDER_MINUTES * 60_000);

  return {
    calendarId: calendar.id,
    businessUnitId,
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    type: form.type.trim().toUpperCase(),
    status: form.active ? "CONFIRMED" : "CANCELLED",
    priority: "NORMAL",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    allDay: false,
    timezone: timeZone,
    sourceModule: REMINDER_SOURCE.module,
    sourceEntityType: REMINDER_SOURCE.entityType,
    recurrence: form.repeats
      ? {
          frequency: form.frequency,
          interval: Number(form.interval) || 1,
          count: form.count ? Number(form.count) : undefined,
          timezone: timeZone,
        }
      : undefined,
  };
}
