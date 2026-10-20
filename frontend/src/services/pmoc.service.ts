/**
 * Serviços do PMOC V2 — `/api/v1/pmoc`.
 *
 * As keys seguem a hierarquia do domínio, e é ela que permite invalidar com
 * precisão: concluir a execução de um equipamento derruba o ciclo e a linha do
 * tempo daquele plano, não o cache de PMOC inteiro.
 *
 * ```text
 * pmoc
 * ├── plans (lista)
 * └── plan/:id
 *     ├── coverage (cursor)
 *     ├── cycles
 *     │   └── cycle/:id → equipment-executions
 *     └── timeline (cursor)
 * ```
 */
import { apiClient } from "@/api/client";
import { downloadAndSave, type DownloadResult } from "@/api/transfer";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import type { PaginatedResult, QueryParams, RequestOptions } from "@/types/api";
import type {
  CreatePmocPlanInput,
  PmocComplianceSummary,
  PmocCoverage,
  PmocCoveragePageQuery,
  PmocCursorPage,
  PmocCycle,
  PmocCycleEquipmentRow,
  PmocEquipmentExecution,
  PmocExecutionPreparation,
  StartPmocExecutionInput,
  CompletePmocExecutionInput,
  PmocPlan,
  PmocPlanQuery,
  PmocPlanSummary,
  PmocPreview,
  PmocPreviewInput,
  PmocSignatureLink,
  PmocCodeSuggestion,
  PmocTimelineItem,
  PmocTimelineQuery,
  PmocUpcoming,
  UpdatePmocPlanInput,
  PmocPlanNameOption,
  PmocUnit,
  CreatePmocUnitInput,
  UpdatePmocUnitInput,
} from "@/types/pmoc";

const PMOC = "pmoc";
const plan = (id: string) => `/pmoc/plans/${encodeURIComponent(id)}`;
const cycle = (planId: string, cycleId: string) =>
  `${plan(planId)}/cycles/${encodeURIComponent(cycleId)}`;

export const pmocService = {
  basePath: "/pmoc",

  /* ---------------------------------------------------------------- */
  /* Configuração                                                      */
  /* ---------------------------------------------------------------- */

  list: (
    query?: PmocPlanQuery,
    options?: RequestOptions,
  ): Promise<PaginatedResult<PmocPlanSummary>> =>
    apiClient.get<PaginatedResult<PmocPlanSummary>>("/pmoc/plans", {
      ...options,
      query: query as QueryParams | undefined,
    }),

  get: (id: string, options?: RequestOptions): Promise<PmocPlan> =>
    apiClient.get<PmocPlan>(plan(id), options),

  create: (input: CreatePmocPlanInput): Promise<PmocPlanSummary> =>
    apiClient.post<PmocPlanSummary>("/pmoc/plans", input),

  /**
   * O código sugerido para um cliente.
   *
   * Não reserva número: quem consome a sequência é o create. Duas telas
   * abertas ao mesmo tempo veem o mesmo `003` e salvam como `003` e `004`.
   */
  /** As unidades da organização, com o roteiro de cada uma. */
  units: (options?: RequestOptions): Promise<PmocUnit[]> =>
    apiClient.get<PmocUnit[]>("/pmoc/units", options),

  createUnit: (
    input: CreatePmocUnitInput,
    options?: RequestOptions,
  ): Promise<PmocUnit> =>
    apiClient.post<PmocUnit>("/pmoc/units", input, options),

  updateUnit: (
    id: string,
    input: UpdatePmocUnitInput,
    options?: RequestOptions,
  ): Promise<PmocUnit> =>
    apiClient.patch<PmocUnit>(
      `/pmoc/units/${encodeURIComponent(id)}`,
      input,
      options,
    ),

  removeUnit: (id: string, options?: RequestOptions): Promise<void> =>
    apiClient.delete<void>(`/pmoc/units/${encodeURIComponent(id)}`, options),

  /** Os nomes sugeridos para um plano. Catálogo da plataforma. */
  planNameOptions: (
    options?: RequestOptions,
  ): Promise<PmocPlanNameOption[]> =>
    apiClient.get<PmocPlanNameOption[]>("/pmoc/plan-name-options", options),

  codeSuggestion: (
    customerId: string,
    options?: RequestOptions,
  ): Promise<PmocCodeSuggestion> =>
    apiClient.get<PmocCodeSuggestion>("/pmoc/code-suggestion", {
      ...options,
      query: { customerId },
    }),

  /**
   * A projeção da configuração — ciclos, equipamentos e a matriz.
   *
   * `POST` porque a lista de equipamentos não cabe numa query string. Não cria
   * nada; a conta de `ciclos × equipamentos` é do backend, e não da tela.
   */
  preview: (input: PmocPreviewInput): Promise<PmocPreview> =>
    apiClient.post<PmocPreview>("/pmoc/plans/preview", input),

  update: (id: string, input: UpdatePmocPlanInput): Promise<PmocPlanSummary> =>
    apiClient.patch<PmocPlanSummary>(plan(id), input),

  activate: (id: string): Promise<PmocPlanSummary> =>
    apiClient.post<PmocPlanSummary>(`${plan(id)}/activate`, {}),

  suspend: (id: string): Promise<PmocPlanSummary> =>
    apiClient.post<PmocPlanSummary>(`${plan(id)}/suspend`, {}),

  cancel: (id: string): Promise<PmocPlanSummary> =>
    apiClient.post<PmocPlanSummary>(`${plan(id)}/cancel`, {}),

  /* ---------------------------------------------------------------- */
  /* Cobertura — cursor, não offset                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Uma página de equipamentos cobertos.
   *
   * O backend pagina por cursor porque a cobertura de um contrato grande passa
   * de centenas de máquinas. Converter para offset no cliente reintroduziria
   * o salto de registros que o cursor existe para evitar.
   */
  coveragePage: (
    id: string,
    query?: PmocCoveragePageQuery,
    options?: RequestOptions,
  ): Promise<PmocCursorPage<PmocCoverage>> =>
    apiClient.get<PmocCursorPage<PmocCoverage>>(`${plan(id)}/equipment-page`, {
      ...options,
      query: query as QueryParams | undefined,
    }),

  /**
   * O relatório de **configuração** do plano.
   *
   * É o contrato impresso: partes, vigência, periodicidade, equipamentos cobertos
   * e o roteiro de cada unidade. Não é o relatório de execução — esse nasce de
   * uma manutenção feita, um por equipamento atendido.
   *
   * O nome do arquivo vem do `Content-Disposition`: é o servidor que decide como
   * o documento se chama, e montá-lo aqui duplicaria essa regra.
   */
  document: (id: string): Promise<DownloadResult> =>
    downloadAndSave(`${plan(id)}/document`),

  addCoverage: (id: string, assetId: string, notes?: string) =>
    apiClient.post<PmocCoverage>(`${plan(id)}/equipment`, { assetId, notes }),

  removeCoverage: (id: string, coverageId: string): Promise<void> =>
    apiClient.delete<void>(
      `${plan(id)}/equipment/${encodeURIComponent(coverageId)}`,
    ),

  /* ---------------------------------------------------------------- */
  /* Ciclos e execuções por equipamento                                */
  /* ---------------------------------------------------------------- */

  cycles: (id: string, options?: RequestOptions): Promise<PmocCycle[]> =>
    apiClient.get<PmocCycle[]>(`${plan(id)}/executions`, options),

  /**
   * A cobertura do ciclo, com a execução de cada equipamento quando existe.
   *
   * Uma consulta responde tudo: quais equipamentos o ciclo abrange, quais já
   * foram executados e por quem. Cruzar cobertura com execuções no navegador
   * daria o mesmo resultado com duas consultas e uma regra a mais para errar.
   */
  equipmentExecutions: (
    planId: string,
    cycleId: string,
    options?: RequestOptions,
  ): Promise<PmocCycleEquipmentRow[]> =>
    apiClient.get<PmocCycleEquipmentRow[]>(
      `${cycle(planId, cycleId)}/equipment-executions`,
      options,
    ),

  /** A resposta que decide se a manutenção deste equipamento pode começar. */
  executionPreparation: (
    planId: string,
    cycleId: string,
    assetId: string,
    options?: RequestOptions,
  ): Promise<PmocExecutionPreparation> =>
    apiClient.get<PmocExecutionPreparation>(
      `${cycle(planId, cycleId)}/equipment/${encodeURIComponent(assetId)}/execution-preparation`,
      options,
    ),

  /* ---------------------------------------------------------------- */
  /* O atendimento                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Abre a execução deste equipamento e a ordem de serviço 1:1 dela.
   *
   * Escala o técnico em campo, que é quem responde pela manutenção e cujo nome vai
   * no documento. A partir daqui, **só ele ou o dono** concluem.
   */
  startExecution: (
    planId: string,
    cycleId: string,
    assetId: string,
    input: StartPmocExecutionInput,
  ): Promise<PmocEquipmentExecution> =>
    apiClient.post<PmocEquipmentExecution>(
      `${cycle(planId, cycleId)}/equipment/${encodeURIComponent(assetId)}/executions`,
      input,
    ),

  /**
   * Conclui a execução. O ciclo fecha sozinho quando todos os equipamentos dele
   * estiverem resolvidos — não há passo separado para isso.
   */
  completeExecution: (
    planId: string,
    cycleId: string,
    executionId: string,
    input: CompletePmocExecutionInput,
  ): Promise<{ execution: PmocEquipmentExecution; cycleCompleted: boolean }> =>
    apiClient.post<{
      execution: PmocEquipmentExecution;
      cycleCompleted: boolean;
    }>(
      `${cycle(planId, cycleId)}/equipment-executions/${encodeURIComponent(executionId)}/complete`,
      input,
    ),

  /**
   * Emite o relatório de execução deste equipamento.
   *
   * Só depois de concluída: o documento afirma o que foi conferido, e um relatório
   * de manutenção em andamento seria uma declaração sobre o futuro.
   */
  generateExecutionArtifact: (
    executionId: string,
  ): Promise<PmocEquipmentExecution> =>
    apiClient.post<PmocEquipmentExecution>(
      `/pmoc/equipment-executions/${encodeURIComponent(executionId)}/artifact/generate`,
      {},
    ),

  /* ---------------------------------------------------------------- */
  /* Linha do tempo                                                    */
  /* ---------------------------------------------------------------- */

  timeline: (
    id: string,
    query?: PmocTimelineQuery,
    options?: RequestOptions,
  ): Promise<PmocCursorPage<PmocTimelineItem>> =>
    apiClient.get<PmocCursorPage<PmocTimelineItem>>(`${plan(id)}/timeline`, {
      ...options,
      query: query as QueryParams | undefined,
    }),

  /* ---------------------------------------------------------------- */
  /* Painel                                                            */
  /* ---------------------------------------------------------------- */

  compliance: (options?: RequestOptions): Promise<PmocComplianceSummary> =>
    apiClient.get<PmocComplianceSummary>("/pmoc/compliance", options),

  upcoming: (options?: RequestOptions): Promise<PmocUpcoming[]> =>
    apiClient.get<PmocUpcoming[]>("/pmoc/upcoming", options),

  /**
   * Gera o link pelo qual o contratante assina.
   *
   * **Não é idempotente, e isso é o recurso.** Cada chamada emite um token novo e
   * revoga o anterior — é o que garante que um link reenviado invalida o que
   * circulou antes. Por isso não tem cache nem query key: o resultado traz o token
   * em claro, que existe uma única vez, e guardá-lo no cache do React Query o
   * deixaria em memória muito depois de ter sido copiado.
   */
  createSignatureLink: (id: string): Promise<PmocSignatureLink> =>
    apiClient.post<PmocSignatureLink>(`${plan(id)}/signature-link`, {}),

  keys: {
    module: (): QueryKey => queryKeys.module(PMOC),
    plans: (query?: PmocPlanQuery): QueryKey =>
      queryKeys.list(PMOC, query as QueryParams | undefined),
    plan: (id: string): QueryKey => queryKeys.detail(PMOC, id),
    coverage: (id: string, query?: PmocCoveragePageQuery): QueryKey =>
      queryKeys.query(PMOC, "coverage", {
        id,
        ...(query as QueryParams | undefined),
      }),
    cycles: (id: string): QueryKey => queryKeys.query(PMOC, "cycles", { id }),
    planNameOptions: (): QueryKey => queryKeys.query(PMOC, "plan-name-options"),
    units: (): QueryKey => queryKeys.query(PMOC, "units"),
    equipmentExecutions: (planId: string, cycleId: string): QueryKey =>
      queryKeys.query(PMOC, "equipment-executions", { planId, cycleId }),
    preparation: (planId: string, cycleId: string, assetId: string): QueryKey =>
      queryKeys.query(PMOC, "execution-preparation", {
        planId,
        cycleId,
        assetId,
      }),
    timeline: (id: string, query?: PmocTimelineQuery): QueryKey =>
      queryKeys.query(PMOC, "timeline", {
        id,
        ...(query as QueryParams | undefined),
      }),
    compliance: (): QueryKey => queryKeys.query(PMOC, "compliance"),
    upcoming: (): QueryKey => queryKeys.query(PMOC, "upcoming"),
  },
} as const;
