import type { ICryptoProvider } from '../../src/contracts';
import { generateTotpSecret, generateTotpToken } from '../../src/utils/totp';
import { adminPrisma } from './admin-prisma';

export async function seedActiveMfa(userId: string, crypto: ICryptoProvider) {
  const secret = generateTotpSecret();
  await adminPrisma().mfaFactor.create({
    data: { userId, secret: crypto.encrypt(secret), verifiedAt: new Date() },
  });
  return () => generateTotpToken(secret);
}
