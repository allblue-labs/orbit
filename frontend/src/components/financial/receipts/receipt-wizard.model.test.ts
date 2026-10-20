import { describe, expect, it } from "vitest";

import {
  canIssue,
  createPayload,
  emptyDraft,
  fromOperation,
  isFuture,
  parseAmount,
  stepIssues,
  type ReceiptDraft,
} from "./receipt-wizard.model";
import type { ReceiptSource } from "@/types/financial";

const HOJE = new Date("2026-10-01T12:00:00.000Z");

const completo = (overrides: Partial<ReceiptDraft> = {}): ReceiptDraft => ({
  ...emptyDraft(HOJE),
  payer: "Darlan Simplício",
  amount: "1.234,56",
  referring: "Manutenção corretiva do split da suíte",
  confirmed: true,
  ...overrides,
});

describe("o valor digitado", () => {
  it("aceita o jeito brasileiro e devolve decimal com ponto", () => {
    /* Quem digita um recibo digita em português. O contrato quer `1234.56`. */
    expect(parseAmount("1.234,56")).toBe("1234.56");
    expect(parseAmount("1234,5")).toBe("1234.50");
  });

  it("aceita decimal com ponto, que é o que vem de integração", () => {
    expect(parseAmount("1234.56")).toBe("1234.56");
    expect(parseAmount("90")).toBe("90.00");
  });

  it("recusa em vez de adivinhar", () => {
    /* Um recibo com valor adivinhado é um recibo contestável: `1,2,3` não é
       `1.23`, e `R$ 10` tem símbolo que ninguém mandou interpretar. */
    for (const entrada of ["", "  ", "R$ 10", "abc", "1,2,3", "10,", "1.2.3,4"]) {
      expect(parseAmount(entrada), entrada).toBeNull();
    }
  });

  it("recusa zero e negativo", () => {
    /* Recibo de R$ 0,00 não prova pagamento nenhum, e o Financeiro ignoraria o
       lançamento — o documento existiria sem a receita que ele declara. */
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("0,00")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
  });

  it("recusa milhar ambíguo em vez de escolher uma leitura", () => {
    /*
     * `1.234` pode ser mil duzentos e trinta e quatro (milhar brasileiro) ou um e
     * duzentos e trinta e quatro milésimos. As duas leituras diferem por mil vezes,
     * num número que a pessoa vai assinar. Quem quer milhar escreve a vírgula.
     */
    expect(parseAmount("1.234")).toBeNull();
    expect(parseAmount("1.234,00")).toBe("1234.00");
  });

  it("recusa mais de dois decimais", () => {
    /* Centavo é a menor unidade do documento: `10,999` viraria `11,00` no papel e
       `10,99` no lançamento, ou o contrário. */
    expect(parseAmount("10,999")).toBeNull();
  });
});

describe("o que falta em cada passo", () => {
  it("origem por atendimento exige o atendimento", () => {
    const draft = completo({ origin: "OPERATION", operationId: null });
    expect(stepIssues("origem", draft, HOJE)).toHaveLength(1);
  });

  it("do zero não exige atendimento nenhum", () => {
    expect(stepIssues("origem", completo(), HOJE)).toEqual([]);
  });

  it("os dados cobram pagador, valor, data e referência", () => {
    const vazio = emptyDraft(HOJE);
    const faltas = stepIssues("dados", vazio, HOJE);

    /* Quatro frases, cada uma dizendo o campo: "não é possível avançar" mandaria a
       pessoa procurar o que está errado. */
    expect(faltas).toHaveLength(3);
    expect(faltas.join(" ")).toContain("recebido");
  });

  it("data no futuro é recusada", () => {
    /* Recibo declara quitação: data futura afirma que se recebeu o que ainda não
       entrou. */
    const draft = completo({ paidOn: "2026-10-02" });
    expect(
      stepIssues("dados", draft, HOJE).some((frase) =>
        frase.includes("futuro"),
      ),
    ).toBe(true);
  });

  it("hoje não é futuro", () => {
    expect(isFuture("2026-10-01", HOJE)).toBe(false);
    expect(isFuture("2026-10-02", HOJE)).toBe(true);
  });

  it("o resumo exige a confirmação de quem emite", () => {
    const draft = completo({ confirmed: false });
    expect(stepIssues("resumo", draft, HOJE)).toHaveLength(1);
    expect(canIssue(draft, HOJE)).toBe(false);
  });

  it("com tudo resolvido, emite", () => {
    expect(canIssue(completo(), HOJE)).toBe(true);
  });
});

describe("origem num atendimento executado", () => {
  const source: ReceiptSource = {
    id: "op-1",
    code: "ORB-1",
    serviceOrderNumber: 87,
    title: "Corretiva no split da suíte",
    status: "COMPLETED",
    completedAt: "2026-09-30T15:00:00.000Z",
    customer: {
      id: "cust-1",
      legalName: "Clínica São José LTDA",
      tradeName: "Clínica São José",
      documentNumber: "12.345.678/0001-90",
    },
  };

  it("preenche pagador, documento e referência", () => {
    const draft = fromOperation(emptyDraft(HOJE), source);

    expect(draft.payer).toBe("Clínica São José");
    expect(draft.payerDocument).toBe("12.345.678/0001-90");
    expect(draft.customerId).toBe("cust-1");

    /* A referência cita o número da OS: é por ele que o cliente reconhece o
       serviço no recibo. */
    expect(draft.referring).toContain("OS-000087");
    expect(draft.referring).toContain("Corretiva");
  });

  it("não preenche o valor", () => {
    /* O sistema não sabe o que foi cobrado a menos que exista proposta ou
       lançamento. Adivinhar o número de um recibo é pior que pedir que alguém o
       digite. */
    const draft = fromOperation(emptyDraft(HOJE), source);
    expect(draft.amount).toBe("");
  });

  it("atendimento sem número de OS cita o código", () => {
    const draft = fromOperation(emptyDraft(HOJE), {
      ...source,
      serviceOrderNumber: null,
    });
    expect(draft.referring).toContain("ORB-1");
  });
});

describe("o corpo da emissão", () => {
  it("manda o valor já traduzido", () => {
    expect(createPayload(completo()).amount).toBe("1234.56");
  });

  it("campo vazio não viaja", () => {
    /* Ausência e string vazia são diferentes para o servidor: uma resposta em
       branco faria o documento imprimir o rótulo com nada ao lado, afirmando que
       não houve forma de pagamento. */
    const payload = createPayload(completo());

    expect(payload.paymentMethod).toBeUndefined();
    expect(payload.payerDocument).toBeUndefined();
    expect(payload.operationId).toBeUndefined();
  });

  it("recusa montar o corpo com valor inválido", () => {
    /* Chegar aqui com valor ilegível é erro de programa, não de quem digitou: o
       passo não deixa avançar. Falhar alto é melhor que mandar `NaN`. */
    expect(() => createPayload(completo({ amount: "abc" }))).toThrow();
  });
});
