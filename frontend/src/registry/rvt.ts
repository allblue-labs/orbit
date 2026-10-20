/**
 * Como o RVT aparece na tela.
 *
 * ## O modelo que a interface precisa ensinar
 *
 * ```text
 * Configuração → a regra da visita: cliente, local, periodicidade, RT
 * Ocorrência   → uma visita prevista, numerada 001..N
 * Execução     → a visita física, com N equipamentos atendidos
 * Documento    → o RVT emitido a partir da execução
 * ```
 *
 * São quatro coisas. Configuração não se visita — ocorrência se visita.
 * Ocorrência não produz documento — execução produz. E RVT **não é uma
 * Operation com outro tipo**: existe uma Operation espelhada durante a
 * execução, projeção operacional, não a entidade principal.
 *
 * Este arquivo só traduz. Nada aqui decide se uma visita pode começar, quando
 * cai a próxima ocorrência ou se o documento pode ser emitido — isso é do
 * servidor, e está em `rvt.domain.ts` do backend.
 */
import type { RvtConfigurationReadModel } from "@/types/contracts/modules/rvt/rvt.read-models";

export type RvtTone = "neutral" | "info" | "warning" | "critical" | "success";

export interface RvtPresentation {
  readonly label: string;
  readonly tone: RvtTone;
  readonly description?: string;
}

/* ------------------------------------------------------------------ */
/* Periodicidade                                                       */
/* ------------------------------------------------------------------ */

/*
  `VISIT_TYPE` saiu daqui.

  Ele traduzia dois códigos fixos — `WEEKLY` e `SEMIANNUAL` — para rótulos de
  produto. O tipo de manutenção passou a ser **cadastro da organização**: quem
  nomeia "Trimestral" é o dono da conta, e um mapa no cliente só teria como
  acertar os dois que existiam antes.

  `scheduleMode` continua aqui, e continua ortogonal: uma visita avulsa também
  tem tipo de manutenção.
*/

export const SCHEDULE_MODE: Readonly<Record<string, RvtPresentation>> = {
  RECURRING: {
    label: "Recorrente",
    tone: "info",
    description: "Gera visitas ao longo de toda a vigência.",
  },
  ONE_TIME: {
    label: "Uma única vez",
    tone: "neutral",
    description: "Uma visita só, sem repetição.",
  },
};

/* ------------------------------------------------------------------ */
/* Situação da configuração                                            */
/* ------------------------------------------------------------------ */

export const CONFIGURATION_STATUS: Readonly<Record<string, RvtPresentation>> = {
  ACTIVE: {
    label: "Ativa",
    tone: "success",
    description: "Vigente, com visitas previstas.",
  },
  INACTIVE: {
    label: "Inativa",
    tone: "neutral",
    description: "Sem novas visitas. O histórico permanece.",
  },
  COMPLETED: { label: "Concluída", tone: "neutral" },
  CANCELLED: { label: "Cancelada", tone: "neutral" },
};

/* ------------------------------------------------------------------ */
/* Ocorrência                                                          */
/* ------------------------------------------------------------------ */

export const OCCURRENCE_STATUS: Readonly<Record<string, RvtPresentation>> = {
  SCHEDULED: { label: "Prevista", tone: "info" },
  IN_PROGRESS: { label: "Em visita", tone: "info" },
  COMPLETED: { label: "Realizada", tone: "success" },
  CANCELLED: { label: "Cancelada", tone: "neutral" },
};

/**
 * Vencimento da visita — decidido pelo servidor, no fuso da configuração.
 *
 * `dueState` chega pronto porque a comparação é entre a data prevista e o
 * **hoje da unidade**. Refazer isso com `new Date()` daria respostas
 * diferentes para duas pessoas olhando a mesma visita de fusos diferentes.
 */
export const DUE_STATE: Readonly<Record<string, RvtPresentation>> = {
  UPCOMING: { label: "No prazo", tone: "neutral" },
  DUE_TODAY: { label: "Hoje", tone: "warning" },
  OVERDUE: { label: "Atrasada", tone: "critical" },
};

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

export const EXECUTION_STATUS: Readonly<Record<string, RvtPresentation>> = {
  IN_PROGRESS: { label: "Em campo", tone: "info" },
  COMPLETED: { label: "Concluída", tone: "success" },
  CANCELLED: { label: "Cancelada", tone: "neutral" },
};

/* ------------------------------------------------------------------ */
/* Documento                                                           */
/* ------------------------------------------------------------------ */

/**
 * O RVT emitido.
 *
 * `status` é o da execução de artefato; `renderStatus` é o do arquivo. São
 * dois: um documento pode estar concluído e ainda não ter PDF pronto, e
 * misturá-los faria a tela prometer download que não existe.
 */
export const DOCUMENT_STATUS: Readonly<Record<string, RvtPresentation>> = {
  DRAFT: { label: "Rascunho", tone: "neutral" },
  IN_PROGRESS: { label: "Em preenchimento", tone: "info" },
  UNDER_REVIEW: { label: "Em revisão", tone: "info" },
  COMPLETED: { label: "Emitido", tone: "success" },
  CANCELLED: { label: "Cancelado", tone: "neutral" },
};

export const RENDER_STATUS: Readonly<Record<string, RvtPresentation>> = {
  PENDING: { label: "Aguardando geração", tone: "neutral" },
  QUEUED: { label: "Na fila", tone: "info" },
  RUNNING: { label: "Gerando", tone: "info" },
  READY: { label: "Disponível", tone: "success" },
  FAILED: { label: "Falhou", tone: "critical" },
};

/* ------------------------------------------------------------------ */
/* Bloqueios                                                           */
/* ------------------------------------------------------------------ */

/**
 * Por que esta ocorrência ainda não pode virar visita.
 *
 * Os códigos vêm de `occurrences/:id/preparation`. Os de assinatura pertencem
 * ao domínio profissional (PR-27) e continuam traduzidos lá — repeti-los aqui
 * manteria dois mapas divergindo. Quem não estiver neste mapa cai lá, e só
 * então no texto genérico.
 */
export const OCCURRENCE_BLOCKED_REASONS: Readonly<Record<string, string>> = {
  OCCURRENCE_CANCELLED: "Esta visita foi cancelada.",
  OCCURRENCE_ALREADY_EXECUTED: "Esta visita já foi realizada.",
  FIELD_TECHNICIAN_NOT_ELIGIBLE:
    "O Técnico em Campo previsto não está elegível para assinar o RVT.",
};

/* ------------------------------------------------------------------ */
/* Acessores                                                           */
/* ------------------------------------------------------------------ */

const FALLBACK: RvtPresentation = { label: "—", tone: "neutral" };

function lookup(
  map: Readonly<Record<string, RvtPresentation>>,
  value: string | null | undefined,
): RvtPresentation {
  if (!value) return FALLBACK;
  /** Código desconhecido não vira rótulo: decifrar o sistema não é tarefa do usuário. */
  return map[value] ?? FALLBACK;
}

export const scheduleMode = (value: string | null | undefined) =>
  lookup(SCHEDULE_MODE, value);
export const configurationStatus = (value: string | null | undefined) =>
  lookup(CONFIGURATION_STATUS, value);
export const occurrenceStatus = (value: string | null | undefined) =>
  lookup(OCCURRENCE_STATUS, value);
export const dueState = (value: string | null | undefined) =>
  lookup(DUE_STATE, value);
export const executionStatus = (value: string | null | undefined) =>
  lookup(EXECUTION_STATUS, value);
export const documentStatus = (value: string | null | undefined) =>
  lookup(DOCUMENT_STATUS, value);
export const renderStatus = (value: string | null | undefined) =>
  lookup(RENDER_STATUS, value);

/**
 * A periodicidade em uma frase.
 *
 * Avulsa é avulsa: quando não há repetição, o tipo da visita não é o que
 * descreve a agenda, e anunciar "Semanal" para uma visita única seria
 * simplesmente falso.
 */
export function recurrenceLabel(
  configuration: Pick<
    RvtConfigurationReadModel,
    "scheduleMode" | "maintenanceType"
  >,
): string {
  if (configuration.scheduleMode === "ONE_TIME")
    return SCHEDULE_MODE.ONE_TIME!.label;
  /** O rótulo que a organização deu ao ritmo — não um mapa no cliente. */
  return configuration.maintenanceType?.label ?? "Recorrente";
}

/** Visita avulsa é derivada de `ONE_TIME` — não é um enum de produto. */
export const isOneTime = (
  configuration: Pick<RvtConfigurationReadModel, "scheduleMode">,
): boolean => configuration.scheduleMode === "ONE_TIME";

/**
 * A frase de um bloqueio, em português.
 *
 * Encadeia com o mapa profissional pelo mesmo motivo do PMOC: motivo de
 * assinatura pertence à PR-27 e continua sendo traduzido lá. O fallback é
 * desta tela — deixar um código de RVT cair na frase de outro domínio foi
 * exatamente o erro corrigido na FE-03.
 */
export function occurrenceBlockedLabel(
  reason: string,
  professionalFallback: (code: string) => string | null,
): string {
  return (
    OCCURRENCE_BLOCKED_REASONS[reason] ??
    professionalFallback(reason) ??
    "Visita indisponível no momento."
  );
}

/**
 * A cadência de um tipo, em palavras.
 *
 * "a cada 3 meses", e não "90 dias": três meses civis vão de 89 a 92 dias
 * conforme a data de partida, e anunciar dias transformaria calendário em
 * contagem — que é o erro que o tipo existe para evitar.
 */
export function cadenciaDe(tipo: {
  intervalDays: number | null;
  intervalMonths: number | null;
}): string {
  if (tipo.intervalMonths) {
    return tipo.intervalMonths === 1
      ? "a cada mês"
      : `a cada ${tipo.intervalMonths} meses`;
  }
  if (tipo.intervalDays) {
    return tipo.intervalDays === 1
      ? "todo dia"
      : `a cada ${tipo.intervalDays} dias`;
  }
  return "sem cadência definida";
}
