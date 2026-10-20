/**
 * As regras do wizard.
 *
 * O que se prova aqui é o que se erra num formulário de seis passos: quando o
 * botão libera, o que exatamente vai no `POST`, e em que ordem. Nada disso
 * depende de desenho, e é por isso que mora em módulo puro.
 */
import { describe, expect, it } from "vitest";

import {
  WIZARD_STEPS,
  canSubmit,
  draftTotals,
  emptyDraft,
  inDays,
  stepIssues,
  submissionPlan,
  type DraftItem,
  type QuoteDraft,
} from "./quote-wizard.model";

const item = (overrides: Partial<DraftItem> = {}): DraftItem => ({
  key: "k1",
  catalogItemId: "prod-1",
  kind: "SERVICE",
  description: "Manutenção preventiva",
  unit: "SERV",
  quantity: 2,
  unitPrice: 500,
  ...overrides,
});

/** Um rascunho que passa em todos os passos, para variar um campo por vez. */
const completo = (overrides: Partial<QuoteDraft> = {}): QuoteDraft => ({
  ...emptyDraft("user-1"),
  customerId: "cust-1",
  customerLabel: "Edifício Aurora",
  title: "Manutenção do parque de climatização",
  items: [item()],
  approved: true,
  ...overrides,
});

describe("rascunho vazio", () => {
  it("nasce do zero, com validade de trinta dias e quem está usando como responsável", () => {
    const draft = emptyDraft("user-1");

    expect(draft.origin).toBe("SCRATCH");
    expect(draft.responsibleUserId).toBe("user-1");
    expect(draft.validUntil).toBe(inDays(30));
    expect(draft.approved).toBe(false);
  });

  /* Sem validade a proposta não pode ser enviada — `canSend` exige `validUntil`.
     Deixar vazio faria a pessoa descobrir isso no último passo. */
  it("sugere validade em vez de deixar vazio", () => {
    expect(stepIssues("dados", emptyDraft("user-1"))).not.toContain(
      "Informe até quando a proposta vale — sem isso ela não pode ser enviada.",
    );
  });
});

describe("a conta do rascunho", () => {
  it("soma quantidade por preço de cada linha", () => {
    const draft = completo({
      items: [
        item({ key: "a", quantity: 2, unitPrice: 500 }),
        item({ key: "b", quantity: 3, unitPrice: 18.4 }),
      ],
    });

    expect(draftTotals(draft)).toEqual({
      subtotal: 1055.2,
      discount: 0,
      total: 1055.2,
    });
  });

  /*
   * Arredondar por linha, como o servidor faz com `Decimal(14,2)`.
   *
   * Somar em ponto flutuante e arredondar no fim produz divergência de um
   * centavo — exatamente o centavo que ninguém consegue explicar depois.
   */
  it("arredonda em centavos por linha, como o servidor", () => {
    const draft = completo({
      items: Array.from({ length: 3 }, (_, i) =>
        item({ key: `k${i}`, quantity: 1, unitPrice: 0.335 }),
      ),
    });

    expect(draftTotals(draft).subtotal).toBe(1.02);
  });

  it("apara o desconto no subtotal, em vez de produzir total negativo", () => {
    const draft = completo({
      items: [item({ quantity: 1, unitPrice: 100 })],
      discount: 500,
    });

    const totais = draftTotals(draft);
    expect(totais.discount).toBe(100);
    expect(totais.total).toBe(0);
  });

  it("ignora valor não finito em vez de propagar NaN", () => {
    const draft = completo({
      items: [item({ quantity: Number.NaN, unitPrice: 100 })],
    });

    expect(draftTotals(draft).total).toBe(0);
  });
});

describe("o que falta em cada passo", () => {
  it("origem por atendimento exige o atendimento", () => {
    const draft = completo({ origin: "OPERATION", operationId: null });
    expect(stepIssues("origem", draft)).toHaveLength(1);

    expect(
      stepIssues("origem", { ...draft, operationId: "op-1" }),
    ).toHaveLength(0);
  });

  it("do zero não exige atendimento nenhum", () => {
    expect(stepIssues("origem", emptyDraft("user-1"))).toHaveLength(0);
  });

  it("dados gerais exige cliente e título", () => {
    const semCliente = completo({ customerId: null });
    expect(stepIssues("dados", semCliente)).toContain(
      "Escolha o cliente da proposta.",
    );

    /* Três caracteres é o mínimo do contrato; "ab" voltaria 400 do servidor. */
    expect(stepIssues("dados", completo({ title: "ab" }))).toContain(
      "O título precisa de ao menos três caracteres.",
    );
    expect(stepIssues("dados", completo({ title: "   abc   " }))).toHaveLength(
      0,
    );
  });

  it("itens exige ao menos um, com quantidade positiva", () => {
    expect(stepIssues("itens", completo({ items: [] }))).toContain(
      "Acrescente ao menos um serviço ou material.",
    );
    expect(
      stepIssues("itens", completo({ items: [item({ quantity: 0 })] })),
    ).toContain("Todo item precisa de quantidade maior que zero.");
  });

  it("valores recusa desconto acima do subtotal", () => {
    const draft = completo({
      items: [item({ quantity: 1, unitPrice: 100 })],
      discount: 150,
    });

    /* A mesma recusa do servidor, dita antes de gastar a requisição. */
    expect(stepIssues("valores", draft)).toContain(
      "O desconto não pode passar do subtotal.",
    );
  });

  it("valores recusa total zero — proposta assim não pode ser enviada", () => {
    const draft = completo({ items: [item({ quantity: 1, unitPrice: 0 })] });
    expect(stepIssues("valores", draft)).toContain(
      "O total precisa ser maior que zero para a proposta ser enviada.",
    );
  });

  it("responsável é obrigatório", () => {
    expect(
      stepIssues("responsavel", completo({ responsibleUserId: null })),
    ).toHaveLength(1);
  });

  it("o resumo exige a confirmação explícita", () => {
    expect(stepIssues("resumo", completo({ approved: false }))).toContain(
      "Confirme que revisou o orçamento antes de gerar.",
    );
    expect(stepIssues("resumo", completo())).toHaveLength(0);
  });

  it("cada frase diz o campo, nunca só que não deu", () => {
    /* Um booleano mandaria a pessoa procurar o erro entre nove campos. */
    for (const step of WIZARD_STEPS) {
      for (const frase of stepIssues(step, emptyDraft(null))) {
        expect(frase.length).toBeGreaterThan(20);
        expect(frase).toMatch(/[.!]$/);
      }
    }
  });
});

describe("liberar a geração", () => {
  it("só com todos os passos completos", () => {
    expect(canSubmit(completo())).toBe(true);
    expect(canSubmit(completo({ approved: false }))).toBe(false);
    expect(canSubmit(completo({ customerId: null }))).toBe(false);
    expect(canSubmit(completo({ items: [] }))).toBe(false);
    expect(canSubmit(completo({ responsibleUserId: null }))).toBe(false);
  });
});

describe("o plano de submissão", () => {
  it("leva cliente, título, validade, endereço, responsável e equipamentos", () => {
    const plan = submissionPlan(
      completo({
        serviceAddressId: "addr-1",
        assetIds: ["asset-1", "asset-2"],
        validUntil: "2099-12-31",
      }),
    );

    expect(plan.create).toMatchObject({
      customerId: "cust-1",
      title: "Manutenção do parque de climatização",
      validUntil: "2099-12-31",
      serviceAddressId: "addr-1",
      responsibleUserId: "user-1",
      assetIds: ["asset-1", "asset-2"],
    });
  });

  it("omite o que está vazio em vez de enviar string vazia", () => {
    const plan = submissionPlan(completo());

    expect(plan.create.notes).toBeUndefined();
    expect(plan.create.introText).toBeUndefined();
    expect(plan.create.assetIds).toBeUndefined();
  });

  /*
   * Abertura vazia é "usar o padrão", não "sem abertura".
   *
   * Quem não escreveu nada no wizard quer a fórmula do setor, que o documento
   * imprime. Mandar string vazia diria ao servidor para não imprimir abertura
   * nenhuma — decisão que se toma na proposta aberta, onde o campo mostra o que
   * está valendo.
   */
  it("abertura em branco pede o padrão do documento", () => {
    expect(
      submissionPlan(completo({ introText: "   " })).create.introText,
    ).toBeUndefined();
    expect(
      submissionPlan(completo({ introText: "Conforme conversamos," })).create
        .introText,
    ).toBe("Conforme conversamos,");
  });

  it("os itens vão separados da criação, na ordem em que entraram", () => {
    const plan = submissionPlan(
      completo({
        items: [
          item({ key: "a", description: "Primeiro" }),
          item({ key: "b", description: "Segundo" }),
        ],
      }),
    );

    /* O contrato não aceita itens no corpo da criação: com um item inválido
       entre dez, a recusa não conseguiria dizer qual. */
    expect(plan.items.map((i) => i.description)).toEqual([
      "Primeiro",
      "Segundo",
    ]);
  });

  it("manda descrição e preço mesmo com item de catálogo", () => {
    /* Negociar preço é o que um orçamento faz, e o enviado vira fotografia. */
    const plan = submissionPlan(
      completo({
        items: [item({ catalogItemId: "prod-9", unitPrice: 412.5 })],
      }),
    );

    expect(plan.items[0]).toMatchObject({
      catalogItemId: "prod-9",
      unitPrice: 412.5,
      description: "Manutenção preventiva",
    });
  });

  it("sem desconto, não há PATCH", () => {
    expect(submissionPlan(completo()).update).toBeNull();
  });

  it("com desconto, o PATCH leva valor e motivo", () => {
    const plan = submissionPlan(
      completo({
        items: [item({ quantity: 1, unitPrice: 1000 })],
        discount: 150,
        discountReason: "contrato anual",
      }),
    );

    expect(plan.update).toEqual({
      discount: 150,
      discountReason: "contrato anual",
    });
  });

  it("desconto sem motivo continua válido", () => {
    /* Centavos para fechar a conta não pedem justificativa. */
    const plan = submissionPlan(
      completo({
        items: [item({ quantity: 1, unitPrice: 100 })],
        discount: 0.4,
      }),
    );

    expect(plan.update).toEqual({ discount: 0.4, discountReason: undefined });
  });

  /*
   * O wizard envia ao final.
   *
   * É o que deixa a proposta em "aguardando decisão" — o estado em que o botão
   * "Aprovado" da lista funciona, porque `canApprove` só vale em `SENT`. Parar
   * em rascunho faria a pessoa gerar um orçamento e não conseguir aprová-lo.
   */
  it("fecha enviando a proposta", () => {
    expect(submissionPlan(completo()).send).toBe(true);
  });
});
