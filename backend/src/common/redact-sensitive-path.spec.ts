import { redactSensitivePath } from './redact-sensitive-path';

describe('redactSensitivePath', () => {
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
