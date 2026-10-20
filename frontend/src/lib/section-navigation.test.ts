import { describe, expect, it } from "vitest";

import {
  SECTION_PARAM,
  resolveSection,
  sectionHref,
} from "./section-navigation";

const SECOES = ["organizacao", "seguranca", "integracoes"] as const;

describe("resolveSection", () => {
  it("abre a primeira seção quando a URL não pede nenhuma", () => {
    expect(resolveSection(null, SECOES)).toBe("organizacao");
    expect(resolveSection(undefined, SECOES)).toBe("organizacao");
    expect(resolveSection("", SECOES)).toBe("organizacao");
  });

  it("abre a seção pedida", () => {
    expect(resolveSection("seguranca", SECOES)).toBe("seguranca");
  });

  it("cai na primeira quando o apelido não existe mais", () => {
    expect(resolveSection("aba-que-saiu", SECOES)).toBe("organizacao");
  });

  it("aceita um destino de partida diferente do primeiro", () => {
    expect(resolveSection(null, SECOES, "integracoes")).toBe("integracoes");
  });
});

describe("sectionHref", () => {
  it("escreve a seção no endereço", () => {
    expect(sectionHref("/configuracoes", "seguranca")).toBe(
      `/configuracoes?${SECTION_PARAM}=seguranca`,
    );
  });

  it("preserva os outros parâmetros da consulta", () => {
    const atual = new URLSearchParams("origem=email&pagina=2");
    const href = sectionHref("/configuracoes", "integracoes", atual);
    expect(href).toContain("origem=email");
    expect(href).toContain("pagina=2");
    expect(href).toContain(`${SECTION_PARAM}=integracoes`);
  });

  it("troca a seção sem duplicar o parâmetro", () => {
    const atual = new URLSearchParams(`${SECTION_PARAM}=organizacao`);
    const href = sectionHref("/perfil", "dados", atual);
    expect(href.match(new RegExp(SECTION_PARAM, "g"))).toHaveLength(1);
    expect(href).toContain(`${SECTION_PARAM}=dados`);
  });
});
