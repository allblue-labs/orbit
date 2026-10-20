/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  MobileFieldService,
  type MobileFieldActor,
} from './mobile-field.service';

const actor: MobileFieldActor = {
  id: '01900000-0000-7000-8000-000000000001',
  organizationId: '01900000-0000-7000-8000-000000000002',
  businessUnitIds: ['01900000-0000-7000-8000-000000000003'],
  permissions: ['operations.read'],
};

describe('MobileFieldService', () => {
  it('returns a valid empty dashboard', async () => {
    const repository = { project: jest.fn().mockResolvedValue(emptySource()) };
    const service = new MobileFieldService(repository as never);
    await expect(service.dashboard(actor)).resolves.toMatchObject({
      next: null,
      counters: { today: 0, overdue: 0, inProgress: 0, upcoming: 0 },
      today: [],
      overdue: [],
      inProgress: [],
    });
  });

  it('does not turn assignment into execution authorization', async () => {
    const source = emptySource();
    source.businessUnits.push({
      id: actor.businessUnitIds[0],
      legalName: 'Recife',
      tradeName: null,
      timezone: 'America/Recife',
    });
    source.operations.push({
      id: '01900000-0000-7000-8000-000000000004',
      businessUnitId: actor.businessUnitIds[0],
      customerId: null,
      assetId: null,
      code: 'OS-1',
      title: 'Atendimento',
      description: null,
      status: 'OPEN',
      priority: 'NORMAL',
      scheduledStart: new Date('2099-01-01T12:00:00Z'),
      scheduledEnd: null,
      startedAt: null,
      completedAt: null,
      location: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      responsibleFieldTechnician: { id: actor.id, displayName: 'João' },
      auxiliaryTechnicians: [],
      asset: null,
      artifactExecutions: [],
      checklistExecutions: [],
    });
    const service = new MobileFieldService({
      project: jest.fn().mockResolvedValue(source),
    } as never);
    const queue = await service.workQueue(actor, {});
    expect(queue.data).toHaveLength(1);

    /*
     * `REQUEST_CANCELLATION` acompanha `VIEW`, e não contradiz o que este teste
     * protege: pedir o cancelamento é relatar, não executar. Quem está na porta
     * precisa poder dizer que não deu para atender mesmo sem
     * `operations.status.update` — exigir a permissão de mudar estado para enviar um
     * relato tornaria o relato impossível justamente para quem só tem o aplicativo.
     */
    expect(queue.data[0]?.allowedActions).toEqual([
      'VIEW',
      'REQUEST_CANCELLATION',
    ]);

    /* A asserção que dá nome ao teste: estar escalado não autoriza iniciar. */
    expect(queue.data[0]?.allowedActions).not.toContain('START');
    expect(queue.data[0]?.allowedActions).not.toContain('COMPLETE');
  });

  it('reports a rendered document as available, and a failed one as failed', async () => {
    /**
     * A regressão que este teste existe para impedir foi silenciosa: a
     * comparação era com `'RENDERED'`, estado que o domínio não tem — o pronto
     * se chama `READY`. Nada quebrou, e todo documento emitido aparecia como
     * "Preparando" para sempre.
     */
    const documentos = [
      documentRow('READY'),
      documentRow('NOT_RENDERED'),
      documentRow('PENDING'),
      documentRow('RENDERING'),
      documentRow('FAILED'),
      documentRow('ESTADO_QUE_AINDA_NAO_EXISTE'),
    ];
    const repository = {
      project: jest.fn().mockResolvedValue(emptySource()),
      recentDocuments: jest.fn().mockResolvedValue(documentos),
      recentAppointments: jest.fn().mockResolvedValue([]),
      recentlyCompleted: jest.fn().mockResolvedValue([]),
    };
    const service = new MobileFieldService(repository as never);

    const home = await service.home(actor);
    expect(home.recentDocuments.map((value) => value.state)).toEqual([
      'AVAILABLE',
      'PREPARING',
      'PREPARING',
      'PREPARING',
      'FAILED',

      /**
       * Um estado que este build não conhece degrada para "preparando" em vez
       * de derrubar a tela inicial de quem está em campo.
       */
      'PREPARING',
    ]);
  });

  it('resolves the public document label on the server', async () => {
    const repository = {
      project: jest.fn().mockResolvedValue(emptySource()),
      recentDocuments: jest
        .fn()
        .mockResolvedValue([
          documentRow('READY', 'SERVICE_ORDER'),
          documentRow('READY', 'PMOC'),
          documentRow('READY', 'TIPO_NOVO'),
        ]),
      recentAppointments: jest.fn().mockResolvedValue([]),
      recentlyCompleted: jest.fn().mockResolvedValue([]),
    };
    const service = new MobileFieldService(repository as never);

    const home = await service.home(actor);
    expect(home.recentDocuments.map((value) => value.label)).toEqual([
      'Ordem de serviço',
      'PMOC',

      /** Sigla crua nunca chega à tela. */
      'Documento',
    ]);
  });

  it('uses an opaque stable cursor without duplicates', async () => {
    const source = emptySource();
    source.businessUnits.push({
      id: actor.businessUnitIds[0],
      legalName: 'Recife',
      tradeName: null,
      timezone: 'America/Recife',
    });
    for (let index = 0; index < 55; index += 1) {
      source.operations.push({
        id: `01900000-0000-7000-8000-${String(index).padStart(12, '0')}`,
        businessUnitId: actor.businessUnitIds[0],
        customerId: null,
        assetId: null,
        code: `OS-${index}`,
        title: `Atendimento ${index}`,
        description: null,
        status: 'OPEN',
        priority: 'NORMAL',
        scheduledStart: new Date(
          `2099-01-${String((index % 28) + 1).padStart(2, '0')}T12:00:00Z`,
        ),
        scheduledEnd: null,
        startedAt: null,
        completedAt: null,
        location: null,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        responsibleFieldTechnician: { id: actor.id, displayName: 'João' },
        auxiliaryTechnicians: [],
        asset: null,
        artifactExecutions: [],
        checklistExecutions: [],
      });
    }
    const service = new MobileFieldService({
      project: jest.fn().mockResolvedValue(source),
    } as never);
    const first = await service.workQueue(actor, { limit: 50 });
    const second = await service.workQueue(actor, {
      limit: 50,
      cursor: first.meta.nextCursor!,
    });
    expect(first.data).toHaveLength(50);
    expect(second.data).toHaveLength(5);
    expect(Buffer.byteLength(JSON.stringify(first), 'utf8')).toBeLessThan(
      128 * 1024,
    );
    expect(
      new Set([...first.data, ...second.data].map((item) => item.id)).size,
    ).toBe(55);
  });
  it('lista a base de clientes, mesmo quem não tem trabalho', async () => {
    /// O defeito que este teste tranca: a primeira versão derivava a lista
    /// da projeção de trabalho, e 433 dos 498 clientes cadastrados não
    /// apareciam — inclusive um recém-criado, que por definição ainda não
    /// tem atendimento nenhum.
    const repository = {
      project: jest.fn().mockResolvedValue(emptySource()),
      recentDocuments: jest.fn().mockResolvedValue([]),
      recentAppointments: jest.fn().mockResolvedValue([]),
      recentlyCompleted: jest.fn().mockResolvedValue([]),
      customersPage: jest.fn().mockResolvedValue([
        {
          id: 'c-sem-trabalho',
          legalName: 'Cliente Recém-Cadastrado LTDA',
          tradeName: null,
          documentNumber: null,
          status: 'ACTIVE',
        },
      ]),
    };
    const service = new MobileFieldService(repository as never);

    const pagina = await service.fieldCustomers(actor, {});

    expect(pagina.data).toHaveLength(1);
    expect(pagina.data[0]!.id).toBe('c-sem-trabalho');

    /// Aparece com zero, e zero é a resposta certa — não é motivo para sumir.
    expect(pagina.data[0]!.openCount).toBe(0);
    expect(pagina.data[0]!.completedCount).toBe(0);

    /// Sem nome fantasia, o nome exibido é a razão social.
    expect(pagina.data[0]!.name).toBe('Cliente Recém-Cadastrado LTDA');
  });

  it('a contagem de trabalho é pessoal, e casada por id', async () => {
    const cliente = { id: 'c1', name: 'Shopping Recife' };
    const repository = {
      project: jest.fn().mockResolvedValue(emptySource()),
      recentDocuments: jest.fn().mockResolvedValue([]),
      recentAppointments: jest.fn().mockResolvedValue([]),
      recentlyCompleted: jest.fn().mockResolvedValue([
        {
          id: 'op1',
          code: 'OP-1',
          title: 'Corretiva',
          kind: 'SERVICE_OPERATION',
          completedAt: new Date('2026-09-05T14:00:00.000Z'),
          customer: { id: 'c1', legalName: 'Shopping Recife S.A.' },
          asset: null,
        },
      ]),
      customersPage: jest.fn().mockResolvedValue([
        {
          id: 'c1',
          legalName: 'Shopping Recife S.A.',
          tradeName: 'Shopping Recife',
          documentNumber: null,
          status: 'ACTIVE',
        },
        {
          id: 'c2',
          legalName: 'Outro Cliente com Nome Igual',
          tradeName: 'Shopping Recife',
          documentNumber: null,
          status: 'ACTIVE',
        },
      ]),
    };
    const service = new MobileFieldService(repository as never);

    const pagina = await service.fieldCustomers(actor, {});

    /// Dois clientes com o **mesmo nome fantasia**. O histórico tem de cair
    /// no dono certo: casar por texto juntaria os dois num só número.
    const [primeiro, segundo] = pagina.data;
    expect(primeiro!.completedCount).toBe(1);
    expect(segundo!.completedCount).toBe(0);
    expect(cliente.id).toBe('c1');
  });
});

/**
 * O plano no contexto de navegação de um item de PMOC.
 *
 * Sem ele o aplicativo não monta nenhuma rota do atendimento — todas são
 * escopadas pelo plano — e o PMOC no celular ficava em leitura. O contexto
 * publicava ciclo e equipamento, e o campo que faltava era justamente o que
 * destrava a execução.
 */
describe('contexto de navegação do PMOC', () => {
  /*
   * Ator próprio, com `pmoc.read`.
   *
   * A fila filtra por `VIEW`, e `VIEW` de um item de PMOC depende dessa
   * permissão — o ator do arquivo tem só `operations.read`, e com ele o item
   * seria descartado antes de qualquer asserção sobre o contexto.
   */
  const tecnico: MobileFieldActor = {
    ...actor,
    permissions: ['operations.read', 'pmoc.read', 'pmoc.execute'],
  };

  it('publica o plano, o ciclo e o equipamento', async () => {
    const source = emptySource();
    source.businessUnits.push({
      id: actor.businessUnitIds[0],
      legalName: 'Recife',
      tradeName: null,
      timezone: 'America/Recife',
    });
    source.pmocCycles.push({
      id: '01900000-0000-7000-8000-0000000000c1',
      dueOn: new Date('2099-01-01T00:00:00Z'),
      status: 'PENDING',
      schedulingEventId: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      artifactExecution: null,
      equipmentExecutions: [],
      plan: {
        id: '01900000-0000-7000-8000-0000000000p1'.replace('p', 'a'),
        code: 'PMOC-1',
        name: 'Anual',
        customerId: null,
        businessUnitId: actor.businessUnitIds[0],
        serviceLocation: null,
        technicalResponsibleUserId: tecnico.id,
        coverages: [
          {
            id: '01900000-0000-7000-8000-0000000000c9',
            asset: {
              id: '01900000-0000-7000-8000-0000000000a9',
              name: 'Split 01',
              identifier: 'TAG-1',
              category: 'EQUIPMENT',
              serialNumber: null,
              model: null,
              manufacturer: null,
              location: null,
              status: 'ACTIVE',
              qrIdentities: [],
            },
          },
        ],
      },
    });

    const service = new MobileFieldService({
      project: jest.fn().mockResolvedValue(source),
    } as never);
    const queue = await service.workQueue(tecnico, {});

    expect(queue.data).toHaveLength(1);
    const contexto = queue.data[0]!.navigationContext;
    /* Os três, porque a rota da preparação precisa dos três. */
    expect(contexto.planId).toBe('01900000-0000-7000-8000-0000000000a1');
    expect(contexto.cycleId).toBe('01900000-0000-7000-8000-0000000000c1');
    expect(contexto.equipmentId).toBe('01900000-0000-7000-8000-0000000000a9');
  });

  it('atendimento avulso não inventa um plano', async () => {
    const source = emptySource();
    source.businessUnits.push({
      id: actor.businessUnitIds[0],
      legalName: 'Recife',
      tradeName: null,
      timezone: 'America/Recife',
    });
    source.operations.push({
      id: '01900000-0000-7000-8000-000000000004',
      businessUnitId: actor.businessUnitIds[0],
      customerId: null,
      assetId: null,
      code: 'OS-1',
      title: 'Atendimento',
      description: null,
      status: 'OPEN',
      priority: 'NORMAL',
      scheduledStart: new Date('2099-01-01T12:00:00Z'),
      scheduledEnd: null,
      startedAt: null,
      completedAt: null,
      location: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      responsibleFieldTechnician: { id: actor.id, displayName: 'João' },
      auxiliaryTechnicians: [],
      asset: null,
      artifactExecutions: [],
      checklistExecutions: [],
    });

    const service = new MobileFieldService({
      project: jest.fn().mockResolvedValue(source),
    } as never);
    const queue = await service.workQueue(tecnico, {});

    /* Nulo, não uma string vazia: o item não pertence a plano nenhum, e um id
       vazio faria o aplicativo montar `/pmoc/plans//cycles/…`. */
    expect(queue.data[0]!.navigationContext.planId).toBeNull();
  });
});

/**
 * O que o técnico precisa saber antes de bater na porta.
 *
 * Endereço com complemento e ponto de referência, telefone de quem espera, tipo do
 * atendimento e — só quando o dono liberou — quanto vale. Cada um destes campos era
 * uma pergunta que a tela de detalhe não respondia.
 */
describe('o contexto do atendimento em campo', () => {
  function comOperacao(extra: Record<string, unknown> = {}) {
    const source = emptySource();
    source.businessUnits.push({
      id: actor.businessUnitIds[0],
      legalName: 'Recife',
      tradeName: null,
      timezone: 'America/Recife',
    });
    source.customers.push({
      id: '01900000-0000-7000-8000-0000000000cc',
      legalName: 'Clínica Santa Maria LTDA',
      tradeName: 'Clínica Santa Maria',
      address: null,
      contacts: [
        { name: 'Dona Rita', phone: '+55 81 98888-0000', email: null },
      ],
    });
    source.operations.push({
      id: '01900000-0000-7000-8000-000000000004',
      businessUnitId: actor.businessUnitIds[0],
      customerId: '01900000-0000-7000-8000-0000000000cc',
      assetId: null,
      code: 'OS-1',
      kind: 'MAINTENANCE',
      sector: 'Sala de máquinas',
      title: 'Atendimento',
      description: null,
      status: 'OPEN',
      priority: 'NORMAL',
      scheduledStart: new Date('2099-01-01T12:00:00Z'),
      scheduledEnd: null,
      startedAt: null,
      completedAt: null,
      location: null,
      customerAddress: {
        label: 'Matriz',
        street: 'Rua da Aurora',
        number: '1200',
        complement: 'Bloco B, 4º andar',
        district: 'Boa Vista',
        city: 'Recife',
        stateCode: 'PE',
        postalCode: '50050-000',
        notes: 'Portão azul nos fundos; falar com a portaria.',
      },
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      responsibleFieldTechnician: { id: actor.id, displayName: 'João' },
      auxiliaryTechnicians: [],
      asset: null,
      artifactExecutions: [],
      checklistExecutions: [],
      ...extra,
    });
    return source;
  }

  async function itemDe(source: ReturnType<typeof emptySource>) {
    const service = new MobileFieldService({
      project: jest.fn().mockResolvedValue(source),
    } as never);
    const queue = await service.workQueue(actor, {});
    return queue.data[0]!;
  }

  it('publica o endereço do atendimento com complemento e referência', async () => {
    const item = await itemDe(comOperacao());

    /* As partes separadas, e não uma linha pronta: quem procura a portaria lê o
       ponto de referência antes do CEP. */
    expect(item.serviceAddress).toEqual({
      label: 'Matriz',
      street: 'Rua da Aurora',
      number: '1200',
      complement: 'Bloco B, 4º andar',
      district: 'Boa Vista',
      city: 'Recife',
      stateCode: 'PE',
      postalCode: '50050-000',
      reference: 'Portão azul nos fundos; falar com a portaria.',
      sector: 'Sala de máquinas',
    });
  });

  it('sem endereço cadastrado devolve nulo, e não um endereço inventado', async () => {
    /* O endereço fiscal do cliente está em `location` e serve para outra coisa.
       Promovê-lo a endereço de serviço mandaria o técnico para a contabilidade. */
    const item = await itemDe(comOperacao({ customerAddress: null }));

    expect(item.serviceAddress).toBeNull();
  });

  it('o tipo do atendimento sai em português', async () => {
    /* A tela não traduz enum: ela imprimiria "MAINTENANCE". */
    const item = await itemDe(comOperacao());

    expect(item.serviceType).toBe('Manutenção');
  });

  it('o telefone do cliente não depende de permissão de cadastro', async () => {
    /*
     * O ator tem só `operations.read` — nada de `customers.read`, que é a permissão
     * de navegar a carteira de clientes e que o Técnico Operacional não costuma ter.
     *
     * O que torna seguro revelar é o recorte da consulta, não uma permissão: a fila
     * só traz item atribuído a esta pessoa. Escondido, o técnico chegava ao prédio
     * sem o telefone de quem o espera.
     */
    const item = await itemDe(comOperacao());

    expect(item.customer?.contact?.phone).toBe('+55 81 98888-0000');
  });
});

describe('o valor do atendimento em campo', () => {
  const CANONICO = 'SERVICE_OPERATION:01900000-0000-7000-8000-000000000004';

  function servico(operationAmount: unknown) {
    const source = emptySource();
    source.businessUnits.push({
      id: actor.businessUnitIds[0],
      legalName: 'Recife',
      tradeName: null,
      timezone: 'America/Recife',
    });
    source.operations.push({
      id: '01900000-0000-7000-8000-000000000004',
      businessUnitId: actor.businessUnitIds[0],
      customerId: null,
      assetId: null,
      code: 'OS-1',
      kind: 'MAINTENANCE',
      sector: null,
      title: 'Atendimento',
      description: null,
      status: 'OPEN',
      priority: 'NORMAL',
      scheduledStart: new Date('2099-01-01T12:00:00Z'),
      scheduledEnd: null,
      startedAt: null,
      completedAt: null,
      location: null,
      customerAddress: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      responsibleFieldTechnician: { id: actor.id, displayName: 'João' },
      auxiliaryTechnicians: [],
      asset: null,
      artifactExecutions: [],
      checklistExecutions: [],
    });
    return new MobileFieldService({
      project: jest.fn().mockResolvedValue(source),
      operationAmount: jest.fn().mockResolvedValue(operationAmount),
    } as never);
  }

  it('liberado, publica o total do orçamento vinculado', async () => {
    const service = servico({
      amountVisibleInField: true,
      quote: { total: '8000.00', status: 'APPROVED' },
    });

    const contexto = await service.fieldContext(actor, CANONICO);

    expect(contexto.financialSummary).toEqual({
      currency: 'BRL',
      approvedAmount: '8000.00',
      paymentStatus: 'APPROVED',
    });
  });

  it('não liberado, o campo não existe — e não vem zerado', async () => {
    /*
     * A asserção central. `{ approvedAmount: null }` diria "este atendimento não tem
     * valor", que é outra afirmação: a tela mostraria "R$ 0,00" num serviço de oito
     * mil. Ausência é a única forma de dizer "não cabe a você ver".
     */
    const service = servico({
      amountVisibleInField: false,
      quote: { total: '8000.00', status: 'APPROVED' },
    });

    const contexto = await service.fieldContext(actor, CANONICO);

    expect(contexto.financialSummary).toBeUndefined();
  });

  it('liberado sem orçamento é um terceiro estado, não omissão', async () => {
    /*
     * Os dois casos vinham omitidos juntos, e o efeito era o dono ligar a chave,
     * não ver nada e concluir que a liberação não funcionava. Presente com valor
     * nulo diz o que de fato falta: vincular um orçamento.
     */
    const service = servico({ amountVisibleInField: true, quote: null });

    const contexto = await service.fieldContext(actor, CANONICO);

    expect(contexto.financialSummary).toEqual({
      currency: 'BRL',
      approvedAmount: null,
      paymentStatus: null,
    });
  });
});

function emptySource() {
  return {
    businessUnits: [] as any[],
    operations: [] as any[],
    pmocCycles: [] as any[],
    rvtOccurrences: [] as any[],
    customers: [] as any[],
    rvtAssets: [] as any[],
  };
}

function documentRow(renderStatus: string, documentType = 'SERVICE_ORDER') {
  return {
    id: '01900000-0000-7000-8000-00000000000a',
    documentType,
    createdAt: new Date('2026-09-01T12:00:00Z'),
    artifactExecution: { renderStatus, customer: null },
  };
}
