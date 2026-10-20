/**
 * Serviços do módulo Operations.
 *
 * Todas as rotas passam pelo BFF (`/api/orbit/...`) via `apiClient` da PR-01.
 * Nenhuma regra de negócio vive aqui: transições de status, validação de
 * agenda e permissões são do backend.
 */
import { apiClient } from "@/api/client";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import { download, upload, type DownloadResult } from "@/api/transfer";
import type { QueryParams, PaginatedResult, RequestOptions } from "@/types/api";
import type {
  AiExecution,
  AiExecutionQuery,
  AssignOperationUserInput,
  ChangeOperationStatusInput,
  ChecklistExecution,
  ChecklistExecutionQuery,
  CreateOperationInput,
  Operation,
  OperationAttachment,
  OperationFieldRecord,
  OperationListItem,
  OperationHistoryEntry,
  OperationQuery,
  OperationTimeline,
  UpdateOperationInput,
  ChecklistTemplate,
  ChecklistTemplateQuery,
  StartChecklistInput,
  CreateChecklistTemplateInput,
  UpdateChecklistTemplateInput,
  OperationCancellationRequest,
  OperationCancellationDecision,
} from "@/types/operations";

const RESOURCE = "operations";
const CHECKLISTS_RESOURCE = "checklist-executions";
const AI_RESOURCE = "ai-executions";

const asParams = (query: object | undefined): QueryParams | undefined =>
  query as QueryParams | undefined;

const item = (id: string): string => `/operations/${encodeURIComponent(id)}`;

export const operationsService = {
  basePath: "/operations",

  /**
   * A listagem devolve linhas, não detalhes.
   *
   * `OperationListItem` não tem `transitions` — o backend só publica a máquina
   * de estados no detalhe. Tipar isto como `Operation` prometia um campo que
   * nunca chega, e quem consumisse receberia `undefined` em silêncio.
   */
  list: (
    query?: OperationQuery,
    options?: RequestOptions,
  ): Promise<PaginatedResult<OperationListItem>> =>
    apiClient.get<PaginatedResult<OperationListItem>>("/operations", {
      ...options,
      query: asParams(query),
    }),

  get: (id: string, options?: RequestOptions): Promise<Operation> =>
    apiClient.get<Operation>(item(id), options),

  create: (input: CreateOperationInput): Promise<Operation> =>
    apiClient.post<Operation>("/operations", input),

  update: (id: string, input: UpdateOperationInput): Promise<Operation> =>
    apiClient.patch<Operation>(item(id), input),

  /** Exclusão lógica no backend; a listagem deixa de trazer o registro. */
  remove: (id: string): Promise<void> => apiClient.delete<void>(item(id)),

  history: (
    id: string,
    options?: RequestOptions,
  ): Promise<readonly OperationHistoryEntry[]> =>
    apiClient.get<readonly OperationHistoryEntry[]>(
      `${item(id)}/history`,
      options,
    ),

  timeline: (
    id: string,
    options?: RequestOptions,
  ): Promise<OperationTimeline> =>
    apiClient.get<OperationTimeline>(`${item(id)}/timeline`, options),

  /**
   * O registro de campo: as fotos do técnico e o aceite do cliente.
   *
   * Leitura separada do detalhe porque envolve assinar URLs de storage com
   * validade curta — carregá-la em toda leitura de operação geraria assinaturas
   * que ninguém abre.
   */
  fieldRecord: (
    id: string,
    options?: RequestOptions,
  ): Promise<OperationFieldRecord> =>
    apiClient.get<OperationFieldRecord>(`${item(id)}/field-record`, options),

  /** O backend valida a transição; o frontend só envia a intenção. */
  changeStatus: (
    id: string,
    input: ChangeOperationStatusInput,
  ): Promise<Operation> =>
    apiClient.patch<Operation>(`${item(id)}/status`, input),

  assign: (id: string, input: AssignOperationUserInput): Promise<Operation> =>
    apiClient.post<Operation>(`${item(id)}/assignments`, input),

  /**
   * Autoriza — ou retira a autorização — da atribuição.
   *
   * Só vale nas organizações que exigem autorização; nas demais o servidor
   * recusa, porque carimbar onde a etapa não existe confundiria a trilha.
   */
  setAuthorization: (id: string, autorizar: boolean): Promise<Operation> =>
    autorizar
      ? apiClient.post<Operation>(`${item(id)}/authorization`, {})
      : apiClient.delete<Operation>(`${item(id)}/authorization`),

  /**
   * Autoriza várias atribuições de uma vez.
   *
   * Leva os ids que a tela mostrou, e não um critério como "todas do técnico X": o
   * dono autoriza o que ele viu. Resolver o conjunto no servidor liberaria para o
   * campo um atendimento criado entre a tela carregar e o botão ser clicado.
   */
  authorizeMany: (
    operationIds: readonly string[],
  ): Promise<{ authorized: number }> =>
    apiClient.post<{ authorized: number }>("/operations/authorizations", {
      operationIds,
    }),

  /* ---------------------------------------------------------------- */
  /* Equipe do atendimento (PR-28)                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Define — ou troca — o responsável pelo atendimento.
   *
   * É também o comando de **promoção**: quando o escolhido já é auxiliar, o
   * servidor o retira da lista de auxiliares e o promove na mesma transação.
   * Fazer isso no cliente com duas chamadas deixaria uma janela em que a
   * pessoa é as duas coisas — o estado que o domínio proíbe.
   */
  replaceResponsible: (id: string, userId: string): Promise<Operation> =>
    apiClient.patch<Operation>(`${item(id)}/responsible-field-technician`, {
      userId,
    }),

  addAuxiliary: (id: string, userId: string): Promise<Operation> =>
    apiClient.post<Operation>(`${item(id)}/auxiliary-technicians`, { userId }),

  removeAuxiliary: (id: string, userId: string): Promise<void> =>
    apiClient.delete<void>(
      `${item(id)}/auxiliary-technicians/${encodeURIComponent(userId)}`,
    ),

  unassign: (id: string, userId: string): Promise<void> =>
    apiClient.delete<void>(
      `${item(id)}/assignments/${encodeURIComponent(userId)}`,
    ),

  /** `multipart/form-data` no campo `file`, limite de 20 MB. */
  uploadAttachment: (id: string, file: File): Promise<OperationAttachment> =>
    upload<OperationAttachment>(`${item(id)}/attachments`, file),

  downloadAttachment: (
    id: string,
    attachmentId: string,
  ): Promise<DownloadResult> =>
    download(`${item(id)}/attachments/${encodeURIComponent(attachmentId)}`),

  removeAttachment: (id: string, attachmentId: string): Promise<void> =>
    apiClient.delete<void>(
      `${item(id)}/attachments/${encodeURIComponent(attachmentId)}`,
    ),

  /**
   * Os pedidos de cancelamento vindos do campo.
   *
   * Rota própria e não um recorte de `/operations`: a pergunta é "o que o campo me
   * devolveu?", atravessando atendimentos — e não "o que há neste atendimento?".
   */
  cancellationRequests: (
    status: "PENDING" | "RESOLVED" = "PENDING",
    options?: RequestOptions,
  ): Promise<OperationCancellationRequest[]> =>
    apiClient.get<OperationCancellationRequest[]>(
      "/operations/cancellation-requests",
      { ...options, query: { status } },
    ),

  /**
   * Registra o desfecho do pedido.
   *
   * Só o desfecho. Reagendar e reatribuir são chamadas de operação à parte, com o
   * histórico e as validações delas — a tela encadeia as duas, e nesta ordem:
   * resolver primeiro fecha a janela em que dois donos decidem o mesmo pedido.
   */
  resolveCancellation: (
    id: string,
    input: { resolution: OperationCancellationDecision; notes?: string },
  ): Promise<{ operationId: string }> =>
    apiClient.post<{ operationId: string }>(
      `/operations/cancellation-requests/${encodeURIComponent(id)}/resolve`,
      input,
    ),

  keys: {
    module: (): QueryKey => queryKeys.module(RESOURCE),
    list: (query?: OperationQuery): QueryKey =>
      queryKeys.list(RESOURCE, asParams(query)),
    cancellationRequests: (status: string): QueryKey =>
      queryKeys.query(RESOURCE, "cancellation-requests", { status }),
    detail: (id: string): QueryKey => queryKeys.detail(RESOURCE, id),
    history: (id: string): QueryKey =>
      queryKeys.nested(RESOURCE, id, "history"),
    timeline: (id: string): QueryKey =>
      queryKeys.nested(RESOURCE, id, "timeline"),
    fieldRecord: (id: string): QueryKey =>
      queryKeys.nested(RESOURCE, id, "field-record"),
  },
} as const;

export const operationChecklistsService = {
  list: (
    query: ChecklistExecutionQuery,
    options?: RequestOptions,
  ): Promise<PaginatedResult<ChecklistExecution>> =>
    apiClient.get<PaginatedResult<ChecklistExecution>>(
      "/checklist-executions",
      { ...options, query: asParams(query) },
    ),

  get: (id: string, options?: RequestOptions): Promise<ChecklistExecution> =>
    apiClient.get<ChecklistExecution>(
      `/checklist-executions/${encodeURIComponent(id)}`,
      options,
    ),

  /** Começa a execução do checklist num atendimento. */
  start: (
    operationId: string,
    input: StartChecklistInput,
    options?: RequestOptions,
  ): Promise<ChecklistExecution> =>
    apiClient.post<ChecklistExecution>(
      `/operations/${encodeURIComponent(operationId)}/checklists`,
      input,
      options,
    ),

  keys: {
    module: (): QueryKey => queryKeys.module(CHECKLISTS_RESOURCE),
    byOperation: (operationId: string): QueryKey =>
      queryKeys.list(CHECKLISTS_RESOURCE, { operationId }),
    detail: (id: string): QueryKey => queryKeys.detail(CHECKLISTS_RESOURCE, id),
  },
} as const;

const CHECKLIST_TEMPLATES_RESOURCE = "checklist-templates";

/**
 * Modelos de checklist — o catálogo que o dono da organização mantém.
 *
 * Separado das execuções de propósito: modelo é o que se define uma vez;
 * execução é o que acontece num atendimento.
 */
export const checklistTemplatesService = {
  list: (
    query?: ChecklistTemplateQuery,
    options?: RequestOptions,
  ): Promise<PaginatedResult<ChecklistTemplate>> =>
    apiClient.get<PaginatedResult<ChecklistTemplate>>("/checklist-templates", {
      ...options,
      query: query as QueryParams | undefined,
    }),

  find: (id: string, options?: RequestOptions): Promise<ChecklistTemplate> =>
    apiClient.get<ChecklistTemplate>(
      `/checklist-templates/${encodeURIComponent(id)}`,
      options,
    ),

  create: (input: CreateChecklistTemplateInput): Promise<ChecklistTemplate> =>
    apiClient.post<ChecklistTemplate>("/checklist-templates", input),

  update: (
    id: string,
    input: UpdateChecklistTemplateInput,
  ): Promise<ChecklistTemplate> =>
    apiClient.patch<ChecklistTemplate>(
      `/checklist-templates/${encodeURIComponent(id)}`,
      input,
    ),

  remove: (id: string): Promise<void> =>
    apiClient.delete<void>(`/checklist-templates/${encodeURIComponent(id)}`),

  keys: {
    module: (): QueryKey => queryKeys.module(CHECKLIST_TEMPLATES_RESOURCE),
    list: (query?: ChecklistTemplateQuery): QueryKey =>
      queryKeys.list(CHECKLIST_TEMPLATES_RESOURCE, asParams(query)),
    detail: (id: string): QueryKey =>
      queryKeys.detail(CHECKLIST_TEMPLATES_RESOURCE, id),
  },
} as const;

export const operationIntelligenceService = {
  /**
   * Execuções de IA vinculadas à operação.
   *
   * É o único caminho real de "Orbit Intelligence" por operação: o backend
   * permite filtrar `AiExecution` por `operationId`. O conteúdo de `output` é
   * JSON livre, definido pelo agente que executou.
   */
  list: (
    query: AiExecutionQuery,
    options?: RequestOptions,
  ): Promise<PaginatedResult<AiExecution>> =>
    apiClient.get<PaginatedResult<AiExecution>>("/ai-executions", {
      ...options,
      query: asParams(query),
    }),

  keys: {
    module: (): QueryKey => queryKeys.module(AI_RESOURCE),
    byOperation: (operationId: string): QueryKey =>
      queryKeys.list(AI_RESOURCE, { operationId }),
    /** `AiExecutionQueryDto` aceita `customerId` — usado pelo Customer Workspace. */
    byCustomer: (customerId: string): QueryKey =>
      queryKeys.list(AI_RESOURCE, { customerId }),
  },
} as const;
