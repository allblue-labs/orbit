import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('global application guard pipeline', () => {
  const sourceRoot = resolve(__dirname, '..');
  const appModule = readFileSync(resolve(sourceRoot, 'app.module.ts'), 'utf8');

  it('keeps authentication before RBAC and product entitlements', () => {
    const orderedGuards = [
      'JwtAuthenticationGuard',
      'SurfaceGuard',
      'PermissionGuard',
      'RoleGuard',
      'ActivePlanGuard',
      'RequiredPlanGuard',
      'CapabilityGuard',
      'ProductCapabilityGuard',
      'ProductFeatureGuard',
    ];
    const positions = orderedGuards.map((guard) =>
      appModule.indexOf(`provide: APP_GUARD, useClass: ${guard}`),
    );

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('does not let feature-module import order define global security order', () => {
    const featureModules = [
      resolve(sourceRoot, 'modules/identity/identity.module.ts'),
      resolve(
        sourceRoot,
        'modules/subscription-plans/subscription-plans.module.ts',
      ),
    ];

    for (const file of featureModules) {
      expect(readFileSync(file, 'utf8')).not.toContain('APP_GUARD');
    }
  });
});
