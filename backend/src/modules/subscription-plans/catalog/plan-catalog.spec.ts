/**
 * Os quatro planos, exatamente como o comercial os congelou.
 *
 * Este arquivo existe para que um número não mude por acidente. Se alguém
 * ajustar um teto, o teste falha e a mudança passa a ser deliberada — que é
 * como preço e limite devem mudar.
 */
import {
  AllocationResource,
  PlanCapability,
  PlanCode,
  UsageResource,
  fitsWithin,
  isUnlimited,
  limited,
  UNLIMITED,
} from './plan-catalog.types';
import {
  PLAN_CATALOG,
  PlanCatalogError,
  planDefinition,
  planLimit,
} from './plan-registry';

const alocacaoDe = (code: string) =>
  Object.fromEntries(
    Object.entries(planDefinition(code).allocation).map(([recurso, limite]) => [
      recurso,
      limite.kind === 'UNLIMITED' ? 'UNLIMITED' : limite.value,
    ]),
  );

const usoDe = (code: string) =>
  Object.fromEntries(
    Object.entries(planDefinition(code).usage).map(([recurso, limite]) => [
      recurso,
      limite.kind === 'UNLIMITED' ? 'UNLIMITED' : limite.value,
    ]),
  );

/**
 * O uso comercial, sem `AI_COMPUTE`.
 *
 * A IA é a diferença entre os dois planos e não tem teto congelado ainda;
 * compará-la aqui só provaria que ela é diferente, que é o que já se sabe.
 */
const usoComercialDe = (code: PlanCode) => {
  const uso: Record<string, unknown> = { ...usoDe(code) };
  delete uso[UsageResource.AI_COMPUTE];
  return uso;
};

describe('catálogo de planos', () => {
  it('tem exatamente os quatro planos comerciais', () => {
    expect(PLAN_CATALOG.map((plano) => plano.code)).toEqual([
      PlanCode.ESSENTIAL,
      PlanCode.PROFESSIONAL,
      PlanCode.PROFESSIONAL_INTELLIGENCE,
      PlanCode.ENTERPRISE_UNLIMITED,
    ]);
  });

  it('separa código interno de rótulo público', () => {
    expect(planDefinition(PlanCode.ESSENTIAL).label).toBe('Essencial');
    expect(planDefinition(PlanCode.PROFESSIONAL).label).toBe('Profissional');
    expect(planDefinition(PlanCode.PROFESSIONAL_INTELLIGENCE).label).toBe(
      'Profissional + Inteligência',
    );
    expect(planDefinition(PlanCode.ENTERPRISE_UNLIMITED).label).toBe(
      'Empresarial Ilimitado',
    );
  });

  it('recusa plano desconhecido em vez de devolver um vazio', () => {
    expect(() => planDefinition('PRO')).toThrow(PlanCatalogError);
  });
});

describe('Essencial', () => {
  it('tem os limites de alocação congelados', () => {
    expect(alocacaoDe(PlanCode.ESSENTIAL)).toEqual({
      BUSINESS_UNITS: 1,
      PLATFORM_USERS: 5,
      FIELD_TECHNICIANS: 5,
      AUXILIARY_TECHNICIANS: 5,
      ACTIVE_CUSTOMERS: 150,
      ACTIVE_EQUIPMENT: 500,
    });
  });

  it('tem as cotas mensais congeladas', () => {
    expect(usoDe(PlanCode.ESSENTIAL)).toEqual({
      SERVICE_ORDERS_CREATED: 500,
      PMOC_DOCUMENTS_ISSUED: 1000,
      RVT_DOCUMENTS_ISSUED: 1000,
      OTHER_DOCUMENTS_ISSUED: 2000,
      AUTOMATION_RUNS: 1000,
      AI_COMPUTE: 0,
    });
  });

  it('não inclui a camada de inteligência', () => {
    const capacidades = planDefinition(PlanCode.ESSENTIAL).capabilities;
    expect(capacidades).not.toContain(PlanCapability.ORBIT_INTELLIGENCE);
    expect(capacidades).not.toContain(PlanCapability.AI_ASSISTANTS);
    expect(capacidades).not.toContain(PlanCapability.CUSTOMER_PORTAL);
  });
});

describe('Profissional', () => {
  it('tem os limites de alocação congelados', () => {
    expect(alocacaoDe(PlanCode.PROFESSIONAL)).toEqual({
      BUSINESS_UNITS: 3,
      PLATFORM_USERS: 20,
      FIELD_TECHNICIANS: 20,
      AUXILIARY_TECHNICIANS: 20,
      ACTIVE_CUSTOMERS: 1000,
      ACTIVE_EQUIPMENT: 5000,
    });
  });

  it('tem as cotas mensais congeladas', () => {
    expect(usoDe(PlanCode.PROFESSIONAL)).toEqual({
      SERVICE_ORDERS_CREATED: 5000,
      PMOC_DOCUMENTS_ISSUED: 10000,
      RVT_DOCUMENTS_ISSUED: 10000,
      OTHER_DOCUMENTS_ISSUED: 20000,
      AUTOMATION_RUNS: 10000,
      AI_COMPUTE: 0,
    });
  });

  it('também não inclui inteligência', () => {
    const capacidades = planDefinition(PlanCode.PROFESSIONAL).capabilities;
    expect(capacidades).not.toContain(PlanCapability.ORBIT_INTELLIGENCE);
    expect(capacidades).not.toContain(PlanCapability.AI_ASSISTANTS);
  });
});

describe('Profissional + Inteligência', () => {
  it('repete exatamente os limites operacionais do Profissional', () => {
    expect(alocacaoDe(PlanCode.PROFESSIONAL_INTELLIGENCE)).toEqual(
      alocacaoDe(PlanCode.PROFESSIONAL),
    );
    expect(usoComercialDe(PlanCode.PROFESSIONAL_INTELLIGENCE)).toEqual(
      usoComercialDe(PlanCode.PROFESSIONAL),
    );
  });

  it('acrescenta a camada de inteligência', () => {
    const capacidades = planDefinition(
      PlanCode.PROFESSIONAL_INTELLIGENCE,
    ).capabilities;
    expect(capacidades).toContain(PlanCapability.ORBIT_INTELLIGENCE);
    expect(capacidades).toContain(PlanCapability.AI_ASSISTANTS);
  });
});

describe('Empresarial Ilimitado', () => {
  it('não tem teto operacional, e nenhum número mágico', () => {
    for (const limite of Object.values(
      planDefinition(PlanCode.ENTERPRISE_UNLIMITED).allocation,
    )) {
      expect(limite).toEqual({ kind: 'UNLIMITED' });
    }
    for (const limite of Object.values(
      planDefinition(PlanCode.ENTERPRISE_UNLIMITED).usage,
    )) {
      expect(limite).toEqual({ kind: 'UNLIMITED' });
    }
  });

  it('tem todas as capacidades qualificadas para a release', () => {
    expect(
      [...planDefinition(PlanCode.ENTERPRISE_UNLIMITED).capabilities].sort(),
    ).toEqual(
      Object.values(PlanCapability)
        .filter((capability) => capability !== PlanCapability.CUSTOMER_PORTAL)
        .sort(),
    );
  });
});

describe('semântica de limite', () => {
  it('ilimitado sempre cabe', () => {
    expect(fitsWithin(UNLIMITED, 10_000_000, 1)).toBe(true);
    expect(isUnlimited(UNLIMITED)).toBe(true);
  });

  it('limitado cabe até o teto, e não além', () => {
    expect(fitsWithin(limited(5), 4, 1)).toBe(true);
    expect(fitsWithin(limited(5), 5, 1)).toBe(false);
    expect(fitsWithin(limited(5), 3, 2)).toBe(true);
    expect(fitsWithin(limited(5), 4, 2)).toBe(false);
  });

  it('recusa limite que não é inteiro não negativo', () => {
    expect(() => limited(-1)).toThrow();
    expect(() => limited(1.5)).toThrow();
  });

  it('teto zero não deixa passar nada', () => {
    expect(fitsWithin(limited(0), 0, 1)).toBe(false);
  });
});

describe('resolução de limite', () => {
  it('recurso sem limite declarado falha, em vez de virar ilimitado', () => {
    const plano = planDefinition(PlanCode.ESSENTIAL);
    expect(() => planLimit(plano, 'RECURSO_INEXISTENTE')).toThrow(
      PlanCatalogError,
    );
  });

  it('resolve alocação e uso pelo mesmo caminho', () => {
    const plano = planDefinition(PlanCode.ESSENTIAL);
    expect(planLimit(plano, AllocationResource.PLATFORM_USERS)).toEqual(
      limited(5),
    );
    expect(planLimit(plano, UsageResource.SERVICE_ORDERS_CREATED)).toEqual(
      limited(500),
    );
  });
});
