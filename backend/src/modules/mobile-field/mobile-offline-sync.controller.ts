import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ForbiddenException } from '../../exceptions';
import { Surfaces } from '../../decorators';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import { RequiresActivePlan } from '../subscription-plans/plan-access';
import {
  FieldPackageBatchDto,
  MobileSyncPullRequestDto,
  MobileSyncPushRequestDto,
} from './mobile-offline-sync.dto';
import { MobileOfflineSyncService } from './mobile-offline-sync.service';
import type { MobileFieldActor } from './mobile-field.service';

@ApiTags('Mobile Field Offline Sync')
@Controller('mobile/field/offline')
@Surfaces('MOBILE')
@RequiresActivePlan()
export class MobileOfflineSyncController {
  constructor(private readonly service: MobileOfflineSyncService) {}

  @Get('packages/:workItemId')
  @ApiOperation({
    summary: 'Gera FieldPackage bounded para cache offline autorizado',
  })
  fieldPackage(
    @Req() request: IdentityRequest,
    @Param('workItemId') id: string,
  ) {
    return this.service.package(this.actor(request), id);
  }

  @Post('packages')
  @ApiOperation({ summary: 'Gera até vinte FieldPackages autorizados' })
  packages(
    @Req() request: IdentityRequest,
    @Body() input: FieldPackageBatchDto,
  ) {
    return this.service.packages(this.actor(request), input.workItemIds);
  }

  @Post('sync/push')
  @ApiOperation({
    summary: 'Reexecuta commands offline nos handlers autoritativos',
  })
  push(
    @Req() request: IdentityRequest,
    @Body() input: MobileSyncPushRequestDto,
  ) {
    return this.service.push(this.actor(request), input.commands);
  }

  @Post('sync/pull')
  @ApiOperation({ summary: 'Retorna delta autoritativo por cursor opaco' })
  pull(
    @Req() request: IdentityRequest,
    @Body() input: MobileSyncPullRequestDto,
  ) {
    return this.service.pull(
      this.actor(request),
      input.cursor,
      input.knownWorkItemIds,
    );
  }

  private actor(request: IdentityRequest): MobileFieldActor {
    const identity = request.identity;
    if (!identity?.organizationId)
      throw new ForbiddenException('Contexto de organização obrigatório');
    return {
      id: identity.id,
      organizationId: identity.organizationId,
      businessUnitIds: identity.businessUnitIds,
      permissions: identity.permissions,
    };
  }
}
