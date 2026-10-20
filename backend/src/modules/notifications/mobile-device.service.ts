import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { RegisterMobileDeviceDto } from './mobile-device.dto';
import { MobileDeviceRepository } from './mobile-device.repository';
import type { MobileDeviceInstallationReadModel } from './mobile-device.read-models';

@Injectable()
export class MobileDeviceService {
  private readonly logger = new Logger(MobileDeviceService.name);

  constructor(private readonly repository: MobileDeviceRepository) {}

  async register(
    actor: { id: string; organizationId: string },
    input: RegisterMobileDeviceDto,
  ): Promise<MobileDeviceInstallationReadModel> {
    const installation = await this.repository.register(
      input,
      createHash('sha256').update(input.pushToken).digest('hex'),
    );
    this.logger.log(
      JSON.stringify({
        event: 'mobile_installation_registered',
        platform: input.platform,
        provider: input.pushProvider,
        actorId: actor.id,
        organizationId: actor.organizationId,
      }),
    );
    return this.map(installation);
  }

  async list(actor: {
    id: string;
    organizationId: string;
  }): Promise<MobileDeviceInstallationReadModel[]> {
    return (await this.repository.list(actor.organizationId, actor.id)).map(
      (item) => this.map(item),
    );
  }

  async revoke(
    actor: { id: string; organizationId: string },
    deviceInstanceId: string,
  ): Promise<void> {
    await this.repository.revoke(
      actor.organizationId,
      actor.id,
      deviceInstanceId,
    );
    this.logger.log(
      JSON.stringify({
        event: 'mobile_installation_revoked',
        actorId: actor.id,
        organizationId: actor.organizationId,
      }),
    );
  }

  private map(value: {
    id: string;
    deviceInstanceId: string;
    platform: string;
    pushProvider: string;
    appVersion: string;
    osVersion: string | null;
    locale: string | null;
    timezone: string | null;
    enabled: boolean;
    lastSeenAt: Date;
    tokenUpdatedAt: Date;
    createdAt: Date;
    revokedAt: Date | null;
  }): MobileDeviceInstallationReadModel {
    return {
      id: value.id,
      deviceInstanceId: value.deviceInstanceId,
      platform: value.platform as MobileDeviceInstallationReadModel['platform'],
      pushProvider:
        value.pushProvider as MobileDeviceInstallationReadModel['pushProvider'],
      appVersion: value.appVersion,
      osVersion: value.osVersion,
      locale: value.locale,
      timezone: value.timezone,
      enabled: value.enabled,
      lastSeenAt: value.lastSeenAt.toISOString(),
      tokenUpdatedAt: value.tokenUpdatedAt.toISOString(),
      createdAt: value.createdAt.toISOString(),
      revokedAt: value.revokedAt?.toISOString() ?? null,
    };
  }
}
