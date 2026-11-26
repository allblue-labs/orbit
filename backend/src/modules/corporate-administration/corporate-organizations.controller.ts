import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Public } from '../../decorators';
import { projectCorporateOrganization } from '../platform-administration/corporate-organization.read-model';
import { PlatformAdministrationRepository } from '../platform-administration/platform-administration.repository';
import {
  CorporateCaller,
  CorporateCapabilityGuard,
  RequiresCorporateCapability,
  TechnicalAuthenticationGuard,
  type CorporateCall,
} from './corporate-access.guard';
import {
  CorporateOrganizationQueryDto,
  UpdateCorporateOrganizationDto,
} from './corporate-organizations.dto';
import {
  ORGANIZATIONS_READ,
  ORGANIZATIONS_WRITE,
} from './technical-credential.service';

const corporateValidation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
});

function auditReference(
  call: CorporateCall,
  reference: unknown,
  required = false,
) {
  if (
    (required || reference !== undefined) &&
    (typeof reference !== 'string' || !isUUID(reference))
  ) {
    throw new BadRequestException('Invalid X-Nexus-Administrator-Id');
  }
  return {
    technicalPrincipalId: call.principal.id,
    declaredNexusAdministratorId:
      typeof reference === 'string' ? reference : undefined,
    correlationId: call.correlationId,
  };
}

@Public()
@UseGuards(TechnicalAuthenticationGuard, CorporateCapabilityGuard)
@Controller({ path: 'corporate-admin/organizations', version: '1' })
export class CorporateOrganizationsController {
  constructor(private readonly repository: PlatformAdministrationRepository) {}

  @Get()
  @RequiresCorporateCapability(ORGANIZATIONS_READ)
  async listOrganizations(
    @Query(corporateValidation) query: CorporateOrganizationQueryDto,
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
  ) {
    const { q, registeredFrom, registeredBefore, ...filters } = query;
    if (
      registeredFrom &&
      registeredBefore &&
      Date.parse(registeredFrom) >= Date.parse(registeredBefore)
    ) {
      throw new BadRequestException(
        'registeredBefore must be after registeredFrom',
      );
    }

    const lookupId = q && isUUID(q) ? q : undefined;
    const digits = q && /^[0-9./\s-]+$/.test(q) ? q.replace(/\D/g, '') : '';
    const document =
      digits.length === 11 || digits.length === 14 ? digits : undefined;
    const page = await this.repository.listCorporateOrganizations(
      {
        ...filters,
        registeredFrom,
        registeredBefore,
        lookupId,
        document,
        q: lookupId || document ? undefined : q,
      },
      auditReference(call, reference),
    );
    const now = new Date();
    return {
      ...page,
      items: page.items.map((item) => projectCorporateOrganization(item, now)),
    };
  }

  @Get(':id')
  @RequiresCorporateCapability(ORGANIZATIONS_READ)
  async getOrganization(
    @Param('id', ParseUUIDPipe) id: string,
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
  ) {
    const record = await this.repository.findCorporateOrganization(
      id,
      auditReference(call, reference),
    );
    if (!record) throw new NotFoundException();
    return projectCorporateOrganization(record, new Date());
  }

  @Patch(':id')
  @RequiresCorporateCapability(ORGANIZATIONS_WRITE)
  async updateOrganization(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(corporateValidation) input: UpdateCorporateOrganizationDto,
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
  ) {
    if (input.displayName === undefined && input.primarySegment === undefined) {
      throw new BadRequestException('Select at least one metadata field');
    }
    const updated = await this.repository.updateCorporateOrganizationMetadata(
      id,
      input,
      auditReference(call, reference, true),
    );
    if (updated.result === 'NOT_FOUND') throw new NotFoundException();
    if (updated.result === 'VERSION_CONFLICT') throw new ConflictException();
    return {
      id,
      updatedAt: updated.updatedAt,
      changedFields: updated.changedFields,
    };
  }
}
