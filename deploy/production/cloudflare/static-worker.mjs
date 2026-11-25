import { cacheControl, contentType } from './static-assets.mjs';

async function origin(url, request) {
  // The input URL is the same fixed production host on a Worker Route.
  // Forward only the static pathname and HTTP method to the existing origin.
  const headers = new Headers();
  for (const name of ['range', 'if-range', 'if-none-match', 'if-modified-since']) {
    if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  }
  const response = await fetch(new Request(url, { method: request.method, headers }), {
    redirect: 'manual',
    cache: 'no-store',
  });
  const result = new Response(response.body, response);
  result.headers.set('Cache-Control', 'no-store');
  result.headers.set('X-Orbit-Static-Source', 'origin');
  result.headers.delete('Set-Cookie');
  return result;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || url.host !== env.ORBIT_PRODUCTION_HOST)
      return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
    const mimeType = contentType(url.pathname);
    // Keep maps, dynamic paths and alternate encodings outside the edge bucket.
    if (!mimeType)
      return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });

    url.search = '';
    const cacheKey = new Request(`${url.href}?__orbit_static=r2-v1`);
    let cached;
    try {
      cached = await caches.default.match(cacheKey);
    } catch {
      // The object store can still serve when the edge cache is unavailable.
    }
    if (cached) {
      const response = new Response(request.method === 'HEAD' ? null : cached.body, cached);
      response.headers.set('X-Orbit-Static-Source', 'edge');
      return response;
    }

    try {
      const key = url.pathname.slice(1);
      const object = request.method === 'HEAD'
        ? await env.ORBIT_WEB_STATIC.head(key)
        : await env.ORBIT_WEB_STATIC.get(key);
      if (object) {
        const response = new Response(object.body ?? null, {
          headers: {
            'Content-Type': mimeType,
            'Content-Length': String(object.size),
            'Cache-Control': cacheControl,
            'ETag': object.httpEtag,
            'X-Content-Type-Options': 'nosniff',
            'X-Orbit-Static-Source': 'r2',
          },
        });
        if (request.method === 'GET')
          ctx.waitUntil(caches.default.put(cacheKey, response.clone()).catch(() => undefined));
        return response;
      }
    } catch {
      // A missing object or unavailable R2 falls back to the same Next.js release.
    }
    return origin(url, request);
  },
};
