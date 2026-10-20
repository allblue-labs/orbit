import {
  deriveRvtDueState,
  formatOccurrenceSequence,
  generateRvtOccurrences,
} from './rvt.domain';

describe('RVT V2 domain', () => {
  it('generates real weekly occurrences without a fake recurrence', () => {
    const values = generateRvtOccurrences({
      scheduleMode: 'RECURRING',
      cadence: { intervalDays: 7, intervalMonths: null },
      coverageStart: '2027-09-01',
      coverageEnd: '2027-09-30',
      timezone: 'America/Recife',
    });
    expect(values.map((x) => x.localDate)).toEqual([
      '2027-09-01',
      '2027-09-08',
      '2027-09-15',
      '2027-09-22',
      '2027-09-29',
    ]);
    expect(values.map((x) => x.sequenceNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it('normalizes one-time as exactly occurrence 001', () => {
    const values = generateRvtOccurrences({
      scheduleMode: 'ONE_TIME',
      cadence: { intervalDays: 7, intervalMonths: null },
      coverageStart: '2027-03-10',
      timezone: 'America/New_York',
    });
    expect(values).toHaveLength(1);
    expect(formatOccurrenceSequence(values[0]!.sequenceNumber)).toBe('001');
  });

  it('clamps semiannual calendar dates and preserves local time through DST', () => {
    const values = generateRvtOccurrences({
      scheduleMode: 'RECURRING',
      cadence: { intervalDays: null, intervalMonths: 6 },
      coverageStart: '2026-08-31',
      coverageEnd: '2027-08-31',
      timezone: 'America/New_York',
    });
    expect(values.map((x) => x.localDate)).toEqual([
      '2026-08-31',
      '2027-02-28',
      '2027-08-31',
    ]);
    expect(
      values.map((x) =>
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          hourCycle: 'h23',
        }).format(x.scheduledFor),
      ),
    ).toEqual(['09', '09', '09']);
  });

  it('derives due state in the authoritative timezone', () => {
    const now = new Date('2027-09-15T12:00:00Z');
    expect(
      deriveRvtDueState(
        new Date('2027-09-15T12:00:00Z'),
        'America/Recife',
        now,
      ),
    ).toBe('DUE_TODAY');
    expect(
      deriveRvtDueState(
        new Date('2027-09-14T12:00:00Z'),
        'America/Recife',
        now,
      ),
    ).toBe('OVERDUE');
  });
});

/**
 * Cadências novas, que o literal de dois valores não permitia.
 *
 * Trimestral é o caso que expõe a diferença entre somar meses e somar dias:
 * três meses a partir de 31 de janeiro cai em 30 de abril, e somar 90 dias
 * cairia em 1º de maio.
 */
describe('cadências além de semanal e semestral', () => {
  it('trimestral segue o calendário, e não noventa dias', () => {
    const ocorrencias = generateRvtOccurrences({
      scheduleMode: 'RECURRING',
      cadence: { intervalDays: null, intervalMonths: 3 },
      coverageStart: '2026-01-31',
      coverageEnd: '2026-12-31',
      timezone: 'America/Recife',
    });

    expect(ocorrencias.map((item) => item.localDate)).toEqual([
      '2026-01-31',
      '2026-04-30',
      '2026-07-31',
      '2026-10-31',
    ]);
  });

  it('mensal parte sempre do início, para não encolher o dia', () => {
    const ocorrencias = generateRvtOccurrences({
      scheduleMode: 'RECURRING',
      cadence: { intervalDays: null, intervalMonths: 1 },
      coverageStart: '2026-01-31',
      coverageEnd: '2026-05-31',
      timezone: 'America/Recife',
    });

    /**
     * 31 de março aparece — e é isso que prova a conta.
     *
     * Somando um mês de cada vez a partir do anterior, fevereiro prenderia a
     * série em 28 e todas as visitas seguintes cairiam no dia 28.
     */
    expect(ocorrencias.map((item) => item.localDate)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('uma cadência sem dias nem meses é recusada', () => {
    expect(() =>
      generateRvtOccurrences({
        scheduleMode: 'RECURRING',
        cadence: { intervalDays: null, intervalMonths: null },
        coverageStart: '2026-01-01',
        coverageEnd: '2026-12-31',
        timezone: 'America/Recife',
      }),
    ).toThrow(/day or a month interval/);
  });
});
