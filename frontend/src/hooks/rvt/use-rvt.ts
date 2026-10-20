"use client";

/**
 * Hooks do RVT V2.
 *
 * A cadência segue a volatilidade: a configuração muda por ação humana, a
 * agenda de ocorrências muda quando alguém edita a regra, e a execução muda
 * enquanto o técnico está em campo.
 */
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/api/query-keys";
import { CACHE } from "@/hooks/api/cache-policy";
import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { useActiveScope } from "@/providers/use-active-scope";
import { rvtService } from "@/services/rvt.service";
import type {
  CreateRvtConfigurationInput,
  RvtConfigurationQuery,
  RvtOccurrenceQuery,
  RvtTimelineQuery,
  UpdateRvtConfigurationInput,
  CreateRvtMaintenanceTypeInput,
  UpdateRvtMaintenanceTypeInput,
} from "@/types/rvt";

export const RVT_REFRESH = {
  configurations: CACHE.stable,
  configuration: CACHE.fresh,
  occurrences: CACHE.fresh,
  /** A visita em campo muda sem que ninguém recarregue a página. */
  execution: CACHE.live,
  timeline: CACHE.stable,
} as const;

/** Lista de configurações. A unidade ativa recorta, como nos demais módulos. */
export function useRvtConfigurations(query: RvtConfigurationQuery) {
  const { businessUnitId } = useActiveScope();
  const scoped = useMemo<RvtConfigurationQuery>(
    () => ({
      ...query,
      businessUnitId: query.businessUnitId ?? businessUnitId ?? undefined,
    }),
    [businessUnitId, query],
  );

  return useApiQuery(
    rvtService.keys.configurations(scoped),
    ({ signal }) => rvtService.list(scoped, { signal }),
    { ...RVT_REFRESH.configurations, placeholderData: (previous) => previous },
  );
}

export function useRvtConfiguration(id: string) {
  return useApiQuery(
    rvtService.keys.configuration(id),
    ({ signal }) => rvtService.get(id, { signal }),
    RVT_REFRESH.configuration,
  );
}

export function useRvtOccurrences(query: RvtOccurrenceQuery) {
  const { businessUnitId } = useActiveScope();
  const scoped = useMemo<RvtOccurrenceQuery>(
    () => ({
      ...query,
      businessUnitId: query.businessUnitId ?? businessUnitId ?? undefined,
    }),
    [businessUnitId, query],
  );

  return useApiQuery(
    rvtService.keys.occurrences(scoped),
    ({ signal }) => rvtService.occurrences(scoped, { signal }),
    { ...RVT_REFRESH.occurrences, placeholderData: (previous) => previous },
  );
}

/**
 * A visita física.
 *
 * O Read Model já traz equipamentos, equipe, evidências, aceite e documento —
 * uma consulta. Buscar equipamento por linha depois seria N+1 sobre dado que
 * já está em mãos.
 */
export function useRvtExecution(id: string) {
  return useApiQuery(
    rvtService.keys.execution(id),
    ({ signal }) => rvtService.execution(id, { signal }),
    RVT_REFRESH.execution,
  );
}

export function useRvtTimeline(id: string, query?: RvtTimelineQuery) {
  return useApiQuery(
    rvtService.keys.timeline(id, query),
    ({ signal }) => rvtService.timeline(id, query, { signal }),
    { ...RVT_REFRESH.timeline, placeholderData: (previous) => previous },
  );
}

/* ------------------------------------------------------------------ */
/* Escritas                                                            */
/* ------------------------------------------------------------------ */

export function useCreateRvtConfiguration() {
  return useApiMutation(
    (input: CreateRvtConfigurationInput) => rvtService.create(input),
    { invalidate: [rvtService.keys.module()] },
  );
}

/**
 * Editar a regra mexe na agenda.
 *
 * O backend reconcilia as ocorrências futuras intocadas e projeta cada uma na
 * Agenda. Por isso a invalidação alcança `scheduling` — sem isso, o calendário
 * continuaria mostrando visitas que o servidor acabou de remarcar.
 */
export function useUpdateRvtConfiguration(id: string) {
  return useApiMutation(
    (input: UpdateRvtConfigurationInput) => rvtService.update(id, input),
    {
      scope: { id: `rvt:${id}` },
      invalidate: [
        rvtService.keys.configuration(id),
        rvtService.keys.timeline(id),
        rvtService.keys.module(),
        queryKeys.module("scheduling"),
      ],
    },
  );
}

/* ------------------------------------------------------------------ */
/* Tipos de manutenção                                                 */
/* ------------------------------------------------------------------ */

/**
 * Os ritmos de manutenção da organização.
 *
 * Substituem os dois códigos fixos que o cliente traduzia. `CACHE.stable`
 * porque é catálogo: muda quando alguém cadastra, não a cada visita.
 */
export function useRvtMaintenanceTypes() {
  return useApiQuery(
    rvtService.keys.maintenanceTypes(),
    ({ signal }) => rvtService.maintenanceTypes({ signal }),
    CACHE.stable,
  );
}

function useMaintenanceTypeInvalidation() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({
      queryKey: rvtService.keys.maintenanceTypes(),
    });
  };
}

export function useCreateRvtMaintenanceType() {
  const invalidate = useMaintenanceTypeInvalidation();
  return useApiMutation(
    (input: CreateRvtMaintenanceTypeInput) =>
      rvtService.createMaintenanceType(input),
    { onSuccess: invalidate },
  );
}

export function useUpdateRvtMaintenanceType(id: string) {
  const invalidate = useMaintenanceTypeInvalidation();
  return useApiMutation(
    (input: UpdateRvtMaintenanceTypeInput) =>
      rvtService.updateMaintenanceType(id, input),
    { onSuccess: invalidate },
  );
}

export function useRemoveRvtMaintenanceType() {
  const invalidate = useMaintenanceTypeInvalidation();
  return useApiMutation((id: string) => rvtService.removeMaintenanceType(id), {
    onSuccess: invalidate,
  });
}
