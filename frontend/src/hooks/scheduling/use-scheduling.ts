"use client";

/**
 * Query Layer do Scheduling Workspace.
 *
 * ## Invalidação
 *
 * Escrever um evento muda, potencialmente, **todas** as janelas: um evento
 * recorrente criado hoje aparece em semanas futuras, e mover um evento muda o
 * conflito de outro. Não existe invalidação cirúrgica por período que seja
 * correta — a única invalidação segura é a raiz do módulo
 * (`queryKeys.module("scheduling")`), que derruba ocorrências, conflitos,
 * inteligência e agenda de qualquer janela em cache.
 *
 * Isso é deliberado e está documentado: invalidar só o período visível
 * deixaria janelas vizinhas mostrando um evento que não existe mais. O custo é
 * refazer as consultas do módulo; o benefício é nunca exibir agenda mentindo.
 *
 * O escopo de organização e unidade já é tratado uma camada acima: o
 * `RequestContextProvider` (PR-02) descarta o cache inteiro ao trocar de
 * organização, e a unidade ativa entra na query key por ser filtro real de
 * `EventQueryDto`.
 */
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/api/query-keys";
import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { CACHE, MINUTE, every } from "@/hooks/api/cache-policy";
import { schedulingService } from "@/services/scheduling.service";
import type {
  AddSchedulingAllocationInput,
  CreateSchedulingAvailabilityInput,
  CreateSchedulingCalendarInput,
  CreateSchedulingEventInput,
  SchedulingAvailabilityQuery,
  SchedulingEventQuery,
  UpdateSchedulingEventInput,
} from "@/types/scheduling";

const RESOURCE = "scheduling";
/**
 * Cadência por leitura.
 *
 * A agenda é compartilhada — alguém remarca uma visita e quem está com a tela
 * aberta precisa ver. Conflitos acompanham a mesma cadência das ocorrências
 * porque descrevem exatamente aquelas ocorrências.
 */
export const SCHEDULING_REFRESH = {
  occurrences: every(CACHE.live, 2 * MINUTE),
  conflicts: every(CACHE.live, 2 * MINUTE),
  /** Calendários e disponibilidade mudam por configuração, não por operação. */
  calendars: CACHE.catalog,
  availability: CACHE.catalog,
  event: CACHE.fresh,
  timeline: CACHE.stable,
  intelligence: CACHE.catalog,
} as const;

export function useSchedulingCalendars(businessUnitId?: string) {
  return useApiQuery(
    schedulingService.keys.calendars(businessUnitId),
    ({ signal }) => schedulingService.calendars(businessUnitId, { signal }),
    SCHEDULING_REFRESH.calendars,
  );
}

/** Ocorrências da janela — fonte de todas as visões. */
export function useSchedulingOccurrences(
  query: SchedulingEventQuery,
  enabled = true,
) {
  return useApiQuery(
    schedulingService.keys.occurrences(query),
    ({ signal }) => schedulingService.occurrences(query, { signal }),
    {
      ...SCHEDULING_REFRESH.occurrences,
      enabled,
      /** Mantém a grade preenchida ao navegar entre períodos. */
      placeholderData: (previous) => previous,
    },
  );
}

export function useSchedulingConflicts(
  query: SchedulingEventQuery,
  enabled = true,
) {
  return useApiQuery(
    schedulingService.keys.conflicts(query),
    ({ signal }) => schedulingService.conflicts(query, { signal }),
    { ...SCHEDULING_REFRESH.conflicts, enabled },
  );
}

export function useSchedulingAvailability(
  query: SchedulingAvailabilityQuery,
  enabled = true,
) {
  return useApiQuery(
    schedulingService.keys.availability(query),
    ({ signal }) => schedulingService.availability(query, { signal }),
    { ...SCHEDULING_REFRESH.availability, enabled },
  );
}

/**
 * Scheduling Intelligence.
 *
 * Exige a capability `scheduling.intelligence`, que nem todo plano inclui — o
 * 403 é tratado como ausência de acesso pelo painel, não como falha.
 */
export function useSchedulingIntelligence(
  query: SchedulingEventQuery,
  enabled = true,
) {
  return useApiQuery(
    schedulingService.keys.intelligence(query),
    ({ signal }) => schedulingService.intelligence(query, { signal }),
    { ...SCHEDULING_REFRESH.intelligence, enabled },
  );
}

export function useSchedulingEvent(id: string | null) {
  return useApiQuery(
    schedulingService.keys.event(id ?? ""),
    ({ signal }) => schedulingService.event(id as string, { signal }),
    { ...SCHEDULING_REFRESH.event, enabled: id !== null },
  );
}

export function useSchedulingEventTimeline(id: string | null) {
  return useApiQuery(
    schedulingService.keys.timeline(id ?? ""),
    ({ signal }) => schedulingService.timeline(id as string, { signal }),
    { ...SCHEDULING_REFRESH.timeline, enabled: id !== null },
  );
}

/** Invalidação padrão de toda escrita do módulo — ver o cabeçalho. */
function useSchedulingInvalidation() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.module(RESOURCE) });
}

/**
 * Criação de calendário.
 *
 * `POST /scheduling/calendars` existe desde a PR-07 e nenhuma tela o
 * consumia — motivo pelo qual organizações sem calendário não conseguiam
 * agendar nada (`calendarId` é obrigatório em `CreateEventDto`).
 */
export function useCreateSchedulingCalendar() {
  const invalidate = useSchedulingInvalidation();
  return useApiMutation(
    (input: CreateSchedulingCalendarInput) =>
      schedulingService.createCalendar(input),
    { onSuccess: invalidate },
  );
}

export function useCreateSchedulingEvent() {
  const invalidate = useSchedulingInvalidation();
  return useApiMutation(
    (input: CreateSchedulingEventInput) => schedulingService.createEvent(input),
    { onSuccess: invalidate },
  );
}

export function useUpdateSchedulingEvent(id: string) {
  const invalidate = useSchedulingInvalidation();
  return useApiMutation(
    (input: UpdateSchedulingEventInput) =>
      schedulingService.updateEvent(id, input),
    {
      /** Escritas do mesmo evento não disputam a última palavra. */
      scope: { id: `${RESOURCE}:${id}` },
      onSuccess: invalidate,
    },
  );
}

export function useRemoveSchedulingEvent() {
  const invalidate = useSchedulingInvalidation();
  return useApiMutation((id: string) => schedulingService.removeEvent(id), {
    onSuccess: invalidate,
  });
}

export function useAddSchedulingAllocation(id: string) {
  const invalidate = useSchedulingInvalidation();
  return useApiMutation(
    (input: AddSchedulingAllocationInput) =>
      schedulingService.addAllocation(id, input),
    { scope: { id: `${RESOURCE}:${id}` }, onSuccess: invalidate },
  );
}

export function useRemoveSchedulingAllocation(id: string) {
  const invalidate = useSchedulingInvalidation();
  return useApiMutation(
    (allocationId: string) =>
      schedulingService.removeAllocation(id, allocationId),
    { scope: { id: `${RESOURCE}:${id}` }, onSuccess: invalidate },
  );
}

export function useCreateSchedulingAvailability() {
  const invalidate = useSchedulingInvalidation();
  return useApiMutation(
    (input: CreateSchedulingAvailabilityInput) =>
      schedulingService.createAvailability(input),
    { onSuccess: invalidate },
  );
}

export function useRemoveSchedulingAvailability() {
  const invalidate = useSchedulingInvalidation();
  return useApiMutation(
    (id: string) => schedulingService.removeAvailability(id),
    { onSuccess: invalidate },
  );
}
