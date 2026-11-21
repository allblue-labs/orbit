import { WebAuthnError } from "@simplewebauthn/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-error";
import {
  biometricFailureMessage,
  dismissBiometricOffer,
  markPasswordLogin,
  takeBiometricOffer,
} from "./webauthn";

function storage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("convite da biometria", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      sessionStorage: storage(),
      localStorage: storage(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("aparece uma vez, depois de um login com senha", () => {
    expect(takeBiometricOffer("team")).toBe(false);
    markPasswordLogin("team");
    expect(takeBiometricOffer("portal")).toBe(false);
    expect(takeBiometricOffer("team")).toBe(true);
    expect(takeBiometricOffer("team")).toBe(false);
  });

  it('"Agora não" vale para os próximos logins deste navegador', () => {
    dismissBiometricOffer("portal");
    markPasswordLogin("portal");
    expect(takeBiometricOffer("portal")).toBe(false);
    markPasswordLogin("team");
    expect(takeBiometricOffer("team")).toBe(true);
  });

  it("sem armazenamento, não convida nem quebra", () => {
    vi.stubGlobal("window", {});
    expect(() => markPasswordLogin("team")).not.toThrow();
    expect(takeBiometricOffer("team")).toBe(false);
  });
});

describe("biometricFailureMessage", () => {
  it("cancelar a janela do sistema não é erro", () => {
    const cancel = Object.assign(new Error("x"), { name: "NotAllowedError" });
    expect(biometricFailureMessage(cancel)).toBeNull();
    expect(
      biometricFailureMessage(
        new WebAuthnError({
          message: "x",
          code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
          cause: cancel,
        }),
      ),
    ).toBeNull();
  });

  it("explica o que o servidor recusou", () => {
    const api = (code: string, status: number) =>
      new ApiError({ kind: "http", status, code, message: "m" });
    expect(biometricFailureMessage(api("BIOMETRIC_INVALID", 401))).toContain(
      "Entre com a senha",
    );
    expect(
      biometricFailureMessage(api("BIOMETRIC_ALREADY_REGISTERED", 409)),
    ).toContain("já está ativada");
    expect(
      biometricFailureMessage(
        new WebAuthnError({
          message: "x",
          code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
          cause: new Error("y"),
        }),
      ),
    ).toContain("já está ativada");
  });
});
