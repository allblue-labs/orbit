import { Injectable, Logger } from '@nestjs/common';
import { ValidationException } from '../../../exceptions';
import { IdentityEmailOutbox } from '../infrastructure/identity-email.outbox';
import type { PrismaTransactionClient } from '../../../database/prisma.types';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { IdentityTokenService } from './token.service';

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  constructor(
    private readonly repository: IdentityRepository,
    private readonly tokens: IdentityTokenService,
    private readonly outbox: IdentityEmailOutbox,
  ) {}

  /** The registration/member transaction also persists the token and delivery. */
  queueWelcomeIn(tx: PrismaTransactionClient, userId: string, email: string) {
    return this.outbox.welcomeIn(tx, userId, email);
  }

  /** Resend: token replacement and durable delivery commit together. */
  async sendWelcome(userId: string): Promise<void> {
    try {
      const token = this.tokens.generateOpaqueToken();
      await this.repository.createEmailVerification(
        userId,
        this.tokens.hashOpaqueToken(token),
        new Date(Date.now() + 24 * 60 * 60_000),
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
