import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { IHashProvider } from '../../../contracts';
import { ConflictException, ValidationException } from '../../../exceptions';
import { SlugHelper } from '../../../helpers';
import { HASH_PROVIDER } from '../../../providers';
import { AuthenticationService } from './authentication.service';
import { RegistrationRepository } from '../infrastructure/registration.repository';
import type { RegisterOrganizationDto } from '../presentation/dto/identity.dto';
import type { SessionMetadata } from '../domain/identity.types';
import { SubscriptionProvisioningService } from '../../subscription-plans/subscriptions/subscription-provisioning.service';

@Injectable()
export class RegistrationService {
  constructor(
    private readonly repository: RegistrationRepository,
    private readonly authentication: AuthenticationService,
    @Inject(HASH_PROVIDER) private readonly hashes: IHashProvider,
    private readonly subscriptions: SubscriptionProvisioningService,
  ) {}

  async register(input: RegisterOrganizationDto, metadata: SessionMetadata) {
    const normalized = {
      ...input,
      email: input.email.trim().toLowerCase(),
    };
    const slug = SlugHelper.create(input.organizationName);
    if (!slug) throw new ValidationException('Invalid organization name');

    try {
      const created = await this.repository.register(
        normalized,
        await this.hashes.hash(input.password),
        slug,
      );
      if (!created) throw new ValidationException('Invalid plan');
      /**
       * A assinatura nasce junto com a organização.
       *
       * Depois do cadastro, e não dentro dele: a transação de registro é longa
       * o bastante, e uma recusa de avaliação não pode desfazer uma empresa
       * que acabou de se cadastrar corretamente.
       */
      await this.subscriptions.provision({
        organizationId: created.organizationId,
        planKey: normalized.planKey,
        legalDocument: normalized.documentNumber,
      });
      return this.authentication.login(
        normalized.email,
        input.password,
        undefined,
        metadata,
      );
    } catch (error) {
      if (error instanceof ValidationException) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Email, organization or document is already registered',
        );
      }
      throw error;
    }
  }
}
