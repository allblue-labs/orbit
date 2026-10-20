/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { OperationRepository } from './operation.repository';

/**
 * Atribuir um técnico grava as **duas** representações.
 *
 * ## O defeito que isto tranca
 *
 * `operation_users` é a tabela genérica de "quem está neste atendimento", e é dela
 * que saem o relatório de equipe e os KPIs de produtividade. O modelo de campo —
 * `responsible_field_technician_id` e `operation_auxiliary_technicians` — diz em
 * qual papel.
 *
 * A criação direta gravava só o segundo. O atendimento ia para o celular do técnico,
 * e a listagem dizia "Sem técnico" enquanto o relatório contava zero atribuições —
 * de onde se concluía, com razão, que atribuir não tinha funcionado. O PMOC já
 * gravava as duas; faltava nesta porta.
 *
 * O teste é do repositório porque é a transação que importa: um teste de serviço com
 * repositório dublado provaria que o serviço passou o id adiante, que é justamente a
 * parte que nunca esteve quebrada.
 */
describe('participação de quem é atribuído', () => {
  const montar = () => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      operation: {
        create: jest.fn().mockResolvedValue({
          id: 'operation-nova',
          organizationId: 'org',
          businessUnitId: 'unit',
          status: 'OPEN',
          kind: 'MAINTENANCE',
          priority: 'NORMAL',
          customerId: null,
          createdById: 'owner',
        }),
      },
      operationUser: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      operationHistory: { create: jest.fn().mockResolvedValue({}) },
      /* O alocador do número da OS devolve `last_value`; sem isso ele recusa, e com
         razão — seguir sem número gravaria uma ordem sem identidade. */
      $queryRaw: jest.fn().mockResolvedValue([{ last_value: 7 }]),
    };
    const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
    const events = { emit: jest.fn().mockResolvedValue(undefined) };
    const repository = new OperationRepository(rls as never, events as never);
    return { tx, repository };
  };

  const criar = (
    repository: OperationRepository,
    tx: ReturnType<typeof montar>['tx'],
    data: Record<string, unknown>,
    auxiliares: string[] = [],
  ) =>
    repository.createWithin(
      tx as never,
      {
        organizationId: 'org',
        businessUnitId: 'unit',
        code: 'OS-1',
        kind: 'MAINTENANCE',
        title: 'Atendimento',
        status: 'OPEN',
        createdById: 'owner',
        ...data,
      },
      'owner',
      {},
      auxiliares,
    );

  /** O caso relatado: um responsável escolhido no formulário de criação. */
  it('o responsável entra na participação', async () => {
    const { tx, repository } = montar();
    await criar(repository, tx, { responsibleFieldTechnicianId: 'tecnico' });

    expect(tx.operationUser.createMany).toHaveBeenCalledTimes(1);
    const [[chamada]] = tx.operationUser.createMany.mock.calls;
    expect(chamada.data).toEqual([
      {
        operationId: 'operation-nova',
        userId: 'tecnico',
        assignedById: 'owner',
      },
    ]);
  });

  /** O relatório pergunta "quantos atendimentos esta pessoa tem", e o auxiliar tem. */
  it('os auxiliares entram na participação', async () => {
    const { tx, repository } = montar();
    await criar(repository, tx, { responsibleFieldTechnicianId: 'tecnico' }, [
      'auxiliar-um',
      'auxiliar-dois',
    ]);

    const [[chamada]] = tx.operationUser.createMany.mock.calls as [
      [{ data: { userId: string }[] }],
    ];
    expect(chamada.data.map((linha) => linha.userId)).toEqual([
      'tecnico',
      'auxiliar-um',
      'auxiliar-dois',
    ]);
  });

  /**
   * A mesma pessoa nos dois papéis não viola a única `(operationId, userId)`.
   *
   * O serviço recusa esse caso, e a escrita não depende de ele ter recusado.
   */
  it('a mesma pessoa nos dois papéis vira uma linha', async () => {
    const { tx, repository } = montar();
    await criar(repository, tx, { responsibleFieldTechnicianId: 'tecnico' }, [
      'tecnico',
    ]);

    const [[chamada]] = tx.operationUser.createMany.mock.calls;
    expect(chamada.data).toHaveLength(1);
    expect(chamada.skipDuplicates).toBe(true);
  });

  /** Sem ninguém atribuído, nenhuma linha de participação é escrita. */
  it('operação sem atribuição não escreve participação', async () => {
    const { tx, repository } = montar();
    await criar(repository, tx, {});
    expect(tx.operationUser.createMany).not.toHaveBeenCalled();
  });

  /** A operação é criada de todo jeito: a participação é consequência, não requisito. */
  it('a operação nasce mesmo sem atribuição', async () => {
    const { tx, repository } = montar();
    const operation = await criar(repository, tx, {});
    expect(operation).toMatchObject({ id: 'operation-nova' });
    expect(tx.operation.create).toHaveBeenCalledTimes(1);
  });
});
