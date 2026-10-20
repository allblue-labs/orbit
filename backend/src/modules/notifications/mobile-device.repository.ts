import { Injectable } from '@nestjs/common';
import { RlsTransaction } from '../../database';
import { generateUuidV7 } from '../../utils';
import type { RegisterMobileDeviceDto } from './mobile-device.dto';

@Injectable()
export class MobileDeviceRepository {
  constructor(private readonly rls: RlsTransaction) {}

  register(input: RegisterMobileDeviceDto, tokenHash: string) {
    return this.rls.run(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT app_register_mobile_installation(
          ${generateUuidV7()}::uuid,
          ${input.deviceInstanceId}::varchar,
          ${input.platform}::varchar,
          ${input.pushProvider}::varchar,
          ${input.pushToken}::text,
          ${tokenHash}::char(64),
          ${input.appVersion}::varchar,
          ${input.osVersion ?? null}::varchar,
          ${input.locale ?? null}::varchar,
          ${input.timezone ?? null}::varchar
        ) AS id
      `;
      const installation = await tx.mobileDeviceInstallation.findUniqueOrThrow({
        where: { id: rows[0]!.id },
      });
      await tx.auditLog.create({
        data: {
          organizationId: installation.organizationId,
          userId: installation.userId,
          action: 'mobile.installation.registered',
          entityType: 'MOBILE_DEVICE_INSTALLATION',
          entityId: installation.id,
          after: {
            platform: installation.platform,
            pushProvider: installation.pushProvider,
            appVersion: installation.appVersion,
          },
        },
      });
      return installation;
    });
  }

  list(organizationId: string, userId: string) {
    return this.rls.run((tx) =>
      tx.mobileDeviceInstallation.findMany({
        where: { organizationId, userId, enabled: true, revokedAt: null },
        orderBy: { lastSeenAt: 'desc' },
      }),
    );
  }

  revoke(organizationId: string, userId: string, deviceInstanceId: string) {
    return this.rls.run(async (tx) => {
      const installation = await tx.mobileDeviceInstallation.findFirst({
        where: {
          organizationId,
          userId,
          deviceInstanceId,
          enabled: true,
          revokedAt: null,
        },
      });
      if (!installation) return { count: 0 };
      const result = await tx.mobileDeviceInstallation.updateMany({
        where: {
          organizationId,
          userId,
          deviceInstanceId,
          enabled: true,
          revokedAt: null,
        },
        data: { enabled: false, revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          organizationId: installation.organizationId,
          userId: installation.userId,
          action: 'mobile.installation.revoked',
          entityType: 'MOBILE_DEVICE_INSTALLATION',
          entityId: installation.id,
        },
      });
      return result;
    });
  }
}
