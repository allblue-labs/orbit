/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Prisma } from '@prisma/client';
import { ConflictException, EntityNotFoundException } from '../../exceptions';
import { QuoteEmissionService } from './quote-emission.service';

/**
 * A porta de emissão do documento da proposta.
 *
 * O que se prova aqui é o que o mapa de campos não alcança: quem pode emitir, de
 * qual modelo, com que código, e que o que o modelo não declara não derruba a
 * emissão.
 */
describe('QuoteEmissionService', () => {
  const secoesOficiais = [
    { id: 'identificacao', fields: [{ id: 'cliente' }, { id: 'data' }] },
    { id: 'escopo', fields: [{ id: 'objeto' }, { id: 'itens' }] },
    { id: 'condicoes', fields: [{ id: 'valor_total' }, { id: 'validade' }] },
  ];

  const proposta = (patch: Record<string, unknown> = {}) => ({
    id: 'quote-id',
    businessUnitId: 'unit',
    customerId: 'cliente',
    operationId: null,
    responsibleUserId: null,
    code: 'ORC-0042',
    status: 'SENT',
    title: 'Manutenção preventiva',
    notes: null,
    introText: null,
    discountReason: null,
    validUntil: null,
    total: new Prisma.Decimal('100.00'),
    sentAt: new Date('2026-03-15T12:00:00.000Z'),
    createdAt: new Date('2026-03-10T12:00:00.000Z'),
    responsible: null,
    serviceAddress: null,
    items: [],
    customer: {
      legalName: 'Padaria Aurora LTDA',
      tradeName: null,
      documentType: null,
      documentNumber: null,
      addresses: [],
    },
    ...patch,
  });

  const montar = (options: {
    quote?: Record<string, unknown> | null;
    template?: unknown;
  }) => {
    const execution = { id: 'execution-id' };
    const executions = {
      create: jest.fn().mockResolvedValue(execution),
      saveResponse: jest.fn().mockResolvedValue(execution),
    };
    const repository = {
      emissionSource: jest
        .fn()
        .mockResolvedValue(
          options.quote === undefined ? proposta() : options.quote,
        ),
    };
    const tx = {
      artifactTemplate: {
        findFirst: jest.fn().mockResolvedValue(
          options.template === undefined
            ? {
                id: 'template-id',
                versions: [{ sections: secoesOficiais }],
              }
            : options.template,
        ),
      },
    };
    const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
    const service = new QuoteEmissionService(
      rls as never,
      repository as never,
      executions as never,
    );
    return { service, executions, repository, tx };
  };

  it('a proposta inexistente não emite', async () => {
    const { service } = montar({ quote: null });
    await expect(
      service.issue('quote-id', 'org', 'actor'),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
  });

  /**
   * Rascunho não emite.
   *
   * Um orçamento em elaboração ainda aceita itens e preço; emitir ali produziria
   * um documento oficial de um número que vai mudar.
   */
  it('o rascunho não emite documento', async () => {
    const { service, executions } = montar({
      quote: proposta({ status: 'DRAFT' }),
    });
    await expect(
      service.issue('quote-id', 'org', 'actor'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(executions.create).not.toHaveBeenCalled();
  });

  /** Recusado e expirado são exatamente os que alguém precisa arquivar. */
  it.each(['SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'])(
    'emite a partir de %s',
    async (status) => {
      const { service, executions } = montar({ quote: proposta({ status }) });
      await expect(service.issue('quote-id', 'org', 'actor')).resolves.toEqual({
        id: 'execution-id',
      });
      expect(executions.create).toHaveBeenCalledTimes(1);
    },
  );

  it('sem modelo de orçamento, recusa em vez de emitir vazio', async () => {
    const { service } = montar({ template: null });
    await expect(
      service.issue('quote-id', 'org', 'actor'),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
  });

  /** Modelo sem versão publicada é modelo que não imprime nada. */
  it('modelo sem versão recusa', async () => {
    const { service } = montar({ template: { id: 't', versions: [] } });
    await expect(
      service.issue('quote-id', 'org', 'actor'),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
  });

  /**
   * O da organização vence o global.
   *
   * Quem publicou o próprio modelo de proposta quer emitir no dele. `desc` em
   * `organizationId` põe o nulo por último, que é o padrão do PostgreSQL nessa
   * direção.
   */
  it('prefere o modelo da organização ao oficial', async () => {
    const { service, tx } = montar({});
    await service.issue('quote-id', 'org', 'actor');
    const [[consulta]] = tx.artifactTemplate.findFirst.mock.calls;
    expect(consulta.where).toMatchObject({
      artifactType: 'ORCAMENTO',
      status: 'ACTIVE',
      deletedAt: null,
    });
    expect(consulta.where.OR).toEqual([
      { organizationId: 'org' },
      { organizationId: null, visibility: 'GLOBAL' },
    ]);
    expect(consulta.orderBy).toEqual([
      { organizationId: 'desc' },
      { createdAt: 'asc' },
    ]);
  });

  /**
   * O código do documento é o da proposta.
   *
   * É o que faz quem recebeu `ORC-0042` achar o documento por esse número na
   * central — a execução já tem id próprio; o código é o que a pessoa digita.
   */
  it('o documento herda o código da proposta', async () => {
    const { service, executions } = montar({});
    await service.issue('quote-id', 'org', 'actor');
    const [[, , input]] = executions.create.mock.calls;
    expect(input.code).toBe('ORC-0042');
    expect(input.title).toBe('Orçamento ORC-0042 — Manutenção preventiva');
    expect(input.businessUnitId).toBe('unit');
    expect(input.customerId).toBe('cliente');
  });

  /** O atendimento convertido, quando houver: o documento cita o serviço. */
  it('amarra ao atendimento quando a proposta virou um', async () => {
    const { service, executions } = montar({
      quote: proposta({ operationId: 'operacao' }),
    });
    await service.issue('quote-id', 'org', 'actor');
    const [[, , input]] = executions.create.mock.calls;
    expect(input.operationId).toBe('operacao');
  });

  it('as respostas são gravadas como SYSTEM, não como se alguém digitasse', async () => {
    const { service, executions } = montar({});
    await service.issue('quote-id', 'org', 'actor');
    expect(executions.saveResponse).toHaveBeenCalled();
    for (const [, , , resposta] of executions.saveResponse.mock.calls) {
      expect(resposta.provenance).toBe('SYSTEM');
    }
  });

  /**
   * O modelo é publicável, e a emissão não pode depender de ele ser o oficial.
   *
   * Uma organização que tirou "Validade" do modelo dela continua emitindo
   * proposta — recusar a emissão inteira por um campo que a casa não quis seria
   * pior que emitir sem ele.
   */
  it('o campo que o modelo não declara é ignorado, não derruba a emissão', async () => {
    const { service, executions } = montar({
      quote: proposta({ validUntil: new Date('2026-04-30T00:00:00.000Z') }),
      template: {
        id: 'template-id',
        versions: [
          { sections: [{ id: 'escopo', fields: [{ id: 'objeto' }] }] },
        ],
      },
    });

    await expect(service.issue('quote-id', 'org', 'actor')).resolves.toEqual({
      id: 'execution-id',
    });
    const gravados = executions.saveResponse.mock.calls.map(
      ([, , , resposta]) => `${resposta.sectionId}.${resposta.fieldId}`,
    );
    expect(gravados).toEqual(['escopo.objeto']);
  });

  /** Modelo sem nenhum campo conhecido: a execução nasce, vazia e editável. */
  it('modelo sem campos conhecidos ainda cria a execução', async () => {
    const { service, executions } = montar({
      template: { id: 'template-id', versions: [{ sections: [] }] },
    });
    await expect(service.issue('quote-id', 'org', 'actor')).resolves.toEqual({
      id: 'execution-id',
    });
    expect(executions.saveResponse).not.toHaveBeenCalled();
  });
});
