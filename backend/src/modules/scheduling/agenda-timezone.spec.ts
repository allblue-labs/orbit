import { validate } from 'class-validator';
import { UpdateProfileDto } from '../identity/presentation/dto/identity.dto';
import { SchedulingRepository } from './scheduling.repository';
import { SchedulingService } from './scheduling.service';

function fixture(preference: string | null) {
  const tx = {
    user: { findFirst: jest.fn().mockResolvedValue({ timezone: preference }) },
    businessUnit: {
      findFirst: jest.fn().mockResolvedValue({ timezone: 'America/Recife' }),
    },
    schedulingCalendar: {
      findFirst: jest.fn().mockResolvedValue({ timezone: 'America/Manaus' }),
    },
  };
  const rls = { run: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)) };
  return { tx, repository: new SchedulingRepository(rls as never) };
}

describe('agenda account timezone', () => {
  it('uses the authenticated viewer preference before the unit', async () => {
    const { repository, tx } = fixture('America/Rio_Branco');
    await expect(
      repository.agendaTimezone('org', 'unit', 'viewer'),
    ).resolves.toBe('America/Rio_Branco');
    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'viewer', deletedAt: null },
      select: { timezone: true },
    });
    expect(tx.businessUnit.findFirst).not.toHaveBeenCalled();
  });

  it.each([null, 'invalid'])(
    'falls back for legacy preference %s',
    async (preference) => {
      const { repository } = fixture(preference);
      await expect(
        repository.agendaTimezone('org', 'unit', 'viewer'),
      ).resolves.toBe('America/Recife');
    },
  );

  it('keeps organization defaults for system jobs without a viewer', async () => {
    const { repository, tx } = fixture('America/Rio_Branco');
    await expect(repository.agendaTimezone('org')).resolves.toBe(
      'America/Manaus',
    );
    expect(tx.user.findFirst).not.toHaveBeenCalled();
  });

  it('uses the selected view day for range boundaries and forwards the viewer', async () => {
    const repository = {
      agendaTimezone: jest.fn().mockResolvedValue('America/Rio_Branco'),
      candidateEvents: jest.fn().mockResolvedValue([]),
    };
    const service = new SchedulingService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const result = await service.agenda(
      'org',
      {
        view: 'DAY',
        date: new Date('2026-10-24T00:00:00Z'),
        businessUnitId: 'unit',
      },
      'viewer',
    );
    expect(repository.agendaTimezone).toHaveBeenCalledWith(
      'org',
      'unit',
      'viewer',
    );
    expect(result.range).toMatchObject({
      timezone: 'America/Rio_Branco',
      from: '2026-10-24T05:00:00.000Z',
      to: '2026-10-25T05:00:00.000Z',
    });
  });

  it('refuses invalid timezone preferences on profile updates', async () => {
    const invalid = Object.assign(new UpdateProfileDto(), {
      timezone: 'invalid',
    });
    const errors = await validate(invalid);
    expect(
      errors.some(
        (error) =>
          error.property === 'timezone' &&
          Boolean(error.constraints?.isTimeZone),
      ),
    ).toBe(true);
    const valid = Object.assign(new UpdateProfileDto(), {
      timezone: 'America/Manaus',
    });
    expect(await validate(valid)).toEqual([]);
  });
});
