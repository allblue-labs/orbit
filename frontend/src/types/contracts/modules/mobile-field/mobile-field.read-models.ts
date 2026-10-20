/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

export type MobileWorkItemKind = 'SERVICE_OPERATION' | 'PMOC' | 'RVT';
export type MobileDueState =
  'IN_PROGRESS' | 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING' | 'UNSCHEDULED';
export type MobileFieldAction =
  | 'VIEW'
  | 'OPEN_ROUTE'
  | 'CALL_CONTACT'
  | 'WHATSAPP_CONTACT'
  | 'START'
  | 'RESUME'
  | 'COMPLETE'
  | 'ADD_EVIDENCE'
  | 'VIEW_DOCUMENT'
  | 'DOWNLOAD_DOCUMENT'
  /**
   * Pedir ao dono o cancelamento do atendimento.
   *
   * Pedido, e não `CANCEL`: quem está na porta relata, quem decide é o dono. O nome
   * da ação diz isso, e é o que impede a tela de rotular o botão como se encerrasse
   * o compromisso.
   */
  | 'REQUEST_CANCELLATION'
  | 'EXECUTE_PMOC'
  | 'EXECUTE_RVT'
  | 'SCAN_EQUIPMENT';

export interface MobilePartySummaryReadModel {
  id: string;
  name: string;
}
export interface MobileCustomerSummaryReadModel extends MobilePartySummaryReadModel {
  address: unknown;
  contact: { name: string; phone: string | null; email: string | null } | null;
}
/**
 * Para onde o técnico vai — o endereço do atendimento, não o fiscal do cliente.
 *
 * Estruturado, e não uma linha pronta: o aplicativo precisa de `complement` e
 * `reference` em destaque. Quem está com o celular na mão procurando a portaria lê
 * "fundos, portão azul" antes de ler o CEP, e uma string única os enterraria no meio
 * do logradouro.
 *
 * `reference` é `CustomerAddress.notes`, que é onde moram ponto de referência,
 * portaria e instruções de acesso.
 */
export interface MobileServiceAddressReadModel {
  /** Como a equipe chama este lugar: "Matriz", "Loja Shopping". */
  label: string | null;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  stateCode: string | null;
  postalCode: string | null;
  /** Ponto de referência, portaria, instruções de acesso. */
  reference: string | null;
  /** O ponto exato dentro do endereço: "Auditório", "Sala 2". */
  sector: string | null;
}

export interface MobileEquipmentSummaryReadModel {
  id: string;
  code: string | null;
  name: string;
  type: string;
  brand: string | null;
  model: string | null;
  sector: string | null;
  status: string;
  qrAvailable: boolean;
}
export interface MobileArtifactSummaryReadModel {
  id: string;
  type: string;
  status: string;
  previewAvailable: boolean;
  downloadAvailable: boolean;
}
export interface MobileNavigationContextReadModel {
  kind: MobileWorkItemKind;
  sourceId: string;
  executionId: string | null;
  occurrenceId: string | null;
  cycleId: string | null;
  equipmentId: string | null;
  /**
   * O plano de PMOC, quando o item é de PMOC.
   *
   * Sem ele o aplicativo não consegue montar nenhuma das rotas do atendimento —
   * todas são escopadas pelo plano
   * (`/pmoc/plans/:planId/cycles/:cycleId/equipment/:assetId/…`), e o contexto
   * publicava apenas o ciclo e o equipamento. O campo faltava, e a
   * consequência era o aplicativo só conseguir **ler** um PMOC.
   *
   * `null` nos outros tipos, que não pertencem a plano nenhum.
   */
  planId: string | null;
}
export interface MobileWorkItemReadModel {
  id: string;
  kind: MobileWorkItemKind;
  sourceId: string;
  schedulingId: string | null;
  title: string;
  description: string | null;
  businessUnit: MobilePartySummaryReadModel;
  customer: MobileCustomerSummaryReadModel | null;
  location: unknown;
  /**
   * O endereço do atendimento, quando a operação aponta para um.
   *
   * Convive com `location` e não o substitui: `location` é o blob livre que a
   * operação carrega — ou, na falta dele, o endereço fiscal do cliente —, e serve
   * para abrir a rota. Este é o cadastro de para onde se vai, com as partes
   * separadas.
   */
  serviceAddress: MobileServiceAddressReadModel | null;
  /** O tipo do atendimento, já em português. A tela não traduz enum. */
  serviceType: string | null;
  /**
   * O pedido de cancelamento em aberto, quando existe.
   *
   * Publicado para que a tela saiba **parar de oferecer** a ação e mostrar que o
   * relato já foi enviado. Sem isso o técnico pediria de novo a cada vez que
   * abrisse o atendimento, sem sinal de que o primeiro chegou.
   */
  pendingCancellation: {
    id: string;
    reason: string;
    requestedAt: string;
  } | null;
  scheduledFor: string | null;
  scheduledEnd: string | null;
  timezone: string;
  dueState: MobileDueState;
  operationalStatus: string;
  priority: string | null;
  responsibleFieldTechnician: MobilePartySummaryReadModel | null;
  auxiliaryTechnicians: readonly MobilePartySummaryReadModel[];
  equipmentSummary: readonly MobileEquipmentSummaryReadModel[];
  artifacts: readonly MobileArtifactSummaryReadModel[];
  allowedActions: readonly MobileFieldAction[];
  primaryAction: MobileFieldAction | null;
  navigationContext: MobileNavigationContextReadModel;
  updatedAt: string;
}
export interface MobileWorkQueueReadModel {
  data: readonly MobileWorkItemReadModel[];
  meta: { limit: number; nextCursor: string | null; hasNextPage: boolean };
}
export interface MobileFieldSummaryReadModel {
  today: number;
  overdue: number;
  inProgress: number;
  upcoming: number;
}
export interface MobileFieldDashboardReadModel {
  next: MobileWorkItemReadModel | null;
  counters: MobileFieldSummaryReadModel;
  today: readonly MobileWorkItemReadModel[];
  overdue: readonly MobileWorkItemReadModel[];
  inProgress: readonly MobileWorkItemReadModel[];
  capabilities: { canScanEquipment: boolean; canCreateAdHocRvt: boolean };
}
/**
 * Um documento de campo já emitido, na forma curta que a tela lista.
 *
 * O suficiente para reconhecer e abrir; nada do conteúdo, nada do caminho de
 * armazenamento, nada de URL permanente.
 */
export interface MobileRecentDocumentReadModel {
  artifactId: string;
  documentType: string;
  /** Rótulo público já resolvido: a tela não traduz enum. */
  label: string;
  customerName: string | null;
  createdAt: string;
  /**
   * O que a tela pode oferecer.
   *
   * - `AVAILABLE` — há arquivo para abrir.
   * - `PREPARING` — ainda vai haver; esperar resolve.
   * - `FAILED` — não vai haver sem alguém pedir de novo. Chamar isto de
   *   "preparando" deixaria a pessoa esperando por um documento que nunca
   *   chega.
   */
  state: 'AVAILABLE' | 'PREPARING' | 'FAILED';
}

/** Um compromisso recente da agenda, para a tela inicial. */
export interface MobileRecentAppointmentReadModel {
  id: string;
  title: string;
  customerName: string | null;
  type: string;
  status: string;
  startsAt: string;
}

/**
 * A tela inicial, numa leitura.
 *
 * Agrega o que já existia — o painel do técnico — com duas listas curtas que
 * exigiriam uma chamada por item se fossem montadas no aplicativo. É
 * **agregação**, e não regra nova: cada parte continua vindo de quem já era
 * dona dela, com os mesmos filtros de permissão e o mesmo isolamento.
 */
/**
 * Um atendimento que esta pessoa já terminou.
 *
 * Não é um item de fila: a fila lista o que falta, e por isso exclui
 * concluídos. Este é o histórico curto que a tela inicial mostra.
 */
export interface MobileCompletedWorkReadModel {
  id: string;
  code: string;
  title: string;
  kind: string;
  customerName: string | null;
  equipmentName: string | null;
  completedAt: string;
}

export interface MobileFieldHomeReadModel {
  dashboard: MobileFieldDashboardReadModel;
  recentDocuments: readonly MobileRecentDocumentReadModel[];
  recentAppointments: readonly MobileRecentAppointmentReadModel[];
  /** O que já foi concluído — alimenta a aba "Concluídos" da home. */
  recentlyCompleted: readonly MobileCompletedWorkReadModel[];
}

/**
 * Uma página de documentos de campo.
 *
 * Mesma projeção de `recentDocuments`, sem o teto de cinco e com filtro por
 * tipo. Existe porque a tela de Documentos precisa listar o que a tela inicial
 * só resume — e montá-la no aplicativo custaria uma chamada por atendimento.
 */
export interface MobileDocumentsPageReadModel {
  data: readonly MobileRecentDocumentReadModel[];
  meta: { limit: number; hasNextPage: boolean; nextCursor: string | null };
}

export interface MobileAgendaReadModel {
  date: string;
  timezone: string;
  items: readonly MobileWorkItemReadModel[];
}
export interface MobileFieldContextReadModel {
  workItem: MobileWorkItemReadModel;
  request: { description: string | null };
  procedures: readonly { id: string; title: string; status: string }[];
  documentContext: readonly MobileArtifactSummaryReadModel[];
  /**
   * Quanto o atendimento vale, quando o dono liberou.
   *
   * Ausente é o padrão, e significa "não cabe a esta pessoa ver" — não "zero". A
   * liberação é por atendimento (`operations.amount_visible_in_field`), e o número é
   * o total do orçamento vinculado: não há um segundo campo de dinheiro na operação
   * que pudesse divergir dele.
   *
   * O campo existia neste contrato e no aplicativo desde o início, e **nada o
   * preenchia**. Agora preenche.
   */
  financialSummary?: {
    currency: string;
    approvedAmount: string | null;
    paymentStatus: string | null;
  };
  snapshotVersion: 1;
}

/// Um cliente que aparece na fila desta pessoa.
///
/// `workCount` é o que torna a escolha informada: filtrar por um cliente com
/// dois atendimentos é diferente de filtrar por um com trinta.
export interface MobileQueueCustomerReadModel {
  id: string;
  name: string;
  workCount: number;
}

/// Um cliente da carteira desta pessoa.
///
/// Não é o cadastro completo do CRM — é o que a tela de Clientes precisa para
/// listar e decidir: quanto trabalho há, quando foi a última vez e quando é a
/// próxima. O cadastro completo exige `customers.read`, que a role de campo
/// não tem.
export interface MobileFieldCustomerReadModel {
  id: string;
  /// O nome comercial quando existe; a razão social quando não.
  name: string;
  legalName: string;
  documentNumber: string | null;
  status: string;

  /// Quantos atendimentos **desta pessoa** com este cliente.
  openCount: number;
  completedCount: number;
  lastServiceAt: string | null;
  nextServiceAt: string | null;
}

export interface MobileFieldCustomerPageReadModel {
  data: readonly MobileFieldCustomerReadModel[];
  meta: {
    limit: number;
    hasNextPage: boolean;
    nextCursor: string | null;
  };
}
