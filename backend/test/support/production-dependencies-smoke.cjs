/** Run via stdin inside the production image; no database or external network. */
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { gzipSync } = require('node:zlib');
const load = createRequire('/app/package.json');
const sharp = load('sharp');
const argon2 = load('argon2');
const qrcode = load('qrcode');
const { NestFactory } = load('@nestjs/core');
const { Module, Controller, Post, Get, Body, Req } = load('@nestjs/common');
const { configureHttpParsers } = load(
  '/app/dist/src/configure-http-parsers.js',
);

class ProbeController {
  json(body, req) {
    return { body, raw: req.rawBody.toString('base64') };
  }
  health() {
    return { ok: true };
  }
}
Controller('probe')(ProbeController);
Post('json')(
  ProbeController.prototype,
  'json',
  Object.getOwnPropertyDescriptor(ProbeController.prototype, 'json'),
);
Body()(ProbeController.prototype, 'json', 0);
Req()(ProbeController.prototype, 'json', 1);
Get('health')(
  ProbeController.prototype,
  'health',
  Object.getOwnPropertyDescriptor(ProbeController.prototype, 'health'),
);
class ProbeModule {}
Module({ controllers: [ProbeController] })(ProbeModule);

(async () => {
  assert.equal(process.versions.node.split('.')[0], '22');
  assert.notEqual(process.getuid(), 0);
  load('firebase-admin/app');
  load('firebase-admin/messaging');
  load('@aws-sdk/client-sesv2');
  const hash = await argon2.hash('Synthetic native runtime probe only');
  assert.equal(
    await argon2.verify(hash, 'Synthetic native runtime probe only'),
    true,
  );
  const svg = await qrcode.toString('orbit-pr01-runtime-probe', {
    type: 'svg',
  });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const image = await sharp(png).metadata();
  assert.equal(image.format, 'png');
  assert.ok(image.width > 0);
  const app = await NestFactory.create(ProbeModule, {
    logger: false,
    rawBody: true,
    bodyParser: false,
  });
  try {
    configureHttpParsers(app);
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const raw = Buffer.from('{ "event": "probe" }');
    let res = await fetch(`${base}/probe/json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), {
      body: { event: 'probe' },
      raw: raw.toString('base64'),
    });
    res = await fetch(`${base}/probe/json`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      body: Buffer.concat([gzipSync(raw), Buffer.from('junk')]),
    });
    assert.equal(res.status, 400);
    await res.arrayBuffer();
    res = await fetch(`${base}/probe/health`);
    assert.equal(res.status, 200);
    await res.arrayBuffer();
    console.log(
      JSON.stringify({
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        uid: process.getuid(),
        sharp: sharp.versions.sharp,
        vips: sharp.versions.vips,
        rsvg: sharp.versions.rsvg,
        nativeImageRoundTrip: true,
        argon2RoundTrip: true,
        firebaseAndSesModulesLoaded: true,
        exactRawBody: true,
        malformedGzipRejected: true,
        healthyAfterMalformedRequest: true,
      }),
    );
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
