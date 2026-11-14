import { Injectable } from '@nestjs/common';
import { EmailService, type EmailSendResult } from '../../email/email.service';
import { actionEmail } from '../../email/email-template';
import {
  IdentityTokenPurpose,
  type IIdentityTokenDelivery,
} from '../domain/identity.types';
import { identityTokenLink } from '../domain/identity-links';

/** Identity and notifications share the sender; tokens never enter logs. */
@Injectable()
export class TransactionalIdentityTokenDelivery implements IIdentityTokenDelivery {
  constructor(private readonly email: EmailService) {}

  async deliver(
    purpose: IdentityTokenPurpose,
    recipient: string,
    token: string,
  ): Promise<EmailSendResult> {
    const copy = {
      EMAIL_VERIFICATION: {
        title: 'Bem-vindo ao Orbit! Confirme seu e-mail',
        introduction:
          'Sua conta foi criada. Confirme seu endereço de e-mail para manter seus dados de acesso atualizados e receber as comunicações do Orbit.',
        action: 'Confirmar meu e-mail',
        expiry:
          'Este link é exclusivo, pode ser usado uma única vez e vale por até 24 horas após a solicitação.',
      },
      PASSWORD_RESET: {
        title: 'Redefinição de senha do Orbit',
        introduction:
          'Recebemos uma solicitação para redefinir sua senha. Use o botão abaixo para escolher uma nova senha com segurança.',
        action: 'Redefinir minha senha',
        expiry:
          'Este link é temporário e pode ser usado uma única vez. Se você não fez a solicitação, sua senha permanece a mesma.',
      },
      INVITATION: {
        title: 'Você foi convidado para o Orbit',
        introduction:
          'Você recebeu um convite para participar de uma equipe no Orbit. Aceite o convite e defina sua senha.',
        action: 'Aceitar convite',
        expiry: 'Este convite vale por até 7 dias após a solicitação.',
      },
    }[purpose];
    return this.email.send({
      to: recipient,
      ...actionEmail({ ...copy, link: identityTokenLink(purpose, token) }),
    });
  }
}
