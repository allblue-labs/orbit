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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import {
  CreateNotificationDto,
  NotificationQueryDto,
  RegisterPushSubscriptionDto,
  UnregisterPushSubscriptionDto,
} from './notification.dto';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@Controller('notifications')
@RequiresActivePlan()
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @Capabilities('notifications.read')
  @Permissions('notifications.read')
  list(@Req() req: IdentityRequest, @Query() query: NotificationQueryDto) {
    return this.notifications.list(this.org(req), req.identity!.id, query);
  }

  @Post('push-subscriptions')
  @Capabilities('notifications.read')
  @Permissions('notifications.read')
  registerPush(
    @Req() req: IdentityRequest,
    @Body() input: RegisterPushSubscriptionDto,
  ) {
    return this.notifications.registerPush(
      this.org(req),
      req.identity!.id,
      input,
      req.header('user-agent'),
    );
  }

  @Delete('push-subscriptions')
  @Capabilities('notifications.read')
  @Permissions('notifications.read')
  @HttpCode(HttpStatus.NO_CONTENT)
  unregisterPush(
    @Req() req: IdentityRequest,
    @Body() input: UnregisterPushSubscriptionDto,
  ) {
    return this.notifications.unregisterPush(
      this.org(req),
      req.identity!.id,
      input.endpoint,
    );
  }

  @Post()
  @Capabilities('notifications.manage')
  @Permissions('notifications.create')
  create(@Req() req: IdentityRequest, @Body() input: CreateNotificationDto) {
    return this.notifications.create(this.org(req), input);
  }

  @Post(':id/dispatch')
  @Capabilities('notifications.manage')
  @Permissions('notifications.dispatch')
  dispatch(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() req: IdentityRequest,
  ) {
    return this.notifications.dispatch(id, this.org(req));
  }

  @Patch('read-all')
  @Capabilities('notifications.read')
  @Permissions('notifications.read')
  markAllRead(@Req() req: IdentityRequest) {
    return this.notifications.markAllRead(this.org(req), req.identity!.id);
  }

  @Get(':id')
  @Capabilities('notifications.read')
  @Permissions('notifications.read')
  get(@Param('id', ParseUUIDv7Pipe) id: string, @Req() req: IdentityRequest) {
    return this.notifications.get(id, this.org(req), req.identity!.id);
  }

  @Patch(':id/read')
  @Capabilities('notifications.read')
  @Permissions('notifications.read')
  markRead(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() req: IdentityRequest,
  ) {
    return this.notifications.markRead(id, this.org(req), req.identity!.id);
  }

  private org(req: IdentityRequest) {
    if (!req.identity?.organizationId)
      throw new ForbiddenException('Organization context is required');
    return req.identity.organizationId;
  }
}
