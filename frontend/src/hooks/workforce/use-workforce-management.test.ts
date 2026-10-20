/**
 * A frase que substitui o botão ausente.
 *
 * O que importa aqui é o destino: plano se resolve na assinatura, papel com quem
 * administra a conta. Uma mensagem genérica manda metade das pessoas pedir a
 * coisa errada — e foi o silêncio total que escondeu o defeito original por
 * tempo suficiente para o usuário reportar a página como somente leitura.
 */
import { describe, expect, it } from "vitest";

import { gate } from "./use-workforce-management";

describe("gate", () => {
  it("libera e não deixa mensagem quando plano e papel batem", () => {
    expect(gate(true, true, "administrar a equipe")).toEqual({
      allowed: true,
      reason: null,
    });
  });

  it("culpa o plano quando é a capability que falta", () => {
    const resultado = gate(false, true, "administrar a equipe");

    expect(resultado.allowed).toBe(false);
    expect(resultado.reason).toBe(
      "O plano atual não inclui administrar a equipe.",
    );
  });

  it("culpa o perfil quando a permissão falta e o plano inclui", () => {
    expect(gate(true, false, "administrar escalas").reason).toBe(
      "Seu perfil não autoriza administrar escalas.",
    );
  });

  it("culpa o plano quando faltam os dois, porque é o primeiro obstáculo", () => {
    /* Sem plano, conceder a permissão não muda nada — mandar a pessoa falar com
       quem administra a conta seria mandá-la voltar de mãos vazias. */
    expect(gate(false, false, "administrar a equipe").reason).toContain(
      "plano",
    );
  });
});
