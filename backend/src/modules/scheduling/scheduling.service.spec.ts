import { ValidationException } from '../../exceptions';
import { SchedulingService } from './scheduling.service';

describe('SchedulingService validation', () => {
  const service = new SchedulingService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('rejects events whose end does not follow the start', async () => {
    await expect(
      service.createEvent('organization', 'actor', {
        calendarId: 'calendar',
        title: 'Invalid',
        type: 'AUDIT',
        startsAt: new Date('2026-08-10T10:00:00.000Z'),
        endsAt: new Date('2026-08-10T09:00:00.000Z'),
        timezone: 'UTC',
        sourceModule: 'audits',
        sourceEntityType: 'AUDIT',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('rejects inconsistent resource allocation identifiers', async () => {
    await expect(
      service.createEvent('organization', 'actor', {
        calendarId: 'calendar',
        title: 'Invalid allocation',
        type: 'OPERATION',
        startsAt: new Date('2026-08-10T09:00:00.000Z'),
        endsAt: new Date('2026-08-10T10:00:00.000Z'),
        timezone: 'UTC',
        sourceModule: 'operations',
        sourceEntityType: 'OPERATION',
        allocations: [
          {
            resourceType: 'USER',
            userId: 'user',
            assetId: 'asset',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('rejects invalid availability windows', async () => {
    await expect(
      service.createAvailability('organization', {
        resourceType: 'CUSTOM',
        resourceKey: 'room-1',
        kind: 'AVAILABLE',
        dayOfWeek: 1,
        startMinute: 600,
        endMinute: 500,
        timezone: 'UTC',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });
});

describe('SchedulingService agenda timezone', () => {
  it('queries UTC boundaries and groups occurrences by the authoritative local day', async () => {
    const repository = {
      agendaTimezone: jest.fn().mockResolvedValue('America/Recife'),
      candidateEvents: jest.fn().mockResolvedValue([
        {
          id: 'event',
          calendarId: 'calendar',
          title: 'Visita noturna',
          description: null,
          type: 'OPERATION',
          status: 'CONFIRMED',
          priority: 'NORMAL',
          startsAt: new Date('2026-08-15T01:30:00.000Z'),
          endsAt: new Date('2026-08-15T02:30:00.000Z'),
          allDay: false,
          timezone: 'America/Recife',
          businessUnitId: 'unit',
          customerId: null,
          assetId: null,
          segment: null,
          sourceModule: 'operations',
          sourceEntityType: 'OPERATION',
          sourceEntityId: null,
          location: null,
          recurrence: null,
          allocations: [],
        },
      ]),
    };
    const recurrence = {
      expand: jest.fn((startsAt: Date, endsAt: Date) => [{ startsAt, endsAt }]),
    };
    const service = new SchedulingService(
      repository as never,
      recurrence as never,
      {} as never,
      {} as never,
    );

    const agenda = await service.agenda('organization', {
      view: 'DAY',
      date: new Date('2026-08-14T00:00:00.000Z'),
      businessUnitId: 'unit',
    });

    expect(repository.candidateEvents).toHaveBeenCalledWith(
      'organization',
      expect.objectContaining({
        from: new Date('2026-08-14T03:00:00.000Z'),
        to: new Date('2026-08-15T03:00:00.000Z'),
      }),
    );
    expect(agenda.range.timezone).toBe('America/Recife');
    expect(agenda.days).toEqual([
      expect.objectContaining({ date: '2026-08-14' }),
    ]);
    for (const day of agenda.days)
      for (const event of day.events)
        expect(event.startsAt).toBe('2026-08-15T01:30:00.000Z');
  });
  /* ---------------------------------------------------------------- */
  /* Agendar não pede do auxiliar o que a operação não pede            */
  /* ---------------------------------------------------------------- */

  /**
   * O elo que ficaria quebrado.
   *
   * As alocações de um evento de operação saem da **própria operação**: o
   * responsável e os auxiliares dela. Cobrar perfil de técnico de campo do
   * auxiliar aqui transformaria um atendimento atribuído corretamente num evento
   * impossível de agendar — a atribuição passa, a agenda recusa, e nada na
   * operação mudou entre as duas.
   */
  describe('alocação de técnicos no evento', () => {
    const agendar = (
      allocations: { resourceType: string; userId: string; role: string }[],
      workforce: {
        listProfessionals: jest.Mock;
        listFieldAssistantCandidates: jest.Mock;
      },
    ) => {
      /*
       * O dublê cobre o caminho até a alocação: calendário, segmento, as
       * referências e os candidatos a conflito. É o mínimo para que a validação
       * de alocação seja alcançada — e é ela que está sob teste.
       */
      const repository = {
        findCalendar: jest.fn().mockResolvedValue({
          id: 'calendar',
          isActive: true,
          businessUnitId: 'unit',
        }),
        organizationSegment: jest.fn().mockResolvedValue(null),
        /*
         * As pessoas alocadas são membros ativos: o dublê confirma exatamente
         * as que foram pedidas. Devolver um conjunto fixo faria o serviço
         * recusar por contagem antes de chegar à regra sob teste.
         */
        references: jest.fn((_org: string, pedido: { userIds: string[] }) =>
          Promise.resolve({
            businessUnit: { id: 'unit' },
            customer: null,
            asset: null,
            users: [...new Set(pedido.userIds)].map((id) => ({ id })),
            allocationAssets: [],
          }),
        ),
        candidateEvents: jest.fn().mockResolvedValue([]),
        availabilityForResources: jest.fn().mockResolvedValue([]),
        createEvent: jest.fn().mockResolvedValue({ id: 'event' }),
      };
      const servico = new SchedulingService(
        repository as never,
        /* Sem recorrência: o evento é único, e `expand` devolve só ele. */
        { expand: () => [] } as never,
        {} as never,
        workforce as never,
      );
      return servico.createEvent('organization', 'actor', {
        calendarId: 'calendar',
        title: 'Atendimento',
        type: 'OPERATION',
        startsAt: new Date('2026-08-10T09:00:00.000Z'),
        endsAt: new Date('2026-08-10T10:00:00.000Z'),
        timezone: 'UTC',
        sourceModule: 'operations',
        sourceEntityType: 'OPERATION',
        businessUnitId: 'unit',
        allocations,
      });
    };

    it('aceita auxiliar sem perfil de técnico de campo', async () => {
      const workforce = {
        listProfessionals: jest.fn().mockResolvedValue([{ userId: 'tecnico' }]),
        listFieldAssistantCandidates: jest
          .fn()
          .mockResolvedValue([{ userId: 'auxiliar' }]),
      };
      await expect(
        agendar(
          [
            {
              resourceType: 'USER',
              userId: 'tecnico',
              role: 'RESPONSIBLE_FIELD_TECHNICIAN',
            },
            {
              resourceType: 'USER',
              userId: 'auxiliar',
              role: 'AUXILIARY_TECHNICIAN',
            },
          ],
          workforce,
        ),
      ).resolves.toBeDefined();
      expect(workforce.listFieldAssistantCandidates).toHaveBeenCalledWith(
        'organization',
        'unit',
      );
    });

    it('recusa responsável sem perfil de técnico de campo', async () => {
      const workforce = {
        listProfessionals: jest.fn().mockResolvedValue([]),
        listFieldAssistantCandidates: jest.fn().mockResolvedValue([]),
      };
      await expect(
        agendar(
          [
            {
              resourceType: 'USER',
              userId: 'tecnico',
              role: 'RESPONSIBLE_FIELD_TECHNICIAN',
            },
          ],
          workforce,
        ),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('recusa auxiliar que não pode acompanhar nesta unidade', async () => {
      const workforce = {
        listProfessionals: jest.fn().mockResolvedValue([{ userId: 'tecnico' }]),
        listFieldAssistantCandidates: jest.fn().mockResolvedValue([]),
      };
      await expect(
        agendar(
          [
            {
              resourceType: 'USER',
              userId: 'tecnico',
              role: 'RESPONSIBLE_FIELD_TECHNICIAN',
            },
            {
              resourceType: 'USER',
              userId: 'estranho',
              role: 'AUXILIARY_TECHNICIAN',
            },
          ],
          workforce,
        ),
      ).rejects.toBeInstanceOf(ValidationException);
    });
  });
});
