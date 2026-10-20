import { addMonths, anchoredPeriod } from './anchored-period';

const iso = (value: string) => new Date(value);

describe('aritmética de período ancorado', () => {
  describe('aniversário em dias difíceis', () => {
    it.each([
      ['2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'],
      ['2026-01-28T00:00:00.000Z', '2026-02-28T00:00:00.000Z'],
      ['2026-01-29T00:00:00.000Z', '2026-02-28T00:00:00.000Z'],
      ['2026-01-30T00:00:00.000Z', '2026-02-28T00:00:00.000Z'],
      ['2026-01-31T00:00:00.000Z', '2026-02-28T00:00:00.000Z'],
    ])('de %s o mês seguinte cai em %s', (ancora, esperado) => {
      expect(addMonths(iso(ancora), 1).toISOString()).toBe(esperado);
    });

    it('ano bissexto tem 29 de fevereiro', () => {
      // 2028 é bissexto: o dia 29 existe e a âncora não precisa ser prendida.
      expect(addMonths(iso('2028-01-29T00:00:00.000Z'), 1).toISOString()).toBe(
        '2028-02-29T00:00:00.000Z',
      );
      expect(addMonths(iso('2028-01-31T00:00:00.000Z'), 1).toISOString()).toBe(
        '2028-02-29T00:00:00.000Z',
      );
    });

    it('o dia 31 volta a valer depois de um mês curto', () => {
      // Cada salto parte da âncora original: fevereiro prende, março solta.
      const ancora = iso('2026-01-31T09:00:00.000Z');
      expect(addMonths(ancora, 1).toISOString()).toBe(
        '2026-02-28T09:00:00.000Z',
      );
      expect(addMonths(ancora, 2).toISOString()).toBe(
        '2026-03-31T09:00:00.000Z',
      );
      expect(addMonths(ancora, 3).toISOString()).toBe(
        '2026-04-30T09:00:00.000Z',
      );
    });

    it('atravessa a virada do ano', () => {
      expect(addMonths(iso('2026-12-15T00:00:00.000Z'), 1).toISOString()).toBe(
        '2027-01-15T00:00:00.000Z',
      );
      expect(addMonths(iso('2026-09-15T00:00:00.000Z'), 12).toISOString()).toBe(
        '2027-09-15T00:00:00.000Z',
      );
    });
  });

  describe('períodos de cobrança', () => {
    const ancora = iso('2026-09-15T00:00:00.000Z');

    it('mensal vai de 15/09 a 15/10', () => {
      const periodo = anchoredPeriod(
        ancora,
        1,
        iso('2026-09-20T00:00:00.000Z'),
      );
      expect(periodo.start.toISOString()).toBe('2026-09-15T00:00:00.000Z');
      expect(periodo.end.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    });

    it('semestral vai de 15/09 a 15/03', () => {
      const periodo = anchoredPeriod(
        ancora,
        6,
        iso('2026-12-01T00:00:00.000Z'),
      );
      expect(periodo.start.toISOString()).toBe('2026-09-15T00:00:00.000Z');
      expect(periodo.end.toISOString()).toBe('2027-03-15T00:00:00.000Z');
    });

    it('anual vai de 15/09 a 15/09 do ano seguinte', () => {
      const periodo = anchoredPeriod(
        ancora,
        12,
        iso('2027-01-10T00:00:00.000Z'),
      );
      expect(periodo.start.toISOString()).toBe('2026-09-15T00:00:00.000Z');
      expect(periodo.end.toISOString()).toBe('2027-09-15T00:00:00.000Z');
    });

    it('o segundo período semestral começa onde o primeiro terminou', () => {
      const periodo = anchoredPeriod(
        ancora,
        6,
        iso('2027-05-01T00:00:00.000Z'),
      );
      expect(periodo.start.toISOString()).toBe('2027-03-15T00:00:00.000Z');
      expect(periodo.end.toISOString()).toBe('2027-09-15T00:00:00.000Z');
    });

    it('o fim é exclusivo: o instante do aniversário já é o período seguinte', () => {
      const periodo = anchoredPeriod(
        ancora,
        1,
        iso('2026-10-15T00:00:00.000Z'),
      );
      expect(periodo.start.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    });

    it('recusa período que não seja inteiro positivo de meses', () => {
      for (const meses of [0, -1, 1.5]) {
        expect(() => anchoredPeriod(ancora, meses, ancora)).toThrow();
      }
    });
  });

  describe('a cota é mensal em qualquer periodicidade', () => {
    const ancora = iso('2026-09-15T00:00:00.000Z');

    it.each([1, 6, 12])(
      'com cobrança de %s mês(es), a janela de uso continua de um mês',
      (mesesDeCobranca) => {
        const cobranca = anchoredPeriod(
          ancora,
          mesesDeCobranca,
          iso('2026-11-20T00:00:00.000Z'),
        );
        const uso = anchoredPeriod(ancora, 1, iso('2026-11-20T00:00:00.000Z'));
        expect(uso.start.toISOString()).toBe('2026-11-15T00:00:00.000Z');
        expect(uso.end.toISOString()).toBe('2026-12-15T00:00:00.000Z');
        expect(cobranca.end.getTime()).toBeGreaterThanOrEqual(
          uso.end.getTime(),
        );
      },
    );

    it('doze janelas mensais cabem num ano contratado', () => {
      const anual = anchoredPeriod(ancora, 12, ancora);
      const janelas = new Set<string>();
      for (let dia = 0; dia < 365; dia += 1) {
        const instante = new Date(ancora.getTime() + dia * 24 * 60 * 60_000);
        janelas.add(anchoredPeriod(ancora, 1, instante).start.toISOString());
      }
      expect(janelas.size).toBe(12);
      expect(anual.end.toISOString()).toBe('2027-09-15T00:00:00.000Z');
    });
  });
});
