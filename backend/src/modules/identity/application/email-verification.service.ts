import { Inject, Injectable, Logger } from '@nestjs/common';
import { ValidationException } from '../../../exceptions';
import {
  IDENTITY_TOKEN_DELIVERY,
  IdentityTokenPurpose,
  type IIdentityTokenDelivery,
} from '../domain/identity.types';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { IdentityTokenService } from './token.service';

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  constructor(
    private readonly repository: IdentityRepository,
    private readonly tokens: IdentityTokenService,
    @Inject(IDENTITY_TOKEN_DELIVERY)
    private readonly delivery: IIdentityTokenDelivery,
  ) {}

  /** Called after the account commits, independently of billing provisioning. */
  async sendWelcome(userId: string): Promise<void> {
    try {
      const token = this.tokens.generateOpaqueToken();
      const recipient = await this.repository.createEmailVerification(
        userId,
        this.tokens.hashOpaqueToken(token),
        new Date(Date.now() + 24 * 60 * 60_000),
      );
      if (recipient)
        await this.delivery.deliver(
          IdentityTokenPurpose.EMAIL_VERIFICATION,
          recipient,
          token,
        );
    } catch {
      // Account creation stays successful; the user can request a fresh email.
      this.logger.error(
        JSON.stringify({ event: 'email_verification_delivery_failed' }),
      );
    }
  }

  /** Uniform response for absent, already verified, disabled and throttled accounts. */
  async request(email: string): Promise<void> {
    const user = await this.repository.findByEmail(email);
    if (
      user &&
      !user.deletedAt &&
      user.status === 'ACTIVE' &&
      !user.emailVerifiedAt
    )
      await this.sendWelcome(user.id);
  }

  async confirm(token: string): Promise<void> {
    if (
      !(await this.repository.confirmEmail(this.tokens.hashOpaqueToken(token)))
    )
      throw new ValidationException(
        'Este link de confirmação é inválido, expirou ou já foi utilizado. Solicite um novo e-mail.',
      );
  }
}
