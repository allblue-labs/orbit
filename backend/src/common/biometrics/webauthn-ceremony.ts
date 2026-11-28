import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { RelyingParty } from './relying-party';

export type { AuthenticationResponseJSON, RegistrationResponseJSON };

export interface StoredPasskey {
  webauthnId: string;
  publicKey: Uint8Array;
  signCount: number;
  transports: string[];
}

/**
 * As duas cerimônias WebAuthn, iguais para equipe e cliente.
 *
 * Sempre com verificação do usuário (`userVerification: required`): só serve
 * a chave que o aparelho liberou com biometria ou PIN — encostar numa chave
 * de segurança sem prova de quem está ali não basta. A chave é *residente*
 * (passkey), então entrar não pede e-mail: o navegador oferece as contas.
 */
export class WebAuthnCeremony {
  constructor(private readonly rp: RelyingParty) {}

  registrationOptions(input: {
    userId: string;
    userName: string;
    displayName: string;
    exclude: StoredPasskey[];
  }): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return generateRegistrationOptions({
      rpName: this.rp.name,
      rpID: this.rp.id,
      userName: input.userName,
      userDisplayName: input.displayName,
      userID: new TextEncoder().encode(input.userId),
      attestationType: 'none',
      excludeCredentials: input.exclude.map((item) => ({
        id: item.webauthnId,
        transports: item.transports as AuthenticatorTransport[],
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
        authenticatorAttachment: 'platform',
      },
    });
  }

  /** A chave nova, ou `null` se a resposta não fecha com o desafio. */
  async verifyRegistration(
    response: RegistrationResponseJSON,
    challenge: string,
  ): Promise<StoredPasskey | null> {
    try {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: [...this.rp.origins],
        expectedRPID: this.rp.id,
        requireUserVerification: true,
      });
      if (!result.verified) return null;
      const { credential } = result.registrationInfo;
      return {
        webauthnId: credential.id,
        publicKey: credential.publicKey,
        signCount: credential.counter,
        transports: credential.transports ?? [],
      };
    } catch {
      return null;
    }
  }

  authenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return generateAuthenticationOptions({
      rpID: this.rp.id,
      userVerification: 'required',
    });
  }

  /** O novo contador de uso, ou `null` se a assinatura não confere. */
  async verifyAuthentication(
    response: AuthenticationResponseJSON,
    challenge: string,
    stored: StoredPasskey,
  ): Promise<number | null> {
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: [...this.rp.origins],
        expectedRPID: this.rp.id,
        requireUserVerification: true,
        credential: {
          id: stored.webauthnId,
          publicKey: stored.publicKey as Uint8Array<ArrayBuffer>,
          counter: stored.signCount,
          transports: stored.transports,
        },
      });
      return result.verified ? result.authenticationInfo.newCounter : null;
    } catch {
      return null;
    }
  }
}
