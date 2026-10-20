import { RequestContext } from '../../../context';
import type { RequestContextService } from '../../../context';
import type { RlsTransaction } from '../../../database';
import {
  AllocationResource,
  PlanCapability,
  UsageResource,
} from '../catalog/plan-catalog.types';
import {
  PlanAllocationLimitReachedException,
  PlanCapabilityUnavailableException,
  PlanConfigurationInvalidException,
  PlanUsageLimitReachedException,
} from './entitlement.errors';
import type { SubscriptionService } from '../subscriptions/subscription.service';
import { isKnownPlan, planDefinition } from '../catalog/plan-registry';
import { snapshotOf } from '../subscriptions/subscription.snapshot';
import { SubscriptionStatus } from '../subscriptions/subscription.types';
import { EntitlementMapper } from './entitlement.mapper';
import { EntitlementMetrics } from './entitlement.metrics';
import type {
  EntitlementRepository,
  LedgerSource,
  PlanRow,
} from './entitlement.repository';
import { EntitlementService } from './entitlement.service';
import type { UsageWindow } from './usage-window';

const ORGANIZACAO = '01900000-0000-7000-8000-000000000001';
const ANCORA = new Date('2026-01-10T00:00:00.000Z');

/**
 * Um repositório de mentira, mas com a mesma semântica que importa: o razão
 * dedupe por origem, e as contagens saem de um estado que o teste controla.
 */
class RepositorioFalso {
  planKey = 'ESSENTIAL';
  consultasDePlano = 0;
  limits: unknown = {};
  readonly counts = new Map<string, number>();
  readonly ledger = new Map<string, number>();

  findPlan(): Promise<PlanRow | null> {
    this.consultasDePlano += 1;
    return Promise.resolve({
      planKey: this.planKey,
      planName: this.planKey,
      limits: this.limits as PlanRow['limits'],
      anchor: ANCORA,
    });
  }

  countAllocation(_organizationId: string, resource: string): Promise<number> {
    return Promise.resolve(this.counts.get(resource) ?? 0);
  }

  sumUsage(
    _organizationId: string,
    resource: string,
    window: UsageWindow,
  ): Promise<number> {
    let total = 0;
    for (const [chave, quantidade] of this.ledger) {
      if (chave.startsWith(`${resource}|${window.start.toISOString()}|`)) {
        total += quantidade;
      }
    }
    return Promise.resolve(total);
  }

  lock(): Promise<void> {
    return Promise.resolve();
  }

  appendUsage(
    _organizationId: string,
    resource: string,
    window: UsageWindow,
    source: LedgerSource,
    quantity: number,
  ): Promise<boolean> {
    const chave = `${resource}|${window.start.toISOString()}|${source.type}:${source.id}`;
    if (this.ledger.has(chave)) return Promise.resolve(false);
    this.ledger.set(chave, quantity);
    return Promise.resolve(true);
  }
}

/** Um contexto de requisição, para o cache de escopo de requisição existir. */
function contextoDeRequisicao(): RequestContext {
  return new RequestContext({
    requestId: 'requisicao',
    userId: null,
    organizationId: ORGANIZACAO as never,
    businessUnitId: null,
    businessUnitIds: [],
    roles: [],
    permissions: [],
    ip: null,
    userAgent: null,
    locale: 'pt-BR',
  });
}

function montar(contexto?: RequestContext, commercialSubscription = true) {
  const repositorio = new RepositorioFalso();
  const rls = {
    run: <T>(work: (tx: unknown) => Promise<T>) => work(null),
    runAmbient: <T>(work: (tx: unknown) => Promise<T>) => work(null),
  } as unknown as RlsTransaction;
  const contexts = {
    getOptional: () => contexto,
  } as unknown as RequestContextService;
  /** Planos comerciais sempre são exercitados por uma assinatura ativa. */
  const assinatura = {
    currentOrNull: () => {
      if (!commercialSubscription || !isKnownPlan(repositorio.planKey)) {
        return Promise.resolve(null);
      }
      const plan = planDefinition(repositorio.planKey);
      return Promise.resolve({
        planCode: plan.code,
        entitlementsSnapshot: snapshotOf(plan),
        effectiveStatus: SubscriptionStatus.ACTIVE,
        pendingEffectiveAt: null,
        pendingPlanCode: null,
        pendingEntitlementsSnapshot: null,
      });
    },
  } as unknown as SubscriptionService;
  const service = new EntitlementService(
    repositorio as unknown as EntitlementRepository,
    assinatura,
    rls,
    contexts,
    new EntitlementMetrics(),
    new EntitlementMapper(),
  );
  return { repositorio, service };
}

describe('EntitlementService', () => {
  describe('capacidades', () => {
    it('nega plano comercial sem assinatura canônica', async () => {
      const { service } = montar(undefined, false);
      await expect(
        service.hasCapability(ORGANIZACAO, PlanCapability.CUSTOMERS),
      ).resolves.toBe(false);
    });

    it('libera o que o plano contratou', async () => {
      const { service } = montar();
      await expect(
        service.hasCapability(ORGANIZACAO, PlanCapability.CUSTOMERS),
      ).resolves.toBe(true);
    });

    it('recusa inteligência nos planos sem inteligência', async () => {
      const { repositorio, service } = montar();
      for (const plano of ['ESSENTIAL', 'PROFESSIONAL']) {
        repositorio.planKey = plano;
        await expect(
          service.hasCapability(ORGANIZACAO, PlanCapability.ORBIT_INTELLIGENCE),
        ).resolves.toBe(false);
        await expect(
          service.assertCapability(ORGANIZACAO, PlanCapability.AI_ASSISTANTS),
        ).rejects.toBeInstanceOf(PlanCapabilityUnavailableException);
      }
    });

    it('libera inteligência onde ela foi comprada', async () => {
      const { repositorio, service } = montar();
      for (const plano of [
        'PROFESSIONAL_INTELLIGENCE',
        'ENTERPRISE_UNLIMITED',
      ]) {
        repositorio.planKey = plano;
        await expect(
          service.hasCapability(ORGANIZACAO, PlanCapability.ORBIT_INTELLIGENCE),
        ).resolves.toBe(true);
      }
    });

    it('a recusa não nomeia a capacidade na copy pública', async () => {
      const { service } = montar();
      await service
        .assertCapability(ORGANIZACAO, PlanCapability.AI_ASSISTANTS)
        .catch((error: PlanCapabilityUnavailableException) => {
          expect(error.code).toBe('PLAN_CAPABILITY_NOT_AVAILABLE');
          expect(error.getStatus()).toBe(403);
        });
      expect.assertions(2);
    });
  });

  describe('alocação', () => {
    it('deixa passar enquanto cabe', async () => {
      const { repositorio, service } = montar();
      repositorio.counts.set(AllocationResource.PLATFORM_USERS, 4);
      await expect(
        service.canAllocate(ORGANIZACAO, AllocationResource.PLATFORM_USERS),
      ).resolves.toBe(true);
      await expect(
        service.assertCanAllocate(
          ORGANIZACAO,
          AllocationResource.PLATFORM_USERS,
        ),
      ).resolves.toBeUndefined();
    });

    it('recusa a unidade que passaria do teto', async () => {
      const { repositorio, service } = montar();
      repositorio.counts.set(AllocationResource.PLATFORM_USERS, 5);
      await expect(
        service.canAllocate(ORGANIZACAO, AllocationResource.PLATFORM_USERS),
      ).resolves.toBe(false);
      await expect(
        service.assertCanAllocate(
          ORGANIZACAO,
          AllocationResource.PLATFORM_USERS,
        ),
      ).rejects.toBeInstanceOf(PlanAllocationLimitReachedException);
    });

    it('não executa o trabalho quando a vaga não existe', async () => {
      const { repositorio, service } = montar();
      repositorio.counts.set(AllocationResource.BUSINESS_UNITS, 1);
      const trabalho = jest.fn().mockResolvedValue('criado');
      await expect(
        service.guardAllocation(
          ORGANIZACAO,
          AllocationResource.BUSINESS_UNITS,
          trabalho,
        ),
      ).rejects.toBeInstanceOf(PlanAllocationLimitReachedException);
      expect(trabalho).not.toHaveBeenCalled();
    });

    it('não tem teto no plano ilimitado', async () => {
      const { repositorio, service } = montar();
      repositorio.planKey = 'ENTERPRISE_UNLIMITED';
      repositorio.counts.set(AllocationResource.PLATFORM_USERS, 10_000);
      await expect(
        service.canAllocate(ORGANIZACAO, AllocationResource.PLATFORM_USERS),
      ).resolves.toBe(true);
    });
  });

  describe('uso mensal', () => {
    const origem = (id: string): LedgerSource => ({
      type: 'ARTIFACT_EXECUTION',
      id,
    });

    it('conta o evento uma vez, mesmo repetido', async () => {
      const { service } = montar();
      const primeira = await service.consume(
        ORGANIZACAO,
        UsageResource.PMOC_DOCUMENTS_ISSUED,
        origem('doc-1'),
      );
      const segunda = await service.consume(
        ORGANIZACAO,
        UsageResource.PMOC_DOCUMENTS_ISSUED,
        origem('doc-1'),
      );
      expect(primeira.counted).toBe(true);
      expect(segunda.counted).toBe(false);
      expect(segunda.total).toBe(1);
    });

    it('recusa a emissão que passaria do teto mensal', async () => {
      const { repositorio, service } = montar();
      repositorio.limits = {
        entitlements: {
          capabilities: ['ARTIFACTS'],
          allocation: {
            BUSINESS_UNITS: 1,
            PLATFORM_USERS: 1,
            FIELD_TECHNICIANS: 1,
            AUXILIARY_TECHNICIANS: 1,
            ACTIVE_CUSTOMERS: 1,
            ACTIVE_EQUIPMENT: 1,
          },
          usage: {
            SERVICE_ORDERS_CREATED: 1,
            PMOC_DOCUMENTS_ISSUED: 1,
            RVT_DOCUMENTS_ISSUED: 1,
            OTHER_DOCUMENTS_ISSUED: 1,
            AUTOMATION_RUNS: 1,
            AI_COMPUTE: null,
          },
        },
      };
      repositorio.planKey = 'PLANO_DE_TESTE';

      await expect(
        service.consume(
          ORGANIZACAO,
          UsageResource.SERVICE_ORDERS_CREATED,
          origem('os-1'),
        ),
      ).resolves.toMatchObject({ counted: true, total: 1 });

      await expect(
        service.consume(
          ORGANIZACAO,
          UsageResource.SERVICE_ORDERS_CREATED,
          origem('os-2'),
        ),
      ).rejects.toBeInstanceOf(PlanUsageLimitReachedException);
    });

    it('o evento já contado não falha por limite', async () => {
      const { repositorio, service } = montar();
      repositorio.limits = {
        entitlements: {
          capabilities: [],
          allocation: {
            BUSINESS_UNITS: 0,
            PLATFORM_USERS: 0,
            FIELD_TECHNICIANS: 0,
            AUXILIARY_TECHNICIANS: 0,
            ACTIVE_CUSTOMERS: 0,
            ACTIVE_EQUIPMENT: 0,
          },
          usage: {
            SERVICE_ORDERS_CREATED: 1,
            PMOC_DOCUMENTS_ISSUED: 1,
            RVT_DOCUMENTS_ISSUED: 1,
            OTHER_DOCUMENTS_ISSUED: 1,
            AUTOMATION_RUNS: 1,
            AI_COMPUTE: null,
          },
        },
      };
      repositorio.planKey = 'PLANO_DE_TESTE';
      await service.consume(
        ORGANIZACAO,
        UsageResource.RVT_DOCUMENTS_ISSUED,
        origem('rvt-1'),
      );
      await expect(
        service.consume(
          ORGANIZACAO,
          UsageResource.RVT_DOCUMENTS_ISSUED,
          origem('rvt-1'),
        ),
      ).resolves.toMatchObject({ counted: false });
    });

    it('desfaz o trabalho quando a cota estoura', async () => {
      const { repositorio, service } = montar();
      repositorio.planKey = 'PLANO_DE_TESTE';
      repositorio.limits = {
        entitlements: {
          capabilities: [],
          allocation: {
            BUSINESS_UNITS: 0,
            PLATFORM_USERS: 0,
            FIELD_TECHNICIANS: 0,
            AUXILIARY_TECHNICIANS: 0,
            ACTIVE_CUSTOMERS: 0,
            ACTIVE_EQUIPMENT: 0,
          },
          usage: {
            SERVICE_ORDERS_CREATED: 0,
            PMOC_DOCUMENTS_ISSUED: 0,
            RVT_DOCUMENTS_ISSUED: 0,
            OTHER_DOCUMENTS_ISSUED: 0,
            AUTOMATION_RUNS: 0,
            AI_COMPUTE: null,
          },
        },
      };
      const trabalho = jest.fn().mockResolvedValue({ id: 'os-9' });
      await expect(
        service.guardUsage(
          ORGANIZACAO,
          UsageResource.SERVICE_ORDERS_CREATED,
          (resultado: { id: string }) => ({
            type: 'OPERATION',
            id: resultado.id,
          }),
          trabalho,
        ),
      ).rejects.toBeInstanceOf(PlanUsageLimitReachedException);
      expect(trabalho).toHaveBeenCalledTimes(1);
    });

    it('recusa quantidade que não seja inteiro positivo', async () => {
      const { service } = montar();
      for (const quantidade of [0, -1, 1.5]) {
        await expect(
          service.consume(
            ORGANIZACAO,
            UsageResource.AUTOMATION_RUNS,
            origem('a'),
            quantidade,
          ),
        ).rejects.toBeInstanceOf(PlanConfigurationInvalidException);
      }
    });
  });

  describe('plano legado', () => {
    it('não passa a aplicar tetos em quem nunca os teve', async () => {
      const { repositorio, service } = montar();
      repositorio.planKey = 'OWNER_FULL_ACCESS';
      repositorio.counts.set(AllocationResource.PLATFORM_USERS, 900);
      const direitos = await service.resolve(ORGANIZACAO);
      expect(direitos.source).toBe('LEGACY_UNGOVERNED');
      await expect(
        service.canAllocate(ORGANIZACAO, AllocationResource.PLATFORM_USERS),
      ).resolves.toBe(true);
      await expect(
        service.hasCapability(ORGANIZACAO, PlanCapability.ORBIT_INTELLIGENCE),
      ).resolves.toBe(true);
    });
  });

  describe('equipe de campo conta pessoas, não designações', () => {
    /**
     * A contagem canônica é a mesma para os dois nomes comerciais: quantas
     * pessoas estão habilitadas para operar em campo. O repositório de mentira
     * reflete isso — um número só, servido aos dois recursos.
     */
    const comEquipe = (pessoas: number) => {
      const montado = montar();
      montado.repositorio.counts.set(
        AllocationResource.FIELD_TECHNICIANS,
        pessoas,
      );
      montado.repositorio.counts.set(
        AllocationResource.AUXILIARY_TECHNICIANS,
        pessoas,
      );
      return montado;
    };

    it('os dois recursos comerciais leem a mesma vaga', async () => {
      const { service } = comEquipe(5);
      const tecnicos = await service.getCurrentUsage(
        ORGANIZACAO,
        AllocationResource.FIELD_TECHNICIANS,
      );
      const auxiliares = await service.getCurrentUsage(
        ORGANIZACAO,
        AllocationResource.AUXILIARY_TECHNICIANS,
      );
      expect(tecnicos).toBe(auxiliares);
    });

    it('cinco pessoas cabem no Essencial', async () => {
      const { service } = comEquipe(4);
      await expect(
        service.canAllocate(ORGANIZACAO, AllocationResource.FIELD_TECHNICIANS),
      ).resolves.toBe(true);
    });

    it('a sexta pessoa é recusada', async () => {
      const { service } = comEquipe(5);
      await expect(
        service.canAllocate(ORGANIZACAO, AllocationResource.FIELD_TECHNICIANS),
      ).resolves.toBe(false);
      await expect(
        service.assertCanAllocate(
          ORGANIZACAO,
          AllocationResource.FIELD_TECHNICIANS,
        ),
      ).rejects.toBeInstanceOf(PlanAllocationLimitReachedException);
    });

    it('o teto vale igual pelos dois nomes comerciais', async () => {
      const { service } = comEquipe(5);
      await expect(
        service.assertCanAllocate(
          ORGANIZACAO,
          AllocationResource.AUXILIARY_TECHNICIANS,
        ),
      ).rejects.toBeInstanceOf(PlanAllocationLimitReachedException);
    });

    it('com a equipe cheia, o teto em vigor continua sendo cinco', async () => {
      const { service } = comEquipe(5);
      const tecnicos = await service.getEffectiveLimit(
        ORGANIZACAO,
        AllocationResource.FIELD_TECHNICIANS,
      );
      const auxiliares = await service.getEffectiveLimit(
        ORGANIZACAO,
        AllocationResource.AUXILIARY_TECHNICIANS,
      );
      expect(tecnicos).toEqual({ kind: 'LIMITED', value: 5 });
      expect(auxiliares).toEqual({ kind: 'LIMITED', value: 5 });
    });

    it('o plano ilimitado não tem teto de equipe', async () => {
      const { repositorio, service } = comEquipe(10_000);
      repositorio.planKey = 'ENTERPRISE_UNLIMITED';
      await expect(
        service.canAllocate(
          ORGANIZACAO,
          AllocationResource.AUXILIARY_TECHNICIANS,
        ),
      ).resolves.toBe(true);
    });

    it('o mais restritivo vence quando os dois números divergem', async () => {
      const { repositorio, service } = comEquipe(3);
      repositorio.planKey = 'PLANO_DE_TESTE';
      repositorio.limits = {
        entitlements: {
          capabilities: [],
          allocation: {
            BUSINESS_UNITS: 1,
            PLATFORM_USERS: 1,
            FIELD_TECHNICIANS: 9,
            AUXILIARY_TECHNICIANS: 3,
            ACTIVE_CUSTOMERS: 1,
            ACTIVE_EQUIPMENT: 1,
          },
          usage: {
            SERVICE_ORDERS_CREATED: 1,
            PMOC_DOCUMENTS_ISSUED: 1,
            RVT_DOCUMENTS_ISSUED: 1,
            OTHER_DOCUMENTS_ISSUED: 1,
            AUTOMATION_RUNS: 1,
            AI_COMPUTE: null,
          },
        },
      };
      await expect(
        service.getEffectiveLimit(
          ORGANIZACAO,
          AllocationResource.FIELD_TECHNICIANS,
        ),
      ).resolves.toEqual({ kind: 'LIMITED', value: 3 });
      await expect(
        service.canAllocate(ORGANIZACAO, AllocationResource.FIELD_TECHNICIANS),
      ).resolves.toBe(false);
    });
  });

  describe('desempenho', () => {
    it('resolve o plano uma vez por requisição, não uma por linha', async () => {
      const contexto = contextoDeRequisicao();
      const { repositorio, service } = montar(contexto, false);
      for (let i = 0; i < 50; i += 1) {
        await service.hasCapability(ORGANIZACAO, PlanCapability.CUSTOMERS);
      }
      expect(repositorio.consultasDePlano).toBe(1);
    });

    it('fora de uma requisição não guarda nada entre chamadas', async () => {
      const { repositorio, service } = montar(undefined, false);
      await service.hasCapability(ORGANIZACAO, PlanCapability.CUSTOMERS);
      await service.hasCapability(ORGANIZACAO, PlanCapability.CUSTOMERS);
      expect(repositorio.consultasDePlano).toBe(2);
    });

    it('a memória não atravessa requisições diferentes', async () => {
      const primeira = contextoDeRequisicao();
      const segunda = contextoDeRequisicao();
      const { repositorio, service } = montar(primeira, false);
      await service.resolve(ORGANIZACAO);
      await service.resolve(ORGANIZACAO);
      expect(repositorio.consultasDePlano).toBe(1);

      const outra = montar(segunda, false);
      await outra.service.resolve(ORGANIZACAO);
      expect(outra.repositorio.consultasDePlano).toBe(1);
    });
  });

  describe('recurso desconhecido', () => {
    it('falha fechado', async () => {
      const { service } = montar();
      await expect(
        service.getCurrentUsage(ORGANIZACAO, 'STORAGE_GIGABYTES'),
      ).rejects.toBeInstanceOf(PlanConfigurationInvalidException);
    });
  });
});
