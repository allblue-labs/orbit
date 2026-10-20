import { validate } from 'class-validator';
import { UpdateProfileDto } from '../presentation/dto/identity.dto';
import { ProfileService } from './profile.service';

describe('Welcome guide dismissal', () => {
  function setup(welcomeDismissedAt: Date | null = null) {
    const repository = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'user', deletedAt: null, welcomeDismissedAt }),
      updateProfile: jest.fn().mockResolvedValue({}),
    };
    const service = new ProfileService(
      repository as never,
      {} as never,
      {} as never,
    );
    return { repository, service };
  }

  it('records the server time for the authenticated user without changing security settings', async () => {
    const { service, repository } = setup();
    await service.update('user', { dismissWelcome: true });
    expect(repository.updateProfile).toHaveBeenCalledWith('user', {
      welcomeDismissedAt: expect.any(Date) as unknown,
    });
  });

  it('preserves dismissal when editing the profile and when reopening the guide', async () => {
    const dismissed = new Date('2026-10-20T12:00:00Z');
    const { service, repository } = setup(dismissed);
    await service.update('user', { displayName: 'Owner' });
    expect(repository.updateProfile).toHaveBeenLastCalledWith('user', {
      displayName: 'Owner',
    });
    await service.update('user', { dismissWelcome: true });
    expect(repository.updateProfile).toHaveBeenLastCalledWith('user', {
      welcomeDismissedAt: dismissed,
    });
  });

  it('only accepts an explicit dismissal, not a reset or a client timestamp', async () => {
    for (const value of [false, 'true', '2026-10-20', 1]) {
      const input = Object.assign(new UpdateProfileDto(), {
        dismissWelcome: value,
      });
      expect(await validate(input)).not.toHaveLength(0);
    }
    expect(
      await validate(
        Object.assign(new UpdateProfileDto(), { dismissWelcome: true }),
      ),
    ).toHaveLength(0);
  });
});
