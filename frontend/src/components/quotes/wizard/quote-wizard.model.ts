/**
 * O rascunho do wizard e as regras que decidem o que dá para avançar.
 *
 * ## Por que módulo puro
 *
 * O que se erra num formulário de seis passos não é o desenho: é quando liberar
 * o botão, o que exatamente vai no `POST`, e em que ordem. Aqui isso é função de
 * dados — testável sem navegador, e em teste é onde essas regras se provam.
 *
 * A interface não decide nada disso. Ela mostra o que `stepIssues` diz que falta
 * e chama `submissionPlan` quando a pessoa aprova.
 *
 * ## O orçamento nasce no fim
 *
 * Criar a proposta no passo 2 e ir editando deixaria um rascunho órfão para cada
 * wizard abandonado — e abandonar um formulário de seis passos é comum. O
 * rascunho vive na memória até a aprovação; só então vira `POST`.
 *
 * O custo é que a criação não é atômica: o contrato cria a proposta vazia e
 * recebe os itens um a um, de propósito (ver `CreateQuoteDto`). `submissionPlan`
 * devolve os passos em ordem para que quem executa saiba **onde** parou se algo
 * falhar no meio — e o que restar é um `DRAFT` editável, não lixo.
 */
import type {
  AddQuoteItemInput,
  CreateQuoteInput,
  UpdateQuoteInput,
} from "@/types/quotes";

/** De onde vêm os dados da proposta. Do zero é o padrão. */
export type QuoteOrigin = "SCRATCH" | "OPERATION";

/**
 * Um item do rascunho.
 *
 * `catalogItemId` nulo é item digitado à mão, que o contrato aceita desde que
 * tenha descrição e preço. `kind` serve ao agrupamento na tela; o servidor
 * congela o dele a partir do Catálogo.
 */
export interface DraftItem {
  /** Chave local. O item ainda não existe no servidor. */
  readonly key: string;
  readonly catalogItemId: string | null;
  readonly kind: "SERVICE" | "PRODUCT" | "PART";
  readonly description: string;
  readonly unit: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

export interface QuoteDraft {
  readonly origin: QuoteOrigin;
  /** Atendimento de origem, quando `origin` é `OPERATION`. */
  readonly operationId: string | null;
  readonly customerId: string | null;
  readonly customerLabel: string | null;
  readonly serviceAddressId: string | null;
  readonly assetIds: readonly string[];
  readonly title: string;
  readonly notes: string;
  /** Vazio significa "usar o padrão do documento", não "sem abertura". */
  readonly introText: string;
  /** `YYYY-MM-DD`. Validade é dia, não instante. */
  readonly validUntil: string;
  readonly items: readonly DraftItem[];
  readonly discount: number;
  readonly discountReason: string;
  readonly responsibleUserId: string | null;
  /** A pessoa revisou o resumo. Sem isso não se gera nada. */
  readonly approved: boolean;
}

export const WIZARD_STEPS = [
  "origem",
  "dados",
  "itens",
  "valores",
  "responsavel",
  "resumo",
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export const STEP_TITLES: Readonly<Record<WizardStep, string>> = {
  origem: "Origem dos dados",
  dados: "Dados gerais",
  itens: "Serviços e materiais",
  valores: "Valores",
  responsavel: "Responsável técnico",
  resumo: "Resumo",
};

/**
 * Validade sugerida: trinta dias.
 *
 * É o padrão comercial mais comum, e uma proposta sem validade não pode ser
 * enviada — o contrato exige `validUntil` para `canSend`. Deixar vazio faria a
 * pessoa descobrir isso no último passo.
 */
export const DEFAULT_VALIDITY_DAYS = 30;

export function inDays(days: number, from = new Date()): string {
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function emptyDraft(responsibleUserId: string | null): QuoteDraft {
  return {
    origin: "SCRATCH",
    operationId: null,
    customerId: null,
    customerLabel: null,
    serviceAddressId: null,
    assetIds: [],
    title: "",
    notes: "",
    introText: "",
    validUntil: inDays(DEFAULT_VALIDITY_DAYS),
    items: [],
    discount: 0,
    discountReason: "",
    /* Quem está usando o sistema responde, até dizer outro. */
    responsibleUserId,
    approved: false,
  };
}

/* ------------------------------------------------------------------ */
/* Dinheiro                                                            */
/* ------------------------------------------------------------------ */

export interface DraftTotals {
  readonly subtotal: number;
  readonly discount: number;
  readonly total: number;
}

/**
 * A conta do rascunho.
 *
 * É a **única** vez que o cliente soma dinheiro, e só porque a proposta ainda
 * não existe no servidor — não há o que pedir. Depois de criada, todo valor vem
 * calculado do backend, e esta função não é usada para conferir nada.
 *
 * Arredonda em centavos a cada linha, como o servidor faz com `Decimal(14,2)`:
 * somar em ponto flutuante e arredondar no fim produz divergência de um centavo
 * em propostas grandes, que é exatamente o centavo que ninguém explica.
 */
export function draftTotals(draft: QuoteDraft): DraftTotals {
  const subtotal = draft.items.reduce(
    (soma, item) => soma + centavos(item.quantity * item.unitPrice),
    0,
  );
  /* O desconto não pode passar do subtotal: o servidor recusa, e um total
     negativo viraria despesa disfarçada de receita no Financeiro. */
  const discount = Math.min(centavos(draft.discount), subtotal);
  return { subtotal, discount, total: subtotal - discount };
}

function centavos(valor: number): number {
  return Math.round((Number.isFinite(valor) ? valor : 0) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* O que falta em cada passo                                           */
/* ------------------------------------------------------------------ */

/**
 * O que impede de avançar, em frases.
 *
 * Lista e não booleano: "não é possível avançar" manda a pessoa procurar o que
 * está errado entre nove campos. Cada frase diz o campo e o que fazer.
 *
 * Vazio significa que o passo está completo.
 */
export function stepIssues(
  step: WizardStep,
  draft: QuoteDraft,
): readonly string[] {
  const issues: string[] = [];

  switch (step) {
    case "origem":
      if (draft.origin === "OPERATION" && !draft.operationId) {
        issues.push("Escolha o atendimento de onde copiar os dados.");
      }
      break;

    case "dados":
      if (!draft.customerId) issues.push("Escolha o cliente da proposta.");
      if (draft.title.trim().length < 3) {
        issues.push("O título precisa de ao menos três caracteres.");
      }
      if (!draft.validUntil) {
        issues.push(
          "Informe até quando a proposta vale — sem isso ela não pode ser enviada.",
        );
      }
      break;

    case "itens":
      if (draft.items.length === 0) {
        issues.push("Acrescente ao menos um serviço ou material.");
      }
      if (draft.items.some((item) => item.quantity <= 0)) {
        issues.push("Todo item precisa de quantidade maior que zero.");
      }
      break;

    case "valores": {
      const { subtotal } = draftTotals(draft);
      if (subtotal <= 0) {
        issues.push(
          "O total precisa ser maior que zero para a proposta ser enviada.",
        );
      }
      if (centavos(draft.discount) > subtotal) {
        issues.push("O desconto não pode passar do subtotal.");
      }
      if (draft.discount < 0) issues.push("O desconto não pode ser negativo.");
      break;
    }

    case "responsavel":
      if (!draft.responsibleUserId) {
        issues.push("Escolha quem responde tecnicamente pela proposta.");
      }
      break;

    case "resumo":
      if (!draft.approved) {
        issues.push("Confirme que revisou o orçamento antes de gerar.");
      }
      break;
  }

  return issues;
}

/** O rascunho está pronto para virar proposta? */
export function canSubmit(draft: QuoteDraft): boolean {
  return WIZARD_STEPS.every((step) => stepIssues(step, draft).length === 0);
}

/* ------------------------------------------------------------------ */
/* A submissão                                                         */
/* ------------------------------------------------------------------ */

/**
 * O que vai ser enviado, em ordem.
 *
 * O contrato **não** aceita itens no mesmo corpo da criação, de propósito: com
 * um item inválido no meio de dez, a recusa não conseguiria dizer qual. Então a
 * criação é uma sequência, e descrevê-la como dados deixa provar a ordem sem
 * disparar requisição.
 *
 * `update` só existe quando há desconto: um `PATCH` com `discount: 0` em toda
 * criação seria uma requisição a mais para não mudar nada.
 *
 * `send` fecha a sequência. Uma proposta gerada pelo wizard está pronta para o
 * cliente, e é o que a deixa em "aguardando decisão" — o estado em que o botão
 * "Aprovado" da lista funciona. Rascunho é o que se salva pela metade, e o
 * wizard não salva pela metade.
 */
export interface SubmissionPlan {
  readonly create: CreateQuoteInput;
  readonly items: readonly AddQuoteItemInput[];
  readonly update: UpdateQuoteInput | null;
  readonly send: boolean;
}

export function submissionPlan(draft: QuoteDraft): SubmissionPlan {
  const { discount } = draftTotals(draft);

  return {
    create: {
      customerId: draft.customerId!,
      title: draft.title.trim(),
      notes: draft.notes.trim() || undefined,
      /* Vazio é ausente, não "sem abertura": quem não escreveu nada quer o
         padrão do documento. Apagar de propósito é decisão que se toma na
         proposta aberta, onde o campo mostra o que está valendo. */
      introText: draft.introText.trim() || undefined,
      validUntil: draft.validUntil,
      serviceAddressId: draft.serviceAddressId ?? undefined,
      responsibleUserId: draft.responsibleUserId ?? undefined,
      assetIds: draft.assetIds.length > 0 ? draft.assetIds : undefined,
    },
    items: draft.items.map((item) => ({
      catalogItemId: item.catalogItemId ?? undefined,
      /* Descrição e preço vão mesmo com item de catálogo: negociar preço é o que
         um orçamento faz, e o que for enviado é o que vira fotografia. */
      description: item.description,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
    update:
      discount > 0
        ? {
            discount,
            discountReason: draft.discountReason.trim() || undefined,
          }
        : null,
    send: true,
  };
}
