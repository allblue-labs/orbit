import { RegistrationService } from './registration.service';
import { BillingInterval } from '../../subscription-plans/catalog/plan-catalog.types';
import type { RegisterOrganizationDto } from '../presentation/dto/identity.dto';
import type { RegistrationRepository } from '../infrastructure/registration.repository';
import type { AuthenticationService } from './authentication.service';
import type { SubscriptionProvisioningService } from '../../subscription-plans/subscriptions/subscription-provisioning.service';
import type { IHashProvider } from '../../../contracts';

describe('registration preserves the commercial selection', () => {
  it.each([
    BillingInterval.MONTHLY,
    BillingInterval.SEMIANNUAL,
    BillingInterval.ANNUAL,
  ])(
    'provisions the selected paid plan with interval %s',
    async (billingInterval) => {
      const repository = {
        register: jest.fn().mockResolvedValue({
          organizationId: 'org',
          userId: 'user',
          businessUnitId: 'unit',
        }),
      };
      const subscriptions = {
        provision: jest.fn().mockResolvedValue(undefined),
      };
      const authentication = {
        login: jest.fn().mockResolvedValue({ accessToken: 'unit-only' }),
      };
      const hashes = { hash: jest.fn().mockResolvedValue('unit-hash') };
      const service = new RegistrationService(
        repository as unknown as RegistrationRepository,
        authentication as unknown as AuthenticationService,
        hashes as unknown as IHashProvider,
        subscriptions as unknown as SubscriptionProvisioningService,
      );
      const input = {
        email: 'owner@example.test',
        password: 'unit-test-password',
        organizationName: 'Empresa',
        planKey: 'PROFESSIONAL',
        documentNumber: '52998224725',
        billingInterval,
      } as RegisterOrganizationDto;
      await service.register(input, {});
      expect(subscriptions.provision).toHaveBeenCalledWith({
        organizationId: 'org',
        planKey: 'PROFESSIONAL',
        legalDocument: '52998224725',
        billingInterval,
      });
      expect(authentication.login).toHaveBeenCalledTimes(1);
    },
  );
});
