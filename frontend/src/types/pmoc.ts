/**
 * Contratos do PMOC V2.
 *
 * Quatro conceitos, quatro tipos — a separação que a interface precisa
 * preservar:
 *
 * ```text
 * PmocPlan            configuração: cobertura, periodicidade, RT
 * PmocCycle           competência com vencimento
 * PmocEquipmentExecution  manutenção física de um equipamento
 * artifactExecution   documento emitido daquele equipamento
 * ```
 *
 * O backend chama o ciclo de `PmocExecutionReadModel`; aqui ele é `PmocCycle`.
 * Não é renomear por gosto: "execução" no PMOC V2 passou a significar a
 * manutenção física de um equipamento, e manter os dois com o mesmo nome
 * garantiria a confusão que este domínio existe para evitar.
 */
import type {
  PmocCodeSuggestionReadModel,
  PmocContractSignatureResultReadModel,
  PmocPublicContractReadModel,
  PmocSignatureLinkReadModel,
  PmocSignatureLinkStateReadModel,
  PmocPreviewReadModel,
  PmocPreviewMatrixRowReadModel,
  PmocComplianceSummaryReadModel,
  PmocCoverageReadModel,
  PmocCursorPageReadModel,
  PmocEquipmentExecutionReadModel,
  PmocExecutionReadModel,
  PmocPlanReadModel,
  PmocPlanSummaryReadModel,
  PmocTimelineItemReadModel,
  PmocUnitReadModel,
  PmocUpcomingReadModel,
} from "./contracts/modules/pmoc/pmoc.read-models";

export type PmocPlanSummary = PmocPlanSummaryReadModel;
export type PmocCodeSuggestion = PmocCodeSuggestionReadModel;
export type PmocPreview = PmocPreviewReadModel;
export type PmocPreviewMatrixRow = PmocPreviewMatrixRowReadModel;
export type PmocPlan = PmocPlanReadModel;
export type PmocCoverage = PmocCoverageReadModel;
export type PmocCycle = PmocExecutionReadModel;
export type PmocEquipmentExecution = PmocEquipmentExecutionReadModel;

/* ---------------------------------------------------------------- */
/* Assinatura do contrato por link temporário                        */
/* ---------------------------------------------------------------- */

export type PmocSignatureLink = PmocSignatureLinkReadModel;
export type PmocSignatureLinkState = PmocSignatureLinkStateReadModel;
export type PmocPublicContract = PmocPublicContractReadModel;
export type PmocContractSignatureResult =
  PmocContractSignatureResultReadModel;

/**
 * O que a página pública envia ao assinar.
 *
 * `signatureBase64` e não um `Blob`: a rota é JSON, e o backend confere o cabeçalho
 * PNG antes de guardar. O prefixo `data:image/png;base64,` é aceito, que é
 * exatamente o que `canvas.toDataURL` produz.
 */
export interface SignPmocContractInput {
  signerName: string;
  signerDocument?: string;
  signerEmail?: string;
  signatureBase64: string;
}

/**
 * Uma linha de `GET .../cycles/:cycleId/equipment-executions`.
 *
 * **Espelhado, não sincronizado.** O endpoint não devolve
 * `PmocEquipmentExecutionReadModel[]`: ele devolve a **cobertura do ciclo** —
 * todo equipamento coberto, com a execução dentro quando existe. É a forma
 * certa, e é melhor que a suposta: a lista já responde "quais equipamentos" e
 * "quais foram feitos" numa consulta, sem o cliente cruzar cobertura com
 * execuções.
 *
 * `status` é `NOT_STARTED` enquanto ninguém executou; a partir daí espelha o
 * status da execução. Registrado como lacuna de contrato em
 * `docs/pmoc-v2-web.md` — o backend não publica Read Model para esta linha.
 */
export interface PmocCycleEquipmentRow {
  coverageId: string;
  equipment: {
    id: string;
    name: string;
    category: string;
    identifier: string | null;
    serialNumber: string | null;
    status: string;
  };
  execution: PmocEquipmentExecution | null;
  /** `NOT_STARTED` ou o status da execução aberta. */
  status: string;
  /**
   * O que impede este equipamento de começar agora.
   *
   * Mesma função do domínio que alimenta a preparação — a lista deixou de
   * pedir a preparação inteira por linha só para saber disso. É leitura, e
   * leitura envelhece: quem autoriza continua sendo o comando de início, que
   * revalida contra o estado do momento.
   */
  eligibility: PmocExecutionEligibility;
}

export interface PmocExecutionEligibility {
  ready: boolean;
  blockedReasons: readonly string[];
}
export type PmocTimelineItem = PmocTimelineItemReadModel;
export type PmocComplianceSummary = PmocComplianceSummaryReadModel;
export type PmocUpcoming = PmocUpcomingReadModel;
export type PmocCursorPage<T> = PmocCursorPageReadModel<T>;

/** `GET /pmoc/plans` — os filtros que o `PmocPlanQueryDto` aceita. */
export interface PmocPlanQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  businessUnitId?: string;
  customerId?: string;
}

/** `GET /pmoc/plans/:id/equipment-page` — cursor, não offset. */
export interface PmocCoveragePageQuery {
  cursor?: string;
  limit?: number;
  search?: string;
  assetStatus?: "ACTIVE" | "INACTIVE";
}

export interface PmocTimelineQuery {
  cursor?: string;
  limit?: number;
}

/** `POST /pmoc/plans` — exatamente os campos do `CreatePmocPlanDto`. */
export interface CreatePmocPlanInput {
  businessUnitId: string;
  customerId: string;
  /**
   * Omitir é o caminho canônico: o backend aloca o próximo da sequência do
   * cliente dentro da transação, e criações simultâneas não colidem. Enviar
   * significa "este código é meu, não gere".
   */
  code?: string;
  name: string;
  startsOn: string;
  endsOn?: string;
  frequencyAmount: number;
  frequencyUnit: string;
  dueSoonDays?: number;
  technicianUserId?: string;
  technicalResponsibleUserId?: string;
  serviceLocation?: Record<string, unknown>;
  scope?: Record<string, unknown>;
  serviceTypes?: string[];
  procedure?: Record<string, unknown>;
  schedulingPaused?: boolean;
  reviewRequired?: boolean;
  notes?: string;
  /** Equipamentos que participam; plano e coberturas nascem juntos. */
  assetIds?: string[];
}

/** Entrada do preview: vigência como duração, que é como a tela pergunta. */
export interface PmocPreviewInput {
  businessUnitId: string;
  customerId: string;
  startsOn: string;
  endsOn?: string;
  coverageAmount?: number;
  coverageUnit?: string;
  frequencyAmount: number;
  frequencyUnit: string;
  assetIds?: string[];
}

export type UpdatePmocPlanInput = Partial<
  Omit<CreatePmocPlanInput, "businessUnitId" | "customerId" | "code">
>;

/**
 * O que o servidor responde antes de executar um equipamento.
 *
 * **Espelhado, não sincronizado.** O backend monta este objeto no serviço e
 * não publica Read Model para ele — não há `PmocExecutionPreparationReadModel`
 * em `pmoc.read-models.ts`. O tipo abaixo reproduz o payload real de
 * `GET /pmoc/plans/:id/cycles/:cycleId/equipment/:assetId/execution-preparation`.
 *
 * A consequência é a mesma de `SchedulingEventDetail`: uma mudança no serviço
 * não quebra a compilação aqui, quebra em runtime. Está registrado como
 * lacuna de contrato em `docs/pmoc-v2-web.md`; cada acesso é tolerante a nulo.
 *
 * É esta resposta — e só ela — que decide se a execução pode começar.
 */
export interface PmocExecutionPreparation {
  plan: { id: string; code: string; name: string; reviewRequired: boolean };
  cycle: { id: string; dueOn: string; status: string; sequenceNumber?: number };
  customer: { id: string; name: string };
  equipment: {
    id: string;
    name: string;
    category?: string;
    identifier?: string | null;
    serialNumber?: string | null;
    status?: string;
  };
  serviceLocation: unknown;
  scope: unknown;
  serviceTypes: unknown;
  /** O JSON cru, como o plano o guarda. A tela usa `procedureGroups`. */
  procedure: unknown;
  /**
   * O roteiro já lido pelo servidor, em grupos.
   *
   * `procedure` é JSON livre com duas formas em produção, e o leitor tolerante
   * mora no backend — o mesmo que o documento usa. Ler de novo aqui produziria
   * um segundo leitor, e no dia em que divergissem a tela mostraria um roteiro e
   * o PDF imprimiria outro.
   */
  procedureGroups: readonly { group: string; items: readonly string[] }[];
  technicalResponsible: { id: string; displayName: string } | null;
  technicalResponsibleEligibility: {
    eligible: boolean;
    blockedReason: string | null;
    signatureAvailable: boolean;
  } | null;
  fieldTechnicians: readonly {
    id: string;
    name: string;
    signatureAvailable: boolean;
  }[];
  auxiliaryTechnicians: readonly {
    id: string;
    name: string;
    signatureAvailable: boolean;
  }[];
  /**
   * A decisão, e o motivo quando é "não".
   *
   * `ready` é a resposta; `blockedReasons` explica. Vazio significa liberado.
   * Cada código é traduzido em `registry/pmoc.ts` — nenhum chega à tela cru.
   */
  eligibility: PmocExecutionEligibility;
  evidencePolicy: {
    minimumPhotos: number;
    maximumPhotos: number;
    acceptedKinds: readonly string[];
  };
  documentPolicy: { artifactType: string } & Record<string, unknown>;
  /** O vencimento e o fuso em que ele foi resolvido — do servidor, não do navegador. */
  suggestedExecutionTime: { dueOn: string; timezone: string };
  /** A execução já aberta para este equipamento neste ciclo, se houver. */
  existingExecution: PmocEquipmentExecution | null;
  /**
   * O que se pode fazer agora — decidido pelo servidor.
   *
   * `START` quando nada bloqueia e nada foi aberto; `COMPLETE`/`ADD_EVIDENCE`
   * enquanto a execução corre; `VIEW` depois. A tela lê; não deduz de status.
   */
  allowedActions: readonly string[];
}

/**
 * `POST /pmoc/plans/:id/cycles/:cycleId/equipment/:assetId/executions`.
 *
 * Abrir a execução **escala** alguém: o técnico em campo responde por ela, e é o
 * nome dele que o documento carrega. Auxiliares são opcionais e não assinam.
 */
export interface StartPmocExecutionInput {
  responsibleFieldTechnicianId: string;
  auxiliaryTechnicianIds?: readonly string[];
}

/**
 * `POST .../equipment-executions/:executionId/complete`.
 *
 * `performedAt` ausente significa agora. O servidor recusa data no futuro — uma
 * manutenção que ainda não aconteceu não se registra como feita.
 */
export interface CompletePmocExecutionInput {
  performedAt?: string;
  notes?: string;
}

/**
 * Um nome sugerido para o plano (`GET /pmoc/plan-name-options`).
 *
 * Catálogo da plataforma. Quem precisa de um nome fora dele escolhe "Outros"
 * e digita o seu — esse texto vai para `PmocPlan.name` e não entra aqui.
 */
export interface PmocPlanNameOption {
  key: string;
  label: string;
}

/**
 * Uma unidade do sistema que recebe manutenção.
 *
 * Condensadora, evaporadora, dutos. **Não é equipamento**: `Asset` é a
 * máquina sob contrato; unidade é a parte dela que recebe manutenção, e é
 * por unidade que o relatório final descreve o serviço.
 */
export type PmocUnit = PmocUnitReadModel;

export interface CreatePmocUnitInput {
  key: string;
  name: string;
  description?: string;
  checklistTemplateId?: string;
  sortOrder?: number;
}

export type UpdatePmocUnitInput = Partial<CreatePmocUnitInput> & {
  isActive?: boolean;
};
