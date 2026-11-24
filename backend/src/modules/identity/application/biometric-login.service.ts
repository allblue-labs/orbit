import { Inject, Injectable } from '@nestjs/common';
import type { IUuidProvider } from '../../../contracts';
import { UUID_PROVIDER } from '../../../providers';
import {
  ConflictException,
  EntityNotFoundException,
  UnauthorizedException,
  ValidationException,
} from '../../../exceptions';
import {
  AuthChallengeStore,
  WebAuthnCeremony,
  deviceLabelFrom,
  deviceSecretMatches,
  newDeviceSecret,
  relyingPartyFrom,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type StoredPasskey,
} from '../../../common/biometrics';
import type { SessionMetadata, TokenPair } from '../domain/identity.types';
import {
  BiometricCredentialRepository,
  type UserBiometricCredential,
} from '../infrastructure/biometric-credential.repository';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { AuthenticationService } from './authentication.service';

export interface BiometricCredentialView {
  id: string;
  kind: 'DEVICE' | 'WEBAUTHN';
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Entrar com a biometria — equipe e owners.
 *
 * Duas formas, uma regra: a biometria só **libera** uma credencial que o
 * aparelho guarda; quem confere é o servidor, e a sessão que sai é a mesma do
 * login com senha (`openVerifiedSession`), com as mesmas recusas.
 */
@Injectable()
export class BiometricLoginService {
  constructor(
    private readonly credentials: BiometricCredentialRepository,
    private readonly challenges: AuthChallengeStore,
    private readonly identities: IdentityRepository,
    private readonly authentication: AuthenticationService,
    @Inject(UUID_PROVIDER) private readonly uuids: IUuidProvider,
  ) {}

  async list(userId: string): Promise<BiometricCredentialView[]> {
    return (await this.credentials.listActive(userId)).map(view);
  }

  async revoke(userId: string, id: string): Promise<void> {
    if (!(await this.credentials.revoke(userId, id)))
      throw new EntityNotFoundException('Biometric credential', id);
  }

  /* ----------------------------- Web (WebAuthn) ---------------------------- */

  async registrationOptions(userId: string) {
    const ceremony = this.ceremony();
    const user = await this.identities.findById(userId);
    if (!user) throw new UnauthorizedException();
    const existing = await this.credentials.listActive(userId);
    const options = await ceremony.registrationOptions({
      userId,
      userName: user.email,
      displayName: user.displayName,
      exclude: existing.flatMap(passkey),
    });
    const challengeId = await this.challenges.issue(
      'USER_REGISTER',
      userId,
      options.challenge,
    );
    return { challengeId, options };
  }

  async register(
    userId: string,
    input: {
      challengeId: string;
      response: RegistrationResponseJSON;
      label?: string;
    },
    userAgent: string | undefined,
  ): Promise<BiometricCredentialView> {
    const ceremony = this.ceremony();
    const challenge = await this.challenges.consume(
      input.challengeId,
      'USER_REGISTER',
      userId,
    );
    if (!challenge) throw expiredChallenge();
    const key = await ceremony.verifyRegistration(input.response, challenge);
    if (!key)
      throw new ValidationException(
        'Não foi possível confirmar a biometria deste aparelho.',
        undefined,
        'BIOMETRIC_REGISTRATION_INVALID',
      );
    const id = this.uuids.generate();
    try {
      await this.credentials.createWebAuthn({
        id,
        userId,
        label: deviceLabelFrom(input.label, userAgent),
        webauthnCredentialId: key.webauthnId,
        publicKey: key.publicKey,
        signCount: key.signCount,
        transports: key.transports,
      });
    } catch {
      throw new ConflictException(
        'Esta biometria já está cadastrada.',
        'BIOMETRIC_ALREADY_REGISTERED',
      );
    }
    const created = await this.credentials.findActive({ id });
    return view(created!);
  }

  async authenticationOptions() {
    const options = await this.ceremony().authenticationOptions();
    const challengeId = await this.challenges.issue(
      'USER_LOGIN',
      null,
      options.challenge,
    );
    return { challengeId, options };
  }

  async authenticate(
    input: { challengeId: string; response: AuthenticationResponseJSON },
    metadata: SessionMetadata,
  ): Promise<TokenPair> {
    const ceremony = this.ceremony();
    const challenge = await this.challenges.consume(
      input.challengeId,
      'USER_LOGIN',
      null,
    );
    if (!challenge) throw expiredChallenge();
    const credential =
      typeof input.response?.id === 'string'
        ? await this.credentials.findActive({
            webauthnCredentialId: input.response.id,
          })
        : null;
    const stored = credential ? passkey(credential)[0] : undefined;
    if (!credential || !stored) throw refused();
    const signCount = await ceremony.verifyAuthentication(
      input.response,
      challenge,
      stored,
    );
    if (signCount === null) throw refused();
    if (
      !(await this.credentials.markUsed(credential.id, credential.userId, {
        signCount,
      }))
    )
      throw refused();
    return this.authentication.openVerifiedSession(credential.userId, metadata);
  }

  /* ------------------------------ App (aparelho) --------------------------- */

  async enrollDevice(
    userId: string,
    input: { deviceId: string; label?: string },
    userAgent: string | undefined,
  ): Promise<{ credentialId: string; secret: string }> {
    const { secret, hash } = newDeviceSecret();
    const id = this.uuids.generate();
    await this.credentials.replaceDevice({
      id,
      userId,
      deviceId: input.deviceId,
      label: deviceLabelFrom(input.label, userAgent),
      secretHash: hash,
    });
    return { credentialId: id, secret };
  }

  /** Entra e devolve o segredo trocado — o anterior deixa de valer. */
  async deviceLogin(
    input: { credentialId: string; secret: string },
    metadata: SessionMetadata,
  ): Promise<TokenPair & { deviceSecret: string }> {
    const credential = await this.credentials.findActive({
      id: input.credentialId,
    });
    if (
      !credential ||
      credential.kind !== 'DEVICE' ||
      !credential.secretHash ||
      !deviceSecretMatches(input.secret, credential.secretHash)
    )
      throw refused();
    const next = newDeviceSecret();
    if (
      !(await this.credentials.markUsed(credential.id, credential.userId, {
        expectedSecretHash: credential.secretHash,
        newSecretHash: next.hash,
      }))
    )
      throw refused();
    const pair = await this.authentication.openVerifiedSession(
      credential.userId,
      metadata,
    );
    return { ...pair, deviceSecret: next.secret };
  }

  private ceremony(): WebAuthnCeremony {
    const rp = relyingPartyFrom(process.env);
    if (!rp)
      throw new ConflictException(
        'A biometria na web não está configurada neste ambiente.',
        'WEBAUTHN_UNAVAILABLE',
      );
    return new WebAuthnCeremony(rp);
  }
}

function passkey(credential: UserBiometricCredential): StoredPasskey[] {
  return credential.kind === 'WEBAUTHN' &&
    credential.webauthnCredentialId &&
    credential.publicKey
    ? [
        {
          webauthnId: credential.webauthnCredentialId,
          publicKey: credential.publicKey,
          signCount: credential.signCount,
          transports: credential.transports,
        },
      ]
    : [];
}

function view(credential: UserBiometricCredential): BiometricCredentialView {
  return {
    id: credential.id,
    kind: credential.kind,
    label: credential.label,
    createdAt: credential.createdAt.toISOString(),
    lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
  };
}

function refused(): UnauthorizedException {
  return new UnauthorizedException(
    'Biometria não reconhecida. Entre com a senha.',
    'BIOMETRIC_INVALID',
  );
}

function expiredChallenge(): UnauthorizedException {
  return new UnauthorizedException(
    'A confirmação expirou. Tente de novo.',
    'BIOMETRIC_CHALLENGE_EXPIRED',
  );
}
