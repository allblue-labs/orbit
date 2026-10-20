/**
 * O recibo, como decisão de dados.
 *
 * ## O que este módulo resolve
 *
 * Em que passo a pessoa está e o que falta para avançar. É função de dados, e em
 * teste é onde essas regras se provam — a interface mostra o que `stepIssues` diz
 * que falta, e nada mais.
 *
 * ## O que ele não decide
 *
 * O número do recibo, o modelo do documento e a unidade do valor. Os três são do
 * servidor: o número porque dois recibos no mesmo minuto colidiriam, o modelo porque
 * a tela escolhendo permitiria emitir um recibo com o modelo de PMOC, e a unidade
 * porque é ela que faz o Financeiro reconhecer dinheiro.
 */
import type { CreateReceiptInput, ReceiptSource } from "@/types/financial";

/** De onde o recibo nasce. */
export type ReceiptOrigin = "SCRATCH" | "OPERATION";

export interface ReceiptDraft {
  readonly origin: ReceiptOrigin;
  /** O atendimento concluído, quando a origem é um serviço executado. */
  readonly operationId: string | null;
  readonly customerId: string | null;
  readonly payer: string;
  readonly payerDocument: string;
  /** Em reais, como a pessoa digita: `1.234,56` ou `1234.56`. */
  readonly amount: string;
  /** `YYYY-MM-DD`. Data de recebimento é dia, não instante. */
  readonly paidOn: string;
  readonly referring: string;
  readonly paymentMethod: string;
  /** A pessoa leu o resumo. Sem isso não se emite nada. */
  readonly confirmed: boolean;
}

export const RECEIPT_STEPS = ["origem", "dados", "resumo"] as const;

export type ReceiptStep = (typeof RECEIPT_STEPS)[number];

export const STEP_TITLES: Readonly<Record<ReceiptStep, string>> = {
  origem: "Origem",
  dados: "Dados do recibo",
  resumo: "Resumo e emissão",
};

/** Hoje, no formato que o campo de data usa. `sv-SE` dá `YYYY-MM-DD`. */
export function today(now = new Date()): string {
  return now.toLocaleDateString("sv-SE");
}

export function emptyDraft(now = new Date()): ReceiptDraft {
  return {
    /* Do zero é o padrão: recibo avulso — adiantamento, acerto, peça vendida no
       balcão — é tão comum quanto o de serviço executado, e exigir a escolha de um
       atendimento primeiro empurraria quem não tem um. */
    origin: "SCRATCH",
    operationId: null,
    customerId: null,
    payer: "",
    payerDocument: "",
    amount: "",
    /* Hoje, porque é quando se emite recibo: o dinheiro entrou agora. */
    paidOn: today(now),
    referring: "",
    paymentMethod: "",
    confirmed: false,
  };
}

/**
 * O que o atendimento preenche, e o que ele deliberadamente não preenche.
 *
 * Pagador e referência vêm dele — são fatos do atendimento. **O valor não**: o
 * sistema não sabe o que foi cobrado a menos que exista proposta ou lançamento, e
 * adivinhar o número de um recibo é pior que pedir que alguém o digite.
 */
export function fromOperation(
  draft: ReceiptDraft,
  source: ReceiptSource,
): ReceiptDraft {
  const cliente = source.customer;
  const numero = source.serviceOrderNumber
    ? `OS-${String(source.serviceOrderNumber).padStart(6, "0")}`
    : source.code;

  return {
    ...draft,
    origin: "OPERATION",
    operationId: source.id,
    customerId: cliente?.id ?? null,
    payer: cliente ? (cliente.tradeName ?? cliente.legalName) : draft.payer,
    payerDocument: cliente?.documentNumber ?? draft.payerDocument,
    referring: `${numero} — ${source.title}`,
  };
}

/* ------------------------------------------------------------------ */
/* O valor                                                             */
/* ------------------------------------------------------------------ */

/**
 * `1.234,56` → `1234.56`.
 *
 * Quem digita um recibo digita em português: ponto de milhar e vírgula de decimal. O
 * contrato quer o decimal com ponto, e é aqui que a tradução acontece — uma só vez,
 * em vez de em cada campo.
 *
 * Devolve `null` quando não dá para ler o número. Não adivinha: `1,2,3` não é
 * `1.23`, e um recibo com valor adivinhado é um recibo contestável.
 */
export function parseAmount(input: string): string | null {
  const texto = input.trim();
  if (texto === "") return null;

  /*
   * A pontuação é conferida **antes** de ser removida.
   *
   * Tirar os pontos primeiro e validar depois lê `1.2.3,4` como `123,40` — um
   * agrupamento de milhar inválido virando um valor plausível. Num recibo, é o
   * número que a pessoa vai assinar.
   */
  const comVirgula = /^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/;

  /*
   * Sem vírgula, só decimal com ponto — e por isso `1.234` é **recusado**, não lido
   * como mil duzentos e trinta e quatro. A entrada é ambígua: pode ser milhar
   * brasileiro ou decimal com três casas, e as duas leituras diferem por mil vezes.
   * Quem quer milhar escreve a vírgula.
   */
  const semVirgula = /^\d+(\.\d{1,2})?$/;

  const normalizado = texto.includes(",")
    ? comVirgula.test(texto)
      ? texto.replace(/\./g, "").replace(",", ".")
      : null
    : semVirgula.test(texto)
      ? texto
      : null;

  if (normalizado === null) return null;

  const numero = Number(normalizado);

  /* Zero não prova pagamento nenhum, e o Financeiro ignoraria o lançamento — o
     documento existiria sem a receita que ele declara. */
  if (!Number.isFinite(numero) || numero <= 0) return null;

  return numero.toFixed(2);
}

/* ------------------------------------------------------------------ */
/* O que falta                                                         */
/* ------------------------------------------------------------------ */

/**
 * O que impede de avançar, em frases.
 *
 * Lista e não booleano: "não é possível avançar" manda a pessoa procurar o que está
 * errado. Cada frase diz o campo e o que fazer.
 */
export function stepIssues(
  step: ReceiptStep,
  draft: ReceiptDraft,
  /**
   * O agora, injetável.
   *
   * Sem isto a regra da data lia o relógio da parede, e o teste que a prova passava
   * num dia e falhava no seguinte — foi o que aconteceu: a asserção fixava
   * `2026-10-02` como futuro, e na virada do dia ela virou hoje. Uma regra sobre
   * tempo precisa receber o tempo de quem a chama.
   */
  now = new Date(),
): readonly string[] {
  const issues: string[] = [];

  switch (step) {
    case "origem":
      if (draft.origin === "OPERATION" && !draft.operationId) {
        issues.push("Escolha o atendimento concluído que originou o pagamento.");
      }
      break;

    case "dados": {
      if (draft.payer.trim().length < 2) {
        issues.push("Informe de quem o pagamento foi recebido.");
      }
      if (parseAmount(draft.amount) === null) {
        issues.push(
          "Informe o valor recebido — um número maior que zero, com até dois decimais.",
        );
      }
      if (!draft.paidOn) {
        issues.push("Informe a data do recebimento.");
      } else if (isFuture(draft.paidOn, now)) {
        /* Recibo declara quitação: um pagamento com data futura afirma que se
           recebeu algo que ainda não entrou. */
        issues.push("A data do recebimento não pode estar no futuro.");
      }
      if (draft.referring.trim().length < 2) {
        issues.push("Informe a que o pagamento se refere.");
      }
      break;
    }

    case "resumo":
      if (!draft.confirmed) {
        issues.push("Confirme que os dados do recibo estão corretos.");
      }
      break;
  }

  return issues;
}

/** A data escolhida está depois de hoje? Comparação por dia, não por instante. */
export function isFuture(date: string, now = new Date()): boolean {
  return date > today(now);
}

/** Pode emitir? Todos os passos resolvidos. */
export function canIssue(draft: ReceiptDraft, now = new Date()): boolean {
  return RECEIPT_STEPS.every(
    (step) => stepIssues(step, draft, now).length === 0,
  );
}

/* ------------------------------------------------------------------ */
/* O que vai no pedido                                                 */
/* ------------------------------------------------------------------ */

/**
 * O corpo da emissão.
 *
 * Campo vazio não viaja: o servidor trata ausência e string vazia de formas
 * diferentes, e uma resposta em branco faria o documento imprimir o rótulo com nada
 * ao lado — afirmando que não houve forma de pagamento, em vez de não dizer nada.
 */
export function createPayload(draft: ReceiptDraft): CreateReceiptInput {
  const amount = parseAmount(draft.amount);
  if (amount === null) {
    throw new Error("createPayload chamado com valor inválido");
  }

  return {
    operationId: draft.operationId ?? undefined,
    customerId: draft.customerId ?? undefined,
    payer: draft.payer.trim(),
    payerDocument: draft.payerDocument.trim() || undefined,
    amount,
    paidOn: draft.paidOn,
    referring: draft.referring.trim(),
    paymentMethod: draft.paymentMethod.trim() || undefined,
  };
}
