import { deviceLabelFrom } from './device-label';

describe('deviceLabelFrom', () => {
  it('prefere o nome que o aparelho mandou', () => {
    expect(deviceLabelFrom('  iPhone   da Ana ', 'x')).toBe('iPhone da Ana');
  });

  it('monta navegador e sistema pelo user-agent', () => {
    expect(
      deviceLabelFrom(
        undefined,
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      ),
    ).toBe('Safari no Mac');
    expect(
      deviceLabelFrom(
        undefined,
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0',
      ),
    ).toBe('Edge no Windows');
    expect(deviceLabelFrom('', undefined)).toBe('Este aparelho');
  });
});
