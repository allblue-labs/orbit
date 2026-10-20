import { CustomerPortalEmail } from './customer-portal-email';

describe('CustomerPortalEmail', () => {
  it('normalizes whitespace, case and compatible unicode deterministically', () => {
    expect(CustomerPortalEmail.normalize('  PORTAL@Example.COM  ')).toBe(
      'portal@example.com',
    );
    expect(CustomerPortalEmail.normalize('ＴＥＳＴ@example.com')).toBe(
      'test@example.com',
    );
  });
});
