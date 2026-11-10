import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { IHashProvider } from '../../contracts';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';
import { SlugHelper } from '../../helpers';
import { HASH_PROVIDER } from '../../providers';
import { RegistrationRepository } from '../identity/infrastructure/registration.repository';
import type { RegisterOrganizationDto } from '../identity/presentation/dto/identity.dto';
import type {
  CreatePlatformTenantDto,
  PlatformListQueryDto,
  UpdatePlatformOrganizationDto,
} from './dto/platform-administration.dto';
import { PlatformAdministrationRepository } from './platform-administration.repository';
import { EmailVerificationService } from '../identity/application/email-verification.service';

@Injectable()
export class PlatformAdministrationService {
  constructor(
    private readonly repository: PlatformAdministrationRepository,
    private readonly registration: RegistrationRepository,
    @Inject(HASH_PROVIDER) private readonly hashes: IHashProvider,
    private readonly verification?: EmailVerificationService,
  ) {}

  overview() {
    return this.repository.overview();
  }

  organizations(query: PlatformListQueryDto) {
    return this.repository.listOrganizations(query);
  }

  users(query: PlatformListQueryDto) {
    return this.repository.listUsers(query);
  }

  resources() {
    return this.repository.plansAndModules();
  }

  async organization(id: string) {
    const organization = await this.repository.findOrganization(id);
    if (!organization) throw new EntityNotFoundException('Organization', id);
    return organization;
  }

  async createTenant(actorId: string, input: CreatePlatformTenantDto) {
    const slug = SlugHelper.create(input.organizationName);
    if (!slug) throw new ValidationException('Invalid organization name');
    const registration: RegisterOrganizationDto = {
      email: input.owner.email,
      firstName: input.owner.firstName,
      lastName: input.owner.lastName,
      password: input.owner.password,
      organizationName: input.organizationName,
      legalName: input.primaryBusinessUnit.legalName,
      documentType: input.primaryBusinessUnit.documentType,
      documentNumber: input.primaryBusinessUnit.documentNumber,
      city: input.primaryBusinessUnit.city,
      street: input.primaryBusinessUnit.street,
      stateCode: input.primaryBusinessUnit.stateCode,
      primarySegment: input.primarySegment,
      planKey: input.planKey,
      businessUnitType: input.primaryBusinessUnit.type,
      client: 'WEB',
    };
    try {
      const result = await this.registration.register(
        registration,
        await this.hashes.hash(input.owner.password),
        slug,
        {
          actorUserId: actorId,
          platformAdmin: true,
          organizationStatus: input.organizationStatus,
          subscriptionStatus: input.subscriptionStatus,
          currentPeriodEnd: input.currentPeriodEnd,
          externalCustomerId: input.externalCustomerId,
          externalSubscriptionId: input.externalSubscriptionId,
        },
      );
      if (!result) throw new ValidationException('Invalid or inactive plan');
      await this.verification?.sendWelcome(result.userId);
      return this.organization(result.organizationId);
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

  async updateOrganization(
    id: string,
    actorId: string,
    input: UpdatePlatformOrganizationDto,
  ) {
    let planId: string | undefined;
    if (input.planKey) {
      const plan = await this.repository.findPlan(input.planKey);
      if (!plan) throw new ValidationException('Invalid or inactive plan');
      planId = plan.id;
    }
    const organization = await this.repository.updateOrganization(
      id,
      actorId,
      input,
      planId,
    );
    if (!organization) throw new EntityNotFoundException('Organization', id);
    return organization;
  }
}
