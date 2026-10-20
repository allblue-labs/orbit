import type {
  OperationKind,
  OperationPriority,
  OperationStatus,
} from '../../contracts';

export interface OperationUserReadModel {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl: string | null;
}

export interface OperationAssignmentReadModel {
  operationId: string;
  userId: string;
  assignedById: string | null;
  assignedAt: string;
  user: OperationUserReadModel;
}

export interface OperationTechnicianAssignmentReadModel {
  userId: string;
  assignedById: string | null;
  assignedAt: string;
  user: OperationUserReadModel;
}

export type OperationAllowedAction =
  | 'VIEW'
  | 'EDIT'
  | 'START'
  | 'CHANGE_STATUS'
  | 'ADD_EVIDENCE'
  | 'GENERATE_REPORT'
  | 'MANAGE_ASSIGNMENTS';

export interface OperationAttachmentReadModel {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  checksum: string;
  uploadedById: string;
  createdAt: string;
}

export interface OperationTimelineAttachmentReadModel extends OperationAttachmentReadModel {
  operationId: string;
  uploadedBy: OperationUserReadModel | null;
}

export interface OperationHistoryReadModel {
  id: string;
  operationId: string;
  userId: string | null;
  action: string;
  fromStatus: OperationStatus | null;
  toStatus: OperationStatus | null;
  details: unknown;
  createdAt: string;
  user: OperationUserReadModel | null;
}

export interface OperationTimelineReadModel {
  events: readonly OperationHistoryReadModel[];
  attachments: readonly OperationTimelineAttachmentReadModel[];
}

export interface OperationBusinessUnitReadModel {
  id: string;
  legalName: string;
  tradeName: string | null;
}

export interface OperationCustomerReadModel {
  id: string;
  legalName: string;
  tradeName: string | null;
}

export interface OperationAssetReadModel {
  id: string;
  name: string;
  identifier: string | null;
  status: string;
}

export interface OperationChecklistReadModel {
  id: string;
  templateId: string;
  templateVersion: number;
  status: string;
  progress: number;
  completedAt: string | null;
  updatedAt: string;
}

export interface OperationCustomerAddressReadModel {
  id: string;
  label: string;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  stateCode: string | null;
  postalCode: string | null;
}

export interface OperationListItemReadModel {
  id: string;
  organizationId: string;
  businessUnitId: string;
  customerId: string | null;
  /** Para onde o técnico vai — um endereço cadastrado do cliente. */
  customerAddressId: string | null;
  /** O ponto exato dentro do endereço: "Auditório", "Sala 2". */
  sector: string | null;
  /**
   * O técnico em campo vê quanto este atendimento vale?
   *
   * Governa a visibilidade, não o número: o valor é o total do orçamento
   * vinculado, e sem orçamento não há o que mostrar mesmo ligado.
   */
  amountVisibleInField: boolean;
  code: string;
  /**
   * O número da Ordem de Serviço — contagem própria, por organização.
   *
   * `code` é o texto que o dono digita; este é o número que o documento imprime e
   * que o cliente cita. Nulo nas operações que nascem de PMOC ou RVT: elas são
   * operação, não ordem de serviço, e têm as contagens delas.
   */
  serviceOrderNumber: number | null;
  /** `OS-000087` — o mesmo número, como se lê. Nulo junto com ele. */
  serviceOrderCode: string | null;
  kind: OperationKind;
  title: string;
  description: string | null;
  status: OperationStatus;
  priority: OperationPriority;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startedAt: string | null;
  completedAt: string | null;
  responsibleFieldTechnicianId: string | null;
  responsibleFieldTechnician: OperationUserReadModel | null;
  /**
   * Quando a atribuição foi autorizada, e por quem.
   *
   * Só tem significado nas organizações que ligaram
   * `settings.operations.requireAssignmentAuthorization`. Nelas, um
   * atendimento sem carimbo não chega ao técnico — nem na fila do aplicativo,
   * nem pelas rotas de campo.
   */
  authorizedAt: string | null;
  authorizedBy: OperationUserReadModel | null;
  auxiliaryTechnicians: readonly OperationTechnicianAssignmentReadModel[];
  startedBy: OperationUserReadModel | null;
  completedBy: OperationUserReadModel | null;
  location: unknown;
  data: unknown;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  businessUnit: OperationBusinessUnitReadModel;
  customer: OperationCustomerReadModel | null;
  customerAddress: OperationCustomerAddressReadModel | null;
  /**
   * Os equipamentos do atendimento.
   *
   * Era `asset`, um só. Publicado como lista porque é o que o campo encontra:
   * o técnico vai ao endereço e atende os aparelhos que estão lá.
   */
  assets: readonly OperationAssetReadModel[];
  users: readonly OperationAssignmentReadModel[];
  attachments: readonly OperationAttachmentReadModel[];
  checklistExecutions: readonly OperationChecklistReadModel[];
  allowedActions: readonly OperationAllowedAction[];
}

/** A lista permanece compacta; somente o detalhe publica ações autoritativas. */
export type OperationDetailsReadModel = OperationListItemReadModel & {
  transitions: readonly OperationStatus[];
};

export interface OperationListReadModel {
  data: readonly OperationListItemReadModel[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/**
 * O que o campo registrou num atendimento — para quem olha da web.
 *
 * ## Por que existe
 *
 * As fotos e a assinatura do cliente eram gravadas pelo aplicativo e só apareciam
 * **dentro do PDF**. O dono acompanhava o fluxo pela plataforma e não tinha como
 * ver o que o técnico fotografou nem se o cliente assinou, a não ser emitindo o
 * documento e abrindo o arquivo — depois de o atendimento acabar.
 *
 * ## Por que num read model próprio
 *
 * Não entra no detalhe da operação porque envolve **assinar URLs** de storage, com
 * validade curta: carregá-lo em toda leitura de operação geraria assinaturas que
 * ninguém usa e encareceria a lista. Quem quer ver o registro de campo pede o
 * registro de campo.
 */
export interface OperationFieldRecordReadModel {
  evidence: readonly OperationFieldEvidenceReadModel[];
  /** `null` quando o cliente não assinou — e isso é legítimo: a assinatura é
   * desejável, não obrigatória, e há atendimentos em que não há quem assine. */
  acknowledgement: OperationFieldAcknowledgementReadModel | null;
}

/**
 * Quem registrou algo em campo — nome e id, nada mais.
 *
 * Separado de `OperationUserReadModel` de propósito: aquele carrega avatar e
 * e-mail, que esta leitura não busca. Reaproveitá-lo obrigaria a preencher campos
 * com `null` e faria a tela oferecer um avatar que nunca existiu.
 */
export interface OperationFieldActorReadModel {
  id: string;
  displayName: string;
}

export interface OperationFieldEvidenceReadModel {
  id: string;
  /** `BEFORE`, `AFTER`, `GENERAL`, `EQUIPMENT`, `DEFECT`, `MEASUREMENT`. */
  category: string;
  /** `CAMERA` ou `GALLERY` — se foi tirada na hora ou escolhida do aparelho. */
  source: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string;
  capturedAt: string | null;
  capturedBy: OperationFieldActorReadModel | null;
  /**
   * Endereço assinado e temporário da imagem.
   *
   * Do próprio storage, com host próprio: o navegador o carrega direto, sem passar
   * pela API. Expira — a tela o pede de novo quando precisar, e guardá-lo em cache
   * longo entregaria um link morto.
   */
  url: string;
  expiresAt: string;
}

export interface OperationFieldAcknowledgementReadModel {
  id: string;
  signerName: string;
  acknowledgedAt: string;
  /** Quem colheu o aceite — o técnico que estava com o aparelho. */
  capturedBy: OperationFieldActorReadModel | null;
  /** A imagem da assinatura, quando o cliente assinou na tela. */
  signature: { url: string; expiresAt: string } | null;
  /**
   * O resumo que o cliente **leu** antes de assinar, como estava naquele momento.
   *
   * Congelado de propósito: é o que dá sentido à assinatura. Recalculá-lo hoje
   * mostraria o atendimento de agora, e não o que foi aceito.
   */
  summary: unknown;
}
