import { RegistrationRepository } from './registration.repository';
import { RegistrationService } from '../application/registration.service';
import { ConflictException } from '../../../exceptions';
import { LEGAL_DOCUMENT_VERSION } from '../../../contracts/modules/legal/legal.read-models';
import type { RegisterOrganizationDto } from '../presentation/dto/identity.dto';

describe('public signup document reservation', () => {
  it('stops before creating a user when the atomic reservation is refused', async () => {
    const tx = {
      plan: { findFirst: jest.fn().mockResolvedValue({ id: 'plan' }) },
      $queryRaw: jest.fn().mockResolvedValue([{ reserved: false }]),
      user: { create: jest.fn() },
    };
    const prisma = {
      $transaction: (work: (transaction: unknown) => Promise<unknown>) =>
        work(tx),
    };
    const repository = new RegistrationRepository(prisma as never);
    await expect(
      repository.register(
        { documentNumber: '529.982.247-25' } as RegisterOrganizationDto,
        'hash',
        'slug',
        { publicSignup: true },
      ),
    ).rejects.toMatchObject({ code: 'REGISTRATION_DOCUMENT_ALREADY_EXISTS' });
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.$queryRaw.mock.calls[0]).toContain('52998224725');
  });

  it('cannot provision another subscription or authenticate after a duplicate document', async () => {
    const repository = {
      register: jest
        .fn()
        .mockRejectedValue(
          new ConflictException(
            'duplicate',
            'REGISTRATION_DOCUMENT_ALREADY_EXISTS',
          ),
        ),
    };
    const authentication = { login: jest.fn() },
      subscriptions = { provision: jest.fn() };
    const service = new RegistrationService(
      repository as never,
      authentication as never,
      { hash: jest.fn().mockResolvedValue('hash') } as never,
      subscriptions as never,
    );
    await expect(
      service.register(
        {
          acceptTerms: true,
          termsVersion: LEGAL_DOCUMENT_VERSION,
          privacyVersion: LEGAL_DOCUMENT_VERSION,
          email: 'owner@example.test',
          password: 'long-password',
          organizationName: 'Empresa',
          documentNumber: '529.982.247-25',
        } as RegisterOrganizationDto,
        { client: 'WEB' },
      ),
    ).rejects.toMatchObject({ code: 'REGISTRATION_DOCUMENT_ALREADY_EXISTS' });
    expect(repository.register).toHaveBeenCalledWith(
      expect.objectContaining({ documentNumber: '52998224725' }),
      'hash',
      'empresa',
      { publicSignup: true },
      { client: 'WEB' },
    );
    expect(subscriptions.provision).not.toHaveBeenCalled();
    expect(authentication.login).not.toHaveBeenCalled();
  });
});
