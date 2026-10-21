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
    /* Endereços externos que não são a rota do storage local ficam intactos. */
    const assinada = "http://localhost:6001/api/v1/files/abc?signature=x";

    expect(browserUrlFor(assinada)).toBe(assinada);
  });

  it.each([
    "http://localhost:6001",
    "http://api:5001",
    "https://orbit.example.com",
    "//internal-api:5001",
  ])(
    "encaminha a foto do storage local pela origem do frontend: %s",
    (origin) => {
      const query =
        "?bucket=orbit-artifacts&key=avatars%2Ffoto%20perfil.png&operation=download&expires=2000000000&signature=abc123&filename=Foto%20de%20perfil.png";
      expect(browserUrlFor(`${origin}/api/v1/storage/objects${query}`)).toBe(
        `/api/orbit/storage/objects${query}`,
      );
    },
  );

  it("preserva URLs assinadas de object stores externos", () => {
    const s3 =
      "https://bucket.s3.amazonaws.com/avatar.png?X-Amz-Signature=abc&X-Amz-Expires=300";
    expect(browserUrlFor(s3)).toBe(s3);
    const external =
      "https://cdn.example.com/api/v1/storage/objects?X-Amz-Signature=abc";
    expect(browserUrlFor(external)).toBe(external);
  });

  it("não transforma uma URL absoluta inválida em erro de renderização", () => {
    expect(browserUrlFor("http://[invalid")).toBe("http://[invalid");
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
