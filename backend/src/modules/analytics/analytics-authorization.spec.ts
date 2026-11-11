import { analyticsAccess } from './analytics-authorization';

describe('Analytics compound authorization', () => {
  it('does not let analytics.read imply domain access', () => {
    const access = analyticsAccess(['analytics.read']);
    expect([...access.domains]).toEqual(['ENVIRONMENT']);
    expect(
      access.availability.find((item) => item.domain === 'PMOC'),
    ).toMatchObject({
      available: false,
      missingCapabilities: ['pmoc.read'],
      blockedReason: 'MISSING_DOMAIN_CAPABILITY',
    });
  });

  it('authorizes operations and PMOC independently', () => {
    const operations = analyticsAccess(['analytics.read', 'operations.read']);
    expect(operations.domains.has('OPERATIONS')).toBe(true);
    expect(operations.domains.has('PMOC')).toBe(false);

    const pmoc = analyticsAccess(['analytics.read', 'pmoc.read']);
    expect(pmoc.domains.has('PMOC')).toBe(true);
    expect(pmoc.domains.has('OPERATIONS')).toBe(false);
  });

  it('requires both operations and workforce for technician analytics', () => {
    expect(analyticsAccess(['workforce.read']).domains.has('TECHNICIANS')).toBe(
      false,
    );
    expect(
      analyticsAccess(['operations.read', 'workforce.read']).domains.has(
        'TECHNICIANS',
      ),
    ).toBe(true);
  });

  it('requires explicit RVT access without granting PMOC or operations', () => {
    const access = analyticsAccess(['analytics.read', 'rvt.read']);
    expect(access.domains.has('RVT')).toBe(true);
    expect(access.domains.has('PMOC')).toBe(false);
    expect(access.domains.has('OPERATIONS')).toBe(false);
    expect(analyticsAccess(['analytics.read']).domains.has('RVT')).toBe(false);
  });
});
