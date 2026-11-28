import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { OmitType, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsObject, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { Public } from '../../decorators';
import { ParseUUIDv7Pipe } from '../../pipes';
import {
  CreatePlatformTenantDto,
  PlatformPrimaryBusinessUnitDto,
  PlatformTenantOwnerDto,
} from '../platform-administration/dto/platform-administration.dto';
import { PlatformAdministrationService } from '../platform-administration/platform-administration.service';
import { TenantOperationAdminService } from '../tenant-operations/tenant-operation-admin.service';
import { ChangeTenantOperationDto } from '../tenant-operations/tenant-operation.dto';
import {
  CorporateCaller,
  CorporateCapabilityGuard,
  RequiresCorporateCapability,
  TechnicalAuthenticationGuard,
  type CorporateCall,
} from './corporate-access.guard';
import { corporateValidation } from './corporate-request';
import {
  ORGANIZATIONS_PROVISION,
  ORGANIZATIONS_PROVISIONING_READ,
} from './technical-credential.service';

class CorporateTenantOwnerDto extends OmitType(PlatformTenantOwnerDto, [
  'password',
] as const) {}
class CorporatePrimaryUnitDto extends OmitType(PlatformPrimaryBusinessUnitDto, [
  'tradeName',
] as const) {}
class CreateCorporateTenantDto extends PickType(CreatePlatformTenantDto, [
  'organizationName',
  'primarySegment',
  'planKey',
  'billingInterval',
] as const) {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CorporateTenantOwnerDto)
  owner!: CorporateTenantOwnerDto;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CorporatePrimaryUnitDto)
  primaryBusinessUnit!: CorporatePrimaryUnitDto;
}

@Public()
@UseGuards(TechnicalAuthenticationGuard, CorporateCapabilityGuard)
@Controller({ path: 'corporate-admin', version: '1' })
export class CorporateTenantLifecycleController {
  constructor(
    private readonly platform: PlatformAdministrationService,
    private readonly operations: TenantOperationAdminService,
  ) {}

  @Post('organizations')
  @RequiresCorporateCapability(ORGANIZATIONS_PROVISION)
  async provisionTenant(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(corporateValidation) input: CreateCorporateTenantDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.platform.createCorporateTenant(
      call,
      reference,
      { ...input, organizationStatus: 'ACTIVE' },
      key,
    );
    response.status(result.complete ? HttpStatus.CREATED : HttpStatus.ACCEPTED);
    return result;
  }

  @Get('tenant-provisionings/:id')
  @RequiresCorporateCapability(ORGANIZATIONS_PROVISIONING_READ)
  readProvisioning(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
  ) {
    return this.platform.getCorporateProvisioning(call, reference, id);
  }

  @Post('tenant-provisionings/:id/resume')
  @RequiresCorporateCapability(ORGANIZATIONS_PROVISION)
  async resumeProvisioning(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.platform.resumeCorporateProvisioning(
      call,
      reference,
      id,
    );
    response.status(result.complete ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return result;
  }

  @Post('organizations/:id/operational-status')
  @HttpCode(HttpStatus.CREATED)
  @RequiresCorporateCapability('operational-status')
  changeOperationalStatus(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(corporateValidation) input: ChangeTenantOperationDto,
  ) {
    return this.operations.changeCorporate(id, input, key, call, reference);
  }
}
