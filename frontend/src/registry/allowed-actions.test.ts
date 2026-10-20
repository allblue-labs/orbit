/**
 * A autoridade de ações — o que o servidor publica vira o que a tela oferece.
 *
 * O que se prova aqui é a tradução, não a regra. Quem decide se um técnico
 * pode mudar o status é o backend; o que se testa é que a resposta dele é
 * respeitada, inclusive quando ele ainda não respondeu nada.
 */
import { describe, expect, it } from "vitest";
import { actionAuthority, availableTransitions } from "./allowed-actions";

type Action = "VIEW" | "EDIT" | "CHANGE_STATUS" | "MANAGE_ASSIGNMENTS";

describe("actionAuthority", () => {
  it("libera o que o servidor publicou", () => {
    const authority = actionAuthority<Action>(["VIEW", "EDIT"]);

    expect(authority.declared).toBe(true);
    expect(authority.permits("EDIT")).toBe(true);
    expect(authority.permits("VIEW")).toBe(true);
  });

  it("recusa o que ficou de fora, mesmo sendo ação conhecida", () => {
    const authority = actionAuthority<Action>(["VIEW"]);

    /**
     * O caso que motivou a PR: o técnico tem a permissão de mudar status, mas
     * não está escalado nesta ordem. O servidor não publicou `CHANGE_STATUS`,
     * e a tela não pode oferecer.
     */
    expect(authority.permits("CHANGE_STATUS")).toBe(false);
    expect(authority.permits("MANAGE_ASSIGNMENTS")).toBe(false);
  });

  it("lista vazia nega tudo — e isso é diferente de não ter lista", () => {
    const authority = actionAuthority<Action>([]);

    expect(authority.declared).toBe(true);
    expect(authority.permits("VIEW")).toBe(false);
    expect(authority.permitsAny("VIEW", "EDIT")).toBe(false);
  });

  it("sem contrato publicado, a decisão volta para a sessão", () => {
    /**
     * Um Read Model que ainda não traz `allowedActions` não pode apagar o menu
     * da tela. A ausência devolve `true` e quem chamou segue pela permissão,
     * como antes — é o que permite adotar o contrato módulo a módulo.
     */
    for (const absent of [undefined, null]) {
      const authority = actionAuthority<Action>(absent);
      expect(authority.declared).toBe(false);
      expect(authority.permits("CHANGE_STATUS")).toBe(true);
      expect(authority.permitsAny("EDIT")).toBe(true);
    }
  });

  it("permitsAny responde ao menu inteiro", () => {
    const authority = actionAuthority<Action>(["EDIT"]);

    expect(authority.permitsAny("VIEW", "EDIT")).toBe(true);
    expect(authority.permitsAny("VIEW", "MANAGE_ASSIGNMENTS")).toBe(false);
  });
});

describe("availableTransitions", () => {
  it("oferece os destinos do servidor, menos o estado atual", () => {
    const destinations = availableTransitions(
      ["OPEN", "IN_PROGRESS", "COMPLETED"] as const,
      "OPEN",
    );

    expect(destinations).toEqual(["IN_PROGRESS", "COMPLETED"]);
  });

  it("estado final não oferece destino nenhum", () => {
    expect(availableTransitions([] as const, "CANCELLED")).toEqual([]);
  });

  it("sem transições publicadas responde null, não o enum inteiro", () => {
    /**
     * `null` é o sinal para buscar o detalhe. Devolver uma lista vazia diria
     * "não há transição" — e devolver todos os status seria reinventar a
     * máquina de estados no cliente, que é o que esta PR remove.
     */
    expect(availableTransitions(undefined, "OPEN")).toBeNull();
    expect(availableTransitions(null, "OPEN")).toBeNull();
  });
});
