const packageLimit = 64 * 1024 * 1024;
const github = 'https://github.com';
const assetHosts = new Set([
  'https://release-assets.githubusercontent.com',
  'https://objects.githubusercontent.com',
]);
const releasePath = /^\/[^/]+\/[^/]+\/releases\/(?:download\/[^/]+|latest\/download)\/[^/]+\.chgame$/i;
const redirectCodes = new Set([301, 302, 303, 307, 308]);

function isRelease(url) {
  return url?.origin === github && !url.username && !url.password && releasePath.test(url.pathname);
}

export async function githubRelease(value, fetcher = fetch) {
  let url = URL.parse(value ?? '');
  if (!isRelease(url)) return new Response('Expected a GitHub .chgame release URL', {status: 400});
  url.search = '';
  url.hash = '';
  const signal = AbortSignal.timeout(25000);
  try {
    for (let redirects = 0; redirects < 5; redirects++) {
      const upstream = await fetcher(url, {redirect: 'manual', signal});
      if (redirectCodes.has(upstream.status)) {
        const next = upstream.headers.get('Location');
        const target = next && URL.parse(next, url);
        await upstream.body?.cancel();
        if (!target || target.username || target.password ||
            !(isRelease(target) || assetHosts.has(target.origin))) break;
        url = target;
        continue;
      }
      if (!upstream.ok || !upstream.body || !assetHosts.has(url.origin)) {
        await upstream.body?.cancel();
        return new Response('GitHub release asset unavailable', {status: upstream.status === 404 ? 404 : 502});
      }
      const length = Number(upstream.headers.get('Content-Length'));
      if (!Number.isSafeInteger(length) || length <= 0 || length > packageLimit) {
        await upstream.body.cancel();
        return new Response('Invalid GitHub release asset size', {status: length > packageLimit ? 413 : 502});
      }
      return new Response(upstream.body, {headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="cart.chgame"',
        'X-Content-Type-Options': 'nosniff',
      }});
    }
  } catch {
    return new Response('Could not reach GitHub releases', {status: 502});
  }
  return new Response('Unexpected GitHub release redirect', {status: 502});
}

export default {
  fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return new Response(null, {status: 405, headers: {'Allow': 'GET'}});
    if (url.pathname === '/api/github-release') return githubRelease(url.searchParams.get('url'));
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(page, {headers: {'Content-Type': 'text/html; charset=utf-8'}});
    }
    return new Response(null, {status: 404});
  },
};
