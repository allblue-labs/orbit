import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  const repository = {
    findRecipient: jest.fn(),
    preference: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    updateDelivery: jest.fn(),
    markSent: jest.fn(),
    markRead: jest.fn(),
  };
  const gateway = { emitToUser: jest.fn() };
  const service = new NotificationService(
    repository as never,
    { send: jest.fn() } as never,
    { send: jest.fn() } as never,
    gateway as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('always persists an in-app delivery for a valid recipient', async () => {
    const notification = {
      id: 'notification',
      recipientUserId: 'user',
      deliveries: [],
    };
    repository.findRecipient.mockResolvedValue({ user: { id: 'user' } });
    repository.preference.mockResolvedValue(null);
    repository.create.mockResolvedValue(notification);
    repository.find.mockResolvedValue(notification);
    repository.markSent.mockResolvedValue(notification);

    await service.create('org', {
      recipientUserId: 'user',
      type: 'OPERATION',
      channels: ['EMAIL'],
      title: 'Assigned',
      body: 'You were assigned',
      scheduledAt: new Date(Date.now() + 60_000),
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ channels: ['IN_APP', 'EMAIL'] }),
      ['IN_APP', 'EMAIL'],
    );
  });

  it('emits a realtime read receipt', async () => {
    repository.find.mockResolvedValue({ id: 'notification' });
    repository.markRead.mockResolvedValue({ count: 1 });
    await service.markRead('notification', 'org', 'user');
    expect(gateway.emitToUser).toHaveBeenCalledWith(
      'user',
      'notification:read',
      { id: 'notification' },
      'org',
    );
  });
});
