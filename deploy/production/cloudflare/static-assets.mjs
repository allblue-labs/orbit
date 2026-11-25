export const prefix = '/_next/static/';
export const bucket = 'orbit-assets';
export const cacheControl = 'public, max-age=31536000, immutable';

const types = {
  js: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

export function contentType(path) {
  if (!path.startsWith(prefix)) return undefined;
  const key = path.slice(prefix.length);
  if (!/^(?:[a-zA-Z0-9_~.-]+\/)*[a-zA-Z0-9_~.-]+$/.test(key)) return undefined;
  if (key.split('/').some((segment) => segment.startsWith('.'))) return undefined;
  const extension = key.split('.').at(-1);
  return Object.hasOwn(types, extension) ? types[extension] : undefined;
}
