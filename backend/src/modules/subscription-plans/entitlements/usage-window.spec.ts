import { monthlyWindow } from './usage-window';

const iso = (value: string) => new Date(value);

describe('janela mensal de uso', () => {
  it('começa na âncora, e não no dia 1º do calendário', () => {
    const janela = monthlyWindow(
      iso('2026-01-17T13:45:00.000Z'),
      iso('2026-02-02T08:00:00.000Z'),
    );
    expect(janela.start.toISOString()).toBe('2026-01-17T13:45:00.000Z');
    expect(janela.end.toISOString()).toBe('2026-02-17T13:45:00.000Z');
  });

  it('devolve a primeira janela quando o instante é a própria âncora', () => {
    const anchor = iso('2026-03-05T00:00:00.000Z');
    const janela = monthlyWindow(anchor, anchor);
    expect(janela.start.toISOString()).toBe(anchor.toISOString());
    expect(janela.end.toISOString()).toBe('2026-04-05T00:00:00.000Z');
  });

  it('trata o fim da janela como exclusivo', () => {
    const anchor = iso('2026-03-05T00:00:00.000Z');
    const janela = monthlyWindow(anchor, iso('2026-04-05T00:00:00.000Z'));
    expect(janela.start.toISOString()).toBe('2026-04-05T00:00:00.000Z');
  });

  it('prende o dia ao fim do mês curto sem derrapar depois', () => {
    // Âncora no dia 31: a janela de fevereiro fecha no dia 28, e a seguinte
    // volta ao dia 31 — porque cada janela é calculada da âncora original.
    // Somar de janela em janela prenderia o inquilino ao dia 28 para sempre.
    const anchor = iso('2026-01-31T09:00:00.000Z');
    const fevereiro = monthlyWindow(anchor, iso('2026-02-15T00:00:00.000Z'));
    expect(fevereiro.start.toISOString()).toBe('2026-01-31T09:00:00.000Z');
    expect(fevereiro.end.toISOString()).toBe('2026-02-28T09:00:00.000Z');

    const marco = monthlyWindow(anchor, iso('2026-03-20T00:00:00.000Z'));
    expect(marco.start.toISOString()).toBe('2026-02-28T09:00:00.000Z');
    expect(marco.end.toISOString()).toBe('2026-03-31T09:00:00.000Z');

    const abril = monthlyWindow(anchor, iso('2026-04-02T00:00:00.000Z'));
    expect(abril.start.toISOString()).toBe('2026-03-31T09:00:00.000Z');
  });

  it('atravessa a virada do ano', () => {
    const janela = monthlyWindow(
      iso('2025-12-10T00:00:00.000Z'),
      iso('2026-01-09T23:59:59.000Z'),
    );
    expect(janela.start.toISOString()).toBe('2025-12-10T00:00:00.000Z');
    expect(janela.end.toISOString()).toBe('2026-01-10T00:00:00.000Z');
  });

  it('a cota é mensal mesmo doze meses depois da âncora', () => {
    const anchor = iso('2026-01-17T00:00:00.000Z');
    const janela = monthlyWindow(anchor, iso('2027-01-20T00:00:00.000Z'));
    expect(janela.start.toISOString()).toBe('2027-01-17T00:00:00.000Z');
    expect(janela.end.toISOString()).toBe('2027-02-17T00:00:00.000Z');
  });
});
