import { describe, expect, it } from "vitest";

import { parseSidebarCookie } from "./sidebar-cookie";

describe("parseSidebarCookie", () => {
  it("mantém o padrão recolhido quando ninguém escolheu", () => {
    expect(parseSidebarCookie(undefined)).toBe(true);
  });

  it("respeita a escolha de deixar aberto", () => {
    /// O defeito que isto tranca: a escolha não era lembrada, e toda
    /// navegação voltava ao recolhido.
    expect(parseSidebarCookie("0")).toBe(false);
  });

  it("respeita a escolha de deixar recolhido", () => {
    expect(parseSidebarCookie("1")).toBe(true);
  });

  it("um valor estranho não deixa a barra em estado indefinido", () => {
    /// Cookie adulterado ou de uma versão antiga cai no padrão, não numa
    /// terceira possibilidade.
    expect(parseSidebarCookie("talvez")).toBe(true);
    expect(parseSidebarCookie("")).toBe(true);
  });
});
