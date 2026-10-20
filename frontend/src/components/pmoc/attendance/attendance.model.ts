/**
 * O atendimento de um equipamento, como decisão de dados.
 *
 * ## O que este módulo resolve
 *
 * Um atendimento de PMOC tem quatro requisições encadeadas — abrir, anexar
 * evidência, concluir, emitir o documento — e a pergunta difícil não é o desenho:
 * é **em que passo a pessoa está** e **o que falta para avançar**. Isso é função
 * de dados, e em teste é onde essas regras se provam.
 *
 * ## A autoridade é do servidor
 *
 * `allowedActions` vem da preparação já resolvida: `START` quando nada bloqueia e
 * nada foi aberto, `COMPLETE`/`ADD_EVIDENCE` enquanto corre, `VIEW` depois.
 * Deduzir isso do status reconstruiria no navegador a máquina de estados que o
 * servidor publica pronta — e ela envelheceria na primeira mudança do domínio.
 *
 * Aqui só se **lê** essa resposta e se traduz em qual passo mostrar.
 */
import type { PmocExecutionPreparation } from "@/types/pmoc";

/**
 * Os passos do atendimento.
 *
 * `emitir` é separado de `concluir` porque são duas decisões: a manutenção
 * aconteceu, e o documento sai. O servidor as separa também — concluir não emite
 * — e juntá-las na tela esconderia que um relatório pode ser emitido depois.
 */
export const ATTENDANCE_STEPS = [
  "escalar",
  "roteiro",
  "concluir",
  "emitir",
] as const;

export type AttendanceStep = (typeof ATTENDANCE_STEPS)[number];

export const STEP_TITLES: Readonly<Record<AttendanceStep, string>> = {
  escalar: "Quem atende",
  roteiro: "Roteiro e evidências",
  concluir: "Registrar a manutenção",
  emitir: "Emitir o relatório",
};

/** O que a pessoa preenche ao longo do atendimento. */
export interface AttendanceDraft {
  readonly responsibleFieldTechnicianId: string | null;
  readonly auxiliaryTechnicianIds: readonly string[];
  /** `YYYY-MM-DDTHH:mm` do input local, ou vazio para "agora". */
  readonly performedAt: string;
  readonly notes: string;
  /** A pessoa percorreu o roteiro. Não é dado do servidor — é confirmação. */
  readonly reviewedProcedure: boolean;
}

export function emptyDraft(
  suggestedTechnicianId: string | null,
): AttendanceDraft {
  return {
    /*
     * Sugere quem o plano já indicou, quando indicou.
     *
     * Começar vazio faria todo atendimento pedir uma escolha cuja resposta é
     * quase sempre a mesma — e num ciclo de vinte equipamentos, vinte vezes.
     */
    responsibleFieldTechnicianId: suggestedTechnicianId,
    auxiliaryTechnicianIds: [],
    performedAt: "",
    notes: "",
    reviewedProcedure: false,
  };
}

/* ------------------------------------------------------------------ */
/* Onde a pessoa está                                                  */
/* ------------------------------------------------------------------ */

/**
 * O passo de **entrada**, dado o que o servidor permite agora.
 *
 * `START` → escalar. `COMPLETE` → o roteiro, de onde o wizard avança para
 * concluir sem consultar o servidor: os dois passos são o mesmo estado lá
 * (`IN_PROGRESS`), e a diferença entre eles é só o que a pessoa ainda vai
 * preencher. Resolvida → emitir, que é onde o atendimento termina, com o
 * documento emitido ou pendente.
 *
 * É a preparação que decide o estado; a tela não deduz de `status`.
 */
export function currentStep(
  preparation: PmocExecutionPreparation,
): AttendanceStep {
  const acoes = preparation.allowedActions;
  if (acoes.includes("START")) return "escalar";
  if (acoes.includes("COMPLETE")) return "roteiro";
  return "emitir";
}

/**
 * O atendimento já terminou por completo.
 *
 * Concluído **e** com documento emitido. Sem o documento, o trabalho existe e a
 * prova de conformidade não — e é a prova que o cliente guarda.
 */
export function isFinished(preparation: PmocExecutionPreparation): boolean {
  const execucao = preparation.existingExecution;
  return Boolean(
    execucao &&
      execucao.status === "COMPLETED" &&
      execucao.artifactExecution !== null,
  );
}

/* ------------------------------------------------------------------ */
/* O que falta                                                         */
/* ------------------------------------------------------------------ */

/**
 * O que impede de avançar, em frases.
 *
 * Lista e não booleano: "não é possível avançar" manda a pessoa procurar o que
 * está errado. Cada frase diz o campo e o que fazer.
 */
export function stepIssues(
  step: AttendanceStep,
  draft: AttendanceDraft,
  preparation: PmocExecutionPreparation,
): readonly string[] {
  const issues: string[] = [];

  switch (step) {
    case "escalar": {
      if (!draft.responsibleFieldTechnicianId) {
        issues.push("Escolha o técnico que vai atender este equipamento.");
      }
      /*
       * O bloqueio do servidor entra aqui como frase.
       *
       * Ele já traduziu os motivos — responsável técnico sem assinatura, plano
       * suspenso, equipamento inativo. Repetir a regra no navegador criaria uma
       * segunda autoridade; o que se faz é mostrar a dele.
       */
      if (!preparation.eligibility.ready) {
        issues.push(
          "O servidor não liberou esta execução — veja os motivos acima.",
        );
      }
      break;
    }

    case "roteiro":
      if (!draft.reviewedProcedure) {
        issues.push(
          "Confirme que percorreu o roteiro antes de registrar a manutenção.",
        );
      }
      break;

    case "concluir":
      if (draft.performedAt && isFuture(draft.performedAt)) {
        /* O servidor recusa data no futuro. Dizer aqui poupa a requisição e
           explica melhor que o 400 que voltaria. */
        issues.push(
          "A manutenção não pode ser registrada no futuro — ela ainda não aconteceu.",
        );
      }
      break;

    case "emitir":
      break;
  }

  return issues;
}

/**
 * A data escolhida está no futuro?
 *
 * Um minuto de tolerância, como o servidor: relógios de máquinas diferentes não
 * batem no segundo, e recusar por causa disso seria recusar o caminho correto.
 */
export function isFuture(local: string, now = Date.now()): boolean {
  const escolhido = new Date(local).getTime();
  if (Number.isNaN(escolhido)) return false;
  return escolhido > now + 60_000;
}

/* ------------------------------------------------------------------ */
/* O que vai no pedido                                                 */
/* ------------------------------------------------------------------ */

export function startPayload(draft: AttendanceDraft) {
  return {
    responsibleFieldTechnicianId: draft.responsibleFieldTechnicianId!,
    /* Auxiliar igual ao responsável seria a mesma pessoa duas vezes; o servidor
       filtra, e mandar limpo evita depender disso. */
    auxiliaryTechnicianIds: draft.auxiliaryTechnicianIds.filter(
      (id) => id !== draft.responsibleFieldTechnicianId,
    ),
  };
}

export function completePayload(draft: AttendanceDraft) {
  return {
    /* Vazio significa **agora**, e é o servidor que resolve o "agora" — o relógio
       do navegador pode estar errado, e a hora da manutenção é registro legal. */
    performedAt: draft.performedAt
      ? new Date(draft.performedAt).toISOString()
      : undefined,
    notes: draft.notes.trim() || undefined,
  };
}
