"use client";

/**
 * Detalhe do evento.
 *
 * É a única leitura do módulo que devolve **nomes** — a de ocorrências traz só
 * identificadores. Por isso o painel busca o evento ao abrir, em vez de
 * receber a ocorrência da grade por props.
 *
 * ## Cancelar não é excluir
 *
 * O backend não tem rota de cancelamento: cancelar é `PATCH` com
 * `status: "CANCELLED"`, o que **preserva** o evento na agenda com o status
 * riscado — o histórico de quem esperava aquela visita continua visível.
 * `DELETE` faz exclusão lógica e some da agenda. As duas ações existem e são
 * apresentadas com essa diferença explícita.
 *
 * ## Recorrência
 *
 * A regra é descrita a partir do que o servidor devolve (`frequency`,
 * `interval`, `byWeekday`, `count`, `until`). O Workspace **não expande**
 * ocorrência alguma: a expansão é do `RecurrenceEngine`, e o que chega na
 * grade já vem expandido.
 */
import { useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  ExternalLink,
  Link2,
  MapPin,
  Repeat,
  Trash2,
  UserRound,
  Building2,
  Phone,
  Mail,
  Wrench,
  Users,
  XCircle,
} from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelError, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useRemoveSchedulingEvent,
  useSchedulingEvent,
  useSchedulingEventTimeline,
  useUpdateSchedulingEvent,
} from "@/hooks/scheduling/use-scheduling";
import { formatZonedDateTime } from "@/lib/scheduling";
import { ROUTES } from "@/lib/routes";
import { formatDate } from "@/lib/formatters";
import {
  allocationStatusLabel,
  schedulingAddress,
  schedulingHistoryLabel,
} from "./event-presentation";
import { allocationRoleLabel } from "@/registry";
import type { SchedulingEventDetail } from "@/types/scheduling";
import {
  EventPriorityBadge,
  EventStatusBadge,
  eventTypeLabel,
} from "./event-badges";

export function EventDetailSheet({
  eventId,
  timeZone,
  canManage,
  onOpenChange,
  onEdit,
}: {
  eventId: string | null;
  timeZone: string;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (event: SchedulingEventDetail) => void;
}) {
  return (
    <Sheet open={eventId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {eventId ? (
          <EventDetailBody
            eventId={eventId}
            timeZone={timeZone}
            canManage={canManage}
            onClose={() => onOpenChange(false)}
            onEdit={onEdit}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function EventDetailBody({
  eventId,
  timeZone,
  canManage,
  onClose,
  onEdit,
}: {
  eventId: string;
  timeZone: string;
  canManage: boolean;
  onClose: () => void;
  onEdit: (event: SchedulingEventDetail) => void;
}) {
  const query = useSchedulingEvent(eventId);
  const timeline = useSchedulingEventTimeline(eventId);
  const update = useUpdateSchedulingEvent(eventId);
  const remove = useRemoveSchedulingEvent();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  if (query.isPending) return <PanelLoading rows={8} />;
  if (query.error || !query.data) {
    return (
      <PanelError error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  const event = query.data;
  const zone = timeZone;
  const operationId =
    event.sourceModule === "operations" ? event.sourceEntityId : null;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="pr-8">{event.title}</SheetTitle>
        <SheetDescription>
          {eventTypeLabel(event.type)}
          {event.calendar ? ` · ${event.calendar.name}` : ""}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-4 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <EventStatusBadge status={event.status} />
          <EventPriorityBadge priority={event.priority} />
          {event.recurrence ? (
            <Badge variant="secondary" className="gap-1">
              <Repeat className="size-3" aria-hidden />
              recorrente
            </Badge>
          ) : null}
          {event.segment ? (
            <Badge variant="outline">{event.segment}</Badge>
          ) : null}
        </div>

        <section className="space-y-2 rounded-xl border border-border bg-muted/30 p-4">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            Data e horário
          </h3>
          <p className="flex items-center gap-2 text-sm">
            <CalendarClock
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="min-w-0">
              {event.allDay ? (
                <>
                  Dia todo · {formatDate(event.startsAt, zone)} até{" "}
                  {formatDate(new Date(Date.parse(event.endsAt) - 1), zone)}
                </>
              ) : (
                <>
                  {formatZonedDateTime(event.startsAt, zone)} —{" "}
                  {formatZonedDateTime(event.endsAt, zone)}
                </>
              )}
            </span>
          </p>
          <p className="pl-6 text-xs text-muted-foreground">
            Horários no fuso: {zone}
            {event.timezone !== zone
              ? ` · Fuso de criação: ${event.timezone}`
              : ""}
          </p>
        </section>

        {event.businessUnit ? (
          <p className="flex items-center gap-2 text-sm">
            <Building2
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            {event.businessUnit.tradeName ?? event.businessUnit.legalName}
          </p>
        ) : null}

        {event.description ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              Descrição do agendamento
            </h3>
            <p className="text-sm whitespace-pre-wrap break-words">
              {event.description}
            </p>
          </section>
        ) : null}

        {event.recurrence ? (
          <RecurrenceSummary recurrence={event.recurrence} zone={zone} />
        ) : null}

        <LinkedRecords event={event} operationId={operationId} />

        <Allocations event={event} />

        <Timeline query={timeline} zone={zone} />

        <section className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
          {event.createdBy ? (
            <p>Criado por {event.createdBy.displayName}</p>
          ) : null}
          <p>Cadastrado em {formatZonedDateTime(event.createdAt, zone)}</p>
          <p>
            Última atualização em {formatZonedDateTime(event.updatedAt, zone)}
          </p>
        </section>

        {canManage ? (
          <section className="space-y-2 border-t border-border pt-4">
            <MutationError error={update.error ?? remove.error} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => onEdit(event)}>
                Editar
              </Button>
              {event.status === "CANCELLED" ? null : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ status: "CANCELLED" })}
                >
                  <XCircle className="size-4" />
                  {update.isPending ? "Cancelando…" : "Cancelar evento"}
                </Button>
              )}
              {confirmingRemoval ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(event.id, { onSuccess: onClose })
                  }
                >
                  <Trash2 className="size-4" />
                  {remove.isPending ? "Excluindo…" : "Confirmar exclusão"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingRemoval(true)}
                >
                  <Trash2 className="size-4" />
                  Excluir
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Cancelar mantém o evento na agenda, com status cancelado. Excluir
              remove o evento da agenda.
            </p>
          </section>
        ) : null}
      </div>
    </>
  );
}

function RecurrenceSummary({
  recurrence,
  zone,
}: {
  recurrence: NonNullable<SchedulingEventDetail["recurrence"]>;
  zone: string;
}) {
  const weekdays = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const frequency: Readonly<Record<string, string>> = {
    DAILY: "Diária",
    WEEKLY: "Semanal",
    MONTHLY: "Mensal",
    CUSTOM: "Datas específicas",
  };

  return (
    <section className="space-y-1 rounded-lg border border-border px-3 py-2">
      <h3 className="flex items-center gap-2 text-xs font-medium uppercase">
        <Repeat className="size-3.5 text-muted-foreground" aria-hidden />
        Recorrência
      </h3>
      <p className="text-sm">
        {frequency[recurrence.frequency] ?? recurrence.frequency}
        {recurrence.interval && recurrence.interval > 1
          ? ` · a cada ${recurrence.interval}`
          : ""}
        {recurrence.byWeekday.length > 0
          ? ` · ${recurrence.byWeekday.map((day) => weekdays[day] ?? day).join(", ")}`
          : ""}
        {recurrence.byMonthDay ? ` · dia ${recurrence.byMonthDay}` : ""}
      </p>
      <p className="text-xs text-muted-foreground">
        {recurrence.count ? `${recurrence.count} ocorrência(s)` : null}
        {recurrence.until
          ? ` até ${formatZonedDateTime(recurrence.until, zone)}`
          : null}
        {recurrence.exceptions.length > 0
          ? ` · ${recurrence.exceptions.length} exceção(ões)`
          : null}
      </p>
      <p className="text-[10px] text-muted-foreground">
        As ocorrências são geradas a partir da regra de recorrência.
      </p>
    </section>
  );
}

function LinkedRecords({
  event,
  operationId,
}: {
  event: SchedulingEventDetail;
  operationId: string | null;
}) {
  const eventAddress = schedulingAddress(event.location);
  const customerAddress = schedulingAddress(
    event.customer?.addresses?.[0] ?? event.customer?.address,
  );
  const address = eventAddress.length ? eventAddress : customerAddress;
  const hasAny =
    operationId ??
    event.customer ??
    event.asset ??
    event.location ??
    event.sourceEntityId;
  if (!hasAny) return null;

  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase">
        Cliente e atendimento
      </h3>

      {operationId ? (
        <Button size="sm" variant="outline" asChild>
          <Link href={`${ROUTES.operations}/${operationId}`}>
            <Link2 className="size-4" />
            Ver operação
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        </Button>
      ) : event.sourceEntityId ? (
        <p className="text-xs text-muted-foreground">
          Origem:{" "}
          {(
            {
              pmoc: "PMOC",
              rvt: "Visita técnica",
              scheduling: "Agenda",
              operations: "Operação",
            } as Record<string, string>
          )[event.sourceModule] ?? "Agenda"}
        </p>
      ) : null}

      {event.customer ? (
        <div className="space-y-2 rounded-xl border border-border p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <UserRound className="size-4 text-primary" aria-hidden />
            {event.customer.tradeName ?? event.customer.legalName}
          </p>
          {event.customer.tradeName &&
          event.customer.tradeName !== event.customer.legalName ? (
            <p className="text-xs text-muted-foreground">
              {event.customer.legalName}
            </p>
          ) : null}
          {event.customer.phone ? (
            <a
              className="flex items-center gap-2 text-sm hover:underline"
              href={`tel:${event.customer.phone}`}
            >
              <Phone className="size-3.5 shrink-0" aria-hidden />
              {event.customer.phone}
            </a>
          ) : null}
          {event.customer.email ? (
            <a
              className="flex items-center gap-2 break-all text-sm hover:underline"
              href={`mailto:${event.customer.email}`}
            >
              <Mail className="size-3.5 shrink-0" aria-hidden />
              {event.customer.email}
            </a>
          ) : null}
          {eventAddress.length > 0 &&
          customerAddress.length > 0 &&
          eventAddress.join("\n") !== customerAddress.join("\n") ? (
            <div className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
              <p className="font-medium">Endereço cadastrado do cliente</p>
              {customerAddress.map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {event.asset ? (
        <div className="space-y-1 rounded-xl border border-border p-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Wrench className="size-4 text-primary" aria-hidden />
            {event.asset.name}
          </p>
          {event.asset.identifier ? (
            <span className="ml-1 font-mono text-xs text-muted-foreground">
              {event.asset.identifier}
            </span>
          ) : null}
          {event.asset.manufacturer || event.asset.model ? (
            <p>
              {[event.asset.manufacturer, event.asset.model]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {event.asset.serialNumber ? (
            <p className="text-xs text-muted-foreground">
              Número de série: {event.asset.serialNumber}
            </p>
          ) : null}
          {event.asset.location ? (
            <p className="text-xs text-muted-foreground">
              Setor/localização: {event.asset.location}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2 rounded-xl border border-border p-4">
        <h4 className="flex items-center gap-2 text-sm font-medium">
          <MapPin className="size-4 text-primary" aria-hidden />
          {eventAddress.length ? "Local do atendimento" : "Endereço do cliente"}
        </h4>
        {address.length ? (
          <address className="space-y-1 text-sm not-italic break-words">
            {address.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </address>
        ) : (
          <p className="text-sm text-muted-foreground">
            Endereço não informado.
          </p>
        )}
      </div>
    </section>
  );
}

function Allocations({ event }: { event: SchedulingEventDetail }) {
  /**
   * A autoridade do vínculo **não** é lida aqui.
   *
   * `assignmentAuthority` pertence ao Read Model da ocorrência
   * (`SchedulingOccurrenceReadModel`); o detalhe do evento é um espelho do
   * registro do Prisma e não o publica. Derivá-la de `sourceModule` seria
   * reimplementar no cliente a regra que o backend já decide — e ela viraria
   * mentira no dia em que a regra mudasse.
   *
   * Onde o contrato a publica, a Agenda a mostra: ver `views/list-view.tsx`.
   */
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
        <Users className="size-3.5" aria-hidden />
        Equipe e recursos
      </h3>

      {event.allocations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum recurso alocado a este evento.
        </p>
      ) : (
        <ul className="space-y-1">
          {event.allocations.map((allocation) => (
            <li
              key={allocation.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <UserRound
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">
                {allocation.user?.displayName ??
                  allocation.asset?.name ??
                  allocation.resourceKey ??
                  (allocation.resourceType === "USER"
                    ? "Pessoa alocada"
                    : allocation.resourceType === "ASSET"
                      ? "Equipamento"
                      : "Recurso")}
              </span>
              {allocationRoleLabel(allocation.role) ? (
                <Badge variant="secondary" className="text-[10px]">
                  {allocationRoleLabel(allocation.role)}
                </Badge>
              ) : null}
              <Badge variant="outline" className="text-[10px]">
                {allocationStatusLabel(allocation.status)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Timeline({
  query,
  zone,
}: {
  query: ReturnType<typeof useSchedulingEventTimeline>;
  zone: string;
}) {
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase">
        Histórico
      </h3>

      {query.isPending ? (
        <PanelLoading rows={2} />
      ) : query.error ? (
        <PanelError error={query.error} />
      ) : (query.data?.history.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">Sem registros.</p>
      ) : (
        <ol className="space-y-2">
          {query.data?.history.map((entry) => (
            <li key={entry.id} className="text-xs">
              <p className="text-sm">{schedulingHistoryLabel(entry.action)}</p>
              <p className="text-muted-foreground">
                {entry.actor ? `${entry.actor.name} · ` : ""}
                {formatZonedDateTime(entry.createdAt, zone)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
