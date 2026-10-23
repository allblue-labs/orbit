/**
 * A troca de plano, e o que ela faz com a avaliação gratuita.
 *
 * ## O buraco que isto fecha
 *
 * Os trinta dias gratuitos existem para o Essencial e só concedem os limites
 * dele — é a condição com que foram oferecidos. Mas a subida de plano aplicava
 * o destino **na hora**, e a avaliação seguia correndo: dava para entrar no
 * Essencial grátis, trocar para o Profissional no mesmo minuto e usar os
 * limites maiores sem pagar nada até o trigésimo dia.
 */
import { BillingInterval, PlanCode } from '../catalog/plan-catalog.types';
import { snapshotOf } from './subscription.snapshot';
import { planDefinition } from '../catalog/plan-registry';
import { SubscriptionService } from './subscription.service';
import { SubscriptionStatus } from './subscription.types';

const ORG = '01900000-0000-7000-8000-000000000001';
/**
 * O fim da avaliação e o do período de cobrança são datas **diferentes** de
 * propósito.
 *
 * Iguais, a asserção não distinguiria `trialEndsAt` de `currentPeriodEnd` — e
 * trocar um pelo outro passaria despercebido. A avaliação acaba no dia trinta
 * do cadastro; o período de cobrança segue a âncora da assinatura.
 */
const FIM_DA_AVALIACAO = new Date('2026-10-31T12:00:00Z');
const FIM_DO_PERIODO = new Date('2026-11-01T12:00:00Z');

function bancada(linha: Record<string, unknown>) {
  const repository = {
    findCurrent: jest.fn().mockResolvedValue({
      id: 'sub-1',
      organizationId: ORG,
      planCode: PlanCode.ESSENTIAL,
      status: SubscriptionStatus.TRIALING,
      billingInterval: BillingInterval.MONTHLY,
      billingAnchorAt: new Date('2026-10-01T12:00:00Z'),
      currentPeriodStart: new Date('2026-10-01T12:00:00Z'),
      currentPeriodEnd: FIM_DO_PERIODO,
      trialStartsAt: new Date('2026-10-01T12:00:00Z'),
      trialEndsAt: FIM_DA_AVALIACAO,
      graceStartsAt: null,
      graceEndsAt: null,
      pendingPlanCode: null,
      pendingBillingInterval: null,
      pendingCatalogVersion: null,
      pendingEntitlementsSnapshot: null,
      pendingEffectiveAt: null,
      entitlementsSnapshot: {},
      catalogVersion: 1,
      version: 1,
      cancelAtPeriodEnd: false,
      ...linha,
    }),
    updateIfVersion: jest
      .fn<
        Promise<Record<string, unknown>>,
        [string, number, Record<string, unknown>]
      >()
      .mockImplementation((_id, _v, data) =>
        Promise.resolve({ id: 'sub-1', ...data }),
      ),
  };
  return {
    repository,
    service: new SubscriptionService(repository as never),
  };
}

describe('trocar de plano durante a avaliação', () => {
  it('a subida é programada para o fim da avaliação, não aplicada na hora', async () => {
    const { service, repository } = bancada({});

    await service.changePlan(ORG, 1, PlanCode.PROFESSIONAL);

    const data = repository.updateIfVersion.mock.calls[0]![2];

    /* O plano corrente **não** muda: os limites seguem sendo os do Essencial
       enquanto o período gratuito corre. */
    expect(data.planCode).toBeUndefined();
    expect(data.entitlementsSnapshot).toBeUndefined();

    expect(data.pendingPlanCode).toBe(PlanCode.PROFESSIONAL);
    /* O fim da avaliação, e não o do período de cobrança: é ele que marca o
       instante em que o gratuito acaba. */
    expect(data.pendingEffectiveAt).toEqual(FIM_DA_AVALIACAO);
    expect(data.pendingEffectiveAt).not.toEqual(FIM_DO_PERIODO);
  });

  it('em plano pago, a subida aguarda o vencimento do período atual', async () => {
    const { service, repository } = bancada({
      status: SubscriptionStatus.ACTIVE,
      trialStartsAt: null,
      trialEndsAt: null,
    });

    await service.changePlan(ORG, 1, PlanCode.PROFESSIONAL);

    const data = repository.updateIfVersion.mock.calls[0]![2];

    expect(data.planCode).toBeUndefined();
    expect(data.pendingPlanCode).toBe(PlanCode.PROFESSIONAL);
    expect(data.pendingEffectiveAt).toEqual(FIM_DO_PERIODO);
  });

  it('o rebaixamento continua programado para o fim do período', async () => {
    /* Rebaixar nunca desliga ninguém no meio do que foi pago: o que existe
       continua existindo, e o que fica bloqueado é criar mais. */
    const { service, repository } = bancada({
      status: SubscriptionStatus.ACTIVE,
      planCode: PlanCode.PROFESSIONAL,
      trialStartsAt: null,
      trialEndsAt: null,
    });

    await service.changePlan(ORG, 1, PlanCode.ESSENTIAL);

    const data = repository.updateIfVersion.mock.calls[0]![2];

    expect(data.planCode).toBeUndefined();
    expect(data.pendingPlanCode).toBe(PlanCode.ESSENTIAL);
    expect(data.pendingEffectiveAt).toBeInstanceOf(Date);
  });
});

describe('renovação financeira e prazo de adequação', () => {
  it('o prazo de adequação de contratos antigos também vale quando o worker atrasa', async () => {
    const { service } = bancada({
      status: 'ACTIVE',
      trialStartsAt: null,
      trialEndsAt: null,
      providerSubscriptionId: null,
      planCode: 'PROFESSIONAL',
      entitlementsSnapshot: snapshotOf(planDefinition('PROFESSIONAL')),
      pendingPlanCode: 'ESSENTIAL',
      pendingEffectiveAt: FIM_DO_PERIODO,
      pendingEntitlementsSnapshot: snapshotOf(planDefinition('ESSENTIAL')),
    });
    const current = await service.currentOrNull(
      ORG,
      new Date('2026-11-02T12:00:00Z'),
    );
    expect(current?.planCode).toBe('ESSENTIAL');
    expect(current?.limitsChangedAt).toEqual(FIM_DO_PERIODO);
    expect(current?.previousEntitlementsSnapshot).toEqual(
      snapshotOf(planDefinition('PROFESSIONAL')),
    );
    expect(current?.pendingPlanCode).toBeNull();
  });
  it('não antecipa troca de um período pago ainda em andamento', async () => {
    const { service, repository } = bancada({
      status: 'ACTIVE',
      trialStartsAt: null,
      trialEndsAt: null,
      providerSubscriptionId: 'sub_stripe',
      entitlementsSnapshot: snapshotOf(planDefinition('ESSENTIAL')),
    });
    await expect(
      service.applyProviderPlan(ORG, 1, {
        planCode: 'PROFESSIONAL',
        billingInterval: 'MONTHLY',
        activate: true,
        cancelAtPeriodEnd: false,
        period: {
          start: new Date('2026-10-23T12:00:00Z'),
          end: new Date('2026-11-23T12:00:00Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'PLAN_CHANGE_NOT_ALLOWED' });
    expect(repository.updateIfVersion).not.toHaveBeenCalled();
  });
  it('webhook do plano anterior não apaga a troca agendada', async () => {
    const { service, repository } = bancada({
      status: 'ACTIVE',
      trialStartsAt: null,
      trialEndsAt: null,
      providerSubscriptionId: 'sub_stripe',
      entitlementsSnapshot: snapshotOf(planDefinition('ESSENTIAL')),
      pendingPlanCode: 'PROFESSIONAL',
      pendingEffectiveAt: FIM_DO_PERIODO,
    });
    await service.applyProviderPlan(ORG, 1, {
      planCode: 'ESSENTIAL',
      billingInterval: 'MONTHLY',
      activate: true,
      cancelAtPeriodEnd: false,
      period: { start: new Date('2026-10-01T12:00:00Z'), end: FIM_DO_PERIODO },
    });
    const data = repository.updateIfVersion.mock.calls[0]![2];
    expect(data.pendingPlanCode).toBeUndefined();
    expect(data.pendingEffectiveAt).toBeUndefined();
    expect(data.limitsChangedAt).toBeUndefined();
  });
});
