import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IHashProvider } from '../../../contracts';
import { HASH_PROVIDER } from '../../../providers';
import { ValidationException } from '../../../exceptions';
import {
  IDENTITY_TOKEN_DELIVERY,
  IdentityTokenPurpose,
  type IIdentityTokenDelivery,
} from '../domain/identity.types';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { IdentityTokenService } from './token.service';

@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);

  constructor(
    private readonly repository: IdentityRepository,
    private readonly tokens: IdentityTokenService,
    @Inject(HASH_PROVIDER) private readonly hashes: IHashProvider,
    @Inject(IDENTITY_TOKEN_DELIVERY)
    private readonly delivery: IIdentityTokenDelivery,
  ) {}

  async request(email: string): Promise<void> {
    const user = await this.repository.findByEmail(email);
    if (!user || user.deletedAt || !user.credential) return;
    const token = this.tokens.generateOpaqueToken();
    await this.repository.createPasswordReset(
      user.id,
      this.tokens.hashOpaqueToken(token),
      new Date(Date.now() + 30 * 60_000),
    );
    /**
     * A falha de entrega **não** pode mudar a resposta.
     *
     * Sem este `catch` o endpoint era um oráculo de enumeração de contas:
     * e-mail inexistente saía cedo com 202, e-mail existente chegava ao envio e,
     * com o SMTP indisponível, estourava 500. Quem quisesse descobrir se uma
     * pessoa tem conta no Orbit só precisava comparar os dois códigos —
     * verificado ao vivo, 202 contra 500.
     *
     * O token já foi gravado; o que se perde é a entrega. O registro fica sem
     * destinatário e sem token: o que o operador precisa saber é que o canal
     * caiu, não para quem.
     */
    try {
      await this.delivery.deliver(
        IdentityTokenPurpose.PASSWORD_RESET,
        user.email,
        token,
      );
    } catch {
      this.logger.error('Password reset delivery failed');
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
