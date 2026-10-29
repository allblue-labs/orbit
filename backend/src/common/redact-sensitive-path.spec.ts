import { redactSensitivePath } from './redact-sensitive-path';

describe('redactSensitivePath', () => {
  it.each(['public/quotes/proposals', 'public/pmoc/contracts'])(
    'oculta os tokens de %s inclusive nos comandos e downloads',
    (route) => {
      for (const suffix of ['', '/document', '/response', '/signature']) {
        expect(
          redactSensitivePath(
            `/api/v1/${route}/secret-token${suffix}?signature=secret`,
          ),
        ).toBe(`/api/v1/${route}/[REDACTED]${suffix}`);
      }
    },
  );
  it('never leaves Equipment QR tokens in logged paths', () => {
    expect(
      redactSensitivePath(
        '/api/v1/assets/qr/J-lPksxO7KEn-uRHsMEgzVguRU3IUqYkZSjCRHcJgbA?x=1',
      ),
    ).toBe('/api/v1/assets/qr/[REDACTED]');
  });

  it('never logs query strings carrying signed capabilities', () => {
    expect(
      redactSensitivePath(
        '/api/v1/mobile/field/me/signature/preview?expires=123&signature=secret',
      ),
    ).toBe('/api/v1/mobile/field/me/signature/preview');
  });
});
