import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Surfaces } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import { NotificationPreferenceDto } from './notification.dto';
import { NotificationService } from './notification.service';

// Personal preferences require authentication, but no notification-management
// permission or paid feature. The tenant and recipient always come from JWT.
@ApiTags('Notifications')
@Controller('notifications/preferences')
@Surfaces('WEB', 'MOBILE', 'API')
export class NotificationPreferencesController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  preferences(@Req() req: IdentityRequest) {
    const identity = this.identity(req);
    return this.notifications.preferences(identity.organizationId, identity.id);
  }

  @Patch()
  setPreference(
    @Req() req: IdentityRequest,
    @Body() input: NotificationPreferenceDto,
  ) {
    const identity = this.identity(req);
    return this.notifications.preference(
      identity.organizationId,
      identity.id,
      input,
    );
  }

  private identity(req: IdentityRequest) {
    const identity = req.identity;
    if (!identity?.id || !identity.organizationId)
      throw new ForbiddenException('Organization context is required');
    return { id: identity.id, organizationId: identity.organizationId };
  }
}
