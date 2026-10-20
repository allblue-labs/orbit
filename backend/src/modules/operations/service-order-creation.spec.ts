/**
 * Toda ordem de serviço nasce numerada — e só ela.
 *
 * ## Por que o teste é da fronteira, e não do serviço
 *
 * `createWithin` é por onde passam os dois caminhos que criam ordem de serviço: a
 * criação direta pelo dono e a conversão de uma solicitação do cliente. O PMOC e a
 * RVT criam operação com `tx.operation.create` próprio, sem passar por aqui — e é
 * assim que ficam fora da contagem sem depender de uma condição que alguém possa
 * esquecer de repetir quando aparecer o terceiro caso.
 *
 * Se a reserva subir para o serviço, este teste falha. É o ponto: lá em cima ela
 * cobriria um caminho e deixaria o outro sem número, o que só apareceria no dia em
 * que um cliente do portal pedisse o PDF da ordem dele.
 */
import { OperationRepository } from './operation.repository';

const ORG = '01900000-0000-7000-8000-000000000001';

function bancada() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ last_value: 87 }]),
    operation: {
      create: jest
        .fn()
        .mockImplementation((args: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'op-1',
            organizationId: ORG,
            businessUnitId: 'unit-1',
            kind: 'MAINTENANCE',
            status: 'OPEN',
            priority: 'NORMAL',
            customerId: null,
            createdById: 'user-1',
            ...args.data,
          }),
        ),
    },
    operationHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  const repository = new OperationRepository(
    { run: (work: (client: typeof tx) => unknown) => work(tx) } as never,
    { emit: jest.fn() } as never,
  );
  return { repository, tx };
}

/** O número que o insert recebeu — lido da chamada, sem matcher aninhado. */
function numeroGravado(create: jest.Mock): number | undefined {
  const calls = create.mock.calls as [
    { data: { serviceOrderNumber?: number } },
  ][];
  return calls[0]?.[0]?.data?.serviceOrderNumber;
}

const criar = (repository: OperationRepository, tx: unknown) =>
  repository.createWithin(
    tx as never,
    {
      organizationId: ORG,
      businessUnitId: 'unit-1',
      code: 'ORB-1',
      kind: 'MAINTENANCE',
      title: 'Preventiva',
    },
    'user-1',
    {},
  );

describe('criação de ordem de serviço', () => {
  it('reserva o número na mesma transação da criação', async () => {
    const { repository, tx } = bancada();

    await criar(repository, tx);

    /* A reserva vai para o banco antes do insert, e no mesmo `tx`: uma transação
       que falhe depois não deixa ordem sem número nem número sem ordem. */
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(numeroGravado(tx.operation.create)).toBe(87);
  });

  it('grava o número que o contador devolveu, não um derivado do código', async () => {
    const { repository, tx } = bancada();
    tx.$queryRaw.mockResolvedValue([{ last_value: 1042 }]);

    await criar(repository, tx);

    expect(numeroGravado(tx.operation.create)).toBe(1042);
  });

  it('a falha na reserva impede a criação', async () => {
    /* Sem isto, uma ordem nasceria sem número e o documento dela sairia sem a
       identidade que o cliente cita. */
    const { repository, tx } = bancada();
    tx.$queryRaw.mockRejectedValue(new Error('sem contador'));

    await expect(criar(repository, tx)).rejects.toThrow(/sem contador/);
    expect(tx.operation.create).not.toHaveBeenCalled();
  });
});
