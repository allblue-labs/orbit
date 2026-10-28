import { schedulesAreClose } from './operation-schedule.service';
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
