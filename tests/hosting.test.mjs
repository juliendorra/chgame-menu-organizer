import assert from 'node:assert/strict';
import test from 'node:test';
import {githubRelease} from '../hosting/worker.mjs';
import relay from '../hosting/cloudflare.mjs';

test('release relay streams GitHub assets and restricts redirect targets', async () => {
  const release = 'https://github.com/example/carts/releases/download/v1/cart.chgame';
  const asset = 'https://release-assets.githubusercontent.com/cart?signature=test';
  const requests = [];
  const result = await githubRelease(release, async (url, options) => {
    requests.push(url.href);
    assert.equal(options.redirect, 'manual');
    return url.href === release
      ? Response.redirect(asset)
      : new Response('cart', {headers: {'Content-Length': '4'}});
  });
  assert.deepEqual(requests, [release, asset]);
  assert.equal(result.headers.get('Content-Type'), 'application/octet-stream');
  assert.equal(await result.text(), 'cart');

  const blocked = await githubRelease(release, async url => {
    assert.equal(url.href, release);
    return Response.redirect('https://example.com/cart.chgame');
  });
  assert.equal(blocked.status, 502);
  const invalid = await githubRelease('https://example.com/cart.chgame', () => assert.fail());
  assert.equal(invalid.status, 400);
});

test('the Cloudflare relay gives the OVH page cross-origin access', async () => {
  const endpoint = 'https://relay.example/api/github-release';
  const origin = 'https://juliendorra.com';
  const result = await relay.fetch(new Request(endpoint, {headers: {'Origin': origin}}));
  assert.equal(result.status, 400);
  assert.equal(result.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(result.headers.get('Vary'), 'Origin');

  const denied = await relay.fetch(new Request(endpoint, {headers: {'Origin': 'https://unrelated.example'}}));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
});
