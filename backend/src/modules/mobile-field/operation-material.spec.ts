/**
 * Registrar material em campo: de catálogo ou avulso.
 *
 * ## O defeito
 *
 * `catalogItemId` era obrigatório e a permissão exigida era `inventory.manage`.
 * Isso cobria um caso só — o item de almoxarifado — e deixava de fora o que mais
 * sai em campo: a abraçadeira, o metro de fita, o parafuso comprado na esquina.
 * O técnico com permissão de executar e sem permissão de estoque não registrava
 * material nenhum, e a etapa do roteiro dizia que "este atendimento não prevê
 * registro de materiais" — verdade sobre a permissão, mentira sobre o
 * atendimento.
 */
import { MobileFieldOperationService } from './mobile-field-operation.service';
import type { MobileFieldActor } from './mobile-field.service';
import { ForbiddenException, ValidationException } from '../../exceptions';

const ORG = '01900000-0000-7000-8000-000000000001';
const UNIDADE = '01900000-0000-7000-8000-000000000002';
const TECNICO = '01900000-0000-7000-8000-000000000003';
const ATENDIMENTO = '01900000-0000-7000-8000-000000000004';
const PRODUTO = '01900000-0000-7000-8000-000000000005';
const VERSAO = '2026-09-29T12:00:00.000Z';

function bancada(permissions: readonly string[]) {
  const repository = {
    preparation: jest.fn().mockResolvedValue({
      id: ATENDIMENTO,
      businessUnitId: UNIDADE,
      status: 'IN_PROGRESS',
      updatedAt: new Date(VERSAO),
      responsibleFieldTechnicianId: TECNICO,
      auxiliaryTechnicians: [],
      assets: [],
      checklistExecutions: [],
      artifactExecutions: [],
      history: [],
    }),
    isFieldActor: jest.fn().mockResolvedValue(true),
    operationMaterialByCommand: jest.fn().mockResolvedValue(null),
    materialByCommand: jest.fn().mockResolvedValue(null),
    createOperationMaterial: jest.fn((input: Record<string, unknown>) =>
      Promise.resolve({
        id: 'linha-1',
        origin: 'APPLIED',
        catalogItemId: input.catalogItemId,
        inventoryMovementId: input.inventoryMovementId,
        description: input.description,
        unit: input.unit,
        quantity: { toString: () => String(input.quantity) },
        notes: input.notes,
      }),
    ),
  };
  const inventory = {
    consumption: jest.fn().mockResolvedValue({
      id: 'movimento-1',
      operationId: ATENDIMENTO,
      catalogItemId: PRODUTO,
      quantity: { toString: () => '2' },
      balanceAfter: { toString: () => '8' },
      reason: null,
      notes: null,
      createdById: TECNICO,
    }),
  };
  const service = new MobileFieldOperationService(
    repository as never,
    inventory as never,
    { context: jest.fn().mockResolvedValue({ signature: null }) } as never,
    {
      authorizeTarget: jest
        .fn()
        .mockResolvedValue({ context: {}, denied: false, readable: true }),
    } as never,
  );
  const actor: MobileFieldActor = {
    id: TECNICO,
    organizationId: ORG,
    businessUnitIds: [UNIDADE],
    /* `requireVisible` exige `operations.read` para qualquer coisa: é a leitura
       do atendimento, antes de qualquer autoridade específica. */
    permissions: ['operations.read', ...permissions],
  };
  return { service, repository, inventory, actor };
}

const comando = (extra: Record<string, unknown>) =>
  ({
    expectedVersion: VERSAO,
    commandId: 'cmd-material-1',
    quantity: 2,
    ...extra,
  }) as never;

describe('material aplicado no atendimento', () => {
  /**
   * O caso que não existia.
   *
   * Material avulso não tem produto cadastrado e não move saldo; a autoridade
   * sobre ele é a de registrar o que aconteceu no atendimento.
   */
  it('o técnico que executa registra material avulso', async () => {
    const { service, repository, inventory, actor } = bancada([
      'operations.update',
    ]);

    const resultado = await service.registerMaterial(
      actor,
      ATENDIMENTO,
      comando({ description: 'Abraçadeira 3/8', unit: 'UN' }),
    );

    expect(resultado).toMatchObject({
      description: 'Abraçadeira 3/8',
      unit: 'UN',
      catalogItemId: null,
      movementId: null,
    });
    /* Nenhum saldo foi tocado: não há o que mover. */
    expect(inventory.consumption).not.toHaveBeenCalled();
    expect(repository.createOperationMaterial).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogItemId: null,
        description: 'Abraçadeira 3/8',
      }),
    );
  });

  /** Sem produto e sem descrição, não há material a registrar. */
  it('recusa comando sem produto e sem descrição', async () => {
    const { service, actor } = bancada(['operations.update']);

    await expect(
      service.registerMaterial(actor, ATENDIMENTO, comando({})),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  /** Unidade omitida é `UN` — e não vazio, que não diria nada no relatório. */
  it('sem unidade informada, usa UN', async () => {
    const { service, repository, actor } = bancada(['operations.update']);

    await service.registerMaterial(
      actor,
      ATENDIMENTO,
      comando({ description: 'Fita isolante' }),
    );

    expect(repository.createOperationMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ unit: 'UN' }),
    );
  });

  /**
   * Consumir do catálogo continua exigindo a permissão de estoque.
   *
   * É a metade que importa: abrir o caminho avulso não pode ter aberto o de
   * mover saldo para quem não administra almoxarifado.
   */
  it('produto do catálogo exige permissão de estoque', async () => {
    const { service, actor } = bancada(['operations.update']);

    await expect(
      service.registerMaterial(
        actor,
        ATENDIMENTO,
        comando({ catalogItemId: PRODUTO }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('com permissão de estoque, move saldo e registra a linha', async () => {
    const { service, repository, inventory, actor } = bancada([
      'inventory.manage',
    ]);

    const resultado = await service.registerMaterial(
      actor,
      ATENDIMENTO,
      comando({ catalogItemId: PRODUTO, description: 'Filtro G4' }),
    );

    expect(inventory.consumption).toHaveBeenCalled();
    expect(resultado).toMatchObject({
      movementId: 'movimento-1',
      balanceAfter: '8',
    });
    /* A linha guarda o movimento: o relatório imprime a linha, o saldo sofre o
       movimento, e um estorno não apaga do papel o que foi aplicado. */
    expect(repository.createOperationMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ inventoryMovementId: 'movimento-1' }),
    );
  });

  /**
   * O reenvio do mesmo comando não soma o material duas vezes.
   *
   * A captura em campo é offline-first: o comando volta quando a rede volta.
   */
  it('reenviar o mesmo comando devolve a linha que existe', async () => {
    const { service, repository, actor } = bancada(['operations.update']);
    repository.operationMaterialByCommand.mockResolvedValue({
      id: 'linha-1',
      operationId: ATENDIMENTO,
      origin: 'APPLIED',
      catalogItemId: null,
      inventoryMovementId: null,
      description: 'Abraçadeira 3/8',
      unit: 'UN',
      quantity: { toString: () => '2' },
      notes: null,
    });

    const resultado = await service.registerMaterial(
      actor,
      ATENDIMENTO,
      comando({ description: 'Abraçadeira 3/8' }),
    );

    expect(resultado.idempotentReplay).toBe(true);
    expect(repository.createOperationMaterial).not.toHaveBeenCalled();
  });
});
