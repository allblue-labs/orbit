import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import {
  AddRvtEquipmentDto,
  AddRvtEvidenceDto,
  CaptureCustomerAcknowledgementDto,
  CompleteRvtExecutionDto,
  CreateAdHocRvtDto,
  CreateRvtConfigurationDto,
  RegisterRvtEquipmentDto,
  RvtConfigurationQueryDto,
  RvtOccurrenceQueryDto,
  RvtTimelineQueryDto,
  StartRvtExecutionDto,
  UpdateRvtExecutionDto,
  UpdateRvtConfigurationDto,
  CreateRvtMaintenanceTypeDto,
  UpdateRvtMaintenanceTypeDto,
} from './rvt.dto';
import { RvtService } from './rvt.service';

@ApiTags('RVT V2')
@Controller('rvt')
@RequiresActivePlan()
export class RvtController {
  constructor(private readonly rvt: RvtService) {}
  /* ---------------------------------------------------------------- */
  /* Tipos de manutenção                                               */
  /* ---------------------------------------------------------------- */

  @Get('maintenance-types')
  @Capabilities('rvt.read')
  @Permissions('rvt.read')
  @ApiOperation({ summary: 'Tipos de manutenção, com o roteiro de cada um' })
  maintenanceTypes(
    @Req() r: IdentityRequest,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.rvt.listMaintenanceTypes(
      this.actor(r),
      includeInactive !== 'true',
    );
  }

  @Post('maintenance-types')
  @Capabilities('rvt.manage')
  @Permissions('rvt.manage')
  createMaintenanceType(
    @Req() r: IdentityRequest,
    @Body() i: CreateRvtMaintenanceTypeDto,
  ) {
    return this.rvt.createMaintenanceType(this.actor(r), i);
  }

  @Patch('maintenance-types/:id')
  @Capabilities('rvt.manage')
  @Permissions('rvt.manage')
  updateMaintenanceType(
    @Req() r: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() i: UpdateRvtMaintenanceTypeDto,
  ) {
    return this.rvt.updateMaintenanceType(this.actor(r), id, i);
  }

  @Delete('maintenance-types/:id')
  @Capabilities('rvt.manage')
  @Permissions('rvt.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMaintenanceType(
    @Req() r: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.rvt.removeMaintenanceType(this.actor(r), id);
  }

  @Post('configurations')
  @Capabilities('rvt.manage')
  @Permissions('rvt.manage')
  @ApiOperation({ summary: 'Create RVT configuration and planned occurrences' })
  create(@Req() r: IdentityRequest, @Body() i: CreateRvtConfigurationDto) {
    return this.rvt.create(this.actor(r), i);
  }
  @Get('configurations')
  @Capabilities('rvt.read')
  @Permissions('rvt.read')
  list(@Req() r: IdentityRequest, @Query() q: RvtConfigurationQueryDto) {
    return this.rvt.list(this.actor(r), q);
  }
  @Get('configurations/:id')
  @Capabilities('rvt.read')
  @Permissions('rvt.read')
  get(@Req() r: IdentityRequest, @Param('id', ParseUUIDv7Pipe) id: string) {
    return this.rvt.get(id, this.actor(r));
  }
  @Patch('configurations/:id')
  @Capabilities('rvt.manage')
  @Permissions('rvt.manage')
  updateConfiguration(
    @Req() r: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() i: UpdateRvtConfigurationDto,
  ) {
    return this.rvt.update(id, this.actor(r), i);
  }
  @Get('configurations/:id/timeline')
  @Capabilities('rvt.read')
  @Permissions('rvt.read')
  timeline(
    @Req() r: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Query() q: RvtTimelineQueryDto,
  ) {
    return this.rvt.timeline(id, this.actor(r), q);
  }
  @Get('occurrences')
  @Capabilities('rvt.read')
  @Permissions('rvt.read')
  occurrences(@Req() r: IdentityRequest, @Query() q: RvtOccurrenceQueryDto) {
    return this.rvt.occurrences(this.actor(r), q);
  }
  @Get('occurrences/:id/preparation')
  @Capabilities('rvt.execute')
  @Permissions('rvt.execute')
  preparation(
    @Req() r: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.rvt.preparation(id, this.actor(r));
  }
  @Post('occurrences/:id/start')
  @Capabilities('rvt.execute')
  @Permissions('rvt.execute')
  start(
    @Req() r: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() i: StartRvtExecutionDto,
  ) {
    return this.rvt.start(id, this.actor(r), i);
  }
  @Post('ad-hoc/executions')
  @Capabilities('rvt.execute')
  @Permissions('rvt.execute')
  adHoc(
    @Req() r: IdentityRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() i: CreateAdHocRvtDto,
  ) {
    return this.rvt.adHoc(this.actor(r), idempotencyKey, i);
  }
  @Get('executions/:id')
  @Capabilities('rvt.read')
  @Permissions('rvt.read')
  execution(
    @Req() r: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.rvt.execution(id, this.actor(r));
  }
  @Patch('executions/:id')
  @Capabilities('rvt.execute')
  @Permissions('rvt.execute')
  update(
    @Req() r: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() i: UpdateRvtExecutionDto,
  ) {
    return this.rvt.updateExecution(id, this.actor(r), i);
  }
  @Post('executions/:id/equipment')
  @Capabilities('rvt.execute')
  @Permissions('rvt.execute')
  addEquipment(
    @Req() r: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() i: AddRvtEquipmentDto,
  ) {
    return this.rvt.addExistingEquipment(id, this.actor(r), i.assetId);
  }
  @Post('executions/:id/equipment/register')
  @Capabilities('rvt.execute')
  @Permissions('rvt.execute')
  registerEquipment(
    @Req() r: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() i: RegisterRvtEquipmentDto,
  ) {
    return this.rvt.registerEquipment(id, this.actor(r), i);
  }
  @Post('executions/:id/evidence')
  @Capabilities('rvt.execute')
  @Permissions('rvt.execute')
  evidence(
    @Req() r: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() i: AddRvtEvidenceDto,
  ) {
    return this.rvt.addEvidence(id, this.actor(r), i);
  }
  @Post('executions/:id/customer-acknowledgement')
  @Capabilities('rvt.execute')
  @Permissions('rvt.execute')
  acknowledge(
    @Req() r: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() i: CaptureCustomerAcknowledgementDto,
  ) {
    return this.rvt.acknowledge(id, this.actor(r), i);
  }
  @Post('executions/:id/complete')
  @Capabilities('rvt.execute')
  @Permissions('rvt.execute')
  complete(
    @Req() r: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() i: CompleteRvtExecutionDto,
  ) {
    return this.rvt.complete(id, this.actor(r), i.performedAt);
  }
  @Post('executions/:id/artifact')
  @Capabilities('rvt.document')
  @Permissions('rvt.document')
  artifact(
    @Req() r: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.rvt.generateArtifact(id, this.actor(r));
  }
  @Post('executions/:id/render')
  @Capabilities('rvt.document')
  @Permissions('rvt.document')
  render(@Req() r: IdentityRequest, @Param('id', ParseUUIDv7Pipe) id: string) {
    return this.rvt.render(id, this.actor(r));
  }
  private actor(r: IdentityRequest) {
    const i = r.identity;
    if (!i?.organizationId)
      throw new ForbiddenException('Organization context required');
    return {
      organizationId: i.organizationId,
      actorId: i.id,
      businessUnitIds: i.businessUnitIds,
      permissions: i.permissions,
    };
  }
}
