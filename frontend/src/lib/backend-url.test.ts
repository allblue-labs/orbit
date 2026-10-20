/**
 * A tradução de endereço do backend para endereço do navegador.
 *
 * Nasce de um defeito: a pré-visualização da assinatura chegava como
 * `/api/v1/…`, o `<img>` pedia isso na origem do frontend, e a resposta era 404
 * — a assinatura cadastrada aparecia como um quadro vazio.
 */
import { describe, expect, it } from "vitest";

import { browserUrlFor } from "./backend-url";

describe("browserUrlFor", () => {
  it("troca o prefixo do backend pelo do BFF, preservando a consulta", () => {
    expect(
      browserUrlFor(
        "/api/v1/identity/me/signature/preview?expires=1&signature=ab",
      ),
    ).toBe("/api/orbit/identity/me/signature/preview?expires=1&signature=ab");
  });

  it("não mexe em URL absoluta", () => {
    /* O endereço assinado do Storage tem host próprio e não passa pelo proxy. */
    const assinada = "http://localhost:6001/api/v1/files/abc?signature=x";

    expect(browserUrlFor(assinada)).toBe(assinada);
  });

  it("não mexe em blob nem data URI", () => {
    expect(browserUrlFor("blob:http://localhost:3000/abc")).toBe(
      "blob:http://localhost:3000/abc",
    );
    expect(browserUrlFor("data:image/png;base64,AAA")).toBe(
      "data:image/png;base64,AAA",
    );
  });

  it("não transforma caminho de tela em pedido de API", () => {
    /* Reescrever qualquer relativo faria `/equipe` virar chamada de API. */
    expect(browserUrlFor("/equipe")).toBe("/equipe");
    expect(browserUrlFor("/api/orbit/customers")).toBe("/api/orbit/customers");
  });

  it("não confunde um caminho que só começa parecido", () => {
    expect(browserUrlFor("/api/v1000/x")).toBe("/api/v1000/x");
  });

  it("devolve vazio para vazio, sem inventar caminho", () => {
    expect(browserUrlFor("   ")).toBe("");
  });
});
