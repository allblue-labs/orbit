import { IdentityRepository } from './identity.repository';

describe('IdentityRepository session bounds', () => {
  it('limits the security session overview at the database query', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new IdentityRepository({
      session: { findMany },
    } as never);

    await repository.listSessions('01900000-0000-7000-8000-000000000001');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  });
});
