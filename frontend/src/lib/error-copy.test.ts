import { describe, expect, it } from "vitest";

import { ApiError } from "./api-error";
import { errorCopy } from "./error-copy";

function http(code: string, status: number, message: string) {
  return new ApiError({ kind: "http", code, status, message });
}

describe("mensagem pública de erro", () => {
  it("exibe a mensagem PT-BR publicada sem tradução por texto", () => {
    expect(
      errorCopy(
        http(
          "CUSTOMER_DOCUMENT_ALREADY_EXISTS",
          409,
          "Já existe um cliente cadastrado com este CPF ou CNPJ.",
        ),
      ),
    ).toBe("Já existe um cliente cadastrado com este CPF ou CNPJ.");
  });

  it("não mantém tabela de compensação para mensagens internas", () => {
    const source = errorCopy.toString();
    expect(source).not.toMatch(/Customer document|must be an email|RegExp/);
  });

  it("mantém copy local somente para transporte", () => {
    expect(
      errorCopy(new ApiError({ kind: "network", message: "fetch failed" })),
    ).toContain("Verifique sua conexão");
    expect(
      errorCopy(new ApiError({ kind: "timeout", message: "timeout" })),
    ).toContain("demorou mais que o esperado");
  });

  it("um erro que não é da API produz frase segura", () => {
    expect(errorCopy(new Error("boom"))).toBe(
      "Não foi possível concluir a operação.",
    );
  });
});
