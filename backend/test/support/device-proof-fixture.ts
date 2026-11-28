import { generateKeyPairSync, sign } from 'node:crypto';

export function deviceProofFixture() {
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const point = key.publicKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(point.x!, 'base64url'),
    Buffer.from(point.y!, 'base64url'),
  ]).toString('base64url');

  return {
    publicKey,
    prove(options: { challengeId: string; challenge: string }) {
      return {
        ...options,
        signature: sign(
          'sha256',
          Buffer.from(options.challenge, 'ascii'),
          key.privateKey,
        ).toString('base64url'),
      };
    },
  };
}
