/**
 * As duas portas da biometria na web: equipe e cliente.
 *
 * Mesma forma, BFFs diferentes — a equipe fala com `/api/auth` e o proxy
 * `/api/orbit`, o cliente com `/api/portal`. Nenhum cookie de um vale no outro.
 */
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";

import { apiClient, authClient } from "@/api/client";
import { portalRequest } from "@/portal/portal-client";
import type { BiometricAudience, BiometricChallenge } from "./webauthn";

export interface BiometricCredential {
  id: string;
  kind: "DEVICE" | "WEBAUTHN";
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface BiometricApi {
  list(): Promise<BiometricCredential[]>;
  registrationChallenge(): Promise<
    BiometricChallenge<PublicKeyCredentialCreationOptionsJSON>
  >;
  register(input: {
    challengeId: string;
    response: RegistrationResponseJSON;
  }): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  loginChallenge(): Promise<
    BiometricChallenge<PublicKeyCredentialRequestOptionsJSON>
  >;
  login(input: {
    challengeId: string;
    response: AuthenticationResponseJSON;
  }): Promise<unknown>;
}

const teamApi: BiometricApi = {
  list: () => apiClient.get<BiometricCredential[]>("/identity/me/biometrics"),
  registrationChallenge: () =>
    apiClient.post("/identity/me/biometrics/webauthn/registration/options"),
  register: (input) =>
    apiClient.post("/identity/me/biometrics/webauthn/registration", input),
  remove: (id) =>
    apiClient.delete(`/identity/me/biometrics/${encodeURIComponent(id)}`),
  loginChallenge: () => authClient.post("/biometric/options"),
  login: (input) => authClient.post("/biometric", input),
};

const portalApi: BiometricApi = {
  list: () => portalRequest<BiometricCredential[]>("/me/biometrics"),
  registrationChallenge: () =>
    portalRequest("/me/biometrics/webauthn/registration/options", {
      method: "POST",
    }),
  register: (input) =>
    portalRequest("/me/biometrics/webauthn/registration", {
      method: "POST",
      body: input,
    }),
  remove: (id) =>
    portalRequest(`/me/biometrics/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  loginChallenge: () =>
    portalRequest("/auth/biometric/options", { method: "POST" }),
  login: (input) =>
    portalRequest("/auth/biometric", { method: "POST", body: input }),
};

export function biometricApi(audience: BiometricAudience): BiometricApi {
  return audience === "team" ? teamApi : portalApi;
}
