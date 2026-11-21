import { Inject, Injectable } from '@nestjs/common';
import type { IUuidProvider } from '../../contracts';
import { UUID_PROVIDER } from '../../providers';
import {
  ConflictException,
  EntityNotFoundException,
  UnauthorizedException,
  ValidationException,
} from '../../exceptions';
import {
  AuthChallengeStore,
  WebAuthnCeremony,
  deviceLabelFrom,
  deviceSecretMatches,
  newDeviceSecret,
  relyingPartyFrom,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '../../common/biometrics';
import type { CustomerPortalSessionReadModel } from './customer-portal.read-models';
import { CustomerPortalRepository } from './customer-portal.repository';
import {
  CustomerPortalService,
  type PortalRequestMetadata,
} from './customer-portal.service';
import type { CustomerPortalActor } from './customer-portal.types';

export interface PortalBiometricView {
  id: string;
  kind: 'DEVICE' | 'WEBAUTHN';
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Entrar com a biometria — cliente.
 *
 * O mesmo desenho da equipe, no mundo do portal: a tabela tem RLS forçado e
 * só as funções do banco a tocam; cadastrar exige a sessão válida da própria
 * identidade; a sessão aberta é a do login com senha
 * (`CustomerPortalService.openVerifiedSession`).
 */
@Injectable()
export class CustomerPortalBiometricService {
  constructor(
    private readonly repository: CustomerPortalRepository,
    private readonly challenges: AuthChallengeStore,
    private readonly portal: CustomerPortalService,
    @Inject(UUID_PROVIDER) private readonly uuids: IUuidProvider,
  ) {}

  async list(actor: CustomerPortalActor): Promise<PortalBiometricView[]> {
    const rows = await this.repository.listBiometrics(
      actor.identityId,
      actor.sessionId,
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind === 'WEBAUTHN' ? 'WEBAUTHN' : 'DEVICE',
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    }));
  }

  async revoke(actor: CustomerPortalActor, id: string): Promise<void> {
    if (
      !(await this.repository.revokeBiometric(
        actor.identityId,
        actor.sessionId,
        id,
      ))
    )
      throw new EntityNotFoundException('Biometric credential', id);
  }

  /* ----------------------------- Web (WebAuthn) ---------------------------- */

  async registrationOptions(actor: CustomerPortalActor) {
    const ceremony = this.ceremony();
    const identity = await this.repository.findLoginIdentityById(
      actor.identityId,
    );
    if (!identity) throw new UnauthorizedException();
    const options = await ceremony.registrationOptions({
      userId: identity.id,
      userName: identity.email,
      displayName: identity.displayName,
      exclude: [],
    });
    const challengeId = await this.challenges.issue(
      'PORTAL_REGISTER',
      actor.identityId,
      options.challenge,
    );
    return { challengeId, options };
  }

  async register(
    actor: CustomerPortalActor,
    input: {
      challengeId: string;
      response: RegistrationResponseJSON;
      label?: string;
    },
    userAgent: string | undefined,
  ): Promise<PortalBiometricView[]> {
    const ceremony = this.ceremony();
    const challenge = await this.challenges.consume(
      input.challengeId,
      'PORTAL_REGISTER',
      actor.identityId,
    );
    if (!challenge) throw expiredChallenge();
    const key = await ceremony.verifyRegistration(input.response, challenge);
    if (!key)
      throw new ValidationException(
        'Não foi possível confirmar a biometria deste aparelho.',
        undefined,
        'BIOMETRIC_REGISTRATION_INVALID',
      );
    let saved = false;
    try {
      saved = await this.repository.registerBiometric({
        identityId: actor.identityId,
        sessionId: actor.sessionId,
        id: this.uuids.generate(),
        kind: 'WEBAUTHN',
        label: deviceLabelFrom(input.label, userAgent),
        webauthnId: key.webauthnId,
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
    if (!saved) throw new UnauthorizedException();
    return this.list(actor);
  }

  async authenticationOptions() {
    const options = await this.ceremony().authenticationOptions();
    const challengeId = await this.challenges.issue(
      'PORTAL_LOGIN',
      null,
      options.challenge,
    );
    return { challengeId, options };
  }

  async authenticate(
    input: { challengeId: string; response: AuthenticationResponseJSON },
    metadata: PortalRequestMetadata,
  ): Promise<CustomerPortalSessionReadModel> {
    const ceremony = this.ceremony();
    const challenge = await this.challenges.consume(
      input.challengeId,
      'PORTAL_LOGIN',
      null,
    );
    if (!challenge) throw expiredChallenge();
    const credential =
      typeof input.response?.id === 'string'
        ? await this.repository.findBiometric({ webauthnId: input.response.id })
        : null;
    if (
      !credential ||
      credential.kind !== 'WEBAUTHN' ||
      !credential.webauthnId ||
      !credential.publicKey
    )
      throw refused();
    const signCount = await ceremony.verifyAuthentication(
      input.response,
      challenge,
      {
        webauthnId: credential.webauthnId,
        publicKey: new Uint8Array(credential.publicKey),
        signCount: Number(credential.signCount),
        transports: credential.transports,
      },
    );
    if (signCount === null) throw refused();
    if (!(await this.repository.useBiometric(credential.id, { signCount })))
      throw refused();
    return this.portal.openVerifiedSession(credential.identityId, metadata);
  }

  /* ------------------------------ App (aparelho) --------------------------- */

  async enrollDevice(
    actor: CustomerPortalActor,
    input: { deviceId: string; label?: string },
    userAgent: string | undefined,
  ): Promise<{ credentialId: string; secret: string }> {
    const { secret, hash } = newDeviceSecret();
    const id = this.uuids.generate();
    const saved = await this.repository.registerBiometric({
      identityId: actor.identityId,
      sessionId: actor.sessionId,
      id,
      kind: 'DEVICE',
      label: deviceLabelFrom(input.label, userAgent),
      deviceId: input.deviceId,
      secretHash: hash,
    });
    if (!saved) throw new UnauthorizedException();
    return { credentialId: id, secret };
  }

  async deviceLogin(
    input: { credentialId: string; secret: string },
    metadata: PortalRequestMetadata,
  ): Promise<CustomerPortalSessionReadModel & { deviceSecret: string }> {
    const credential = await this.repository.findBiometric({
      credentialId: input.credentialId,
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
      !(await this.repository.useBiometric(credential.id, {
        expectedSecretHash: credential.secretHash,
        newSecretHash: next.hash,
      }))
    )
      throw refused();
    const session = await this.portal.openVerifiedSession(
      credential.identityId,
      metadata,
    );
    return { ...session, deviceSecret: next.secret };
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
