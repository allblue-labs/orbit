import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { UnauthorizedException, ValidationException } from '../../exceptions';
import type {
  AuthChallengeStore,
  ChallengePurpose,
} from './auth-challenge.store';

export const DEVICE_CHALLENGE_PATTERN = /^orbit-device-v1\.[A-Za-z0-9_-]{43}$/;

export interface DeviceProof {
  challengeId: string;
  challenge: string;
  signature: string;
}

export async function issueDeviceChallenge(
  store: AuthChallengeStore,
  purpose: ChallengePurpose,
  subjectId: string,
) {
  const challenge = `orbit-device-v1.${randomBytes(32).toString('base64url')}`;
  const challengeId = await store.issue(purpose, subjectId, challenge);
  return { challengeId, challenge };
}

function deviceProofMatches(
  publicKey: Uint8Array,
  input: DeviceProof,
): boolean {
  const point = Buffer.from(publicKey);
  const signature = Buffer.from(input.signature, 'base64url');
  if (
    point.length !== 65 ||
    point[0] !== 4 ||
    signature.length < 8 ||
    signature.length > 72 ||
    signature.toString('base64url') !== input.signature ||
    !DEVICE_CHALLENGE_PATTERN.test(input.challenge)
  )
    return false;
  try {
    const key = createPublicKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33, 65).toString('base64url'),
      },
    });
    return verify(
      'sha256',
      Buffer.from(input.challenge, 'ascii'),
      key,
      signature,
    );
  } catch {
    return false;
  }
}

async function takeDeviceProof(
  store: AuthChallengeStore,
  purpose: ChallengePurpose,
  subjectId: string,
  input: DeviceProof,
  key: Uint8Array,
) {
  if (!deviceProofMatches(key, input)) return false;
  return !!(await store.consume(
    input.challengeId,
    purpose,
    subjectId,
    input.challenge,
  ));
}

export async function verifyDeviceRegistration(
  store: AuthChallengeStore,
  purpose: ChallengePurpose,
  sessionId: string,
  input: DeviceProof & { publicKey: string },
) {
  const key = Buffer.from(input.publicKey, 'base64url');
  if (
    key.toString('base64url') !== input.publicKey ||
    !(await takeDeviceProof(store, purpose, sessionId, input, key))
  )
    throw new ValidationException(
      'Não foi possível confirmar a biometria deste aparelho.',
      undefined,
      'BIOMETRIC_REGISTRATION_INVALID',
    );
  return key;
}

export async function verifyDeviceLogin(
  store: AuthChallengeStore,
  purpose: ChallengePurpose,
  input: DeviceProof & { credentialId: string },
  publicKey: Uint8Array,
) {
  if (!deviceProofMatches(publicKey, input)) {
    throw deviceBiometricRefused();
  }
  if (
    !(await store.consume(
      input.challengeId,
      purpose,
      input.credentialId,
      input.challenge,
    ))
  ) {
    throw new UnauthorizedException(
      'A confirmação expirou. Tente de novo.',
      'BIOMETRIC_CHALLENGE_EXPIRED',
    );
  }
}

export function deviceBiometricRefused() {
  return new UnauthorizedException(
    'Biometria não reconhecida. Entre com a senha.',
    'BIOMETRIC_INVALID',
  );
}
