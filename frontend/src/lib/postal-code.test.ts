import { describe, expect, it } from "vitest";

import {
  formatPostalCode,
  isCompletePostalCode,
  normalizePostalCode,
  toPostalAddress,
} from "./postal-code";

describe("normalizePostalCode", () => {
  it("guarda só os dígitos", () => {
    expect(normalizePostalCode("50030-230")).toBe("50030230");
    expect(normalizePostalCode(" 50.030 230 ")).toBe("50030230");
  });

  it("para nos oito dígitos", () => {
    expect(normalizePostalCode("500302309999")).toBe("50030230");
  });
});

describe("formatPostalCode", () => {
  it("põe o hífen depois do quinto dígito", () => {
    expect(formatPostalCode("50030230")).toBe("50030-230");
  });

  it("deixa parcial o que ainda está sendo digitado", () => {
    expect(formatPostalCode("500")).toBe("500");
    expect(formatPostalCode("50030")).toBe("50030");
    expect(formatPostalCode("500302")).toBe("50030-2");
  });
});

describe("isCompletePostalCode", () => {
  it("só é completo com oito dígitos", () => {
    expect(isCompletePostalCode("50030-230")).toBe(true);
    expect(isCompletePostalCode("5003023")).toBe(false);
    expect(isCompletePostalCode("")).toBe(false);
  });
});

describe("toPostalAddress", () => {
  it("traduz a resposta para o vocabulário do produto", () => {
    expect(
      toPostalAddress({
        cep: "50030-230",
        logradouro: "Cais do Apolo",
        bairro: "Recife",
        localidade: "Recife",
        uf: "pe",
        estado: "Pernambuco",
      }),
    ).toEqual({
      postalCode: "50030-230",
      street: "Cais do Apolo",
      district: "Recife",
      city: "Recife",
      state: "Pernambuco",
      stateCode: "PE",
      country: "Brasil",
    });
  });

  it("devolve nulo quando o CEP não existe", () => {
    /** O serviço sinaliza ausência no corpo, com status 200. */
    expect(toPostalAddress({ erro: "true" })).toBeNull();
    expect(toPostalAddress({ erro: true })).toBeNull();
  });

  it("devolve nulo quando a resposta não traz CEP", () => {
    expect(toPostalAddress({})).toBeNull();
  });

  it("aceita campos ausentes sem inventar texto", () => {
    const endereco = toPostalAddress({ cep: "01001000", localidade: "São Paulo", uf: "SP" });
    expect(endereco).toEqual({
      postalCode: "01001-000",
      street: "",
      district: "",
      city: "São Paulo",
      state: "",
      stateCode: "SP",
      country: "Brasil",
    });
  });

  it("o país vem preenchido, não em branco", () => {
    /*
     * O ViaCEP atende só CEP brasileiro: o país é consequência de a consulta
     * ter dado certo, não um dado a buscar. Sem ele o formulário preenchia
     * rua, bairro, cidade e estado e abandonava o campo logo abaixo —
     * preenchido pela metade parece defeito, e é.
     */
    const endereco = toPostalAddress({
      cep: "50030230",
      logradouro: "Rua do Sol",
      bairro: "Santo Antônio",
      localidade: "Recife",
      uf: "pe",
      estado: "Pernambuco",
    });

    expect(endereco?.country).toBe("Brasil");
  });
});
