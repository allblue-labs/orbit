import { createPrivateKey } from 'node:crypto';
import { isEmail } from 'class-validator';
import { InfrastructureException } from '../../exceptions';

/** Service account fields come exclusively from environment, never a JSON file or ADC. */
export function firebasePushCredentials(env: NodeJS.ProcessEnv = process.env) {
  for (const key of [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
  ]) {
    if (!env[key]?.trim())
      throw new InfrastructureException(
        `${key} must be configured for Firebase push`,
      );
  }
  const projectId = env.FIREBASE_PROJECT_ID!.trim();
  const clientEmail = env.FIREBASE_CLIENT_EMAIL!.trim();
  const privateKey = env
    .FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId))
    throw new InfrastructureException('FIREBASE_PROJECT_ID is invalid');
  if (!isEmail(clientEmail) || !clientEmail.endsWith('.gserviceaccount.com'))
    throw new InfrastructureException(
      'FIREBASE_CLIENT_EMAIL must be a service account email',
    );
  try {
    if (createPrivateKey(privateKey).asymmetricKeyType !== 'rsa')
      throw new Error();
  } catch {
    // OpenSSL/SDK errors may include key material. Never propagate the original error.
    throw new InfrastructureException(
      'FIREBASE_PRIVATE_KEY must be a valid RSA private key',
    );
  }
  return { projectId, clientEmail, privateKey };
}
