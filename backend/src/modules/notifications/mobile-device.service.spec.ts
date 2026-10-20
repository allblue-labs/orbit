import { createHash } from 'node:crypto';
import { MobileDeviceService } from './mobile-device.service';

describe('MobileDeviceService', () => {
  it('derives the token hash and never exposes the token in the read model', async () => {
    const token = 'push-token-with-more-than-twenty-characters';
    const repository = {
      register: jest.fn().mockResolvedValue({
        id: '01900000-0000-7000-8000-000000000001',
        deviceInstanceId: 'device-instance-0000001',
        platform: 'IOS',
        pushProvider: 'APNS',
        pushToken: token,
        appVersion: '1.0.0',
        osVersion: '18',
        locale: 'pt-BR',
        timezone: 'America/Recife',
        enabled: true,
        lastSeenAt: new Date('2026-09-02T00:00:00Z'),
        tokenUpdatedAt: new Date('2026-09-02T00:00:00Z'),
        createdAt: new Date('2026-09-02T00:00:00Z'),
        revokedAt: null,
      }),
    };
    const service = new MobileDeviceService(repository as never);
    const result = await service.register(
      {
        id: '01900000-0000-7000-8000-000000000002',
        organizationId: '01900000-0000-7000-8000-000000000003',
      },
      {
        deviceInstanceId: 'device-instance-0000001',
        platform: 'IOS',
        pushProvider: 'APNS',
        pushToken: token,
        appVersion: '1.0.0',
      },
    );
    expect(repository.register).toHaveBeenCalledWith(
      expect.anything(),
      createHash('sha256').update(token).digest('hex'),
    );
    expect(JSON.stringify(result)).not.toContain(token);
  });
});
