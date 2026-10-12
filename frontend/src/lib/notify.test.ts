/**
 * O vocabulário dos avisos.
 *
 * Cobre o que é testável sem navegador: que cada função escolha o tom certo.
 *
 * Que `useApiMutation` dispare o aviso uma vez e só no sucesso **não** está
 * preso aqui: o frontend roda em `node` e não tem harness de componente, e
 * fingir cobertura com um teste que não monta o hook seria pior que a ausência
 * dela. O que garante aquilo é o aviso morar dentro de `onSuccess`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const avisos: { kind: string; message: string }[] = [];

vi.mock("sonner", () => ({
  toast: Object.assign(
    (message: string) => avisos.push({ kind: "info", message }),
    {
      success: (message: string) => avisos.push({ kind: "success", message }),
      warning: (message: string) => avisos.push({ kind: "warning", message }),
      error: (message: string) => avisos.push({ kind: "error", message }),
    },
  ),
}));

const { notifySuccess, notifyError } = await import("@/lib/notify");

beforeEach(() => {
  avisos.length = 0;
});

describe("vocabulário dos avisos", () => {
  it("sucesso e erro são tons diferentes", () => {
    notifySuccess("Cliente cadastrado");
    notifyError("Não foi possível remover");

    expect(avisos).toEqual([
      { kind: "success", message: "Cliente cadastrado" },
      { kind: "error", message: "Não foi possível remover" },
    ]);
  });
});
