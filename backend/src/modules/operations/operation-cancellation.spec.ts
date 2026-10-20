/**
 * O pedido de cancelamento feito em campo.
 *
 * ## O que está sendo protegido
 *
 * A separação entre relatar e decidir. Quem está na porta precisa conseguir
 * registrar que não deu para atender; o que não pode é esse registro encerrar o
 * compromisso sozinho. As duas pontas desse contrato estão aqui: quem pode pedir, e
 * o que o pedido faz com o atendimento — nada.
 */
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
} from '../../exceptions';
import { OperationCancellationService } from './operation-cancellation.service';

const ORG = '01900000-0000-7000-8000-000000000001';
const OPERACAO = '01900000-0000-7000-8000-000000000002';
const ESCALADO = '01900000-0000-7000-8000-000000000003';
const AUXILIAR = '01900000-0000-7000-8000-000000000004';
const ESTRANHO = '01900000-0000-7000-8000-000000000005';

function bancada(
  operacao: Record<string, unknown> | null,
  extra: Record<string, unknown> = {},
) {
  const repository = {
    operationForRequest: jest.fn().mockResolvedValue(
      operacao && {
        id: OPERACAO,
        businessUnitId: '01900000-0000-7000-8000-0000000000bb',
        status: 'OPEN',
        responsibleFieldTechnicianId: ESCALADO,
        auxiliaryTechnicians: [{ userId: AUXILIAR }],
        cancellationRequests: [],
        ...operacao,
      },
    ),
    create: jest.fn().mockResolvedValue({
      id: '01900000-0000-7000-8000-0000000000rr'.replace('r', 'a'),
      reason: 'Ninguém no local às 09h.',
      requestedAt: new Date('2026-10-04T12:00:00Z'),
    }),
    inbox: jest.fn().mockResolvedValue([]),
    byId: jest.fn(),
    resolve: jest.fn().mockResolvedValue({ count: 1 }),
    ...extra,
  };
  return {
    repository,
    service: new OperationCancellationService(repository as never),
  };
}

const ator = { id: ESCALADO, organizationId: ORG };

describe('pedir o cancelamento em campo', () => {
  it('o técnico escalado pede', async () => {
    const { service } = bancada({});

    const pedido = await service.request(ator, OPERACAO, {
      reason: 'Ninguém no local às 09h.',
    });

    expect(pedido.status).toBe('PENDING');
    expect(pedido.resolution).toBeNull();
  });

  it('o auxiliar também pede', async () => {
    /* Quem está na porta pode ser o auxiliar — e é ele quem viu o portão fechado. */
    const { service } = bancada({});

    await expect(
      service.request({ id: AUXILIAR, organizationId: ORG }, OPERACAO, {
        reason: 'Portaria sem autorização.',
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('quem não está escalado não pede', async () => {
    const { service, repository } = bancada({});

    await expect(
      service.request({ id: ESTRANHO, organizationId: ORG }, OPERACAO, {
        reason: 'Não consigo entrar.',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    /* E nada foi gravado: a recusa vem antes do registro. */
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('atendimento já concluído não aceita pedido', async () => {
    /* O serviço foi feito; um pedido aqui não descreve nada que ainda possa ser
       decidido. */
    const { service } = bancada({ status: 'COMPLETED' });

    await expect(
      service.request(ator, OPERACAO, { reason: 'Mudei de ideia.' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('atendimento já cancelado não aceita pedido', async () => {
    const { service } = bancada({ status: 'CANCELLED' });

    await expect(
      service.request(ator, OPERACAO, { reason: 'Não deu.' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('atendimento inexistente é inexistente', async () => {
    const { service } = bancada(null);

    await expect(
      service.request(ator, OPERACAO, { reason: 'Não deu.' }),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
  });

  it('reenvio devolve o pedido que já existe, em vez de erro', async () => {
    /*
     * O caminho real é um aplicativo offline reenviando: a rede caiu depois de
     * gravar, e a segunda tentativa não pode virar erro na cara de quem já
     * justificou. Devolver o pedido existente é o que torna o reenvio inofensivo.
     */
    const existente = {
      id: '01900000-0000-7000-8000-0000000000ff',
      status: 'PENDING',
      reason: 'Ninguém no local às 09h.',
      requestedAt: new Date('2026-10-04T12:00:00Z'),
      resolution: null,
      resolutionNotes: null,
      resolvedAt: null,
    };
    const { service, repository } = bancada(
      { cancellationRequests: [{ id: existente.id }] },
      { inbox: jest.fn().mockResolvedValue([existente]) },
    );

    const pedido = await service.request(ator, OPERACAO, {
      reason: 'Ninguém no local às 09h.',
    });

    expect(pedido.id).toBe(existente.id);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('a citação é por id local, porque a foto ainda não subiu', async () => {
    /*
     * No instante do pedido a foto quase nunca existe no servidor: a captura é
     * offline-first e o upload acontece depois. Citar pelo id do servidor faria a
     * prova funcionar só com rede boa — que é quando ela menos importa.
     *
     * Quem fecha a lacuna é a finalização do upload, que pergunta se aquele
     * `localMediaId` foi citado por um pedido em aberto daquele atendimento.
     */
    const { service, repository } = bancada({});

    await service.request(ator, OPERACAO, {
      reason: 'Equipamento inacessível; portão trancado.',
      evidenceLocalIds: ['local-media-7f3a'],
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceLocalIds: ['local-media-7f3a'] }),
    );
  });

  it('as fotos citadas viajam para o registro', async () => {
    const { service, repository } = bancada({});
    /* Id local da captura, como o aparelho o nomeia — não um UUID do servidor. */
    const foto = 'local-media-7f3a';

    await service.request(ator, OPERACAO, {
      reason: 'Equipamento inacessível.',
      evidenceLocalIds: [foto],
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceLocalIds: [foto] }),
    );
  });
});

describe('resolver o pedido', () => {
  const pendente = {
    id: '01900000-0000-7000-8000-0000000000ff',
    status: 'PENDING',
    operationId: OPERACAO,
    operation: { id: OPERACAO, businessUnitId: 'bu' },
  };

  it('devolve o atendimento para quem vai agir sobre ele', async () => {
    /* Resolver registra a decisão; reagendar e reatribuir acontecem pelas rotas de
       operação que já existem. O id é o que amarra as duas chamadas. */
    const { service } = bancada(
      {},
      { byId: jest.fn().mockResolvedValue(pendente) },
    );

    await expect(
      service.resolve(ORG, ESCALADO, pendente.id, {
        resolution: 'RESCHEDULED',
      }),
    ).resolves.toEqual({ operationId: OPERACAO });
  });

  it('pedido já resolvido não é resolvido de novo', async () => {
    const { service } = bancada(
      {},
      {
        byId: jest.fn().mockResolvedValue({ ...pendente, status: 'RESOLVED' }),
      },
    );

    await expect(
      service.resolve(ORG, ESCALADO, pendente.id, { resolution: 'CANCELLED' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('dois donos decidindo ao mesmo tempo: o segundo não sobrescreve', async () => {
    /*
     * A leitura disse PENDING, a escrita não encontrou linha — alguém resolveu no
     * intervalo. Sem esta checagem o segundo desfecho sobrescreveria o primeiro, e o
     * técnico receberia a resposta de quem chegou depois.
     */
    const { service } = bancada(
      {},
      {
        byId: jest.fn().mockResolvedValue(pendente),
        resolve: jest.fn().mockResolvedValue({ count: 0 }),
      },
    );

    await expect(
      service.resolve(ORG, ESCALADO, pendente.id, { resolution: 'CANCELLED' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('pedido inexistente é inexistente', async () => {
    const { service } = bancada(
      {},
      { byId: jest.fn().mockResolvedValue(null) },
    );

    await expect(
      service.resolve(ORG, ESCALADO, pendente.id, { resolution: 'CANCELLED' }),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
  });
});
