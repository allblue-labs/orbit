/**
 * A biometria do aparelho no navegador — WebAuthn com passkey de plataforma.
 *
 * O navegador cria e guarda a chave; a biometria (Touch ID, Windows Hello,
 * digital do Android) só a libera. O servidor recebe a chave pública no
 * cadastro e uma assinatura a cada entrada. Nada secreto passa por aqui.
 */
import {
  WebAuthnError,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/browser";

import { toApiError } from "@/lib/api-error";

export interface BiometricChallenge<O> {
  challengeId: string;
  options: O;
}

/** Este aparelho tem biometria que o navegador pode usar? */
export async function deviceBiometricAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !browserSupportsWebAuthn()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

/** Entrar: pede o desafio, a biometria assina, o servidor confere. */
export async function authenticateWithBiometric<T>(steps: {
  challenge: () => Promise<
    BiometricChallenge<PublicKeyCredentialRequestOptionsJSON>
  >;
  verify: (input: {
    challengeId: string;
    response: AuthenticationResponseJSON;
  }) => Promise<T>;
}): Promise<T> {
  const { challengeId, options } = await steps.challenge();
  const response = await startAuthentication({ optionsJSON: options });
  return steps.verify({ challengeId, response });
}

/** Cadastrar: o aparelho cria a chave e o servidor guarda a parte pública. */
export async function registerBiometric<T>(steps: {
  challenge: () => Promise<
    BiometricChallenge<PublicKeyCredentialCreationOptionsJSON>
  >;
  register: (input: {
    challengeId: string;
    response: RegistrationResponseJSON;
  }) => Promise<T>;
}): Promise<T> {
  const { challengeId, options } = await steps.challenge();
  const response = await startRegistration({ optionsJSON: options });
  return steps.register({ challengeId, response });
}

/**
 * O que dizer quando não deu certo — ou `null` quando a pessoa só cancelou.
 *
 * Cancelar a janela do sistema não é erro: não merece aviso vermelho.
 */
export function biometricFailureMessage(error: unknown): string | null {
  const name =
    error instanceof WebAuthnError
      ? (error.cause as { name?: string } | undefined)?.name
      : (error as { name?: string } | null)?.name;
  if (error instanceof WebAuthnError) {
    if (error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED")
      return "A biometria deste aparelho já está ativada.";
    if (name === "NotAllowedError" || name === "AbortError") return null;
    return "Este aparelho não conseguiu usar a biometria.";
  }
  if (name === "NotAllowedError" || name === "AbortError") return null;
  const api = toApiError(error);
  if (api.code === "WEBAUTHN_UNAVAILABLE")
    return "A biometria ainda não está disponível neste ambiente.";
  if (api.code === "BIOMETRIC_ALREADY_REGISTERED")
    return "A biometria deste aparelho já está ativada.";
  if (api.code === "BIOMETRIC_CHALLENGE_EXPIRED")
    return "A confirmação demorou demais. Tente de novo.";
  if (api.status === 401)
    return "Biometria não reconhecida. Entre com a senha e ative de novo.";
  return api.message || "Não foi possível usar a biometria agora.";
}

/* ------------------------------------------------------------------ */
/* O convite depois do primeiro login com senha                        */
/* ------------------------------------------------------------------ */

export type BiometricAudience = "team" | "portal";

const OFFER = (audience: BiometricAudience) =>
  `orbit.biometric.offer.${audience}`;
const DISMISSED = (audience: BiometricAudience) =>
  `orbit.biometric.dismissed.${audience}`;

/** Marca que acabou de haver um login com senha — o momento de oferecer. */
export function markPasswordLogin(audience: BiometricAudience): void {
  try {
    window.sessionStorage.setItem(OFFER(audience), "1");
  } catch {
    /* Sem armazenamento, sem convite — a opção segue no perfil. */
  }
}

/** Há convite pendente? Lê e consome: ele aparece uma vez por login. */
export function takeBiometricOffer(audience: BiometricAudience): boolean {
  try {
    const pending = window.sessionStorage.getItem(OFFER(audience)) === "1";
    window.sessionStorage.removeItem(OFFER(audience));
    return (
      pending && window.localStorage.getItem(DISMISSED(audience)) !== "1"
    );
  } catch {
    return false;
  }
}

/** "Agora não": não pergunta mais neste navegador. */
export function dismissBiometricOffer(audience: BiometricAudience): void {
  try {
    window.localStorage.setItem(DISMISSED(audience), "1");
  } catch {
    /* Ignorado: no pior caso, pergunta de novo no próximo login. */
  }
}
