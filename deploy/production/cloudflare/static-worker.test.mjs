import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import worker from './static-worker.mjs';

const host = 'orbit.example.test';
const asset = `https://${host}/_next/static/chunks/build.js`;
const previous = { fetch: globalThis.fetch, caches: globalThis.caches };
const environment = (bucket) => ({ ORBIT_PRODUCTION_HOST: host, ORBIT_WEB_STATIC: bucket });
const object = { size: 2, httpEtag: '"hash"', body: 'JS' };

beforeEach(() => {
  globalThis.fetch = () => assert.fail('Unexpected origin request');
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
});
afterEach(() => {
  globalThis.fetch = previous.fetch;
  globalThis.caches = previous.caches;
});

test('serves R2 and then the edge cache without touching the origin', async () => {
  let cached;
  let published;
  let reads = 0;
  globalThis.caches.default = {
    match: async (key) => {
      assert.equal(key.url, `${asset}?__orbit_static=r2-v1`);
      return cached?.clone();
    },
    put: async (_key, response) => { cached = response; },
  };
  const env = environment({ get: async (key) => {
    reads++;
    assert.equal(key, '_next/static/chunks/build.js');
    return object;
  } });
  const initial = await worker.fetch(new Request(asset), env, {
    waitUntil(operation) { published = operation; },
  });
  await published;
  assert.equal(initial.headers.get('X-Orbit-Static-Source'), 'r2');
  assert.match(initial.headers.get('Cache-Control'), /immutable/);
  assert.equal(await initial.text(), 'JS');
  const hit = await worker.fetch(new Request(`${asset}?ignored=123`), env);
  assert.equal(hit.headers.get('X-Orbit-Static-Source'), 'edge');
  assert.equal(await hit.text(), 'JS');
  assert.equal(reads, 1);
});

test('HEAD loads metadata without opening the object body', async () => {
  const response = await worker.fetch(new Request(asset, { method: 'HEAD' }), environment({
    head: async () => ({ size: object.size, httpEtag: object.httpEtag }),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.equal(response.headers.get('Content-Length'), '2');
});

test('a missing or unavailable R2 object falls back without credentials or shared caching', async () => {
  for (const get of [async () => null, async () => { throw new Error('offline'); }]) {
    globalThis.fetch = async (request) => {
      assert.equal(request.url, asset);
      assert.equal(request.headers.get('Authorization'), null);
      assert.equal(request.headers.get('Cookie'), null);
      return new Response('fallback', { headers: { 'Set-Cookie': 'unused=1' } });
    };
    const response = await worker.fetch(new Request(`${asset}?token=ignored`, {
      headers: { Authorization: 'Bearer fixture', Cookie: 'session=fixture' },
    }), environment({ get }));
    assert.equal(response.headers.get('X-Orbit-Static-Source'), 'origin');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(await response.text(), 'fallback');
  }
});

test('rejects outside origins, dynamic paths, private extensions and mutations', async () => {
  const env = environment({});
  for (const request of [
    new Request(asset, { method: 'POST' }),
    new Request(asset.replace(host, 'staging.example.test')),
    new Request(`https://${host}/api/orbit/storage/objects`),
    new Request(`${asset}.map`),
  ]) {
    const response = await worker.fetch(request, env);
    assert.equal(response.status, request.method === 'POST' ? 405 : 404);
  }
});
