import { Injectable } from '@nestjs/common';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { InfrastructureException } from '../../../exceptions';
import type {
  IdentityTokenPurpose,
  IIdentityTokenDelivery,
} from '../domain/identity.types';
import { IdentityTokenPurpose as Purpose } from '../domain/identity.types';
import { identityTokenLink } from '../domain/identity-links';

/**
 * Safe default until an email provider is connected. It deliberately does not
 * log or expose secrets. Production deployments should replace this provider.
 */
@Injectable()
export class NoopIdentityTokenDelivery implements IIdentityTokenDelivery {
  deliver(
    purpose: IdentityTokenPurpose,
    recipient: string,
    token: string,
  ): Promise<void> {
    void purpose;
    void recipient;
    void token;
    return Promise.resolve();
  }
}

/**
 * Production delivery for the already-public invitation and password recovery
 * flows. Tokens exist only in the HTTPS link sent to the intended recipient;
 * neither the token nor the provider response is logged.
 */
@Injectable()
export class SmtpIdentityTokenDelivery implements IIdentityTokenDelivery {
  async deliver(
    purpose: IdentityTokenPurpose,
    recipient: string,
    token: string,
  ): Promise<void> {
    const invitation = purpose === Purpose.INVITATION;
    /** O mesmo montador que o link compartilhável usa — uma rota só. */
    const link = identityTokenLink(purpose, token);

    const options: SendMailOptions = {
      from: this.required('EMAIL_FROM'),
      to: recipient,
      subject: invitation
        ? 'Você foi convidado para o Orbit'
        : 'Redefinição de senha do Orbit',
      text: invitation
        ? `Use este link para aceitar o convite e definir sua senha:\n\n${link}\n\nSe você não esperava este convite, ignore esta mensagem.`
        : `Use este link para redefinir sua senha:\n\n${link}\n\nSe você não solicitou a alteração, ignore esta mensagem.`,
    };

    try {
      await this.send(options);
    } catch {
      throw new InfrastructureException('Identity token delivery failed');
    }
  }

  protected async send(options: SendMailOptions): Promise<void> {
    const user = process.env.SMTP_USER?.trim();
    const password = process.env.SMTP_PASSWORD?.trim();
    const transporter = nodemailer.createTransport({
      host: this.required('SMTP_HOST'),
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      requireTLS: process.env.SMTP_SECURE !== 'true',
      auth: user && password ? { user, pass: password } : undefined,
    });
    await transporter.sendMail(options);
  }

  private required(key: string): string {
    const value = process.env[key]?.trim();
    if (!value) {
      throw new InfrastructureException(`${key} is required`);
    }
    return value;
  }
}
