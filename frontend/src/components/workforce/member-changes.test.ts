import { describe, expect, it } from "vitest";

import { memberChanges, type MemberFormState } from "./member-changes";
import type { TeamMember } from "@/types/workforce";

/**
 * O diálogo de "Editar usuário" manda dois `PATCH` parciais.
 *
 * Campo ausente significa "não mexa". O que estes testes seguram é o contrário:
 * campo presente quando nada mudou — que no caso de `permissions` troca um
 * acesso vinculado ao papel por uma cópia congelada dele, sem nada na tela
 * dizendo isso.
 */
describe("o que o formulário de usuário manda", () => {
  const membro: TeamMember = {
    userId: "user-1",
    displayName: "Marcos Tavares",
    firstName: "Marcos",
    lastName: "Tavares",
    email: "marcos@clima-norte.com",
    avatarUrl: null,
    status: "ACTIVE",
    role: { id: "role-1", key: "FIELD_TECHNICIAN", name: "Técnico de campo" },
    businessUnits: [{ id: "unit-1", legalName: "Clima Norte", tradeName: null }],
    joinedAt: "2026-01-01T00:00:00.000Z",
    isOwner: false,
    hasSignature: false,
    access: {
      useRoleDefaults: true,
      permissions: ["operations.read"],
      allowedSurfaces: ["MOBILE"],
    },
  };

  const intocado: MemberFormState = {
    firstName: "Marcos",
    lastName: "Tavares",
    email: "marcos@clima-norte.com",
    roleId: "role-1",
    status: "ACTIVE",
    businessUnitIds: ["unit-1"],
    useRoleDefaults: true,
    permissions: ["operations.read"],
    allowedSurfaces: ["MOBILE"],
  };

  const mudando = (campos: Partial<MemberFormState>) =>
    memberChanges(membro, { ...intocado, ...campos });

  it("não manda nada quando nada mudou", () => {
    expect(memberChanges(membro, intocado)).toEqual({
      dados: null,
      acesso: null,
    });
  });

  /* O caso que o diálogo precisa distinguir: fechar sem chamar o servidor. */
  it("ignora espaço em volta como se nada tivesse mudado", () => {
    expect(
      mudando({ firstName: "  Marcos  ", email: " marcos@clima-norte.com " }),
    ).toEqual({ dados: null, acesso: null });
  });

  it("manda só o campo de cadastro que mudou", () => {
    expect(mudando({ lastName: "Tavares Filho" })).toEqual({
      dados: { lastName: "Tavares Filho" },
      acesso: null,
    });
  });

  it("manda o e-mail quando o endereço é outro", () => {
    expect(mudando({ email: "marcos.tavares@clima-norte.com" }).dados).toEqual({
      email: "marcos.tavares@clima-norte.com",
    });
  });

  /**
   * Só a caixa não é correção.
   *
   * O servidor normaliza para o índice único, então `Marcos@` e `marcos@` são o
   * mesmo login — e o pedido só gastaria uma escrita e uma linha de auditoria.
   */
  it("não manda o e-mail quando só a caixa das letras difere", () => {
    expect(mudando({ email: "Marcos@Clima-Norte.com" }).dados).toBeNull();
  });

  /** Campo apagado não é "apague o nome": é formulário pela metade. */
  it("não manda campo de cadastro vazio", () => {
    expect(mudando({ firstName: "", lastName: "   " }).dados).toBeNull();
  });

  /**
   * O dono não tem cadastro editável aqui — o servidor recusa (400).
   *
   * Sem esta regra a tela montaria o corpo e descobriria na resposta o que já
   * sabia: trocar o e-mail do dono, somado à recuperação pública de senha,
   * seria assumir a conta.
   */
  it("nunca manda cadastro do dono da organização", () => {
    const dono = { ...membro, isOwner: true };

    expect(
      memberChanges(dono, { ...intocado, firstName: "Outro" }).dados,
    ).toBeNull();
  });

  it("o dono continua tendo papel e situação alteráveis pelo acesso", () => {
    const dono = { ...membro, isOwner: true };

    expect(
      memberChanges(dono, { ...intocado, status: "SUSPENDED" }).acesso,
    ).toEqual({ status: "SUSPENDED" });
  });

  /* ---------------------------------------------------------------- */
  /* Acesso                                                            */
  /* ---------------------------------------------------------------- */

  it("manda o papel quando ele muda, e nada mais", () => {
    expect(mudando({ roleId: "role-2" }).acesso).toEqual({ roleId: "role-2" });
  });

  /**
   * O defeito que este teste existe para impedir.
   *
   * Mandar `permissions` e `allowedSurfaces` numa mudança que não é de acesso
   * desliga `useRoleDefaults` no servidor: a pessoa deixa de acompanhar o papel
   * e fica com a cópia que a tela tinha carregado.
   */
  it("não manda permissões quando só o papel mudou", () => {
    const { acesso } = mudando({ roleId: "role-2" });

    expect(acesso).not.toHaveProperty("permissions");
    expect(acesso).not.toHaveProperty("allowedSurfaces");
    expect(acesso).not.toHaveProperty("useRoleDefaults");
  });

  it("manda o conjunto inteiro quando o acesso passa a ser personalizado", () => {
    expect(
      mudando({
        useRoleDefaults: false,
        permissions: ["operations.read", "operations.update"],
        allowedSurfaces: ["MOBILE", "WEB"],
      }).acesso,
    ).toEqual({
      useRoleDefaults: false,
      permissions: ["operations.read", "operations.update"],
      allowedSurfaces: ["MOBILE", "WEB"],
    });
  });

  /**
   * Voltar a seguir o papel manda só a chave.
   *
   * As listas personalizadas que ficaram na tela não têm por que viajar: o
   * servidor passa a ler o papel, e mandá-las sugeriria o contrário.
   */
  it("ao voltar a seguir o papel, não manda as listas personalizadas", () => {
    const personalizado: TeamMember = {
      ...membro,
      access: {
        useRoleDefaults: false,
        permissions: ["operations.read"],
        allowedSurfaces: ["MOBILE"],
      },
    };

    expect(
      memberChanges(personalizado, { ...intocado, useRoleDefaults: true })
        .acesso,
    ).toEqual({ useRoleDefaults: true });
  });

  it("a ordem das unidades não é mudança", () => {
    const duas: TeamMember = {
      ...membro,
      businessUnits: [
        { id: "unit-1", legalName: "A", tradeName: null },
        { id: "unit-2", legalName: "B", tradeName: null },
      ],
    };

    expect(
      memberChanges(duas, {
        ...intocado,
        businessUnitIds: ["unit-2", "unit-1"],
      }).acesso,
    ).toBeNull();
  });

  it("manda as unidades quando o escopo muda", () => {
    expect(mudando({ businessUnitIds: ["unit-1", "unit-2"] }).acesso).toEqual({
      businessUnitIds: ["unit-1", "unit-2"],
    });
  });

  /** As duas rotas são independentes, e uma mudança em cada manda os dois. */
  it("manda cadastro e acesso quando os dois mudam", () => {
    expect(mudando({ firstName: "Marco", status: "SUSPENDED" })).toEqual({
      dados: { firstName: "Marco" },
      acesso: { status: "SUSPENDED" },
    });
  });
});
