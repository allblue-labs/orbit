import type {
  AnalyticsDomain,
  AnalyticsDomainAvailability,
} from './analytics.read-models';

export const ANALYTICS_DOMAIN_CAPABILITIES: Readonly<
  Record<AnalyticsDomain, readonly string[]>
> = {
  OPERATIONS: ['operations.read'],
  PMOC: ['pmoc.read'],
  RVT: ['rvt.read'],
  EQUIPMENT: ['assets.read'],
  TECHNICIANS: ['operations.read', 'workforce.read'],
  CONTRACTS: ['customers.read'],
  ENVIRONMENT: [],
};

export function analyticsAccess(permissions: readonly string[]) {
  const granted = new Set(permissions);
  const wildcard = granted.has('*');
  const availability = Object.entries(ANALYTICS_DOMAIN_CAPABILITIES).map(
    ([domain, requiredCapabilities]): AnalyticsDomainAvailability => {
      const missingCapabilities = wildcard
        ? []
        : requiredCapabilities.filter((value) => !granted.has(value));
      return {
        domain: domain as AnalyticsDomain,
        available: missingCapabilities.length === 0,
        requiredCapabilities,
        missingCapabilities,
        blockedReason: missingCapabilities.length
          ? 'MISSING_DOMAIN_CAPABILITY'
          : null,
      };
    },
  );
  return {
    availability,
    domains: new Set(
      availability.filter((item) => item.available).map((item) => item.domain),
    ),
  };
}
