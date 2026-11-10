import {
  OperationScheduleService,
  schedulesAreClose,
} from './operation-schedule.service';
describe('aviso de proximidade da agenda', () => {
  const start = new Date('2026-11-01T12:00:00Z');
  it.each([
    '2026-11-01T11:50:00Z',
    '2026-11-01T12:00:00Z',
    '2026-11-01T12:10:00Z',
  ])('avisa inclusive o limite de dez minutos (%s)', (other) => {
    expect(schedulesAreClose(start, null, new Date(other), null)).toBe(true);
  });
  it.each(['2026-11-01T12:10:01Z', '2026-11-02T12:00:00Z'])(
    'considera hora e data completas (%s)',
    (other) => {
      expect(schedulesAreClose(start, null, new Date(other), null)).toBe(false);
    },
  );
  it('considera duração e intervalo entre atendimentos, em ambos os sentidos', () => {
    const end = new Date('2026-11-01T14:00:00Z');
    expect(
      schedulesAreClose(
        start,
        end,
        new Date('2026-11-01T13:00:00Z'),
        new Date('2026-11-01T13:30:00Z'),
      ),
    ).toBe(true);
    expect(
      schedulesAreClose(start, end, new Date('2026-11-01T14:10:00Z'), null),
    ).toBe(true);
    expect(
      schedulesAreClose(new Date('2026-11-01T14:10:00Z'), null, start, end),
    ).toBe(true);
  });
});

describe('previsão de PMOC no aviso de agenda', () => {
  it('inclui equipamento ainda não iniciado e exclui a própria previsão da edição', async () => {
    const tx = {
      operation: { findMany: jest.fn().mockResolvedValue([]) },
      schedulingEvent: { findMany: jest.fn().mockResolvedValue([]) },
      pmocEquipmentSchedule: {
        findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([
          {
            id: 'schedule',
            cycleId: 'cycle',
            scheduledFor: new Date('2026-11-15T12:05:00Z'),
            responsibleFieldTechnician: { id: 'field', displayName: 'Marina' },
            auxiliaryTechnicianIds: [],
            cycle: { plan: { name: 'Preventiva mensal' } },
            coverage: {
              asset: { name: 'Split sala' },
              equipmentExecutions: [],
            },
          },
        ]),
      },
    };
    const service = new OperationScheduleService(
      { run: (work: (value: unknown) => unknown) => work(tx) } as never,
      {} as never,
    );
    const warnings = await service.check('org', {
      userIds: ['field'],
      scheduledStart: new Date('2026-11-15T12:00:00Z'),
      excludePmocScheduleId: 'edited',
    });
    expect(warnings).toEqual([
      {
        userName: 'Marina',
        title: 'Preventiva mensal · Split sala',
        startsAt: '2026-11-15T12:05:00.000Z',
        endsAt: null,
      },
    ]);
    const query = tx.pmocEquipmentSchedule.findMany.mock.calls[0]?.[0] as {
      where: { id: { not: string }; organizationId: string; cancelledAt: null };
    };
    expect(query.where.organizationId).toBe('org');
    expect(query.where.cancelledAt).toBeNull();
    expect(query.where.id.not).toBe('edited');
  });
});
