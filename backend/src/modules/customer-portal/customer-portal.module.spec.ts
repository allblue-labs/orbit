import { InfrastructureException } from '../../exceptions';
import {
  CustomerPortalModule,
  customerPortalControllers,
} from './customer-portal.module';

describe('CustomerPortalModule release exposure', () => {
  it('keeps the release runtime dormant by default', () => {
    expect(customerPortalControllers({ NODE_ENV: 'production' })).toEqual([]);
  });

  it('fails closed if an operator tries to expose the unqualified portal', () => {
    expect(() =>
      customerPortalControllers({
        NODE_ENV: 'production',
        CUSTOMER_PORTAL_ENABLED: 'true',
      }),
    ).toThrow(InfrastructureException);
  });

  it('keeps the complete backend contract available to its isolated tests', () => {
    expect(customerPortalControllers({ NODE_ENV: 'test' })).toHaveLength(4);
    expect(CustomerPortalModule).toBeDefined();
  });
});
