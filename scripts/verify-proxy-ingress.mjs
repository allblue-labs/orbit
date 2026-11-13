/** Real production Nginx files, disposable TLS/proxy fixture. No live server,
 * database, real certificate or cloud credential is accessed. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { request } from 'node:https';
import assert from 'node:assert/strict';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'orbit-proxy-test-'));
const container = `orbit-proxy-test-${randomBytes(6).toString('hex')}`;
const secret = randomBytes(32).toString('hex');
const image = 'nginx@sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311';
let started = false;
try {
  await mkdir(join(directory, 'conf.d'));
  await mkdir(join(directory, 'ssl'));
  await writeFile(join(directory, 'nginx.conf'), 'events {}\nhttp { include /etc/nginx/conf.d/*.conf; }\n');
  await cp(resolve(root, 'deploy/staging/nginx/00-orbit-common.conf'), join(directory, 'conf.d/00-common.conf'));
  await cp(resolve(root, 'deploy/staging/nginx/orbit-tls.conf'), join(directory, 'conf.d/10-orbit.conf'));
  await cp(resolve(root, 'deploy/staging/nginx/proxy-common.inc'), join(directory, 'orbit-proxy.inc'));
  await writeFile(join(directory, 'cloudflare-realip.conf'), 'set_real_ip_from 127.0.0.1;\n');
  await writeFile(join(directory, 'orbit-proxy-secret.inc'), `proxy_set_header X-Orbit-Proxy-Secret "${secret}";\n`, { mode: 0o600 });
  await writeFile(join(directory, 'conf.d/20-fixture.conf'), `server {
    listen 127.0.0.1:7070; listen 127.0.0.1:6001;
    location / { default_type application/json;
      return 200 '{"ip":"$http_x_orbit_client_ip","secret":"$http_x_orbit_proxy_secret","xff":"$http_x_forwarded_for","cf":"$http_cf_connecting_ip","forwarded":"$http_forwarded"}'; }
  }\n`);
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=orbit.allblue-labs.com', '-keyout', join(directory, 'ssl/orbit-origin.key'), '-out', join(directory, 'ssl/orbit-origin.pem')]);
  await exec('docker', ['run', '--detach', '--rm', '--name', container, '--publish', '127.0.0.1::443',
    '--add-host', 'orbit.allblue-labs.com:127.0.0.1', '--mount', `type=bind,src=${directory},dst=/etc/nginx,readonly`,
    '--entrypoint', 'nginx', image, '-g', 'daemon off;']);
  started = true;
  const port = Number((await exec('docker', ['port', container, '443/tcp'])).stdout.trim().split(':').at(-1));
  const send = (path, headers = {}) => new Promise((accept, reject) => {
    const req = request({ hostname: '127.0.0.1', port, servername: 'orbit.allblue-labs.com', rejectUnauthorized: false,
      method: 'POST', path, headers: { host: 'orbit.allblue-labs.com', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => accept({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Local proxy timeout')));
    req.end();
  });
  for (let attempt = 0; ; attempt++) {
    try { await send('/ready'); break; }
    catch (error) { if (attempt >= 30) throw error; await new Promise((done) => setTimeout(done, 250)); }
  }
  await exec('docker', ['exec', container, 'nginx', '-t']);
  for (const path of ['/api/auth/login', '/api/v1/identity/login']) {
    const response = await send(path, { 'x-forwarded-for': '203.0.113.99', forwarded: 'for=203.0.113.99',
      'cf-connecting-ip': '203.0.113.99', 'x-orbit-client-ip': '203.0.113.99', 'x-orbit-proxy-secret': 'forged' });
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body);
    assert.notEqual(body.ip, '203.0.113.99');
    assert.equal(body.secret, secret);
    assert.equal(body.xff, body.ip);
    assert.equal(body.cf, '');
    assert.equal(body.forwarded, '');
  }
  const trusted = await exec('docker', ['exec', container, 'wget', '-q', '-T', '5', '--no-check-certificate',
    '--header', 'CF-Connecting-IP: 198.51.100.30', '--post-data={}', '-O', '-', 'https://orbit.allblue-labs.com/api/v1/identity/login']);
  assert.equal(JSON.parse(trusted.stdout).ip, '198.51.100.30');
  const burst = await Promise.all(Array.from({ length: 25 }, () => send('/api/v1/identity/login')));
  const blocked = burst.find((response) => response.status === 429);
  assert.ok(blocked);
  assert.equal(blocked.headers['retry-after'], '60');
  assert.equal(JSON.parse(blocked.body).error.code, 'RATE_LIMITED');
  assert.ok(blocked.headers['strict-transport-security']);
  process.stdout.write('Nginx ingress: syntax, untrusted spoofing, trusted edge and 429/Retry-After passed.\n');
} finally {
  if (started) await exec('docker', ['stop', '--timeout', '5', container]);
  await rm(directory, { recursive: true, force: true });
}
