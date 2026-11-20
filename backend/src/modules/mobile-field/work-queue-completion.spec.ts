/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A fila sabe o que já foi feito.
 *
 * ## Os defeitos
 *
 * 1. `dueState` olhava só a data. Um atendimento concluído com data passada saía
 *    `OVERDUE` — "não atendido" —; com data de hoje, `DUE_TODAY`; com data
 *    futura, `UPCOMING`. O mesmo PMOC aparecia como pendente, depois como
 *    próximo, e só na home como feito.
 * 2. A fila excluía concluídos na consulta. O técnico não tinha onde ver o que
 *    tinha feito, além de cinco linhas na home.
 * 3. O item de PMOC não dizia de que mês era. Fechado um ciclo, o seguinte abria
 *    para o mesmo aparelho, com o mesmo título.
 */
import {
  MobileFieldService,
  periodoDoCiclo,
  type MobileFieldActor,
} from './mobile-field.service';

const UNIDADE = '01900000-0000-7000-8000-000000000003';
const actor: MobileFieldActor = {
  id: '01900000-0000-7000-8000-000000000001',
  organizationId: '01900000-0000-7000-8000-000000000002',
  businessUnitIds: [UNIDADE],
  permissions: ['operations.read', 'artifact_executions.read'],
};

function operacao(
  id: string,
  status: string,
  scheduledStart: Date,
  completedAt: Date | null = null,
) {
  return {
    id,
    businessUnitId: UNIDADE,
    customerId: null,
    code: id.slice(-4),
    title: 'Atendimento',
    description: null,
    status,
    priority: 'NORMAL',
    scheduledStart,
    scheduledEnd: null,
    startedAt: null,
    completedAt,
    location: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    responsibleFieldTechnician: { id: actor.id, displayName: 'João' },
    auxiliaryTechnicians: [],
    assets: [],
    artifactExecutions: [],
    checklistExecutions: [],
  };
}

function origem(operations: any[]) {
  return {
    businessUnits: [
      {
        id: UNIDADE,
        legalName: 'Recife',
        tradeName: null,
        timezone: 'America/Recife',
      },
    ],
    operations,
    pmocCycles: [] as any[],
    rvtOccurrences: [] as any[],
    customers: [] as any[],
    rvtAssets: [] as any[],
  };
}

const ONTEM = new Date(Date.now() - 24 * 60 * 60 * 1000);
const AMANHA = new Date(Date.now() + 24 * 60 * 60 * 1000);
const SEMANA_PASSADA = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

function servico(operations: any[]) {
  /* Tipado para o teste poder ler os filtros sem `any`. */
  const project = jest.fn<
    Promise<ReturnType<typeof origem>>,
    [
      string,
      string,
      readonly string[],
      unknown,
      { includeCompleted?: boolean }?,
    ]
  >(() => Promise.resolve(origem(operations)));
  return { service: new MobileFieldService({ project } as never), project };
}

describe('estado de prazo de um atendimento concluído', () => {
  /** O defeito relatado, em um teste. */
  it('concluído com data passada não é "não atendido"', async () => {
    const { service } = servico([
      operacao(
        '01900000-0000-7000-8000-0000000000a1',
        'COMPLETED',
        SEMANA_PASSADA,
        ONTEM,
      ),
    ]);

    const { data } = await service.workQueue(actor, {});

    expect(data[0]!.dueState).toBe('COMPLETED');
  });

  it('concluído com data futura não é "próximo"', async () => {
    const { service } = servico([
      operacao(
        '01900000-0000-7000-8000-0000000000a1',
        'COMPLETED',
        AMANHA,
        ONTEM,
      ),
    ]);

    const { data } = await service.workQueue(actor, {});

    expect(data[0]!.dueState).toBe('COMPLETED');
  });

  it('publica quando foi concluído', async () => {
    const { service } = servico([
      operacao(
        '01900000-0000-7000-8000-0000000000a1',
        'COMPLETED',
        SEMANA_PASSADA,
        ONTEM,
      ),
    ]);

    const { data } = await service.workQueue(actor, {});

    expect(data[0]!.completedAt).toBe(ONTEM.toISOString());
  });
});

describe('recortes da fila', () => {
  const lista = () => [
    operacao(
      '01900000-0000-7000-8000-0000000000a1',
      'COMPLETED',
      SEMANA_PASSADA,
      ONTEM,
    ),
    operacao('01900000-0000-7000-8000-0000000000a2', 'OPEN', SEMANA_PASSADA),
    operacao('01900000-0000-7000-8000-0000000000a3', 'OPEN', AMANHA),
  ];

  it('"Concluídos" traz só o que foi concluído', async () => {
    const { service } = servico(lista());

    const { data } = await service.workQueue(actor, { view: 'COMPLETED' });

    expect(data.map((item) => item.dueState)).toEqual(['COMPLETED']);
  });

  /** "Não atendidos" é o recorte de atrasados — e concluído não é atrasado. */
  it('"Não atendidos" não traz concluído', async () => {
    const { service } = servico(lista());

    const { data } = await service.workQueue(actor, { view: 'OVERDUE' });

    expect(data.map((item) => item.sourceId)).toEqual([
      '01900000-0000-7000-8000-0000000000a2',
    ]);
  });

  /** O que falta pesa mais do que o que foi feito. */
  it('"Tudo" traz concluídos no fim', async () => {
    const { service } = servico(lista());

    const { data } = await service.workQueue(actor, {});

    expect(data.at(-1)!.dueState).toBe('COMPLETED');
  });

  it('entre concluídos, o mais recente primeiro', async () => {
    const { service } = servico([
      operacao(
        '01900000-0000-7000-8000-0000000000b1',
        'COMPLETED',
        SEMANA_PASSADA,
        SEMANA_PASSADA,
      ),
      operacao(
        '01900000-0000-7000-8000-0000000000b2',
        'COMPLETED',
        SEMANA_PASSADA,
        ONTEM,
      ),
    ]);

    const { data } = await service.workQueue(actor, { view: 'COMPLETED' });

    expect(data.map((item) => item.sourceId)).toEqual([
      '01900000-0000-7000-8000-0000000000b2',
      '01900000-0000-7000-8000-0000000000b1',
    ]);
  });

  /**
   * Concluídos são pedidos à origem só quando o recorte os mostra.
   *
   * A home e os contadores leem a mesma origem e querem o que falta; trazer
   * concluídos para descartar seria custo sem resposta.
   */
  it('pede concluídos à origem só em "Tudo" e "Concluídos"', async () => {
    const pedidos: Record<string, boolean> = {};
    for (const view of [
      'ALL',
      'COMPLETED',
      'OVERDUE',
      'TODAY',
      'UPCOMING',
      'IN_PROGRESS',
    ] as const) {
      const { service, project } = servico([]);
      await service.workQueue(actor, { view });
      /* `project(organizationId, actorId, unidades, alvo, filtros)`. */
      const filtros = project.mock.calls[0]![4];
      pedidos[view] = filtros?.includeCompleted === true;
    }

    expect(pedidos).toEqual({
      ALL: true,
      COMPLETED: true,
      OVERDUE: false,
      TODAY: false,
      UPCOMING: false,
      IN_PROGRESS: false,
    });
  });
});

describe('período de um ciclo de PMOC', () => {
  it('diz o mês por extenso', () => {
    expect(periodoDoCiclo(new Date('2026-11-30T00:00:00.000Z'))).toBe(
      'novembro de 2026',
    );
  });

  /**
   * `dueOn` é data civil. Ler no fuso de quem está a oeste de Greenwich levaria
   * o dia 1º para o mês anterior.
   */
  it('o dia 1º continua no próprio mês', () => {
    expect(periodoDoCiclo(new Date('2026-12-01T00:00:00.000Z'))).toBe(
      'dezembro de 2026',
    );
  });

  it('janeiro e dezembro nas pontas', () => {
    expect(periodoDoCiclo(new Date('2027-01-15T00:00:00.000Z'))).toBe(
      'janeiro de 2027',
    );
  });
});

/* ------------------------------------------------------------------ */
/* PMOC                                                                */
/* ------------------------------------------------------------------ */

/**
 * O caso que o técnico relatou: o PMOC que ele acabou de atender.
 *
 * O ciclo continua aberto enquanto há outro equipamento a atender. O aparelho
 * concluído seguia na fila — e como `dueState` ignorava a conclusão, como
 * "atrasado". O documento publicado era o do ciclo, que não existe.
 */
describe('equipamento de PMOC concluído num ciclo ainda aberto', () => {
  const ASSET = '01900000-0000-7000-8000-0000000000c1';
  const DOC = '01900000-0000-7000-8000-0000000000d1';

  function cicloComUmConcluido() {
    const asset = {
      id: ASSET,
      identifier: 'SPL-01',
      name: 'Split da recepção',
      category: 'EQUIPMENT',
      manufacturer: null,
      model: null,
      location: null,
      status: 'ACTIVE',
      qrIdentities: [],
    };
    return {
      id: '01900000-0000-7000-8000-0000000000e1',
      dueOn: new Date('2026-10-31T00:00:00.000Z'),
      status: 'PENDING',
      schedulingEventId: null,
      updatedAt: new Date('2026-11-01T00:00:00Z'),
      artifactExecution: null,
      plan: {
        id: '01900000-0000-7000-8000-0000000000f1',
        name: 'PMOC Clínica',
        code: 'PMOC-7',
        businessUnitId: UNIDADE,
        customerId: '01900000-0000-7000-8000-0000000000f2',
        serviceLocation: null,
        technician: { id: actor.id, displayName: 'João' },
        technicalResponsibleUserId: '01900000-0000-7000-8000-0000000000f3',
        coverages: [{ id: 'cov-1', asset }],
      },
      equipmentExecutions: [
        {
          id: '01900000-0000-7000-8000-0000000000e2',
          coverageId: 'cov-1',
          status: 'COMPLETED',
          completedAt: ONTEM,
          artifactExecution: {
            id: DOC,
            status: 'COMPLETED',
            renderStatus: 'COMPLETED',
            snapshot: { artifactType: 'PMOC' },
          },
          responsibleFieldTechnician: { id: actor.id, displayName: 'João' },
          operation: { auxiliaryTechnicians: [] },
        },
      ],
      equipmentSchedules: [],
    };
  }

  async function item() {
    const source = origem([]);
    source.pmocCycles.push(cicloComUmConcluido());
    const service = new MobileFieldService({
      project: jest.fn().mockResolvedValue(source),
    } as never);
    const { data } = await service.workQueue(
      { ...actor, permissions: [...actor.permissions, 'pmoc.read'] },
      { kind: 'PMOC' },
    );
    return data[0]!;
  }

  it('aparece como concluído, e não como atrasado', async () => {
    expect((await item()).dueState).toBe('COMPLETED');
  });

  it('publica o documento do equipamento', async () => {
    expect((await item()).artifacts.map((artefato) => artefato.id)).toEqual([
      DOC,
    ]);
  });

  it('diz de que mês é a manutenção', async () => {
    expect((await item()).description).toContain('outubro de 2026');
  });
});

/* ------------------------------------------------------------------ */
/* Concluídos da home                                                  */
/* ------------------------------------------------------------------ */

/**
 * O PMOC concluído da home precisa saber voltar à tela de PMOC.
 *
 * Ele aparece aqui como a operação atrás da execução, e o aplicativo o abria na
 * tela genérica de operação — sem o roteiro do plano e sem o relatório.
 */
describe('PMOC na lista de concluídos da home', () => {
  async function concluidos(rows: any[]) {
    const service = new MobileFieldService({
      project: jest.fn().mockResolvedValue(origem([])),
      recentDocuments: jest.fn().mockResolvedValue([]),
      recentAppointments: jest.fn().mockResolvedValue([]),
      recentlyCompleted: jest.fn().mockResolvedValue(rows),
    } as never);
    return (await service.home(actor)).recentlyCompleted;
  }

  const linha = (
    pmoc: { planId: string; cycleId: string; assetId: string } | null,
  ) => ({
    id: 'op1',
    code: 'PMOC-1',
    title: 'PMOC',
    kind: 'PMOC',
    completedAt: ONTEM,
    customer: null,
    assets: [],
    pmocEquipmentExecution: pmoc,
  });

  it('publica plano, ciclo e equipamento', async () => {
    const [item] = await concluidos([
      linha({ planId: 'p1', cycleId: 'c1', assetId: 'a1' }),
    ]);

    expect(item!.pmoc).toEqual({ planId: 'p1', cycleId: 'c1', assetId: 'a1' });
  });

  it('atendimento comum não tem endereço de PMOC', async () => {
    const [item] = await concluidos([linha(null)]);

    expect(item!.pmoc).toBeNull();
  });
});
