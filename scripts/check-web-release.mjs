/** Somente GET público; não lê envs, cookies ou credenciais. */
const [origin, expectedCommit] = process.argv.slice(2);
const FLOW = 'checkout-required-v2';

async function read(url) {
  const response = await fetch(url, {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(20000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${url.pathname}`);
  return response.text();
}

async function main() {
  if (!origin) throw new Error('Uso: node scripts/check-web-release.mjs https://orbit.exemplo.com [commit esperado]');
  const base = new URL(origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Origem HTTP(S) inválida.');
  let release = null;
  try {
    release = JSON.parse(await read(new URL(`/api/release?check=${Date.now()}`, base)));
  } catch {
    console.log('A versão pública não apresentou identificação de release do frontend.');
  }
  const html = await read(new URL(`/cadastro?plano=PROFESSIONAL&releaseCheck=${Date.now()}`, base));
  const paths = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]))];
  const urls = paths.map((path) => new URL(path, base)).filter((url) =>
    url.origin === base.origin && url.pathname.startsWith('/_next/static/') && url.pathname.endsWith('.js'));
  if (urls.length === 0 || urls.length > 60) throw new Error('Não foi possível identificar os scripts do cadastro.');
  let source = '';
  for (let index = 0; index < urls.length; index += 4) {
    source += (await Promise.all(urls.slice(index, index + 4).map(read))).join('\n');
  }
  const checkout = source.includes('/billing/checkout-session') && source.includes('PENDING_PAYMENT') && source.includes('cadastro=concluido');
  console.log(`Checkout após cadastro no JavaScript publicado: ${checkout ? 'PRESENTE' : 'AUSENTE'}`);
  if (release) {
    console.log(`Frontend: ${release.commit}; fluxo: ${release.billingFlow}`);
  }
  let api = null;
  try {
    const payload = JSON.parse(await read(new URL(`/api/v1/release?check=${Date.now()}`, base)));
    api = payload.data ?? payload;
    console.log(`API: ${api.commit}; fluxo: ${api.billingFlow}`);
  } catch { console.log('A API pública não apresentou identificação de release.'); }
  if (!checkout || release?.billingFlow !== FLOW || api?.billingFlow !== FLOW ||
      (expectedCommit && (release.commit !== expectedCommit || api.commit !== expectedCommit))) {
    throw new Error('A publicação não confirmou frontend e API com o fluxo de pagamento esperado. Confira imagens, containers e cache do proxy/CDN.');
  }
  console.log('Release público conferido. Nenhuma conta ou cobrança foi criada.');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
