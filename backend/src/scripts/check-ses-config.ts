import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import {
  createSesEmailClient,
  emailConfiguration,
} from '../modules/email/email.config';
import {
  sesPreflight,
  validateSesConfiguration,
  sesPreflightFailureCode,
} from '../modules/email/ses-preflight';

loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
loadEnv({ path: resolve(process.cwd(), '../.env'), quiet: true });

async function main() {
  const config = emailConfiguration();
  validateSesConfiguration(config);
  if (!process.argv.includes('--remote')) {
    console.log(
      'Configuração local válida. Para consultar identidade, envio, sandbox e quotas na AWS, acrescente --remote. Nenhum e-mail será enviado.',
    );
    return;
  }
  const client = createSesEmailClient(config);
  if (!client) throw new Error('SES_PREFLIGHT_UNAVAILABLE');
  try {
    const report = await sesPreflight(client, config);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'READY') process.exitCode = 2;
  } finally {
    client.destroy();
  }
}
void main().catch((error: unknown) => {
  // Do not echo SDK errors or env values: AWS can include identities/credentials.
  console.error(
    JSON.stringify({
      event: 'ses_preflight_failed',
      code: sesPreflightFailureCode(error),
    }),
  );
  console.error(
    'Não foi possível validar o SES. Confira AWS_REGION, AWS_SES_FROM_EMAIL e as credenciais; a consulta remota exige ses:GetAccount e ses:GetEmailIdentity na região selecionada.',
  );
  process.exitCode = 1;
});
