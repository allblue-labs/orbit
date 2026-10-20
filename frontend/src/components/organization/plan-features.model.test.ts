/**
 * Tradução de capability em recurso.
 *
 * O que custa dinheiro aqui é dizer "disponível no plano Profissional" sobre
 * algo que a organização já tem — manda a pessoa comprar o que já comprou. É o
 * caso que a colisão de verbos cria, e o que estes testes cercam.
 */
import { describe, expect, it } from "vitest";

import {
  buildPlanFeatures,
  moduleLabel,
  operationLabel,
  type PlanLike,
} from "./plan-features.model";

const ESSENCIAL: PlanLike = {
  key: "ESSENTIAL",
  name: "Essencial",
  /* `manage` antes de `read` de propósito: a tela lista em ordem alfabética do
     verbo, não na ordem em que o backend publicou as capabilities. */
  capabilities: ["operations.manage", "operations.read", "reports.read"],
};

const PROFISSIONAL: PlanLike = {
  key: "PROFESSIONAL_INTELLIGENCE",
  name: "Profissional",
  capabilities: [
    "operations.read",
    "operations.manage",
    "reports.read",
    "reports.management.read",
    "scheduling.intelligence",
  ],
};

describe("buildPlanFeatures", () => {
  it("nomeia o módulo como produto e a operação como verbo", () => {
    const [operacoes] = buildPlanFeatures([ESSENCIAL], ESSENCIAL.capabilities);

    expect(operacoes.name).toBe("Operações");
    expect(operacoes.included).toEqual(["consultar", "gerenciar"]);
    expect(operacoes.missing).toEqual([]);
  });

  it("aponta o plano que concede o que falta, pelo nome comercial", () => {
    const agenda = buildPlanFeatures(
      [ESSENCIAL, PROFISSIONAL],
      ESSENCIAL.capabilities,
    ).find((recurso) => recurso.id === "scheduling");

    expect(agenda?.missing).toEqual(["otimizar automaticamente"]);
    expect(agenda?.availableIn).toEqual(["Profissional"]);
  });

  it("não oferece plano para um verbo que a organização já tem", () => {
    /* `reports.read` está habilitada e `reports.management.read` não; as duas
       traduzem para "consultar". Sem cuidado, Relatórios diria "consultar" como
       incluído e como faltando, e ofereceria o plano Profissional por algo que
       já funciona. */
    const relatorios = buildPlanFeatures(
      [ESSENCIAL, PROFISSIONAL],
      ESSENCIAL.capabilities,
    ).find((recurso) => recurso.id === "reports");

    expect(relatorios?.included).toEqual(["consultar"]);
    expect(relatorios?.missing).toEqual([]);
    expect(relatorios?.availableIn).toEqual([]);
  });

  it("não repete o mesmo verbo", () => {
    for (const recurso of buildPlanFeatures([ESSENCIAL, PROFISSIONAL], [])) {
      expect([...new Set(recurso.missing)]).toEqual(recurso.missing);
      expect([...new Set(recurso.included)]).toEqual(recurso.included);
    }
  });

  it("mostra capability concedida à mão, que nenhum plano lista", () => {
    const recursos = buildPlanFeatures(
      [ESSENCIAL],
      [...ESSENCIAL.capabilities, "inventory.manage"],
    );

    const estoque = recursos.find((recurso) => recurso.id === "inventory");
    expect(estoque?.name).toBe("Estoque");
    expect(estoque?.included).toEqual(["gerenciar"]);
  });

  it("não deixa chave crua na tela", () => {
    const textos = buildPlanFeatures([PROFISSIONAL], []).flatMap((recurso) => [
      recurso.name,
      ...recurso.included,
      ...recurso.missing,
    ]);

    expect(textos.filter((texto) => texto.includes("."))).toEqual([]);
    expect(textos.filter((texto) => texto.includes("_"))).toEqual([]);
  });

  it("ordena pelo nome exibido, não pela chave", () => {
    const nomes = buildPlanFeatures([PROFISSIONAL], []).map(
      (recurso) => recurso.name,
    );

    expect(nomes).toEqual(
      [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")),
    );
  });
});

describe("rótulos", () => {
  it("devolve o nome cru de um módulo sem tradução, em vez de esconder", () => {
    expect(moduleLabel("novo_modulo_do_backend")).toBe(
      "Novo Modulo Do Backend",
    );
  });

  it("traduz as operações compostas", () => {
    expect(operationLabel("qr.manage")).toBe("gerenciar etiquetas QR");
    expect(operationLabel("management.read")).toBe("consultar");
  });
});
