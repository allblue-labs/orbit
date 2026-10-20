/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { MobileFieldRepository } from './mobile-field.repository';

describe('MobileFieldRepository projection bounds', () => {
  it('reserves a bounded query for unscheduled work instead of hiding it behind history', async () => {
    const tx = {
      businessUnit: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: '01900000-0000-7000-8000-000000000001',
            legalName: 'Recife',
            tradeName: null,
            timezone: 'America/Recife',
          },
        ]),
      },
      /* A fila consulta a preferência de autorização da organização antes de
         montar o `where` — sem este duplo o repositório quebra no acesso. */
      organization: {
        findUnique: jest.fn().mockResolvedValue({ settings: null }),
      },
      operation: { findMany: jest.fn().mockResolvedValue([]) },
      pmocExecution: { findMany: jest.fn().mockResolvedValue([]) },
      rvtOccurrence: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
    const repository = new MobileFieldRepository(rls as never);

    await repository.project(
      '01900000-0000-7000-8000-000000000002',
      '01900000-0000-7000-8000-000000000003',
      ['01900000-0000-7000-8000-000000000001'],
    );

    expect(tx.operation.findMany).toHaveBeenCalledTimes(4);
    expect(
      tx.operation.findMany.mock.calls.map(([query]) => ({
        take: query.take as number,
        scheduledStart: (query.where as { scheduledStart?: unknown })
          .scheduledStart,
      })),
    ).toEqual([
      { take: 125, scheduledStart: undefined },
      {
        take: 125,
        scheduledStart: expect.objectContaining({ lte: expect.any(Date) }),
      },
      {
        take: 125,
        scheduledStart: expect.objectContaining({ gt: expect.any(Date) }),
      },
      { take: 125, scheduledStart: null },
    ]);
  });

  it('loads one canonical operation directly under the assignment scope', async () => {
    const tx = {
      businessUnit: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: '01900000-0000-7000-8000-000000000001',
            legalName: 'Recife',
            tradeName: null,
            timezone: 'America/Recife',
          },
        ]),
      },
      /* A fila consulta a preferência de autorização da organização antes de
         montar o `where` — sem este duplo o repositório quebra no acesso. */
      organization: {
        findUnique: jest.fn().mockResolvedValue({ settings: null }),
      },
      operation: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
    const repository = new MobileFieldRepository(rls as never);
    const sourceId = '01900000-0000-7000-8000-000000000004';

    await repository.project(
      '01900000-0000-7000-8000-000000000002',
      '01900000-0000-7000-8000-000000000003',
      ['01900000-0000-7000-8000-000000000001'],
      { kind: 'SERVICE_OPERATION', sourceId },
    );

    expect(tx.operation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1,
        where: expect.objectContaining({
          id: sourceId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        }),
      }),
    );
  });

  /* ---------------------------------------------------------------- */
  /* A atribuição é o que faz o atendimento chegar ao aplicativo       */
  /* ---------------------------------------------------------------- */

  /**
   * O que este teste tranca.
   *
   * A fila do aplicativo é pessoal: um atendimento aparece porque **esta pessoa**
   * está atribuída a ele, como responsável ou como auxiliar. É o elo final da
   * correção de atribuição — se o recorte parar de olhar as duas listas, o
   * técnico recebe o trabalho no sistema e não o vê no celular, que é
   * indistinguível de não ter recebido.
   *
   * Nos quatro buckets, e não só no primeiro: eles existem para ordenar por
   * urgência, e um deles sem o recorte mostraria à pessoa o trabalho de outra.
   */
  it('a fila só traz o que está atribuído a quem pergunta — como responsável ou auxiliar', async () => {
    const tx = {
      businessUnit: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: '01900000-0000-7000-8000-000000000001',
            legalName: 'Recife',
            tradeName: null,
            timezone: 'America/Recife',
          },
        ]),
      },
      organization: {
        findUnique: jest.fn().mockResolvedValue({ settings: null }),
      },
      operation: { findMany: jest.fn().mockResolvedValue([]) },
      pmocExecution: { findMany: jest.fn().mockResolvedValue([]) },
      rvtOccurrence: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
    const repository = new MobileFieldRepository(rls as never);
    const actorId = '01900000-0000-7000-8000-000000000003';

    await repository.project('01900000-0000-7000-8000-000000000002', actorId, [
      '01900000-0000-7000-8000-000000000001',
    ]);

    expect(tx.operation.findMany).toHaveBeenCalledTimes(4);
    for (const [query] of tx.operation.findMany.mock.calls) {
      expect((query.where as { OR?: unknown }).OR).toEqual([
        { responsibleFieldTechnicianId: actorId },
        {
          auxiliaryTechnicians: {
            some: { userId: actorId, removedAt: null },
          },
        },
      ]);
    }
  });

  /**
   * O auxiliar removido para de ver o atendimento.
   *
   * `removedAt: null` é o que separa "é auxiliar" de "já foi": sem ele, tirar
   * alguém da equipe de um atendimento não lhe tiraria o acesso ao atendimento —
   * e o histórico de atribuição é guardado, não apagado.
   */
  it('o recorte de auxiliar ignora quem foi removido', async () => {
    const tx = {
      businessUnit: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: '01900000-0000-7000-8000-000000000001',
            legalName: 'Recife',
            tradeName: null,
            timezone: 'America/Recife',
          },
        ]),
      },
      organization: {
        findUnique: jest.fn().mockResolvedValue({ settings: null }),
      },
      operation: { findMany: jest.fn().mockResolvedValue([]) },
      pmocExecution: { findMany: jest.fn().mockResolvedValue([]) },
      rvtOccurrence: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
    const repository = new MobileFieldRepository(rls as never);

    await repository.project(
      '01900000-0000-7000-8000-000000000002',
      '01900000-0000-7000-8000-000000000003',
      ['01900000-0000-7000-8000-000000000001'],
    );

    for (const [query] of tx.operation.findMany.mock.calls) {
      const [, auxiliar] = (
        query.where as {
          OR: { auxiliaryTechnicians?: { some: { removedAt?: unknown } } }[];
        }
      ).OR;
      expect(auxiliar?.auxiliaryTechnicians?.some.removedAt).toBeNull();
    }
  });
});
