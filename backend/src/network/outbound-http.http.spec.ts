import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isPrivateRouteAddress } from './outbound-address';
import { outboundConfiguration } from './outbound.config';
import { OutboundPolicy } from './outbound-policy';
import { OutboundHttp } from './outbound-http';

/** Real TCP/TLS and actual policy. Only DNS and the synthetic test CA are injected.
 * The fixture binds a local RFC1918 interface, explicitly authorized as an
 * enterprise route; there is no production switch allowing loopback or test TLS.
 */
describe('OutboundHttp — real local TLS', () => {
  let directory: string;
  let server: https.Server;
  let url: string;
  let ip: string;
  let certificate: Buffer;
  const calls: {
    host: string;
    authorization: string | undefined;
    body: Buffer;
    path: string;
  }[] = [];
  let handle: (req: IncomingMessage, res: ServerResponse) => void;
  let dns: { resolve: jest.Mock };
  let client: OutboundHttp;
  beforeAll(async () => {
    ip =
      Object.values(networkInterfaces())
        .flat()
        .find(
          (a) =>
            a &&
            !a.internal &&
            a.family === 'IPv4' &&
            isPrivateRouteAddress(a.address),
        )?.address ?? '';
    if (!ip)
      throw new Error(
        'An RFC1918 interface is required for this real transport gate',
      );
    directory = mkdtempSync(join(tmpdir(), 'orbit-pr11-tls-'));
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(directory, 'key.pem'),
        '-out',
        join(directory, 'cert.pem'),
        '-subj',
        '/CN=provider.example.test',
        '-addext',
        'subjectAltName=DNS:provider.example.test',
        '-days',
        '1',
      ],
      { stdio: 'ignore' },
    );
    certificate = readFileSync(join(directory, 'cert.pem'));
    server = https.createServer(
      { key: readFileSync(join(directory, 'key.pem')), cert: certificate },
      (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          calls.push({
            host: req.headers.host ?? '',
            authorization: req.headers.authorization,
            body: Buffer.concat(chunks),
            path: req.url ?? '',
          });
          handle(req, res);
        });
      },
    );
    await new Promise<void>((resolve) => server.listen(0, ip, resolve));
    url = `https://provider.example.test:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });
  afterEach(() => jest.restoreAllMocks());
  beforeEach(() => {
    calls.length = 0;
    dns = {
      resolve: jest.fn().mockResolvedValue([{ address: ip, family: 4 }]),
    };
    const config = outboundConfiguration({
      OUTBOUND_AI_ORIGINS: '',
      OUTBOUND_AI_PRIVATE_ROUTES: JSON.stringify([
        { origin: url, addresses: [ip] },
      ]),
    });
    client = new OutboundHttp(new OutboundPolicy(config, dns));
    handle = (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    };
    const original = https.request;
    jest
      .spyOn(https, 'request')
      .mockImplementation(((
        options: https.RequestOptions,
        callback: (res: IncomingMessage) => void,
      ) =>
        original(
          { ...options, ca: certificate },
          callback,
        )) as typeof https.request);
  });
  const request = (path = '/v1', timeoutMs = 2000) =>
    client.request('AI', url + path, {
      headers: { authorization: 'Bearer synthetic-test-key' },
      body: Buffer.from('{"prompt":"test"}'),
      timeoutMs,
    });
  it('pins DNS IP, preserves TLS/Host name and sends exactly the intended bytes', async () => {
    expect((await request()).body.toString()).toBe('{"ok":true}');
    expect(calls).toEqual([
      {
        host: new URL(url).host,
        authorization: 'Bearer synthetic-test-key',
        body: Buffer.from('{"prompt":"test"}'),
        path: '/v1',
      },
    ]);
    expect(dns.resolve).toHaveBeenCalledTimes(1);
    expect(https.request).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: ip,
        servername: 'provider.example.test',
        agent: false,
        rejectUnauthorized: true,
      }),
      expect.any(Function),
    );
  });
  it('rejects a mixed DNS response before opening a socket', async () => {
    dns.resolve.mockResolvedValue([
      { address: ip, family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    await expect(request()).rejects.toThrow();
    expect(https.request).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
  it('never performs a second DNS lookup, and rejects a private/metadata rebind next time', async () => {
    dns.resolve
      .mockResolvedValueOnce([{ address: ip, family: 4 }])
      .mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await request();
    await expect(request()).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(https.request).toHaveBeenCalledTimes(1);
  });
  it.each([301, 302, 307, 308])(
    'does not follow redirect %s or forward credentials to the target',
    async (status) => {
      handle = (_req, res) => {
        res.writeHead(status, {
          Location: `https://${ip}:${(server.address() as AddressInfo).port}/credential-target`,
        });
        res.end();
      };
      await expect(request()).rejects.toThrow();
      expect(calls.map((c) => c.path)).toEqual(['/v1']);
    },
  );
  it('rejects an incorrect TLS identity without sending HTTP credentials/body', async () => {
    const different = url.replace(
      'provider.example.test',
      'wrong.example.test',
    );
    const config = outboundConfiguration({
      OUTBOUND_AI_PRIVATE_ROUTES: JSON.stringify([
        { origin: different, addresses: [ip] },
      ]),
    });
    const other = new OutboundHttp(new OutboundPolicy(config, dns));
    await expect(
      other.request('AI', different, {
        headers: { authorization: 'Bearer secret' },
        body: Buffer.from('private'),
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  it('enforces CA validation even if the process global TLS bypass is set', async () => {
    jest.restoreAllMocks();
    const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      await expect(request()).rejects.toThrow();
      expect(calls).toEqual([]);
    } finally {
      if (previous === undefined)
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
    }
  });
  it.each(['length', 'chunked', 'encoding', 'aborted', 'error'])(
    'rejects bounded/invalid response: %s',
    async (mode) => {
      handle = (_req, res) => {
        if (mode === 'length') {
          res.writeHead(200, { 'Content-Length': 1024 * 1024 + 1 });
          res.end();
        }
        if (mode === 'chunked') {
          res.writeHead(200);
          res.end(Buffer.alloc(1024 * 1024 + 1));
        }
        if (mode === 'encoding') {
          res.writeHead(200, { 'Content-Encoding': 'gzip' });
          res.end('compressed');
        }
        if (mode === 'aborted') {
          res.writeHead(200, { 'Content-Length': 200 });
          res.write('partial');
          res.destroy();
        }
        if (mode === 'error') {
          res.writeHead(500);
          res.end('secret upstream body');
        }
      };
      await expect(request()).rejects.toThrow(
        'Não foi possível concluir a comunicação',
      );
    },
  );
  it('enforces the total deadline even when the server keeps sending chunks', async () => {
    handle = (_req, res) => {
      res.writeHead(200);
      const timer = setInterval(() => res.write('x'), 10);
      res.on('close', () => clearInterval(timer));
    };
    const start = Date.now();
    await expect(request('/slow', 150)).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(1800);
    handle = (_req, res) => res.end('recovered');
    expect((await request()).body.toString()).toBe('recovered');
  });
  it('rejects excess concurrent operations, then recovers capacity', async () => {
    handle = (_req, res) => {
      res.writeHead(200);
      res.write('hold');
    };
    const pending = Array.from({ length: 16 }, () => request('/held', 150));
    const settled = Promise.allSettled(pending);
    await expect(request()).rejects.toThrow();
    await settled;
    handle = (_req, res) => res.end('available');
    expect((await request()).body.toString()).toBe('available');
  });
});
