/**
 * Entrar com a biometria na web — o lado servidor.
 *
 * O navegador assina o desafio com a passkey; quem fala com o backend é o BFF,
 * que grava a sessão em cookies HttpOnly. O par de tokens nunca chega à
 * página, como no login com senha.
 */
import { backendJson, jsonBody } from "@/server/backend-client";
import type { PortalSessionPayload } from "@/server/portal/portal-session";
import type { TokenPair } from "@/types/session";

export type BiometricAudience = "team" | "portal";

export interface BiometricChallenge {
  challengeId: string;
  /** `PublicKeyCredentialRequestOptionsJSON`, repassado ao navegador. */
  options: Record<string, unknown>;
}

const PATHS = {
  team: "/identity/biometrics/webauthn/authentication",
  portal: "/portal/auth/biometrics/webauthn/authentication",
} as const;

export function biometricChallenge(
  audience: BiometricAudience,
): Promise<BiometricChallenge> {
  return backendJson<BiometricChallenge>({
    method: "POST",
    path: `${PATHS[audience]}/options`,
    retries: 0,
  });
}

/** Confere a resposta do navegador. Equipe recebe o par; cliente, par + `me`. */
export function biometricLogin<A extends BiometricAudience>(
  audience: A,
  input: { challengeId?: unknown; response?: unknown },
  userAgent: string | null,
): Promise<A extends "team" ? TokenPair : PortalSessionPayload> {
  return backendJson({
    method: "POST",
    path: PATHS[audience],
    body: jsonBody({
      challengeId: String(input.challengeId ?? ""),
      response: input.response ?? null,
      ...(audience === "team" ? { client: "WEB" } : {}),
    }),
    headers: userAgent ? { "user-agent": userAgent.slice(0, 512) } : undefined,
    retries: 0,
  });
}
