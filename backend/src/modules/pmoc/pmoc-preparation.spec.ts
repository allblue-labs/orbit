import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../decorators';
import { PmocService, type PmocActor } from './pmoc.service';
import { PmocController } from './pmoc.controller';
import { pmocProcedure, executionPmocProcedure } from './pmoc-procedure';
import { WorkforceService } from '../workforce/workforce.service';

const actor: PmocActor = {
  actorId: 'field',
  organizationId: 'org',
  businessUnitIds: ['unit'],
  permissions: ['pmoc.read'],
};
function setup(
  existing: unknown = null,
  mobileNotifications?: { materialize: jest.Mock },
) {
  const data = {
    plan: {
      id: 'plan',
      code: 'PMOC-1',
      name: 'Plano',
      businessUnitId: 'unit',
      status: 'ACTIVE',
      technicianUserId: 'plan-field',
      technicalResponsibleUserId: 'owner',
      technicalResponsible: { id: 'owner', displayName: 'Proprietário' },
      customer: { id: 'customer', legalName: 'Cliente' },
      procedure: {},
      units: [
        {
          unit: {
            name: 'Evaporadora',
            checklistTemplate: {
              items: [{ label: 'Limpar filtro' }, { title: 'Verificar dreno' }],
            },
          },
        },
      ],
    },
    cycle: { id: 'cycle', status: 'PENDING', dueOn: new Date('2026-10-27') },
    coverage: {
      id: 'coverage',
      asset: { id: 'asset', name: 'Split', status: 'ACTIVE' },
    },
    existing,
    technicalResponsibleSignature: {},
    technicalResponsibleCredential: {},
  };
  const repository = {
    executionPreparation: jest.fn().mockResolvedValue(data),
    operationCodeTaken: jest.fn().mockResolvedValue(false),
    startEquipmentExecution: jest
      .fn()
      .mockResolvedValue({ created: true, execution: { id: 'execution' } }),
  };
  const workforce = {
    professionalEligibility: jest
      .fn()
      .mockResolvedValue({ eligible: true, signatureAvailable: true }),
    listProfessionals: jest
      .fn()
      .mockResolvedValue([{ id: 'owner', signatureAvailable: true }]),
    listPmocFieldTechnicians: jest.fn().mockResolvedValue([
      { id: 'field', name: 'Operador' },
      { id: 'owner', name: 'Proprietário' },
    ]),
    listFieldAssistantCandidates: jest
      .fn()
      .mockResolvedValue([{ id: 'assistant', name: 'Auxiliar' }]),
  };
  const service = new PmocService(
    repository as never,
    { equipmentExecution: (row: unknown) => row } as never,
    {} as never,
    workforce as never,
    {} as never,
    {} as never,
    {} as never,
    mobileNotifications as never,
  );
  return { service, data, repository, workforce };
}

describe('preparação e escala do atendimento PMOC', () => {
  it('publica roteiros das unidades e auxiliares sem exigir perfil de operador', async () => {
    const env = setup();
    const result = await env.service.equipmentExecutionPreparation(
      'plan',
      'cycle',
      'asset',
      { ...actor, isOrganizationOwner: true },
    );
    expect(result.procedureGroups).toEqual([
      { group: 'Evaporadora', items: ['Limpar filtro', 'Verificar dreno'] },
    ]);
    expect(result.auxiliaryTechnicians).toEqual([
      { id: 'assistant', name: 'Auxiliar' },
    ]);
    expect(result.fieldTechnicians).toContainEqual({
      id: 'owner',
      name: 'Proprietário',
    });
    expect(env.workforce.listFieldAssistantCandidates).toHaveBeenCalledWith(
      'org',
      'unit',
    );
  });

  it('aceita auxiliar e salva o mesmo roteiro no snapshot da execução', async () => {
    const env = setup();
    await env.service.startEquipmentExecution(
      'plan',
      'cycle',
      'asset',
      { ...actor, isOrganizationOwner: true },
      {
        responsibleFieldTechnicianId: 'owner',
        auxiliaryTechnicianIds: ['assistant'],
      },
    );
    expect(env.repository.startEquipmentExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        auxiliaryTechnicianIds: ['assistant'],
        responsibleFieldTechnicianId: 'owner',
        procedureSnapshot: {
          Evaporadora: ['Limpar filtro', 'Verificar dreno'],
        },
      }),
    );
  });

  it('notifica os técnicos atribuídos com o destino do equipamento PMOC, sem repetir na retomada', async () => {
    const notifications = { materialize: jest.fn().mockResolvedValue({}) };
    const env = setup(null, notifications);
    const start = () =>
      env.service.startEquipmentExecution(
        'plan',
        'cycle',
        'asset',
        { ...actor, actorId: 'manager', isOrganizationOwner: true },
        {
          responsibleFieldTechnicianId: 'field',
          auxiliaryTechnicianIds: ['assistant'],
        },
      );
    await start();
    expect(notifications.materialize).toHaveBeenCalledTimes(2);
    expect(notifications.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org',
        businessUnitId: 'unit',
        recipientUserId: 'field',
        workItemId: 'PMOC:cycle:asset',
        factId: 'execution',
      }),
    );
    env.repository.startEquipmentExecution.mockResolvedValue({
      created: false,
      execution: { id: 'execution' },
    });
    await start();
    expect(notifications.materialize).toHaveBeenCalledTimes(2);
  });

  it('a atribuição à execução libera conclusão sem depender da atribuição ao plano', async () => {
    const env = setup({
      id: 'execution',
      status: 'IN_PROGRESS',
      responsibleFieldTechnician: { id: 'field' },
      procedureSnapshot: {},
    });
    const result = await env.service.equipmentExecutionPreparation(
      'plan',
      'cycle',
      'asset',
      actor,
    );
    expect(result.allowedActions).toEqual(['COMPLETE', 'ADD_EVIDENCE']);
    const assignedWithoutGlobalPermissions =
      await env.service.equipmentExecutionPreparation(
        'plan',
        'cycle',
        'asset',
        { ...actor, permissions: [] },
      );
    expect(assignedWithoutGlobalPermissions.allowedActions).toEqual([
      'COMPLETE',
      'ADD_EVIDENCE',
    ]);
    await expect(
      env.service.equipmentExecutionPreparation('plan', 'cycle', 'asset', {
        ...actor,
        actorId: 'someone-else',
        permissions: [],
      }),
    ).rejects.toThrow(/não está atribuído/i);
    const other = await env.service.equipmentExecutionPreparation(
      'plan',
      'cycle',
      'asset',
      { ...actor, actorId: 'someone-else' },
    );
    expect(other.allowedActions).toEqual(['VIEW']);
    expect(result.procedureGroups).toHaveLength(1);
  });

  it('as rotas pessoais verificam a atribuição no serviço sem exigir permissão global', () => {
    const reflector = new Reflector();
    for (const name of [
      'startMyEquipmentExecution',
      'completeMyEquipmentExecution',
      'generateMyEquipmentArtifact',
    ]) {
      const handler: unknown = Reflect.get(PmocController.prototype, name);
      if (typeof handler !== 'function') throw new Error('Missing handler');
      expect(reflector.get(PERMISSIONS_KEY, handler) ?? []).not.toContain(
        'pmoc.execute',
      );
    }
  });

  it('mantém o roteiro congelado e combina grupos sem repetição', () => {
    const units = [
      {
        unit: {
          name: 'Evaporadora',
          checklistTemplate: { items: ['Filtro', 'Dreno'] },
        },
      },
    ];
    expect(
      pmocProcedure(
        { Evaporadora: ['Filtro'], Condensadora: ['Corrente'] },
        units,
      ),
    ).toEqual({ Evaporadora: ['Filtro', 'Dreno'], Condensadora: ['Corrente'] });
    expect(
      executionPmocProcedure({ Histórico: ['Roteiro na abertura'] }, {}, units),
    ).toEqual({ Histórico: ['Roteiro na abertura'] });
  });

  it('inclui somente o proprietário RT entre os técnicos adicionais, sem duplicá-lo', async () => {
    const workforce = new WorkforceService(
      {
        organizationOwner: () => Promise.resolve({ ownerUserId: 'owner' }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const list = jest
      .spyOn(workforce, 'listProfessionals')
      .mockResolvedValueOnce([{ id: 'field', name: 'Operador' }] as never)
      .mockResolvedValueOnce([
        { id: 'owner', name: 'Proprietário' },
        { id: 'other-rt', name: 'Outro RT' },
      ] as never);
    expect(
      (await workforce.listPmocFieldTechnicians('org', 'unit')).map(
        (person) => person.id,
      ),
    ).toEqual(['field', 'owner']);
    expect(list).toHaveBeenCalledWith('org', 'TECHNICAL_RESPONSIBLE', 'unit');
  });
});
