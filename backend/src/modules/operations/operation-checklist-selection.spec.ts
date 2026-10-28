import { AuthorizationService } from '../../common/authorization.service';
import { OperationController } from './operation.controller';
import { OperationService } from './operation.service';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import type { CreateOperationDto } from './dto/operation.dto';
import { PlanCode } from '../subscription-plans/catalog/plan-catalog.types';
import { planDefinition } from '../subscription-plans/catalog/plan-registry';

const input: CreateOperationDto = {
  businessUnitId: 'unit',
  code: 'OS-1',
  title: 'Manutenção',
  kind: 'MAINTENANCE',
  checklists: [{ templateId: 'general' }, { templateId: 'specific' }],
};

function harness(fail = false, plan = PlanCode.ESSENTIAL) {
  let ambient = false;
  const repository = {
    findBusinessUnit: jest.fn().mockResolvedValue({ id: 'unit' }),
    create: jest.fn(() => {
      expect(ambient).toBe(true);
      return Promise.resolve({ id: 'operation' });
    }),
    find: jest.fn().mockResolvedValue({
      id: 'operation',
      checklistExecutions: ['general', 'specific'],
    }),
  };
  const entitlements = {
    assertCapability: jest.fn((_organizationId: string, capability: string) => {
      if (!planDefinition(plan).capabilities.includes(capability))
        return Promise.reject(new Error('Seu plano não inclui este recurso.'));
      return Promise.resolve();
    }),
    guardUsage: jest.fn(
      async (
        _org: string,
        _resource: string,
        _source: unknown,
        work: () => Promise<unknown>,
      ) => {
        ambient = true;
        try {
          return await work();
        } finally {
          ambient = false;
        }
      },
    ),
  };
  const checklists = {
    start: jest.fn(
      (
        _op: string,
        _org: string,
        _actor: string,
        selected: { templateId: string },
      ) => {
        expect(ambient).toBe(true);
        return fail && selected.templateId === 'specific'
          ? Promise.reject(new Error('Modelo indisponível'))
          : Promise.resolve({ id: selected.templateId });
      },
    ),
  };
  const notifications = { notify: jest.fn() };
  const service = new OperationService(
    repository as never,
    {} as never,
    {} as never,
    entitlements as never,
    {} as never,
    checklists as never,
    notifications as never,
  );
  return { service, repository, entitlements, checklists, notifications };
}

describe('seleção de checklists na criação da operação', () => {
  it.each(Object.values(PlanCode))(
    'cria uma operação com checklist no plano %s',
    async (plan) => {
      const { service, checklists } = harness(false, plan);
      await expect(
        service.create('org', 'owner', input),
      ).resolves.toMatchObject({ id: 'operation' });
      expect(checklists.start).toHaveBeenCalledTimes(2);
    },
  );
  it('vincula somente os modelos escolhidos dentro da transação ambiente e retorna os vínculos', async () => {
    const { service, checklists, entitlements } = harness();
    const operation = await service.create('org', 'owner', input);
    expect(entitlements.assertCapability).toHaveBeenCalledWith(
      'org',
      'OPERATIONS',
    );
    expect(checklists.start).toHaveBeenNthCalledWith(
      1,
      'operation',
      'org',
      'owner',
      { templateId: 'general' },
    );
    expect(checklists.start).toHaveBeenNthCalledWith(
      2,
      'operation',
      'org',
      'owner',
      { templateId: 'specific' },
    );
    expect(operation.checklistExecutions).toEqual(['general', 'specific']);
  });

  it('uma falha no segundo modelo propaga para a transação, sem sucesso parcial', async () => {
    const { service, repository, entitlements } = harness(true);
    await expect(service.create('org', 'owner', input)).rejects.toThrow(
      'Modelo indisponível',
    );
    expect(repository.find).not.toHaveBeenCalled();
    await expect(
      entitlements.guardUsage.mock.results[0].value,
    ).rejects.toThrow();
  });

  it('a seleção vazia é explícita e não recoloca modelos gerais no backend', async () => {
    const { service, checklists, entitlements } = harness();
    await service.create('org', 'owner', { ...input, checklists: [] });
    expect(checklists.start).not.toHaveBeenCalled();
    expect(entitlements.assertCapability).not.toHaveBeenCalled();
  });

  it('não permite contornar a permissão de checklists pela criação da operação', async () => {
    const service = { create: jest.fn() };
    const controller = new OperationController(
      service as never,
      {} as never,
      new AuthorizationService(),
    );
    const request = {
      identity: {
        id: 'user',
        organizationId: 'org',
        isOrganizationOwner: false,
        permissions: ['operations.create'],
      },
    } as unknown as IdentityRequest;
    await expect(controller.create(request, input)).rejects.toThrow(
      'Você não possui permissão para vincular checklists',
    );
    expect(service.create).not.toHaveBeenCalled();
  });
});
