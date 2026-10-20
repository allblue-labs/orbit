import { HttpGatewayMobilePushProvider } from './mobile-push.provider';

describe('HttpGatewayMobilePushProvider', () => {
  const target = {
    platform: 'IOS',
    provider: 'APNS',
    token: 'secret-token',
  } as const;
  const payload = {
    version: 1,
    notificationId: '01900000-0000-7000-8000-000000000001',
    type: 'WORK_ASSIGNED',
    deepLink: '/field/work-items/OPERATION:id',
    title: 'Novo atendimento atribuído',
    body: 'Abra o Orbit.',
  } as const;

  afterEach(() => jest.restoreAllMocks());

  it.each([
    [410, 'INVALID_TOKEN'],
    [429, 'TEMPORARY_FAILURE'],
    [503, 'TEMPORARY_FAILURE'],
    [400, 'PERMANENT_FAILURE'],
  ])('classifies HTTP %s as %s', async (status, kind) => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ code: `HTTP_${status}` }), { status }),
      );
    const provider = new HttpGatewayMobilePushProvider(
      'https://push.orbit.local/send',
      'credential',
    );
    await expect(provider.send(target, payload)).resolves.toMatchObject({
      kind,
    });
  });
});
