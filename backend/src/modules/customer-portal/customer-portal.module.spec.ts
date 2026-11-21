import {
  CustomerPortalModule,
  customerPortalControllers,
} from './customer-portal.module';

describe('CustomerPortalModule release exposure', () => {
  it('keeps the release runtime dormant by default', () => {
    expect(customerPortalControllers({ NODE_ENV: 'production' })).toEqual([]);
  });

  it('só registra as rotas quando a instalação liga o portal', () => {
    expect(
      customerPortalControllers({
        NODE_ENV: 'production',
        CUSTOMER_PORTAL_ENABLED: 'false',
      }),
    ).toEqual([]);
    expect(
      customerPortalControllers({
        NODE_ENV: 'production',
        CUSTOMER_PORTAL_ENABLED: 'true',
      }),
    ).toHaveLength(5);
  });

  it('keeps the complete backend contract available to its isolated tests', () => {
    expect(customerPortalControllers({ NODE_ENV: 'test' })).toHaveLength(5);
    expect(CustomerPortalModule).toBeDefined();
  });
});
