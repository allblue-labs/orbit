import { RegistrationRepository } from './registration.repository';
import type { RegisterOrganizationDto } from '../presentation/dto/identity.dto';
import { LEGAL_DOCUMENT_VERSION } from '../../../contracts/modules/legal/legal.read-models';

it.each([
  'ESSENTIAL',
  'PROFESSIONAL',
  'PROFESSIONAL_INTELLIGENCE',
  'ENTERPRISE_UNLIMITED',
])(
  'registration of %s cannot create a legacy trial before canonical provisioning',
  async (planKey) => {
    const organization = {
      create: jest
        .fn<Promise<object>, [{ data: Record<string, unknown> }]>()
        .mockResolvedValue({}),
    };
    const create = jest.fn().mockResolvedValue({ id: 'role' });
    const tx = {
      $queryRawUnsafe: jest.fn(),
      plan: {
        findFirst: jest.fn().mockResolvedValue({ id: 'plan', key: planKey }),
      },
      organization,
      user: { create },
      role: { create, createMany: create },
      rvtMaintenanceType: { createMany: create },
      businessUnit: { create },
      organizationMembership: { create },
      businessUnitMembership: { create },
      organizationLegalAcceptance: { create },
    };
    const prisma = {
      $transaction: jest.fn((work: (tx: unknown) => unknown) =>
        Promise.resolve(work(tx)),
      ),
    };
    const repository = new RegistrationRepository(prisma as never);
    const input = {
      planKey,
      email: 'owner@example.test',
      firstName: 'Marina',
      lastName: 'Silva',
      organizationName: 'Empresa',
      legalName: 'Empresa',
      city: 'Recife',
      street: 'Rua do Sol',
      stateCode: 'PE',
      acceptTerms: true,
      termsVersion: LEGAL_DOCUMENT_VERSION,
      privacyVersion: LEGAL_DOCUMENT_VERSION,
    } as RegisterOrganizationDto;
    await repository.register(
      input,
      'test-hash',
      'empresa',
      {},
      { client: 'WEB', ipAddress: '192.0.2.1', userAgent: 'Orbit test' },
    );
    expect(organization.create.mock.calls[0]?.[0].data).toMatchObject({
      subscriptionStatus: 'PENDING_PAYMENT',
      currentPeriodEnd: null,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          termsVersion: LEGAL_DOCUMENT_VERSION,
          privacyVersion: LEGAL_DOCUMENT_VERSION,
          ipAddress: '192.0.2.1',
          userAgent: 'Orbit test',
          acceptedAt: expect.any(Date) as unknown,
          documentsSnapshot: expect.objectContaining({
            terms: expect.objectContaining({
              version: LEGAL_DOCUMENT_VERSION,
            }) as unknown,
            privacy: expect.objectContaining({
              version: LEGAL_DOCUMENT_VERSION,
            }) as unknown,
          }) as unknown,
        }) as unknown,
      }),
    );
  },
);
