/**
 * Como o PMOC aparece na tela.
 *
 * ## O modelo que a interface precisa ensinar
 *
 * ```text
 * Configuração  → o contrato de manutenção: cobertura, periodicidade, RT
 * Ciclo         → uma competência com vencimento
 * Execução      → a manutenção física de UM equipamento
 * Documento     → o PMOC emitido por equipamento executado
 * ```
 *
 * São quatro coisas, não uma. Configuração não vence — ciclo vence.
 * Configuração não se executa — equipamento se executa. E documento é por
 * equipamento executado, nunca do ciclo inteiro: o técnico atendeu cinco
 * máquinas, e são cinco documentos.
 *
 * Este arquivo só traduz. Nada aqui decide se um plano pode ser ativado, se um
 * ciclo venceu ou se uma execução pode começar — isso é do servidor, e está
 * em `pmoc.domain.ts` do backend.
 */
import type {
  PmocComplianceStatus,
  PmocEquipmentExecutionStatus,
  PmocExecutionStatus,
  PmocPlanStatus,
} from "@/types/contracts";

/** Aparência semântica compartilhada — o mesmo vocabulário do resto do produto. */
export type PmocTone = "neutral" | "info" | "warning" | "critical" | "success";

export interface PmocPresentation {
  readonly label: string;
  readonly tone: PmocTone;
  readonly description?: string;
}

/* ------------------------------------------------------------------ */
/* Configuração                                                        */
/* ------------------------------------------------------------------ */

/**
 * O estado do **contrato de manutenção**, não da manutenção.
 *
 * Um plano suspenso continua existindo e continua com histórico; o que ele
 * deixa de fazer é gerar ciclo novo. Por isso "Suspenso" é aviso, não erro.
 *
 * ## O que o tom responde
 *
 * "Este plano está trabalhando?" — e é essa pergunta que a cor responde na coluna
 * Situação, de longe:
 *
 * - **Ativo** verde: gerando ciclo.
 * - **Suspenso** âmbar: parado, e volta.
 * - **Cancelado** vermelho: parado, e não volta. Vermelho aqui não é atraso — atraso
 *   é o selo de conformidade, que é outro chip na mesma linha. É encerramento por
 *   decisão, e distingui-lo de "Encerrado" importa: um é escolha, o outro é prazo.
 * - **Rascunho** e **Encerrado** cinza: não estão trabalhando e nada há a fazer. Um é
 *   "ainda não", o outro é "já foi"; nenhum dos dois pede atenção, e pintá-los
 *   gastaria cor onde não há decisão a tomar.
 */
export const PLAN_STATUS: Readonly<Record<PmocPlanStatus, PmocPresentation>> = {
  DRAFT: {
    label: "Rascunho",
    tone: "neutral",
    description: "Ainda não vigente. Nenhum ciclo é gerado.",
  },
  ACTIVE: {
    label: "Ativo",
    tone: "success",
    description: "Vigente, gerando ciclos conforme a periodicidade.",
  },
  SUSPENDED: {
    label: "Suspenso",
    tone: "warning",
    description: "Sem novos ciclos até ser reativado. O histórico permanece.",
  },
  EXPIRED: {
    label: "Encerrado",
    tone: "neutral",
    description: "A vigência terminou.",
  },
  CANCELLED: {
    label: "Cancelado",
    tone: "critical",
    description: "Encerrado definitivamente. Os ciclos cumpridos permanecem.",
  },
};

/* ------------------------------------------------------------------ */
/* Conformidade — do plano, calculada pelo servidor                    */
/* ------------------------------------------------------------------ */

/**
 * "Em dia", "Vence em breve", "Atrasado".
 *
 * Quem decide é o backend, comparando `next_due_on` com a **data do servidor**.
 * A tela nunca recalcula com `new Date()`: o relógio do navegador está no fuso
 * de quem abriu, e o vencimento é do fuso da unidade. Duas pessoas veriam
 * estados diferentes para o mesmo plano.
 */
export const COMPLIANCE_STATUS: Readonly<
  Record<PmocComplianceStatus, PmocPresentation>
> = {
  UP_TO_DATE: { label: "Em dia", tone: "success" },
  DUE_SOON: { label: "Vence em breve", tone: "warning" },
  OVERDUE: { label: "Atrasado", tone: "critical" },
  NOT_APPLICABLE: { label: "Sem vencimento", tone: "neutral" },
};

/* ------------------------------------------------------------------ */
/* Ciclo                                                               */
/* ------------------------------------------------------------------ */

/** A competência: pendente, cumprida ou cancelada. */
export const CYCLE_STATUS: Readonly<
  Record<PmocExecutionStatus, PmocPresentation>
> = {
  PENDING: { label: "Pendente", tone: "info" },
  COMPLETED: { label: "Concluído", tone: "success" },
  CANCELLED: { label: "Cancelado", tone: "neutral" },
};

/* ------------------------------------------------------------------ */
/* Execução por equipamento                                            */
/* ------------------------------------------------------------------ */

/**
 * A manutenção física de um equipamento.
 *
 * `IN_PROGRESS` é "Em execução" — o técnico abriu o atendimento daquela
 * máquina. Não é "em andamento" genérico de ordem de serviço: PMOC tem
 * vocabulário próprio, e misturá-lo com Operations confundiria duas coisas
 * que o domínio separa.
 */
export const EQUIPMENT_EXECUTION_STATUS: Readonly<
  Record<PmocEquipmentExecutionStatus, PmocPresentation>
> = {
  IN_PROGRESS: { label: "Em execução", tone: "info" },
  COMPLETED: { label: "Concluída", tone: "success" },
  CANCELLED: { label: "Cancelada", tone: "neutral" },
};

/* ------------------------------------------------------------------ */
/* Bloqueios de execução                                               */
/* ------------------------------------------------------------------ */

/**
 * Por que este equipamento ainda não pode ser executado.
 *
 * Os códigos vêm de `GET .../execution-preparation`, que é a autoridade: o
 * servidor monta a lista olhando plano, ciclo, equipamento e a elegibilidade
 * do Responsável Técnico. A tela traduz e **não** recalcula — nem para
 * "ajudar", nem para antecipar.
 *
 * Os motivos de assinatura vêm do domínio profissional (PR-27) e já têm
 * tradução em `registry/professional.ts`; repeti-los aqui manteria dois mapas
 * divergindo. Quem não estiver neste mapa cai lá, e só então no texto
 * genérico.
 */
export const EXECUTION_BLOCKED_REASONS: Readonly<Record<string, string>> = {
  PLAN_NOT_ACTIVE:
    "O plano não está ativo. Reative-o para executar manutenções.",
  CYCLE_NOT_PENDING: "Este ciclo já foi encerrado.",
  EQUIPMENT_INACTIVE: "O equipamento está inativo no cadastro.",
  TECHNICAL_RESPONSIBLE_MISSING:
    "O plano não tem Responsável Técnico definido.",
  TECHNICAL_RESPONSIBLE_INELIGIBLE:
    "O Responsável Técnico do plano não está elegível para assinar o PMOC.",
};

/* ------------------------------------------------------------------ */
/* Documento                                                           */
/* ------------------------------------------------------------------ */

/**
 * O PMOC emitido de um equipamento.
 *
 * `artifactExecution` no Read Model: existe quando há documento, e o `status`
 * é o da execução de artefato. A ausência não é falha — é o estado normal de
 * quem ainda não concluiu a manutenção.
 */
export const DOCUMENT_STATUS: Readonly<Record<string, PmocPresentation>> = {
  DRAFT: { label: "Rascunho", tone: "neutral" },
  IN_PROGRESS: { label: "Em preenchimento", tone: "info" },
  UNDER_REVIEW: { label: "Em revisão", tone: "info" },
  COMPLETED: { label: "Emitido", tone: "success" },
  CANCELLED: { label: "Cancelado", tone: "neutral" },
};

/* ------------------------------------------------------------------ */
/* Acessores                                                           */
/* ------------------------------------------------------------------ */

const FALLBACK: PmocPresentation = { label: "—", tone: "neutral" };

function lookup<T extends string>(
  map: Readonly<Record<string, PmocPresentation>>,
  value: T | string | null | undefined,
): PmocPresentation {
  if (!value) return FALLBACK;
  /**
   * Código desconhecido não vira rótulo.
   *
   * Mostrar `SOMETHING_NEW` empurraria para o usuário a tarefa de decifrar o
   * sistema. O traço é honesto, e a falta aparece no teste do registry.
   */
  return map[value] ?? FALLBACK;
}

export const planStatus = (value: string | null | undefined) =>
  lookup(PLAN_STATUS, value);
export const complianceStatus = (value: string | null | undefined) =>
  lookup(COMPLIANCE_STATUS, value);
export const cycleStatus = (value: string | null | undefined) =>
  lookup(CYCLE_STATUS, value);
export const equipmentExecutionStatus = (value: string | null | undefined) =>
  lookup(EQUIPMENT_EXECUTION_STATUS, value);
export const documentStatus = (value: string | null | undefined) =>
  lookup(DOCUMENT_STATUS, value);

/**
 * A frase de um bloqueio, em português.
 *
 * Encadeia com o mapa profissional: motivos de assinatura pertencem à PR-27 e
 * continuam sendo traduzidos lá.
 */
export function executionBlockedLabel(
  reason: string,
  professionalFallback: (code: string) => string | null,
): string {
  return (
    EXECUTION_BLOCKED_REASONS[reason] ??
    professionalFallback(reason) ??
    "Execução indisponível no momento."
  );
}
