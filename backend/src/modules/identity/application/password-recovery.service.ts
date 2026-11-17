import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IHashProvider } from '../../../contracts';
import { HASH_PROVIDER } from '../../../providers';
import { ValidationException } from '../../../exceptions';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { IdentityTokenService } from './token.service';
import {
  PASSWORD_RESET_TTL_MS,
  PASSWORD_RESET_INVALID_MESSAGE,
  usablePasswordReset,
} from '../domain/password-reset.policy';

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
        new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        token,
      );
    } catch {
      // Database/outbox failures must not disclose whether the mailbox exists.
      this.logger.error(
        JSON.stringify({ event: 'password_reset_enqueue_failed' }),
      );
    }
  }

  private async validReset(token: string) {
    const reset = await this.repository.findPasswordReset(
      this.tokens.hashOpaqueToken(token),
    );
    if (!reset || !usablePasswordReset(reset)) {
      throw new ValidationException(
        PASSWORD_RESET_INVALID_MESSAGE,
        undefined,
        'PASSWORD_RESET_INVALID',
      );
    }
    return reset;
  }

  /** Read-only check; opening an email never consumes its token. */
  async validate(token: string): Promise<void> {
    await this.validReset(token);
  }

  async reset(token: string, password: string): Promise<void> {
    const reset = await this.validReset(token);
    await this.repository.consumePasswordReset(
      reset.id,
      reset.userId,
      await this.hashes.hash(password),
    );
  }
}
