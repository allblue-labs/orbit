import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IHashProvider } from '../../../contracts';
import { HASH_PROVIDER } from '../../../providers';
import { ValidationException } from '../../../exceptions';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { IdentityTokenService } from './token.service';

@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);

  constructor(
    private readonly repository: IdentityRepository,
    private readonly tokens: IdentityTokenService,
    @Inject(HASH_PROVIDER) private readonly hashes: IHashProvider,
  ) {}

  async request(email: string): Promise<void> {
    const user = await this.repository.findByEmail(email);
    if (!user || user.deletedAt || user.status !== 'ACTIVE' || !user.credential)
      return;
    const token = this.tokens.generateOpaqueToken();
    try {
      await this.repository.createPasswordReset(
        user.id,
        this.tokens.hashOpaqueToken(token),
        new Date(Date.now() + 30 * 60_000),
        token,
      );
    } catch {
      // Database/outbox failures must not disclose whether the mailbox exists.
      this.logger.error(
        JSON.stringify({ event: 'password_reset_enqueue_failed' }),
      );
    }
  }

  async reset(token: string, password: string): Promise<void> {
    const reset = await this.repository.findPasswordReset(
      this.tokens.hashOpaqueToken(token),
    );
    if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now()) {
      throw new ValidationException('Invalid or expired reset token');
    }
    await this.repository.consumePasswordReset(
      reset.id,
      reset.userId,
      await this.hashes.hash(password),
    );
  }
}
