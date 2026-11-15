import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions, Roles } from '../../decorators';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  CreatePlatformTenantDto,
  PlatformListQueryDto,
  UpdatePlatformOrganizationDto,
} from './dto/platform-administration.dto';
import { PlatformAdministrationService } from './platform-administration.service';
import type { Response } from 'express';

@ApiTags('Platform Administration')
@ApiBearerAuth()
@Controller('platform-admin')
@Roles('PLATFORM_ADMIN')
@Permissions('platform.admin')
export class PlatformAdministrationController {
  constructor(private readonly platform: PlatformAdministrationService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Return global platform administration totals' })
  overview() {
    return this.platform.overview();
  }

  @Get('organizations')
  @ApiOperation({ summary: 'List organizations across all tenants' })
  organizations(@Query() query: PlatformListQueryDto) {
    return this.platform.organizations(query);
  }

  @Get('organizations/:id')
  organization(@Param('id', ParseUUIDv7Pipe) id: string) {
    return this.platform.organization(id);
  }

  @Patch('organizations/:id')
  @ApiOperation({
    summary:
      'Update tenant display name/segment with optimistic concurrency; financial fields are read-only',
  })
  updateOrganization(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdatePlatformOrganizationDto,
  ) {
    return this.platform.updateOrganization(id, request.identity!.id, input);
  }

  @ApiAcceptedResponse({
    description:
      'Provisioning remains pending; consult provisioning.id and resume the same operation',
  })
  @Post('tenants')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({
    description:
      'Local provisioning persisted; owner setup and payment remain independent states',
  })
  @ApiOperation({
    summary: 'Provision a tenant and its first organization owner',
  })
  async createTenant(
    @Req() request: IdentityRequest,
    @Body() input: CreatePlatformTenantDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.platform.createTenant(
      request.identity!.id,
      input,
      key,
    );
    response.status(
      result?.provisioning?.complete ? HttpStatus.CREATED : HttpStatus.ACCEPTED,
    );
    return result;
  }

  @Get('tenant-provisionings/:id')
  provisioning(@Param('id', ParseUUIDv7Pipe) id: string) {
    return this.platform.provisioning(id);
  }

  @Post('tenant-provisionings/:id/resume')
  async resume(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.platform.resumeProvisioning(id);
    response.status(
      result?.provisioning?.complete ? HttpStatus.OK : HttpStatus.ACCEPTED,
    );
    return result;
  }

  @Get('users')
  @ApiOperation({ summary: 'List users across all tenants' })
  users(@Query() query: PlatformListQueryDto) {
    return this.platform.users(query);
  }

  @Get('resources')
  @ApiOperation({ summary: 'List plans and modules managed by the platform' })
  resources() {
    return this.platform.resources();
  }
}
