import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { FoundationModule } from '../common';
import { EmailModule } from '../modules/email/email.module';
import { EmailService } from '../modules/email/email.service';
import { EmailTransportRepository } from '../modules/email/email-transport.repository';
import { emailConfiguration } from '../modules/email/email.config';
import { sesFeedbackConfiguration } from '../modules/email/ses-feedback.config';
import { validateSesConfiguration } from '../modules/email/ses-preflight';

/** No IdentityModule, JobsModule or HTTP listener: never drains customer mail. */
@Module({ imports: [FoundationModule, EmailModule] })
class SesSimulationModule {}

export function simulatorRecipient(
  scenario: string,
  label: string = randomUUID(),
): string {
  if (!['success', 'bounce', 'complaint'].includes(scenario) || !isUUID(label))
    throw new Error('SES_SIMULATOR_ARGUMENT_INVALID');
  return `${scenario}+orbit-pr08-${label}@simulator.amazonses.com`;
}

async function main() {
  loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
  loadEnv({ path: resolve(process.cwd(), '../.env'), quiet: true });
  const args = process.argv.slice(2),
    scenario = args[0] ?? '';
  const recipient = simulatorRecipient(scenario);
  if (args.slice(1).some((value) => value !== '--send'))
    throw new Error('SES_SIMULATOR_ARGUMENT_INVALID');
  const feedback = sesFeedbackConfiguration(),
    email = emailConfiguration();
  validateSesConfiguration(email);
  if (!feedback.enabled || email.provider !== 'ses')
    throw new Error('SES_FEEDBACK_NOT_CONFIGURED');
  if (!args.includes('--send')) {
    console.log(
      JSON.stringify({
        event: 'ses_simulator',
        scenario,
        status: 'DRY_RUN',
        networkCalls: 0,
      }),
    );
    return;
  }
  const app = await NestFactory.createApplicationContext(SesSimulationModule, {
    logger: false,
  });
  try {
    const sender = app.get(EmailService),
      repository = app.get(EmailTransportRepository);
    const message = {
      to: recipient,
      subject: 'Orbit — teste controlado do Mailbox Simulator',
      text: 'Homologação de feedback SES/SNS. Nenhum dado ou token de cliente está incluído.',
    };
    const result = await sender.send(message);
    if (result.status === 'FAILED') {
      console.error(
        JSON.stringify({ event: 'ses_simulator', code: result.code }),
      );
      process.exitCode = 1;
      return;
    }
    if (result.status !== 'SENT' || !result.providerMessageId)
      throw new Error('SES_SIMULATOR_SEND_NOT_ACCEPTED');
    console.log(
      JSON.stringify({
        event: 'ses_simulator',
        scenario,
        providerMessageId: result.providerMessageId,
        status: 'ACCEPTED_BY_PROVIDER',
      }),
    );
    const expected =
      scenario === 'success'
        ? 'DELIVERY'
        : scenario === 'bounce'
          ? 'HARD_BOUNCE'
          : 'COMPLAINT';
    for (let attempt = 0; attempt < 30; attempt++) {
      const observed = await repository.inspectProviderMessage(
        result.providerMessageId,
      );
      if (observed?.feedbackStatus === expected) {
        if (expected !== 'DELIVERY') {
          const repeated = await sender.send(message);
          if (
            repeated.status !== 'FAILED' ||
            repeated.code !== 'EMAIL_SUPPRESSED' ||
            repeated.retryable
          )
            throw new Error('SES_SIMULATOR_SUPPRESSION_NOT_APPLIED');
          if (observed.suppressedRecipients !== 1)
            throw new Error('SES_SIMULATOR_SUPPRESSION_NOT_APPLIED');
        }
        console.log(
          JSON.stringify({
            event: 'ses_simulator',
            scenario,
            providerMessageId: result.providerMessageId,
            status: 'FEEDBACK_CONFIRMED',
            feedback: expected,
            suppressionVerified: expected !== 'DELIVERY',
          }),
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log(
      JSON.stringify({
        event: 'ses_simulator',
        scenario,
        providerMessageId: result.providerMessageId,
        status: 'AWAITING_SNS',
        qualified: false,
      }),
    );
    process.exitCode = 2;
  } finally {
    await app.close();
  }
}
if (require.main === module)
  void main().catch(() => {
    console.error(
      JSON.stringify({ event: 'ses_simulator', code: 'SES_SIMULATOR_FAILED' }),
    );
    process.exitCode = 1;
  });
