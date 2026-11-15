import {githubRelease} from './worker.mjs';

const origins = new Set(['https://juliendorra.com', 'https://www.juliendorra.com']);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/github-release') return new Response(null, {status: 404});
    if (request.method !== 'GET') return new Response(null, {status: 405, headers: {'Allow': 'GET'}});
    const origin = request.headers.get('Origin');
    if (origin && !origins.has(origin)) return new Response(null, {status: 403, headers: {'Vary': 'Origin'}});
    const release = await githubRelease(url.searchParams.get('url'));
    const response = new Response(release.body, release);
    response.headers.set('Vary', 'Origin');
    if (origin) response.headers.set('Access-Control-Allow-Origin', origin);
    return response;
  },
};
