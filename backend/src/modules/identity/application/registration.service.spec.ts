import { generateUuidV7 } from '../../../utils';
import { LEGAL_DOCUMENT_VERSION } from '../../../contracts/modules/legal/legal.read-models';
import { RegistrationService } from './registration.service';
import { BillingInterval } from '../../subscription-plans/catalog/plan-catalog.types';
import type { RegisterOrganizationDto } from '../presentation/dto/identity.dto';
import type { RegistrationRepository } from '../infrastructure/registration.repository';
import type { AuthenticationService } from './authentication.service';
import type { SubscriptionProvisioningService } from '../../subscription-plans/subscriptions/subscription-provisioning.service';
import type { IHashProvider } from '../../../contracts';

describe('registration preserves the commercial selection', () => {
  it.each([
    {},
    {
      acceptTerms: false,
      termsVersion: LEGAL_DOCUMENT_VERSION,
      privacyVersion: LEGAL_DOCUMENT_VERSION,
    },
    {
      acceptTerms: true,
      termsVersion: 'old',
      privacyVersion: LEGAL_DOCUMENT_VERSION,
    },
    {
      acceptTerms: true,
      termsVersion: LEGAL_DOCUMENT_VERSION,
      privacyVersion: 'old',
    },
  ])(
    'rejects absent or stale acceptance before writing an account: %j',
    async (acceptance) => {
      const repository = { register: jest.fn() };
      const hashes = { hash: jest.fn() };
      const service = new RegistrationService(
        repository as never,
        {} as never,
        hashes as never,
        {} as never,
      );
      await expect(
        service.register(acceptance as RegisterOrganizationDto, {
          client: 'WEB',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repository.register).not.toHaveBeenCalled();
      expect(hashes.hash).not.toHaveBeenCalled();
    },
  );
  it.each([
    BillingInterval.MONTHLY,
    BillingInterval.SEMIANNUAL,
    BillingInterval.ANNUAL,
  ])(
    'provisions the selected paid plan with interval %s',
    async (billingInterval) => {
      const created = {
        organizationId: generateUuidV7(),
        userId: generateUuidV7(),
        businessUnitId: generateUuidV7(),
      };
      const repository = {
        register: jest
          .fn<
            ReturnType<RegistrationRepository['register']>,
            Parameters<RegistrationRepository['register']>
          >()
          .mockResolvedValue(created),
      };
      const subscriptions = {
        provision: jest.fn().mockResolvedValue(undefined),
      };
      const authentication = {
        login: jest.fn().mockResolvedValue({ accessToken: 'unit-only' }),
      };
      const hashes = { hash: jest.fn().mockResolvedValue('unit-hash') };
      const verification = {
        queueWelcomeIn: jest.fn().mockResolvedValue(undefined),
      };
      const service = new RegistrationService(
        repository as unknown as RegistrationRepository,
        authentication as unknown as AuthenticationService,
        hashes as unknown as IHashProvider,
        subscriptions as unknown as SubscriptionProvisioningService,
        verification as never,
      );
      const input = {
        acceptTerms: true,
        termsVersion: LEGAL_DOCUMENT_VERSION,
        privacyVersion: LEGAL_DOCUMENT_VERSION,
        email: 'owner@example.test',
        password: 'unit-test-password',
        organizationName: 'Empresa',
        planKey: 'PROFESSIONAL',
        documentNumber: '52998224725',
        billingInterval,
      } as RegisterOrganizationDto;
      await service.register(input, { client: 'WEB' });
      const callback = repository.register.mock.calls[0]?.[5] as (
        tx: unknown,
        userId: string,
      ) => Promise<void>;
      expect(callback).toEqual(expect.any(Function));
      await callback('transaction', created.userId);
      expect(verification.queueWelcomeIn).toHaveBeenCalledWith(
        'transaction',
        created.userId,
        input.email,
      );
      expect(subscriptions.provision).toHaveBeenCalledWith({
        organizationId: created.organizationId,
        planKey: 'PROFESSIONAL',
        legalDocument: '52998224725',
        billingInterval,
      });
      expect(authentication.login).toHaveBeenCalledTimes(1);
    },
  );
});
