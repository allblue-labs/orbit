import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import {
  createSesEmailClient,
  emailConfiguration,
} from '../modules/email/email.config';
import {
  resolveSesIdentity,
  validateSesConfiguration,
  sesPreflightFailureCode,
} from '../modules/email/ses-preflight';
loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
loadEnv({ path: resolve(process.cwd(), '../.env'), quiet: true });
/** Read-only AWS discovery. Output is configuration metadata, never AWS credentials. */
async function main() {
  const config = emailConfiguration();
  validateSesConfiguration(config);
  const account = process.env.AWS_SES_FEEDBACK_ACCOUNT_ID?.trim() ?? '';
  if (!/^\d{12}$/.test(account)) throw new Error('SES_ACCOUNT_REQUIRED');
  const client = createSesEmailClient(config);
  if (!client) throw new Error('SES_NOT_CONFIGURED');
  try {
    const sources = [
      ...new Set([
        config.from!,
        ...Object.values(config.routes ?? {})
          .map((route) => route.from)
          .filter((from): from is string => !!from),
      ]),
    ];
    const identities: Record<string, string> = {};
    for (const from of sources) {
      const identity = await resolveSesIdentity(client, { ...config, from });
      if (!identity?.details.VerifiedForSendingStatus)
        throw new Error('SES_SENDER_NOT_VERIFIED');
      identities[from] =
        `arn:aws:ses:${config.region}:${account}:identity/${identity.name}`;
    }
    console.log(
      `AWS_SES_FEEDBACK_SENDER_IDENTITIES=${JSON.stringify(identities)}`,
    );
  } finally {
    client.destroy();
  }
}
void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'ses_sender_resolution_failed',
      code: sesPreflightFailureCode(error),
    }),
  );
  process.exitCode = 1;
});
