import { Injectable } from '@nestjs/common';
import { EmailService, type EmailSendResult } from '../../email/email.service';
import { transactionalEmail } from '../../email/transactional-templates';
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
    identityDeliveryId?: string,
    template?: 'WELCOME',
  ): Promise<EmailSendResult> {
    if (purpose === 'INVITATION')
      return { status: 'SKIPPED', provider: 'noop' };
    return this.email.send({
      to: recipient,
      ...(identityDeliveryId ? { identityDeliveryId } : {}),
      ...transactionalEmail(
        purpose === 'EMAIL_VERIFICATION' && template === 'WELCOME'
          ? 'WELCOME'
          : purpose,
        {
          link: identityTokenLink(purpose, token),
        },
      ),
    });
  }
}
