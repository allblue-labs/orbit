import { OperationKind, OperationStatus } from '../../contracts';
import { ValidationException } from '../../exceptions';
import type { OperationRepository } from './operation.repository';
import { OperationService } from './operation.service';
import type { OperationStorageService } from './operation-storage.service';
import { OperationStateMachine } from './operation-state-machine';
import type { WorkforceRepository } from '../workforce/workforce.repository';
import type { EntitlementService } from '../subscription-plans/entitlements';

/** Estes testes são sobre as regras da ordem, não sobre cota. */
const semCota = {
  guardAllocation: <T>(_o: string, _r: string, work: () => Promise<T>) =>
    work(),
  guardUsage: <T>(
    _o: string,
    _r: string,
    _s: unknown,
    work: () => Promise<T>,
  ) => work(),
  countAuxiliaryAdditions: () => Promise.resolve(0),
} as unknown as EntitlementService;

describe('OperationService', () => {
  const repository = {
    find: jest.fn(),
    findBusinessUnit: jest.fn(),
    findCustomer: jest.fn(),
    findAsset: jest.fn(),
    create: jest.fn(),
    changeStatus: jest.fn(),
    replaceResponsibleFieldTechnician: jest.fn(),
    addAuxiliaryTechnician: jest.fn(),
  };
  const storage = { store: jest.fn(), remove: jest.fn(), read: jest.fn() };
  const workforce = {
    listProfessionals: jest.fn(),
    listFieldAssistantCandidates: jest.fn(),
  };
  /* Estes testes não tocam o registro de campo, e o dublê diz isso: chamar
     `sign` aqui é erro de teste, não comportamento a tolerar. */
  const files = {
    sign: jest.fn(() => {
      throw new Error('assinatura de storage não participa destes testes');
    }),
  };
  const service = new OperationService(
    repository as unknown as OperationRepository,
    storage as unknown as OperationStorageService,
    workforce as unknown as WorkforceRepository,
    semCota,
    files as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findBusinessUnit.mockResolvedValue({ id: 'unit-id' });
  });

  it('creates scheduled operations with a normalized code', async () => {
    repository.create.mockResolvedValue({ id: 'operation-id' });
    await service.create('organization-id', 'actor-id', {
      businessUnitId: 'unit-id',
      code: ' os-001 ',
      kind: OperationKind.MAINTENANCE,
      title: 'Manutenção preventiva',
      scheduledStart: new Date('2026-08-01T12:00:00Z'),
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'OS-001',
        status: OperationStatus.SCHEDULED,
      }),
      'actor-id',
      expect.any(Object),
      [],
      /** Os equipamentos, agora uma lista — vazia quando nenhum foi escolhido. */
      [],
    );
  });

  /**
   * O valor do atendimento não vaza por omissão.
   *
   * Quem cria uma ordem sem opinar sobre isso não está liberando o valor
   * combinado com o cliente para quem está em campo. O padrão da coluna já é
   * `false`; o serviço é explícito pelo mesmo motivo — a regra fica visível no
   * único lugar que a aplica.
   */
  it('não libera o valor ao campo quando ninguém pediu', async () => {
    repository.create.mockResolvedValue({ id: 'operation-id' });

    await service.create('organization-id', 'actor-id', {
      businessUnitId: 'unit-id',
      code: 'OS-003',
      kind: OperationKind.MAINTENANCE,
      title: 'Manutenção preventiva',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ amountVisibleInField: false }),
      'actor-id',
      expect.any(Object),
      [],
      [],
    );
  });

  it('libera o valor quando o dono marca', async () => {
    repository.create.mockResolvedValue({ id: 'operation-id' });

    await service.create('organization-id', 'actor-id', {
      businessUnitId: 'unit-id',
      code: 'OS-004',
      kind: OperationKind.MAINTENANCE,
      title: 'Manutenção preventiva',
      amountVisibleInField: true,
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ amountVisibleInField: true }),
      'actor-id',
      expect.any(Object),
      [],
      [],
    );
  });

  it('rejects an invalid schedule interval', async () => {
    await expect(
      service.create('organization-id', 'actor-id', {
        businessUnitId: 'unit-id',
        code: 'OS-002',
        kind: OperationKind.MAINTENANCE,
        title: 'Manutenção preventiva',
        scheduledStart: new Date('2026-08-02T12:00:00Z'),
        scheduledEnd: new Date('2026-08-01T12:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('enforces the operation status state machine', async () => {
    repository.find.mockResolvedValue({
      id: 'operation-id',
      status: OperationStatus.OPEN,
    });
    await expect(
      service.changeStatus('operation-id', 'organization-id', 'actor-id', {
        status: OperationStatus.COMPLETED,
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('keeps every published transition consistent with the status action', async () => {
    const statuses = Object.values(OperationStatus);
    for (const from of statuses) {
      for (const to of statuses) {
        repository.find.mockResolvedValue({
          id: 'operation-id',
          status: from,
          startedAt: null,
        });
        repository.changeStatus.mockResolvedValue({
          id: 'operation-id',
          status: to,
        });
        const action = service.changeStatus(
          'operation-id',
          'organization-id',
          'actor-id',
          { status: to },
        );
        if (OperationStateMachine.allowedTransitions(from).includes(to)) {
          await expect(action).resolves.toMatchObject({ status: to });
        } else {
          await expect(action).rejects.toBeInstanceOf(ValidationException);
        }
      }
    }
  });

  /* ---------------------------------------------------------------- */
  /* Responsável e auxiliar não passam pelo mesmo portão                */
  /* ---------------------------------------------------------------- */

  describe('atribuição na criação', () => {
    const criar = (patch: Record<string, unknown>) =>
      service.create('organization-id', 'actor-id', {
        businessUnitId: 'unit-id',
        code: 'OS-900',
        title: 'Atendimento',
        kind: 'CORRECTIVE',
        ...patch,
      });

    beforeEach(() => {
      repository.create.mockResolvedValue({ id: 'operation-id' });
    });

    it('exige perfil de técnico de campo do responsável', async () => {
      workforce.listProfessionals.mockResolvedValue([]);
      await expect(
        criar({ responsibleFieldTechnicianId: 'tecnico' }),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('aceita o responsável que tem o perfil', async () => {
      workforce.listProfessionals.mockResolvedValue([{ userId: 'tecnico' }]);
      await expect(
        criar({ responsibleFieldTechnicianId: 'tecnico' }),
      ).resolves.toBeDefined();
    });

    /**
     * O caso que estava quebrado.
     *
     * O auxiliar passava pelo filtro de `FIELD_TECHNICIAN`, então o papel
     * "Auxiliar técnico" — que existe para acompanhar, e não tem perfil
     * profissional porque não assina nada — nunca podia ser auxiliar de nada.
     * A designação de executante era exigida de quem o produto define como
     * observador.
     */
    it('aceita auxiliar sem perfil de técnico de campo', async () => {
      workforce.listProfessionals.mockResolvedValue([{ userId: 'tecnico' }]);
      workforce.listFieldAssistantCandidates.mockResolvedValue([
        { userId: 'auxiliar' },
      ]);
      await expect(
        criar({
          responsibleFieldTechnicianId: 'tecnico',
          auxiliaryTechnicianIds: ['auxiliar'],
        }),
      ).resolves.toBeDefined();
      expect(workforce.listFieldAssistantCandidates).toHaveBeenCalledWith(
        'organization-id',
        'unit-id',
      );
    });

    /** Aceitar o papel auxiliar não é aceitar qualquer um. */
    it('recusa auxiliar que não pode acompanhar nesta unidade', async () => {
      workforce.listProfessionals.mockResolvedValue([{ userId: 'tecnico' }]);
      workforce.listFieldAssistantCandidates.mockResolvedValue([]);
      await expect(
        criar({
          responsibleFieldTechnicianId: 'tecnico',
          auxiliaryTechnicianIds: ['estranho'],
        }),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    /**
     * Um auxiliar não substitui o responsável.
     *
     * Sem responsável ninguém executa, e o atendimento ficaria com
     * acompanhantes de um trabalho que não começa.
     */
    it('recusa auxiliar sem responsável', async () => {
      workforce.listFieldAssistantCandidates.mockResolvedValue([
        { userId: 'auxiliar' },
      ]);
      await expect(
        criar({ auxiliaryTechnicianIds: ['auxiliar'] }),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('recusa a mesma pessoa nos dois papéis', async () => {
      workforce.listProfessionals.mockResolvedValue([{ userId: 'tecnico' }]);
      workforce.listFieldAssistantCandidates.mockResolvedValue([
        { userId: 'tecnico' },
      ]);
      await expect(
        criar({
          responsibleFieldTechnicianId: 'tecnico',
          auxiliaryTechnicianIds: ['tecnico'],
        }),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    /** Sem ninguém atribuído, nenhuma das duas listas é consultada. */
    it('não consulta elegibilidade quando não há atribuição', async () => {
      await expect(criar({})).resolves.toBeDefined();
      expect(workforce.listProfessionals).not.toHaveBeenCalled();
      expect(workforce.listFieldAssistantCandidates).not.toHaveBeenCalled();
    });
  });

  it('only assigns active members of the operation unit', async () => {
    repository.find.mockResolvedValue({
      id: 'operation-id',
      businessUnitId: 'unit-id',
      status: OperationStatus.OPEN,
    });
    workforce.listProfessionals.mockResolvedValue([]);
    await expect(
      service.assign('operation-id', 'organization-id', 'actor-id', {
        userId: 'user-id',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });
});
