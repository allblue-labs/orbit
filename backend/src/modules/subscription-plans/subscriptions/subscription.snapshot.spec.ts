import { planDefinition } from '../catalog/plan-registry';
import { customProfile } from '../entitlements/effective-entitlements';
import { snapshotOf } from './subscription.snapshot';

describe('retrato dos direitos', () => {
  it('guarda os limites do plano no momento da contratação', () => {
    const retrato = snapshotOf(planDefinition('ESSENTIAL'));
    expect(retrato.allocation['PLATFORM_USERS']).toBe(5);
    expect(retrato.usage['SERVICE_ORDERS_CREATED']).toBe(500);
    expect(retrato.capabilities).toContain('CUSTOMERS');
    expect(retrato.capabilities).not.toContain('ORBIT_INTELLIGENCE');
  });

  it('ilimitado vira null declarado, nunca um número mágico', () => {
    const retrato = snapshotOf(planDefinition('ENTERPRISE_UNLIMITED'));
    for (const valor of [
      ...Object.values(retrato.allocation),
      ...Object.values(retrato.usage),
    ]) {
      expect(valor).toBeNull();
    }
  });

  it('passa pelo mesmo verificador que lê o perfil de um plano', () => {
    // Um caminho de leitura só: retrato inválido falha igual a perfil inválido.
    const retrato = snapshotOf(planDefinition('PROFESSIONAL'));
    const direitos = customProfile('PROFESSIONAL', 'Profissional', {
      entitlements: retrato,
    });
    expect(direitos?.capabilities.has('ANALYTICS')).toBe(true);
    expect(direitos?.allocation.PLATFORM_USERS).toEqual({
      kind: 'LIMITED',
      value: 20,
    });
  });
});
