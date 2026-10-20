/**
 * Serviços do RVT V2 — `/api/v1/rvt`.
 *
 * ```text
 * rvt
 * ├── configurations (lista)
 * ├── configuration/:id
 * │   └── timeline (cursor)
 * ├── occurrences (lista global)
 * └── execution/:id
 * ```
 *
 * O que **não** está aqui é tão deliberado quanto o que está: não há
 * `start`, `complete`, `evidence` nem `acknowledgement`. São ações de campo,
 * exigem `rvt.execute` e acontecem com o técnico diante do equipamento; expor
 * um botão no navegador que as dispare criaria visita que ninguém fez.
 */
import { apiClient } from "@/api/client";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import type { QueryParams, RequestOptions } from "@/types/api";
import type {
  CreateRvtConfigurationInput,
  RvtConfiguration,
  RvtConfigurationListItem,
  RvtConfigurationQuery,
  RvtCursorPage,
  RvtExecution,
  RvtOccurrence,
  RvtOccurrenceQuery,
  RvtTimelineItem,
  RvtTimelineQuery,
  RvtUpdateResult,
  UpdateRvtConfigurationInput,
  RvtMaintenanceType,
  CreateRvtMaintenanceTypeInput,
  UpdateRvtMaintenanceTypeInput,
} from "@/types/rvt";

const RVT = "rvt";
const configuration = (id: string) =>
  `/rvt/configurations/${encodeURIComponent(id)}`;

export const rvtService = {
  basePath: "/rvt",

  /* ---------------------------------------------------------------- */
  /* Configuração                                                      */
  /* ---------------------------------------------------------------- */

  list: (
    query?: RvtConfigurationQuery,
    options?: RequestOptions,
  ): Promise<RvtCursorPage<RvtConfigurationListItem>> =>
    apiClient.get<RvtCursorPage<RvtConfigurationListItem>>(
      "/rvt/configurations",
      { ...options, query: query as QueryParams | undefined },
    ),

  get: (id: string, options?: RequestOptions): Promise<RvtConfiguration> =>
    apiClient.get<RvtConfiguration>(configuration(id), options),

  create: (input: CreateRvtConfigurationInput): Promise<RvtConfiguration> =>
    apiClient.post<RvtConfiguration>("/rvt/configurations", input),

  /**
   * A edição devolve **configuração e reconciliação**.
   *
   * O segundo campo é o que o servidor fez com a agenda futura. Descartá-lo
   * obrigaria a tela a comparar listas para adivinhar o mesmo — e a errar
   * quando a comparação empatasse.
   */
  update: (
    id: string,
    input: UpdateRvtConfigurationInput,
  ): Promise<RvtUpdateResult> =>
    apiClient.patch<RvtUpdateResult>(configuration(id), input),

  timeline: (
    id: string,
    query?: RvtTimelineQuery,
    options?: RequestOptions,
  ): Promise<RvtCursorPage<RvtTimelineItem>> =>
    apiClient.get<RvtCursorPage<RvtTimelineItem>>(
      `${configuration(id)}/timeline`,
      { ...options, query: query as QueryParams | undefined },
    ),

  /* ---------------------------------------------------------------- */
  /* Ocorrências e execução                                            */
  /* ---------------------------------------------------------------- */

  occurrences: (
    query?: RvtOccurrenceQuery,
    options?: RequestOptions,
  ): Promise<RvtCursorPage<RvtOccurrence>> =>
    apiClient.get<RvtCursorPage<RvtOccurrence>>("/rvt/occurrences", {
      ...options,
      query: query as QueryParams | undefined,
    }),

  execution: (id: string, options?: RequestOptions): Promise<RvtExecution> =>
    apiClient.get<RvtExecution>(
      `/rvt/executions/${encodeURIComponent(id)}`,
      options,
    ),

  /* ---------------------------------------------------------------- */
  /* Tipos de manutenção                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Os ritmos da organização, com o roteiro de cada um.
   *
   * Substituem `visitType`, que eram dois códigos fixos no cliente. Quem nomeia
   * "Trimestral" é o dono da conta.
   */
  maintenanceTypes: (
    options?: RequestOptions,
  ): Promise<readonly RvtMaintenanceType[]> =>
    apiClient.get<readonly RvtMaintenanceType[]>(
      "/rvt/maintenance-types",
      options,
    ),

  createMaintenanceType: (
    input: CreateRvtMaintenanceTypeInput,
  ): Promise<RvtMaintenanceType> =>
    apiClient.post<RvtMaintenanceType>("/rvt/maintenance-types", input),

  updateMaintenanceType: (
    id: string,
    input: UpdateRvtMaintenanceTypeInput,
  ): Promise<RvtMaintenanceType> =>
    apiClient.patch<RvtMaintenanceType>(
      `/rvt/maintenance-types/${encodeURIComponent(id)}`,
      input,
    ),

  removeMaintenanceType: (id: string): Promise<void> =>
    apiClient.delete<void>(
      `/rvt/maintenance-types/${encodeURIComponent(id)}`,
    ),

  keys: {
    maintenanceTypes: (): QueryKey =>
      queryKeys.query(RVT, "maintenance-types"),
    module: (): QueryKey => queryKeys.module(RVT),
    configurations: (query?: RvtConfigurationQuery): QueryKey =>
      queryKeys.list(RVT, query as QueryParams | undefined),
    configuration: (id: string): QueryKey => queryKeys.detail(RVT, id),
    occurrences: (query?: RvtOccurrenceQuery): QueryKey =>
      queryKeys.query(RVT, "occurrences", query as QueryParams | undefined),
    execution: (id: string): QueryKey =>
      queryKeys.query(RVT, "execution", { id }),
    timeline: (id: string, query?: RvtTimelineQuery): QueryKey =>
      queryKeys.query(RVT, "timeline", {
        id,
        ...(query as QueryParams | undefined),
      }),
  },
} as const;
