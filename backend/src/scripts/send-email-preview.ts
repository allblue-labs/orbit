import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { isEmail } from 'class-validator';
import { FoundationModule } from '../common';
import { EmailModule } from '../modules/email/email.module';
import { EmailService } from '../modules/email/email.service';
import {
  transactionalEmail,
  TRANSACTIONAL_TEMPLATES,
  accountEmailLink,
} from '../modules/email/transactional-templates';
/** Operator only: no HTTP endpoint, signup, token issuance or customer queue. */
@Module({ imports: [FoundationModule, EmailModule] })
class EmailPreviewModule {}
async function main() {
  const recipient = process.argv.find((a) => a.startsWith('--to='))?.slice(5);
  if (!recipient || !isEmail(recipient) || !process.argv.includes('--send'))
    throw new Error('EMAIL_PREVIEW_REQUIRES_EXPLICIT_RECIPIENT_AND_SEND');
  process.env.JOBS_WORKER_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(EmailPreviewModule, {
    logger: false,
  });
  try {
    const sender = app.get(EmailService),
      link = accountEmailLink();
    const previews = TRANSACTIONAL_TEMPLATES.map((template) => ({
      template,
      ...transactionalEmail(template, {
        link,
        name: 'Cliente de teste',
        organizationName: 'Ambiente de staging',
        resources: ['clientes ativos', 'ordens de serviço no mês'],
      }),
    }));
    const html = `<!doctype html><html lang="pt-BR"><meta charset="UTF-8"><body style="font-family:Arial,sans-serif;background:#eef2f8;padding:20px"><h1>Orbit — prévia de e-mails transacionais</h1><p>Teste solicitado pelo administrador. Estes exemplos não indicam alterações reais de conta, senha ou plano. Nenhum link de verificação ou redefinição foi emitido.</p>${previews.map((p) => `<section style="margin:32px 0;border:1px solid #ddd;border-radius:20px;padding:12px;background:white"><h2>${p.subject}</h2>${p.html.replace(/<!doctype[^>]*>|<\/?html[^>]*>|<head>[\s\S]*?<\/head>|<\/?body[^>]*>/gi, '')}</section>`).join('')}</body></html>`;
    // Exactly two requested test messages per execution. No retry loop or bulk recipient input.
    for (const message of [
      {
        subject: '[TESTE STAGING] Orbit — seis modelos de e-mail',
        text:
          'Prévia de teste. Nenhuma ação real na sua conta.\n\n' +
          previews.map((p) => p.text).join('\n\n---\n\n'),
        html,
      },
      {
        subject: '[TESTE STAGING] Orbit — confirmação da integração Amazon SES',
        text: 'Este é um teste transacional solicitado pelo administrador do Orbit após a aprovação de produção do Amazon SES. Nenhuma senha, token ou dado de cliente foi incluído. Você recebeu somente este teste e uma prévia dos modelos.',
      },
    ]) {
      const result = await sender.send({ to: recipient, ...message });
      console.log(
        JSON.stringify({
          stage: 'ses-preview',
          status: result.status,
          ...(result.status === 'SENT'
            ? { providerMessageId: result.providerMessageId }
            : result.status === 'FAILED'
              ? { code: result.code }
              : {}),
        }),
      );
      if (result.status !== 'SENT') {
        process.exitCode = 1;
        break;
      }
    }
  } finally {
    await app.close();
  }
}
void main().catch(() => {
  console.error('EMAIL_PREVIEW_FAILED');
  process.exitCode = 1;
});
