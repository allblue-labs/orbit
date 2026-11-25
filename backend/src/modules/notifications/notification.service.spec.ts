import { NotificationService } from './notification.service';

describe('NotificationService — durable HTTP inbox', () => {
  const repository = {
    findRecipient: jest.fn(),
    preference: jest.fn(),
    preferences: jest.fn(),
    upsertPreference: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    updateDelivery: jest.fn(),
    markSent: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    upsertSubscription: jest.fn(),
  };
  const email = { send: jest.fn() };
  const push = { send: jest.fn(), validateEndpoint: jest.fn() };
  const service = new NotificationService(
    repository as never,
    email,
    push as never,
  );
  beforeEach(() => jest.resetAllMocks());

  it('does not persist a denied web push endpoint', async () => {
    push.validateEndpoint.mockRejectedValue(new Error('blocked'));
    await expect(
      service.registerPush('org', 'user', {
        endpoint: 'https://127.0.0.1/token',
        keys: { p256dh: 'key', auth: 'auth' },
      }),
    ).rejects.toThrow('blocked');
    expect(repository.upsertSubscription).not.toHaveBeenCalled();
  });

  it.each([['EMAIL'], ['REALTIME'], ['IN_APP', 'REALTIME']])(
    'always persists one inbox delivery, including legacy channel %s',
    async (...channels: string[]) => {
      repository.findRecipient.mockResolvedValue({ user: { id: 'user' } });
      repository.preference.mockResolvedValue(null);
      repository.create.mockResolvedValue({ id: 'notification' });
      await service.create('org', {
        recipientUserId: 'user',
        type: 'OPERATION',
        channels,
        title: 'Assigned',
        body: 'You were assigned',
        scheduledAt: new Date(Date.now() + 60_000),
      });
      const expected = channels.includes('EMAIL')
        ? ['IN_APP', 'EMAIL']
        : ['IN_APP'];
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ channels: expected }),
        expected,
      );
    },
  );

  it('keeps historical REALTIME preferences compatible on read and write', async () => {
    repository.preferences.mockResolvedValue([
      {
        type: 'OPERATION',
        enabled: true,
        channels: ['REALTIME', 'IN_APP', 'PUSH'],
      },
    ]);
    expect(await service.preferences('org', 'user')).toEqual([
      { type: 'OPERATION', enabled: true, channels: ['IN_APP', 'PUSH'] },
    ]);
    await service.preference('org', 'user', {
      type: 'OPERATION',
      enabled: true,
      channels: ['REALTIME', 'IN_APP'],
    });
    expect(repository.upsertPreference).toHaveBeenCalledWith(
      'org',
      'user',
      'OPERATION',
      expect.objectContaining({ channels: ['IN_APP'] }),
    );
  });

  it('records skipped legacy delivery without inventing socket delivery, and does not retry it', async () => {
    const notification = {
      id: 'notification',
      deliveries: [
        { id: 'inbox', channel: 'IN_APP', status: 'SENT' },
        { id: 'legacy', channel: 'REALTIME', status: 'PENDING' },
      ],
    };
    repository.find.mockResolvedValue(notification);
    await service.dispatch('notification', 'org');
    expect(repository.updateDelivery).toHaveBeenCalledWith(
      'legacy',
      expect.objectContaining({
        status: 'SKIPPED',
        provider: 'realtime-retired',
        attempts: { increment: 1 },
      }),
    );
    expect(repository.updateDelivery).toHaveBeenCalledWith(
      'legacy',
      expect.objectContaining({ sentAt: undefined }),
    );
    expect(repository.markSent).toHaveBeenCalledWith('notification', 'SENT');
    repository.find.mockResolvedValue({
      ...notification,
      deliveries: [
        notification.deliveries[0],
        {
          ...notification.deliveries[1],
          status: 'SKIPPED',
          provider: 'realtime-retired',
        },
      ],
    });
    repository.updateDelivery.mockClear();
    await service.dispatch('notification', 'org');
    expect(repository.updateDelivery).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
    expect(push.send).not.toHaveBeenCalled();
  });

  it('does not claim a retired-only transport was delivered', async () => {
    repository.find.mockResolvedValue({
      id: 'notification',
      deliveries: [{ id: 'legacy', channel: 'REALTIME', status: 'PENDING' }],
    });
    await service.dispatch('notification', 'org');
    expect(repository.markSent).toHaveBeenCalledWith('notification', 'FAILED');
  });

  it('persists recipient-scoped read receipts and returns confirmed state', async () => {
    const readAt = new Date();
    repository.find.mockResolvedValue({ id: 'notification', readAt });
    expect(await service.markRead('notification', 'org', 'user')).toMatchObject(
      { id: 'notification', readAt },
    );
    expect(repository.markRead).toHaveBeenCalledWith(
      'notification',
      'org',
      'user',
    );
    expect(repository.find).toHaveBeenLastCalledWith(
      'notification',
      'org',
      'user',
    );
    repository.markAllRead.mockResolvedValue({ count: 3 });
    expect(await service.markAllRead('org', 'user')).toEqual({ updated: 3 });
    expect(repository.markAllRead).toHaveBeenCalledWith('org', 'user');
  });

  it('does not mark another recipient notification read', async () => {
    repository.find.mockResolvedValue(null);
    await expect(service.markRead('foreign', 'org', 'user')).rejects.toThrow();
    expect(repository.markRead).not.toHaveBeenCalled();
  });
});
