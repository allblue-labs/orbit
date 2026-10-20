import {
  AllocationResource,
  PlanCapability,
  UsageResource,
} from '../catalog/plan-catalog.types';
import { planDefinition } from '../catalog/plan-registry';
import {
  customProfile,
  fromCatalog,
  legacyUngoverned,
  limitFor,
} from './effective-entitlements';
import { PlanConfigurationInvalidException } from './entitlement.errors';

const completo = {
  capabilities: ['CUSTOMERS', 'OPERATIONS'],
  allocation: {
    BUSINESS_UNITS: 1,
    PLATFORM_USERS: 2,
    FIELD_TECHNICIANS: 2,
    AUXILIARY_TECHNICIANS: 2,
    ACTIVE_CUSTOMERS: 3,
    ACTIVE_EQUIPMENT: 3,
  },
  usage: {
    SERVICE_ORDERS_CREATED: 2,
    PMOC_DOCUMENTS_ISSUED: 2,
    RVT_DOCUMENTS_ISSUED: 2,
    OTHER_DOCUMENTS_ISSUED: 2,
    AUTOMATION_RUNS: 2,
    AI_COMPUTE: null,
  },
};

describe('direitos efetivos', () => {
  describe('origem catálogo', () => {
    it('traz capacidades e limites do plano congelado', () => {
      const direitos = fromCatalog(planDefinition('ESSENTIAL'));
      expect(direitos.source).toBe('CATALOG');
      expect(direitos.capabilities.has(PlanCapability.CUSTOMERS)).toBe(true);
      expect(direitos.capabilities.has(PlanCapability.AI_ASSISTANTS)).toBe(
        false,
      );
      expect(limitFor(direitos, AllocationResource.PLATFORM_USERS)).toEqual({
        kind: 'LIMITED',
        value: 5,
      });
    });
  });

  describe('origem legado', () => {
    it('preserva o que os inquilinos anteriores já tinham: tudo, sem teto', () => {
      const direitos = legacyUngoverned('STARTER', 'Starter');
      expect(direitos.source).toBe('LEGACY_UNGOVERNED');
      for (const capacidade of Object.values(PlanCapability)) {
        expect(direitos.capabilities.has(capacidade)).toBe(true);
      }
      for (const recurso of Object.values(AllocationResource)) {
        expect(limitFor(direitos, recurso)).toEqual({ kind: 'UNLIMITED' });
      }
      for (const recurso of Object.values(UsageResource)) {
        expect(limitFor(direitos, recurso)).toEqual({ kind: 'UNLIMITED' });
      }
    });
  });

  describe('origem perfil declarado', () => {
    it('é ignorada quando a linha não declara nada', () => {
      expect(customProfile('LEGADO', 'Legado', {})).toBeNull();
      expect(customProfile('LEGADO', 'Legado', null)).toBeNull();
      expect(
        customProfile('LEGADO', 'Legado', { users: 5, businessUnits: 1 }),
      ).toBeNull();
    });

    it('lê um perfil completo, com null como ilimitado declarado', () => {
      const direitos = customProfile('TESTE', 'Teste', {
        entitlements: completo,
      });
      expect(direitos?.source).toBe('CUSTOM');
      expect(direitos?.capabilities.has(PlanCapability.CUSTOMERS)).toBe(true);
      expect(direitos?.capabilities.has(PlanCapability.PMOC)).toBe(false);
      expect(limitFor(direitos!, AllocationResource.PLATFORM_USERS)).toEqual({
        kind: 'LIMITED',
        value: 2,
      });
      expect(limitFor(direitos!, UsageResource.AI_COMPUTE)).toEqual({
        kind: 'UNLIMITED',
      });
    });

    it('recusa recurso ausente em vez de assumir ilimitado', () => {
      const parcial = {
        ...completo,
        allocation: { ...completo.allocation },
      } as Record<string, unknown>;
      delete (parcial['allocation'] as Record<string, unknown>)[
        'ACTIVE_EQUIPMENT'
      ];
      expect(() =>
        customProfile('TESTE', 'Teste', { entitlements: parcial }),
      ).toThrow(PlanConfigurationInvalidException);
    });

    it('recusa capacidade desconhecida', () => {
      expect(() =>
        customProfile('TESTE', 'Teste', {
          entitlements: { ...completo, capabilities: ['TELEPORTE'] },
        }),
      ).toThrow(PlanConfigurationInvalidException);
    });

    it('recusa limite negativo ou fracionado', () => {
      for (const valor of [-1, 1.5]) {
        expect(() =>
          customProfile('TESTE', 'Teste', {
            entitlements: {
              ...completo,
              allocation: { ...completo.allocation, PLATFORM_USERS: valor },
            },
          }),
        ).toThrow(PlanConfigurationInvalidException);
      }
    });

    it('recusa um bloco de direitos que não é objeto', () => {
      expect(() =>
        customProfile('TESTE', 'Teste', { entitlements: 'ilimitado' }),
      ).toThrow(PlanConfigurationInvalidException);
    });
  });

  describe('recurso desconhecido', () => {
    it('falha fechado em vez de virar ilimitado', () => {
      const direitos = fromCatalog(planDefinition('ENTERPRISE_UNLIMITED'));
      expect(() => limitFor(direitos, 'STORAGE_GIGABYTES')).toThrow(
        PlanConfigurationInvalidException,
      );
    });
  });
});
