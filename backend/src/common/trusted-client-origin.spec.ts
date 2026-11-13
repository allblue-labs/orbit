import type { Request } from 'express';
import { normalizeClientIp, requestClientIp } from './trusted-client-origin';

describe('origem autenticada pelo proxy', () => {
  const previous = process.env.TRUSTED_PROXY_SECRET;
  beforeAll(() => {
    process.env.TRUSTED_PROXY_SECRET = 'a'.repeat(64);
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.TRUSTED_PROXY_SECRET;
    else process.env.TRUSTED_PROXY_SECRET = previous;
  });
  const request = (headers: Record<string, string>) =>
    ({ headers, socket: { remoteAddress: '::ffff:192.0.2.10' } }) as Request;
  it('não usa request.ip quando os metadados do transporte estão ausentes', () => {
    expect(requestClientIp({ ip: '203.0.113.99' } as Request)).toBe('0.0.0.0');
  });
  it('ignora chains, real-ip, Cloudflare e atestado sem credencial', () => {
    expect(
      requestClientIp(
        request({
          'x-forwarded-for': '203.0.113.1',
          forwarded: 'for=203.0.113.2',
          'x-real-ip': '203.0.113.3',
          'cf-connecting-ip': '203.0.113.4',
          'x-orbit-client-ip': '203.0.113.5',
        }),
      ),
    ).toBe('192.0.2.10');
    expect(
      requestClientIp(
        request({
          'x-orbit-client-ip': '203.0.113.5',
          'x-orbit-proxy-secret': 'b'.repeat(64),
        }),
      ),
    ).toBe('192.0.2.10');
  });
  it('aceita somente endereço único com credencial exata e normaliza IPv6', () => {
    expect(
      requestClientIp(
        request({
          'x-orbit-client-ip': '2001:0db8:0000::1',
          'x-orbit-proxy-secret': 'a'.repeat(64),
        }),
      ),
    ).toBe('2001:db8::1');
    expect(
      requestClientIp(
        request({
          'x-orbit-client-ip': '203.0.113.1, 203.0.113.2',
          'x-orbit-proxy-secret': 'a'.repeat(64),
        }),
      ),
    ).toBe('192.0.2.10');
  });
  it.each([
    'host.test',
    '127.1',
    ' 192.0.2.1',
    '192.0.2.1:443',
    'fe80::1%eth0',
  ])('recusa origem inválida %s', (value) => {
    expect(normalizeClientIp(value)).toBeNull();
  });
});
