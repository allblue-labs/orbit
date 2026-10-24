import { LEGAL_DOCUMENT_VERSION } from '../../../contracts/modules/legal/legal.read-models';
import { Inject, Injectable } from '@nestjs/common';
import type { IHashProvider } from '../../../contracts';
import { ValidationException } from '../../../exceptions';
import { registrationConflict } from './registration-conflicts';
import { normalizeBrazilianDocument } from '../../../utils';
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
    if (
      input.acceptTerms !== true ||
      input.termsVersion !== LEGAL_DOCUMENT_VERSION ||
      input.privacyVersion !== LEGAL_DOCUMENT_VERSION
    ) {
      throw new ValidationException(
        'The current Terms of Use and Privacy Policy must be accepted',
      );
    }
    const normalized = {
      ...input,
      email: input.email.trim().toLowerCase(),
      documentNumber: normalizeBrazilianDocument(input.documentNumber),
    };
    const slug = SlugHelper.create(input.organizationName);
    if (!slug) throw new ValidationException('Invalid organization name');

    try {
      const created = await this.repository.register(
        normalized,
        await this.hashes.hash(input.password),
        slug,
        { publicSignup: true },
        metadata,
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
        billingInterval: normalized.billingInterval,
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
      const conflict = registrationConflict(error);
      if (conflict) throw conflict;
      throw error;
    }
  }
}
