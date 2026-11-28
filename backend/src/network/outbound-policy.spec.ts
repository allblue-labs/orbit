import {
  isPrivateRouteAddress,
  isPublicOutboundAddress,
  sameAddress,
} from './outbound-address';
import { outboundConfiguration } from './outbound.config';
import { OutboundPolicy } from './outbound-policy';

const public4 = '93.184.216.34';
const public6 = '2606:4700:4700::1111';
describe('OutboundPolicy — no network', () => {
  const dns = { resolve: jest.fn() };
  const config = () =>
    outboundConfiguration({
      OUTBOUND_AI_ORIGINS: 'https://ai.example.test',
      OUTBOUND_WEB_PUSH_ORIGINS: 'https://push.example.test',
    });
  const policy = () => new OutboundPolicy(config(), dns);
  beforeEach(() => {
    jest.resetAllMocks();
    dns.resolve.mockResolvedValue([{ address: public4, family: 4 }]);
  });
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '168.63.129.16',
    'fd00:ec2::254',
    'fd20:ce::254',
    '172.16.0.1',
    '192.168.1.1',
    '192.0.0.1',
    '192.0.2.2',
    '192.88.99.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '2002:7f00:1::',
    '2001::1',
    '2001:20::1',
    '64:ff9b::a9fe:a9fe',
    '3fff::1',
  ])('blocks non-public address %s', (ip) =>
    expect(isPublicOutboundAddress(ip)).toBe(false),
  );
  it.each([public4, public6])('accepts globally routable address %s', (ip) =>
    expect(isPublicOutboundAddress(ip)).toBe(true),
  );
  it.each([
    'http://ai.example.test',
    'https://user:pass@ai.example.test',
    'https://ai.example.test/#token',
    'https://ai.example.test/?token=secret',
    'https://ai.example.test:8443',
    'https://ai.example.test.attacker.test',
    'https://ai.example.test.',
    'https://ai.example.test@attacker.test',
    'https://ai.example.test\\@attacker.test',
    'https://ai.example.test\n',
    'https://127.0.0.1',
    'https://2130706433',
    'https://0x7f000001',
    'https://0177.0.0.1',
    'https://[::1]',
    'https://[::ffff:127.0.0.1]',
  ])('rejects unsafe/unlisted URL before DNS: %s', async (value) => {
    await expect(policy().authorize('AI', value)).rejects.toThrow();
    expect(dns.resolve).not.toHaveBeenCalled();
  });
  it('verifies every A/AAAA record, including mixed public/private results', async () => {
    dns.resolve.mockResolvedValue([
      { address: public4, family: 4 },
      { address: '::1', family: 6 },
    ]);
    await expect(
      policy().authorize('AI', 'https://ai.example.test/v1'),
    ).rejects.toMatchObject({ reason: 'DNS_DENIED' });
  });
  it('pins a public address, checks DNS again on every call and denies rebinding', async () => {
    const current = policy();
    expect(
      await current.authorize('AI', 'https://ai.example.test/v1'),
    ).toMatchObject({ address: { address: public4, family: 4 } });
    dns.resolve.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(
      current.authorize('AI', 'https://ai.example.test/v1'),
    ).rejects.toMatchObject({ reason: 'DNS_DENIED' });
    expect(dns.resolve).toHaveBeenCalledTimes(2);
  });
  it.each([
    { addresses: [] },
    { addresses: [{ address: public6, family: 4 }] },
  ])(
    'fails closed on empty or inconsistent DNS records',
    async ({ addresses }) => {
      dns.resolve.mockResolvedValue(addresses);
      await expect(
        policy().authorize('AI', 'https://ai.example.test'),
      ).rejects.toThrow();
    },
  );
  it('sanitizes DNS errors instead of exposing the endpoint', async () => {
    dns.resolve.mockRejectedValue(
      new Error('credential-bearing resolver error'),
    );
    await expect(
      policy().authorize('WEB_PUSH', 'https://push.example.test/token-secret'),
    ).rejects.toMatchObject({ reason: 'DNS_UNAVAILABLE' });
  });
  it('permits only the deployment-approved private origin, port and exact IP for AI', async () => {
    const conf = outboundConfiguration({
      OUTBOUND_AI_ORIGINS: '',
      OUTBOUND_WEB_PUSH_ORIGINS: '',
      OUTBOUND_AI_PRIVATE_ROUTES: JSON.stringify([
        { origin: 'https://model.internal:8443', addresses: ['10.42.0.10'] },
      ]),
    });
    const privatePolicy = new OutboundPolicy(conf, dns);
    dns.resolve.mockResolvedValue([{ address: '10.42.0.10', family: 4 }]);
    await expect(
      privatePolicy.authorize('AI', 'https://model.internal:8443/v1'),
    ).resolves.toMatchObject({ address: { address: '10.42.0.10' } });
    await expect(
      privatePolicy.authorize('WEB_PUSH', 'https://model.internal:8443/token'),
    ).rejects.toThrow();
    dns.resolve.mockResolvedValue([{ address: '10.42.0.11', family: 4 }]);
    await expect(
      privatePolicy.authorize('AI', 'https://model.internal:8443/v1'),
    ).rejects.toThrow();
  });
  it.each([
    '127.0.0.1',
    '169.254.169.254',
    '168.63.129.16',
    'fd00:ec2::254',
    'fd20:ce::254',
    '100.100.100.200',
    '::1',
    '::ffff:10.0.0.1',
    '::ffff:a00:1',
    'fe80::1',
    public4,
  ])(
    'cannot opt in dangerous/private-mapped address %s through deployment config',
    (ip) => {
      expect(isPrivateRouteAddress(ip)).toBe(false);
      expect(() =>
        outboundConfiguration({
          OUTBOUND_AI_PRIVATE_ROUTES: JSON.stringify([
            { origin: 'https://model.internal', addresses: [ip] },
          ]),
        }),
      ).toThrow();
    },
  );
  it.each([
    'https://*.example.test',
    'http://ai.example.test',
    'https://a:b@ai.example.test',
    'https://ai.example.test/path',
    'https://ai.example.test:8443',
  ])('rejects malformed deployment origin %s', (value) => {
    expect(() =>
      outboundConfiguration({ OUTBOUND_AI_ORIGINS: value }),
    ).toThrow();
  });
  it('compares canonical IPv6 and IPv4-mapped peers without accepting another IP', () => {
    expect(sameAddress(public4, `::ffff:${public4}`)).toBe(true);
    expect(sameAddress('fd00::1', 'fd00:0:0:0:0:0:0:1')).toBe(true);
    expect(sameAddress(public4, '127.0.0.1')).toBe(false);
  });
  it('allows cache purge only on the fixed Cloudflare origin with public DNS', async () => {
    await expect(
      policy().authorize(
        'CACHE_PURGE',
        'https://api.cloudflare.com/client/v4/zones/id/purge_cache',
      ),
    ).resolves.toBeDefined();
    await expect(
      policy().authorize('CACHE_PURGE', 'https://push.example.test/'),
    ).rejects.toThrow();
    dns.resolve.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(
      policy().authorize(
        'CACHE_PURGE',
        'https://api.cloudflare.com/client/v4/zones/id/purge_cache',
      ),
    ).rejects.toThrow();
  });
});
