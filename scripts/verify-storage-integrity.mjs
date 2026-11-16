import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { withIntegrationEnvironment, run, backend } from './lib/integration-environment.mjs';

// Official community distribution is source-only. Pin the release; never use a
// public R2 bucket, host app credentials or an optionally skipped emulator test.
const release = 'RELEASE.2025-10-15T17-29-55Z';
const directory = await mkdtemp(join(tmpdir(), 'orbit-pr09-minio-'));
let child;
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
try {
  const bin = process.env.ORBIT_MINIO_BIN || join(directory, 'bin', 'minio');
  if (!process.env.ORBIT_MINIO_BIN) {
    await mkdir(join(directory, 'bin'));
    execFileSync('go', ['install', `github.com/minio/minio@${release}`], {
      env: { ...process.env, GOBIN: join(directory, 'bin'), GOTOOLCHAIN: 'go1.26.3' },
      stdio: 'inherit',
    });
  }
  const buildInfo = execFileSync('go', ['version','-m',bin], {encoding:'utf8'});
  if (!buildInfo.includes('v0.0.0-20251015172955-9e49d5e7a648\th1:6TdolSCLSs2nwm8i0PpWDqf9iX2Ty9WQK8wmr7dCnUM=')) throw new Error('Pinned official MinIO source build required');
  const endpoint = `http://127.0.0.1:${await freePort()}`;
  const credentials = { accessKeyId: randomBytes(12).toString('hex'), secretAccessKey: randomBytes(24).toString('hex') };
  child = spawn(bin, ['server', join(directory, 'data'), '--address', new URL(endpoint).host, '--console-address', `127.0.0.1:${await freePort()}`], {
    env: { PATH: process.env.PATH, HOME: directory, MINIO_ROOT_USER: credentials.accessKeyId, MINIO_ROOT_PASSWORD: credentials.secretAccessKey, MINIO_BROWSER: 'off', MINIO_UPDATE: 'off' },
    stdio: 'ignore',
  });
  let startupError;
  child.on('error', error => { startupError = error; });
  for (let attempt = 0; ; attempt++) {
    if (startupError || child.exitCode !== null) throw new Error('Disposable MinIO failed to start');
    try { const response = await fetch(`${endpoint}/minio/health/live`, { signal: AbortSignal.timeout(500) }); if (response.ok) break; } catch { /* retry bounded startup */ }
    if (attempt >= 60) throw new Error('Disposable MinIO readiness timed out');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  console.log(JSON.stringify({ stage: 'storage-integrity', minioSourceRelease: release, realCloudAccess: false }));
  await withIntegrationEnvironment(async ({ env }) => {
    Object.assign(env, { ORBIT_MINIO_TEST_ENDPOINT: endpoint, ORBIT_MINIO_TEST_ACCESS_KEY: credentials.accessKeyId, ORBIT_MINIO_TEST_SECRET_KEY: credentials.secretAccessKey });
    await run('npm', ['run','test:e2e:jest','--','--runInBand','--watchman=false','--testPathPatterns=storage-integrity|mobile-evidence|avatar'], { cwd: backend, env });
  }, { postgresTmpfs: true });
} finally {
  if (child && child.exitCode === null && !child.killed) {
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await rm(directory, { recursive: true, force: true });
}
