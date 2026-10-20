import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions, Surfaces } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import { RegisterMobileDeviceDto } from './mobile-device.dto';
import { MobileDeviceService } from './mobile-device.service';

@ApiTags('Mobile Device Registry')
@Controller('mobile/devices')
@Surfaces('MOBILE')
@RequiresActivePlan()
@Capabilities('notifications.read')
@Permissions('notifications.read')
export class MobileDeviceController {
  constructor(private readonly devices: MobileDeviceService) {}

  @Post()
  @ApiOperation({
    summary: 'Registra ou rotaciona o token da instalação atual',
  })
  register(
    @Req() request: IdentityRequest,
    @Body() input: RegisterMobileDeviceDto,
  ) {
    return this.devices.register(this.actor(request), input);
  }

  @Get()
  @ApiOperation({
    summary: 'Lista somente as instalações ativas do usuário atual',
  })
  list(@Req() request: IdentityRequest) {
    return this.devices.list(this.actor(request));
  }

  @Delete(':deviceInstanceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove o binding da instalação no logout' })
  revoke(
    @Req() request: IdentityRequest,
    @Param('deviceInstanceId') deviceInstanceId: string,
  ) {
    return this.devices.revoke(this.actor(request), deviceInstanceId);
  }

  private actor(request: IdentityRequest) {
    const identity = request.identity;
    if (!identity?.organizationId)
      throw new ForbiddenException('Organization context is required');
    return { id: identity.id, organizationId: identity.organizationId };
  }
}
