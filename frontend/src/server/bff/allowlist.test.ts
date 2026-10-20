/**
 * A decisão de quem o proxy encaminha **sem sessão**.
 *
 * ## Por que este arquivo existe agora
 *
 * `inspectPath` não tinha teste enquanto a resposta era igualdade de strings: o
 * conjunto literal era a própria especificação, e lê-la bastava. Deixou de bastar
 * quando um padrão entrou na conta — um regex responde sobre infinitos caminhos, e
 * nenhum deles está escrito no arquivo.
 *
 * ## O que está sendo protegido
 *
 * Não é "o link de assinatura funciona". É o complemento disso: que abrir uma rota
 * pública não abriu nenhuma vizinha. Os casos negativos abaixo são o teste de
 * verdade — a asserção positiva só confirma que o token chega onde deve.
 */
import { describe, expect, it } from "vitest";

import { inspectPath } from "./allowlist";

/** 48 bytes em `base64url`: 64 caracteres, caixa mista, como o backend emite. */
const TOKEN =
  "Ab3-_xYz01234567890123456789012345678901234567890123456789012xZ_";

describe("inspectPath", () => {
  it("encaminha o contrato público sem exigir sessão", () => {
    expect(inspectPath(`/public/pmoc/contracts/${TOKEN}`, "GET")).toEqual({
      allowed: true,
      requiresSession: false,
    });
  });

  it("aceita a assinatura sem sessão — é o cliente, que nunca terá uma", () => {
    expect(
      inspectPath(`/public/pmoc/contracts/${TOKEN}/signature`, "POST"),
    ).toEqual({ allowed: true, requiresSession: false });
  });

  it("o método faz parte da regra", () => {
    /* Ler o contrato é GET; `POST` no mesmo caminho é outra operação, e não foi
       declarada. Um padrão que ignorasse o método daria ao portador do link um
       verbo que o backend não espera. */
    const verdict = inspectPath(`/public/pmoc/contracts/${TOKEN}`, "POST");

    expect(verdict).toEqual({ allowed: true, requiresSession: true });
  });

  it("o caminho sem token não é público", () => {
    /* A coleção toda. Sem a âncora de formato, `^/public/pmoc/contracts/` casaria
       aqui e exporia a lista de contratos da organização. */
    expect(inspectPath("/public/pmoc/contracts", "GET")).toMatchObject({
      requiresSession: true,
    });
  });

  it("um segmento a mais depois do token não é público", () => {
    /* `$` depois do token. Sem ele, qualquer sufixo herdaria a dispensa de sessão
       — inclusive um que o backend venha a servir amanhã. */
    expect(
      inspectPath(`/public/pmoc/contracts/${TOKEN}/anexos`, "GET"),
    ).toMatchObject({ requiresSession: true });
  });

  it("um prefixo antes de /public não é público", () => {
    /* `^` na outra ponta. Vale menos que o `$` porque a raiz já barraria o
       caminho, e é exatamente por isso que está testado: se `public` deixar de ser
       a primeira raiz verificada, esta asserção é a que sobra. */
    expect(
      inspectPath(`/public/public/pmoc/contracts/${TOKEN}`, "GET"),
    ).toMatchObject({ requiresSession: true });
  });

  it("token curto demais não é token", () => {
    expect(inspectPath("/public/pmoc/contracts/abc", "GET")).toMatchObject({
      requiresSession: true,
    });
  });

  it("outro caminho sob /public continua exigindo sessão", () => {
    /* A raiz `public` foi liberada para o contrato. Ela não é um guarda-chuva:
       o que ainda não tem padrão declarado continua pedindo credencial. */
    expect(inspectPath("/public/pmoc/planos", "GET")).toMatchObject({
      allowed: true,
      requiresSession: true,
    });
  });

  it("a rota autenticada de PMOC não foi contaminada", () => {
    expect(inspectPath("/pmoc/plans", "GET")).toEqual({
      allowed: true,
      requiresSession: true,
    });
  });

  it("mantém os públicos por igualdade", () => {
    expect(inspectPath("/plans", "GET")).toMatchObject({
      requiresSession: false,
    });
  });

  it("raiz desconhecida continua em 404", () => {
    expect(inspectPath("/publico/pmoc", "GET")).toMatchObject({
      allowed: false,
      status: 404,
    });
  });

  it("rota de token continua em 403, antes de qualquer regra pública", () => {
    expect(inspectPath("/identity/login", "POST")).toMatchObject({
      allowed: false,
      status: 403,
    });
  });
});
