/**
 * O resumo de acesso traduz registry em frase — e o que importa é que ele
 * mande a pessoa ao lugar certo.
 *
 * Dizer "fale com quem administra a conta" quando o que falta é plano manda a
 * pessoa pedir o que ninguém ali pode dar. É o único erro deste módulo que
 * custa tempo de alguém, e é o que estes testes cercam.
 */
import { describe, expect, it } from "vitest";

import { allEntities } from "@/entities";
import type { AccessContext } from "@/registry";

import { buildAccessSummary, enumerate } from "./access-summary.model";

/** Dono da organização: curinga de permissão e todas as capabilities. */
const DONO: AccessContext = {
  hasPermission: () => true,
  hasCapability: () => true,
  hasProductCapability: () => true,
  hasFeature: () => true,
};

/** Papel restrito num plano completo. */
const SOMENTE_LEITURA: AccessContext = {
  ...DONO,
  hasPermission: (permission) => permission.endsWith(".read"),
};

/** Papel completo num plano que não habilita nada. */
const SEM_PLANO: AccessContext = { ...DONO, hasCapability: () => false };

describe("buildAccessSummary", () => {
  it("cobre uma área por entidade do registry", () => {
    const areas = buildAccessSummary(DONO);

    expect(areas).toHaveLength(allEntities().length);
    expect(new Set(areas.map((area) => area.id)).size).toBe(areas.length);
  });

  it("libera tudo para quem tem permissão e plano", () => {
    const areas = buildAccessSummary(DONO);

    expect(areas.flatMap((area) => area.blocked)).toEqual([]);
    expect(areas.every((area) => area.allowed.includes("consultar"))).toBe(
      true,
    );
  });

  it("mostra o nome do registry, não o id da entidade", () => {
    /* `artifact-template` é um id legível — um teste que só procurasse ponto
       ou underscore deixaria passar. O nome tem que ser o do registry. */
    const nomes = new Set(
      allEntities().map((entidade) => entidade.labelPlural),
    );

    for (const area of buildAccessSummary(DONO)) {
      expect(nomes).toContain(area.name);
    }
  });

  it("atribui ao papel o que falta de permissão, mesmo com plano completo", () => {
    const bloqueado = buildAccessSummary(SOMENTE_LEITURA).flatMap(
      (area) => area.blocked,
    );

    expect(bloqueado.length).toBeGreaterThan(0);
    expect(bloqueado.every((item) => item.by === "papel")).toBe(true);
    expect(bloqueado.map((item) => item.label)).toContain("cadastrar");
  });

  it("atribui ao plano o que falta de capability, com permissão completa", () => {
    const bloqueado = buildAccessSummary(SEM_PLANO).flatMap(
      (area) => area.blocked,
    );

    expect(bloqueado.length).toBeGreaterThan(0);
    expect(bloqueado.every((item) => item.by === "plano")).toBe(true);
  });

  it("culpa o papel, não o plano, quando faltam os dois", () => {
    const nada: AccessContext = {
      hasPermission: () => false,
      hasCapability: () => false,
      hasProductCapability: () => false,
      hasFeature: () => false,
    };

    const areas = buildAccessSummary(nada);

    expect(areas.every((area) => area.allowed.length === 0)).toBe(true);
    expect(
      areas
        .flatMap((area) => area.blocked)
        .every((item) => item.by === "papel"),
    ).toBe(true);
  });

  it("não diz a mesma operação duas vezes", () => {
    /* O registry tem ações rotuladas "Editar" e "Excluir", que são exatamente
       os verbos da entidade. Sem o filtro de categoria, a área diria "editar,
       editar". */
    for (const area of buildAccessSummary(DONO)) {
      expect([...new Set(area.allowed)]).toEqual(area.allowed);
    }
  });
});

describe("enumerate", () => {
  it("usa 'e' antes do último item", () => {
    expect(enumerate(["consultar", "cadastrar", "editar"])).toBe(
      "consultar, cadastrar e editar",
    );
    expect(enumerate(["consultar", "cadastrar"])).toBe("consultar e cadastrar");
    expect(enumerate(["consultar"])).toBe("consultar");
    expect(enumerate([])).toBe("");
  });
});
