import { brandImageStub } from '../../../test/support/brand-image.stub';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PmocService, type PmocActor } from './pmoc.service';
import { CreatePmocPlanDto, UpdatePmocPlanDto } from './pmoc.dto';

const rt = '01900000-0000-7000-8000-000000000001';
const actor: PmocActor = {
  actorId: 'owner',
  organizationId: 'org',
  businessUnitIds: ['unit'],
  permissions: ['pmoc.manage'],
  isOrganizationOwner: true,
};
const input: CreatePmocPlanDto = {
  businessUnitId: 'unit',
  customerId: 'customer',
  name: 'Plano preventivo',
  startsOn: '2026-01-01',
  frequencyAmount: 1,
  frequencyUnit: 'MONTHS',
  technicalResponsibleUserId: rt,
};

function fixture(responsibleId: string | null = null) {
  const plan = {
    id: 'plan',
    name: 'Plano preventivo',
    status: 'ACTIVE',
    startsOn: new Date('2026-01-01'),
    endsOn: null,
    businessUnit: { id: 'unit' },
    technicalResponsibleUserId: responsibleId,
    technicalResponsible: responsibleId
      ? { id: responsibleId, displayName: 'Responsável' }
      : null,
    _count: { coverages: 1 },
  };
  const repository = {
    find: jest.fn().mockResolvedValue(plan),
    findBusinessUnit: jest.fn().mockResolvedValue({ id: 'unit' }),
    findCustomer: jest
      .fn()
      .mockResolvedValue({ id: 'customer', legalName: 'Cliente' }),
    create: jest.fn().mockResolvedValue(plan),
    update: jest.fn().mockResolvedValue(plan),
    activate: jest.fn(),
  };
  const professionals = jest
    .fn()
    .mockResolvedValue([{ id: rt, signatureAvailable: false }]);
  const service = new PmocService(
    repository as never,
    { summary: (value: unknown) => value } as never,
    {} as never,
    { listProfessionals: professionals } as never,
    {} as never,
    {} as never,
    {} as never,
    undefined,
    brandImageStub(),
  );
  return { service, repository, professionals };
}

describe('Responsável Técnico obrigatório na configuração do PMOC', () => {
  it('recusa novo plano sem responsável antes de persistir', async () => {
    const { service, repository } = fixture();
    await expect(
      service.create(actor, {
        ...input,
        technicalResponsibleUserId: undefined,
      } as unknown as CreatePmocPlanDto),
    ).rejects.toThrow(/Defina.*Responsável Técnico/);
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('exige que o responsável seja elegível na organização e unidade do plano', async () => {
    const { service, repository, professionals } = fixture();
    professionals.mockResolvedValue([]);
    await expect(service.create(actor, input)).rejects.toThrow(
      /habilitado na unidade/,
    );
    expect(professionals).toHaveBeenCalledWith(
      'org',
      'TECHNICAL_RESPONSIBLE',
      'unit',
    );
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('permite configurar o profissional antes de cadastrar sua assinatura', async () => {
    const { service, repository } = fixture();
    await service.create(actor, input);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ technicalResponsibleUserId: rt }),
      actor.actorId,
    );
  });
  it('permite corrigir um plano legado pela edição', async () => {
    const { service, repository } = fixture();
    await service.update('plan', actor, { technicalResponsibleUserId: rt });
    const args = repository.update.mock.calls[0] as unknown[];
    expect(args[3]).toMatchObject({
      technicalResponsible: { connect: { id: rt } },
    });
  });
  it('recusa salvar um plano legado sem definir responsável', async () => {
    const { service, repository } = fixture();
    await expect(
      service.update('plan', actor, { name: 'Novo nome' }),
    ).rejects.toThrow(/Defina.*Responsável Técnico/);
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('mantém o responsável existente quando o PATCH altera outro campo', async () => {
    const { service, repository, professionals } = fixture(rt);
    await service.update('plan', actor, { name: 'Novo nome' });
    expect(professionals).toHaveBeenCalledWith(
      'org',
      'TECHNICAL_RESPONSIBLE',
      'unit',
    );
    expect(repository.update).toHaveBeenCalled();
  });
  it('não permite remover o responsável enviando null no PATCH', async () => {
    const { service, repository } = fixture(rt);
    await expect(
      service.update('plan', actor, {
        technicalResponsibleUserId: null,
      } as unknown as UpdatePmocPlanDto),
    ).rejects.toThrow(/Defina.*Responsável Técnico/);
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('impede ativar planos legados sem responsável', async () => {
    const { service, repository } = fixture();
    await expect(service.activate('plan', actor)).rejects.toThrow(
      /Defina.*Responsável Técnico/,
    );
    expect(repository.activate).not.toHaveBeenCalled();
  });
  it('o DTO de criação exige a escolha, enquanto o PATCH continua parcial', async () => {
    const create = plainToInstance(CreatePmocPlanDto, {
      ...input,
      technicalResponsibleUserId: undefined,
    });
    const errors = await validate(create);
    expect(
      errors.find((error) => error.property === 'technicalResponsibleUserId')
        ?.constraints?.isDefined,
    ).toBe('Selecione o Responsável Técnico do PMOC.');
    const update = plainToInstance(UpdatePmocPlanDto, { name: 'Novo nome' });
    expect(await validate(update)).toHaveLength(0);
  });
});
