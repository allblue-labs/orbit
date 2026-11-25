import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';
import { cacheControl, contentType, prefix } from '../cloudflare/static-assets.mjs';

const require = createRequire(new URL('../../../backend/ops/backup-node/package.json', import.meta.url));
const { HeadObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');

async function* list(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* list(path);
    else if (entry.isFile()) yield path;
    else throw new Error('unexpected_static_entry');
  }
}

async function publish() {
  const root = process.argv[2];
  const { ORBIT_STATIC_R2_ENDPOINT, ORBIT_STATIC_R2_ACCESS_KEY_ID, ORBIT_STATIC_R2_SECRET_ACCESS_KEY } = process.env;
  if (!/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(ORBIT_STATIC_R2_ENDPOINT ?? '') ||
      !ORBIT_STATIC_R2_ACCESS_KEY_ID || !ORBIT_STATIC_R2_SECRET_ACCESS_KEY)
    throw new Error('invalid_static_publisher_configuration');
  const client = new S3Client({
    endpoint: ORBIT_STATIC_R2_ENDPOINT,
    credentials: { accessKeyId: ORBIT_STATIC_R2_ACCESS_KEY_ID, secretAccessKey: ORBIT_STATIC_R2_SECRET_ACCESS_KEY },
    region: 'auto',
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  let published = 0;
  let reused = 0;
  const head = async (ref) => {
    try {
      return await client.send(new HeadObjectCommand(ref));
    } catch (error) {
      if (error.$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  };
  try {
    for await (const file of list(root)) {
      if (file.endsWith('.map')) continue;
      const path = prefix + relative(root, file).split(sep).join('/');
      const mime = contentType(path);
      if (!mime) throw new Error(`unexpected_asset_type: ${path}`);
      const bytes = await readFile(file);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const ref = { Bucket: 'orbit-web-static', Key: path.slice(1) };
      let existing = await head(ref);
      if (existing) reused++;
      else {
        try {
          await client.send(new PutObjectCommand({
            ...ref, Body: bytes, ContentType: mime, CacheControl: cacheControl,
            Metadata: { sha256 }, IfNoneMatch: '*',
          }));
        } catch (error) {
          // Concurrent publication can win the same immutable key.
          if (error.$metadata?.httpStatusCode !== 412) throw error;
        }
        existing = await head(ref);
        published++;
      }
      if (existing?.Metadata?.sha256 !== sha256 || existing.ContentLength !== bytes.length)
        throw new Error(`immutable_asset_verification_failed: ${path}`);
    }
    if (published + reused === 0) throw new Error('empty_static_release');
    console.log(JSON.stringify({ event: 'orbit_web_static_published', published, reused }));
  } finally {
    client.destroy();
  }
}

publish().catch((error) => {
  const detail = error instanceof Error && !('$metadata' in error) ? error.message : error.name;
  console.error(JSON.stringify({ event: 'orbit_web_static_publish_failed', detail }));
  process.exitCode = 1;
});
