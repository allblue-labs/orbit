/**
 * O contrato de erro público, como a interface o lê.
 *
 * O backend responde `{ error: { code, message }, requestId }`. O que se prova
 * aqui é que o frontend extrai isso sem inventar texto e sem deixar vazar
 * detalhe técnico — e que classifica os status que a UI trata de forma
 * diferente (401, 403, 404, 409).
 */
import { describe, expect, it } from "vitest";
import {
  ApiError,
  FALLBACK_MESSAGE,
  parseErrorEnvelope,
  toApiError,
} from "./api-error";

describe("parseErrorEnvelope", () => {
  it("lê o envelope do backend inteiro", () => {
    const parsed = parseErrorEnvelope({
      success: false,
      error: {
        code: "OPERATION_INVALID_TRANSITION",
        message: "Transição inválida.",
        status: 422,
      },
      requestId: "01a0-abc",
    });

    expect(parsed.message).toBe("Transição inválida.");
    expect(parsed.code).toBe("OPERATION_INVALID_TRANSITION");
    expect(parsed.requestId).toBe("01a0-abc");
  });

  it("lê os detalhes estruturados do contrato de validação", () => {
    const parsed = parseErrorEnvelope({
      error: {
        code: "VALIDATION_ERROR",
        message: "Revise os campos informados.",
        status: 400,
        details: [
          {
            field: "email",
            code: "INVALID_FORMAT",
            message: "Informe um e-mail válido.",
          },
        ],
      },
    });

    expect(parsed.message).toBe("Revise os campos informados.");
    expect(parsed.details).toEqual([
      {
        field: "email",
        code: "INVALID_FORMAT",
        message: "Informe um e-mail válido.",
      },
    ]);
  });

  it("corpo irreconhecível cai na frase neutra, nunca em undefined", () => {
    expect(parseErrorEnvelope(null).message).toBe(FALLBACK_MESSAGE);
    expect(parseErrorEnvelope("<html>502 Bad Gateway</html>").message).toBe(
      FALLBACK_MESSAGE,
    );
  });
});

describe("ApiError", () => {
  const http = (status: number) =>
    new ApiError({ kind: "http", message: "x", status });

  it("classifica os status que a interface trata de forma diferente", () => {
    expect(http(401).isUnauthorized).toBe(true);
    expect(http(403).isForbidden).toBe(true);
    expect(http(404).isNotFound).toBe(true);
    expect(http(500).isServer).toBe(true);
    expect(http(409).code).toBe("CONFLICT");
  });

  it("deriva um código quando o backend não manda um", () => {
    expect(http(403).code).toBe("FORBIDDEN");
    expect(http(429).code).toBe("TOO_MANY_REQUESTS");
  });

  it("preserva o código publicado pelo backend", () => {
    const error = new ApiError({
      kind: "http",
      message: "Conflito",
      status: 409,
      code: "QUOTE_ALREADY_APPROVED",
    });

    expect(error.code).toBe("QUOTE_ALREADY_APPROVED");
  });

  it("sem requestId responde null — a UI decide não mostrar referência", () => {
    expect(http(500).requestId).toBeNull();
  });
});

describe("toApiError", () => {
  it("cancelamento não é falha de rede", () => {
    const aborted = toApiError(
      new DOMException("The operation was aborted.", "AbortError"),
    );

    expect(aborted.kind).toBe("aborted");
    expect(aborted.isAborted).toBe(true);
  });

  it("tempo limite tem tratamento próprio", () => {
    const timeout = toApiError(
      new DOMException("The operation timed out.", "TimeoutError"),
    );

    expect(timeout.kind).toBe("timeout");
  });

  it("não reembrulha um ApiError já normalizado", () => {
    const original = new ApiError({
      kind: "http",
      message: "Recusado",
      status: 403,
    });
    expect(toApiError(original)).toBe(original);
  });
});
