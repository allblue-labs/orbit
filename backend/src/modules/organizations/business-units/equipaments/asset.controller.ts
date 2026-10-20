import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permissions } from '../../../../decorators';
import { ForbiddenException } from '../../../../exceptions';
import { ParseUUIDv7Pipe } from '../../../../pipes';
import type { IdentityRequest } from '../../../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../../../subscription-plans/plan-access';
import { AssetQueryDto, CreateAssetDto, UpdateAssetDto } from './asset.dto';
import { AssetService } from './asset.service';
import { EquipmentQrRenderQueryDto } from './equipment-qr.dto';
import { EquipmentQrService } from './equipment-qr.service';

@ApiTags('Assets')
@Controller('assets')
@RequiresActivePlan()
export class AssetController {
  constructor(
    private readonly assets: AssetService,
    private readonly equipmentQr: EquipmentQrService,
  ) {}

  @Get()
  @Capabilities('assets.read')
  @Permissions('assets.read')
  list(@Req() request: IdentityRequest, @Query() query: AssetQueryDto) {
    return this.assets.list(this.organizationId(request), query);
  }

  @Get('resolve/:identifier')
  @Capabilities('assets.read')
  @Permissions('assets.read')
  resolve(
    @Param('identifier') identifier: string,
    @Req() request: IdentityRequest,
  ) {
    return this.assets.resolve(identifier, this.organizationId(request));
  }

  @Get('qr/:token')
  @Capabilities('assets.read')
  @Permissions('assets.read')
  @ApiOperation({
    summary: 'Resolve authenticated Equipment QR identity for field use',
  })
  resolveQr(@Param('token') token: string, @Req() request: IdentityRequest) {
    return this.equipmentQr.resolve(token, this.actor(request));
  }

  @Get(':id/qr')
  @Capabilities('assets.read')
  @Permissions('assets.read')
  qrSummary(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.equipmentQr.summary(id, this.actor(request));
  }

  @Post(':id/qr/ensure')
  @Capabilities('assets.manage', 'assets.qr.manage')
  @Permissions('assets.qr.manage')
  ensureQr(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.equipmentQr.ensure(id, this.actor(request));
  }

  @Post(':id/qr/rotate')
  @Capabilities('assets.manage', 'assets.qr.manage')
  @Permissions('assets.qr.manage')
  rotateQr(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.equipmentQr.rotate(id, this.actor(request));
  }

  @Post(':id/qr/revoke')
  @Capabilities('assets.manage', 'assets.qr.manage')
  @Permissions('assets.qr.manage')
  revokeQr(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.equipmentQr.revoke(id, this.actor(request));
  }

  @Get(':id/qr/render')
  @Capabilities('assets.read')
  @Permissions('assets.read')
  @ApiProduces('image/svg+xml', 'image/png', 'application/pdf')
  async renderQr(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Query() query: EquipmentQrRenderQueryDto,
    @Res() response: Response,
  ) {
    const rendered = await this.equipmentQr.render(
      id,
      this.actor(request),
      query,
    );
    response.setHeader('Content-Type', rendered.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${rendered.fileName}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(rendered.bytes);
  }

  @Get(':id/service-order-preparation')
  @Capabilities('assets.read', 'operations.manage')
  @Permissions('operations.create')
  @ApiOperation({
    summary: 'Prepare a service order without creating an Operation',
  })
  serviceOrderPreparation(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.equipmentQr.serviceOrderPreparation(id, this.actor(request));
  }

  @Get(':id')
  @Capabilities('assets.read')
  @Permissions('assets.read')
  get(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.assets.get(id, this.organizationId(request));
  }

  @Post()
  @Capabilities('assets.manage')
  @Permissions('assets.create')
  create(@Req() request: IdentityRequest, @Body() input: CreateAssetDto) {
    return this.assets.create(this.organizationId(request), input);
  }

  @Patch(':id')
  @Capabilities('assets.manage')
  @Permissions('assets.update')
  update(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateAssetDto,
  ) {
    return this.assets.update(id, this.organizationId(request), input);
  }

  @Delete(':id')
  @Capabilities('assets.manage')
  @Permissions('assets.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.assets.remove(id, this.organizationId(request));
  }

  private organizationId(request: IdentityRequest): string {
    const id = request.identity?.organizationId;
    if (!id) throw new ForbiddenException('Organization context is required');
    return id;
  }

  private actor(request: IdentityRequest) {
    const identity = request.identity;
    if (!identity?.organizationId)
      throw new ForbiddenException('Organization context is required');
    return {
      organizationId: identity.organizationId,
      actorId: identity.id,
      businessUnitIds: identity.businessUnitIds,
      permissions: identity.permissions,
    };
  }
}
