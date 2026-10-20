/**
 * A recusa do login, e o campo que ela abre.
 *
 * Este teste existe por um defeito real: a tela decidia pela mensagem interna em
 * inglês, que o contrato nunca envia, e quem ativava o segundo fator não
 * conseguia mais entrar. A decisão é pelo código publicado — e um código novo no
 * catálogo não muda nada aqui sem alguém decidir.
 */
import { describe, expect, it } from "vitest";

import { ApiError } from "./api-error";
import { loginFailure } from "./login-failure";

function recusa(code: string, message: string): ApiError {
  return new ApiError({ kind: "http", status: 401, code, message });
}

describe("loginFailure", () => {
  it("abre o campo do código quando o servidor diz que ele falta", () => {
    const acao = loginFailure(
      recusa("MFA_REQUIRED", "Informe o código do seu autenticador."),
    );

    expect(acao.revealMfa).toBe(true);
    expect(acao.description).toBe("Informe o código do seu autenticador.");
  });

  it("mantém o campo aberto quando o código não confere", () => {
    /* Fechar obrigaria a digitar e-mail e senha de novo por causa de um dígito. */
    expect(loginFailure(recusa("MFA_INVALID", "não confere")).revealMfa).toBe(
      true,
    );
  });

  it("não abre o campo em credencial errada", () => {
    const acao = loginFailure(
      recusa("INVALID_CREDENTIALS", "E-mail ou senha incorretos."),
    );

    expect(acao.revealMfa).toBe(false);
    expect(acao.description).toBe("E-mail ou senha incorretos.");
  });

  it("diz que é bloqueio quando a conta está travada", () => {
    /* Com "e-mail ou senha incorretos", quem está travado digita a senha certa e
       recebe erro sem nenhuma pista de que só precisa esperar. */
    const acao = loginFailure(
      recusa("ACCOUNT_LOCKED", "Muitas tentativas seguidas."),
    );

    expect(acao.title).toBe("Acesso bloqueado");
    expect(acao.revealMfa).toBe(false);
  });

  it("ignora a mensagem interna em inglês, que o contrato não envia", () => {
    /* O defeito original: decidir por este texto. Se alguém voltar a comparar
       mensagem, este teste cai. */
    expect(
      loginFailure(recusa("UNAUTHORIZED", "MFA code is required")).revealMfa,
    ).toBe(false);
  });

  it("nunca fica sem texto: `ApiError` garante uma mensagem", () => {
    /* Por isso não há fallback nesta função — seria ramo morto. */
    const acao = loginFailure(recusa("UNAUTHORIZED", ""));

    expect(acao.description.length).toBeGreaterThan(0);
  });
});
