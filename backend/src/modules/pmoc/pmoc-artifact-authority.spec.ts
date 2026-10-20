/**
 * A recusa de escala na **emissão** do relatório, dentro da transação.
 *
 * ## Por que aqui e não só no serviço
 *
 * O serviço tem teste de que passa a restrição adiante — e passar adiante não é
 * cumprir. Quem cumpre é esta função, e ela decide junto do lock que garante a
 * idempotência do documento: conferir a escala fora da transação deixaria a
 * janela em que a atribuição muda entre a leitura e a criação do artefato.
 *
 * ## O que o `tx` falso preserva
 *
 * A consulta é a real, o lock é pedido de verdade e a comparação é a do código.
 * O que o dublê substitui é o banco — e a decisão testada não depende dele.
 */
import { PmocRepository } from './pmoc.repository';

const ORG = '01900000-0000-7000-8000-000000000001';
const EXECUCAO = '01900000-0000-7000-8000-000000000002';
const TECNICO = '01900000-0000-7000-8000-000000000003';
const OUTRO = '01900000-0000-7000-8000-000000000004';

function bancada(responsibleFieldTechnicianId: string | null) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    pmocEquipmentExecution: {
      findFirst: jest.fn().mockResolvedValue({
        id: EXECUCAO,
        status: 'COMPLETED',
        responsibleFieldTechnicianId,
        /* Já tem documento: o caminho curto e idempotente, que é o que precisa
           ser barrado antes de devolver o artefato de outra pessoa. */
        artifactExecutionId: 'art-1',
      }),
    },
    artifactExecution: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'art-1', renderStatus: 'READY' }),
    },
  };
  const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
  const repository = new PmocRepository(
    rls as never,
    {} as never,
    { publish: jest.fn() } as never,
    /* Prisma sem inquilino: só o acesso por token o usa. */
    undefined as never,
  );
  return { repository, tx };
}

describe('emissão do relatório de uma execução de equipamento', () => {
  it('recusa quem não é o técnico escalado', async () => {
    const { repository } = bancada(OUTRO);

    const resultado = await repository.createEquipmentArtifact(
      ORG,
      EXECUCAO,
      TECNICO,
      TECNICO,
    );

    /* Recusa nomeada, e não `null`: "não encontrada" mandaria o técnico procurar
       um registro que existe e está correto. */
    expect(resultado).toEqual({ refused: 'NOT_ASSIGNED' });
  });

  it('não devolve o documento de outra pessoa nem quando ele já existe', async () => {
    const { repository, tx } = bancada(OUTRO);

    await repository.createEquipmentArtifact(ORG, EXECUCAO, TECNICO, TECNICO);

    /* A recusa vem **antes** do caminho idempotente. Depois dele, o técnico
       errado receberia de volta o artefato que outra pessoa assinou. */
    expect(tx.artifactExecution.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('o escalado emite', async () => {
    const { repository } = bancada(TECNICO);

    const resultado = await repository.createEquipmentArtifact(
      ORG,
      EXECUCAO,
      TECNICO,
      TECNICO,
    );

    expect(resultado).toEqual({
      artifactExecutionId: 'art-1',
      renderStatus: 'READY',
      created: false,
    });
  });

  it('sem restrição, qualquer escala passa — é como o dono emite', async () => {
    const { repository } = bancada(OUTRO);

    const resultado = await repository.createEquipmentArtifact(
      ORG,
      EXECUCAO,
      TECNICO,
      null,
    );

    expect(resultado).toMatchObject({ artifactExecutionId: 'art-1' });
  });

  it('execução sem técnico registrado não passa por restrição', async () => {
    /* `null` no registro não pode virar "serve para qualquer um": a comparação
       precisa ser com o ator, não com a ausência dele. */
    const { repository } = bancada(null);

    const resultado = await repository.createEquipmentArtifact(
      ORG,
      EXECUCAO,
      TECNICO,
      TECNICO,
    );

    expect(resultado).toEqual({ refused: 'NOT_ASSIGNED' });
  });
});
