import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {ascii, crc32, frame, Frames, grantedCHGame, installHelper, join, Link, SerialCard, view, word} from '../src/serial.mjs';
import {organizeFolder} from '../src/menu.mjs';
import {linkedPackageUrl, packageSourceUrl, prepareLinkedPackage, preparePackage} from '../src/import.mjs';
import {coverStyle, encodeCover} from '../src/cover.mjs';

const vectors = JSON.parse(readFileSync(new URL('./fixtures/vectors.json', import.meta.url)));

test('cart source links accept absolute external HTTPS destinations', () => {
  const page = new URL('https://juliendorra.com/chgame-menu-organizer/');
  assert.equal(packageSourceUrl('https://github.com/example/game', page)?.href, 'https://github.com/example/game');
  for (const value of ['', '/path', '//other.example/path', 'javascript:', 'data:text/html,hello',
    'https://github.com@other.example/path', 'https://www.juliendorra.com/politicayab/']) {
    assert.equal(packageSourceUrl(value, page), null, value);
  }
});

test('bootloader vectors and serial framing across USB packet boundaries', () => {
  const parser = new Frames();
  const observed = [];
  const emit = (protocol, command, payload) => observed.push([protocol, command, Buffer.from(payload).toString('hex')]);
  for (const {cmd, payload, frame: expected} of vectors.frames) {
    const bytes = frame('CG', cmd, Buffer.from(payload, 'hex'));
    assert.equal(Buffer.from(bytes).toString('hex'), expected);
    parser.feed(join(Uint8Array.of(67, 23), bytes.subarray(0, 2)), emit);
    for (let at = 2; at < bytes.length; at += 13) parser.feed(bytes.subarray(at, at + 13), emit);
  }
  assert.deepEqual(observed, vectors.frames.map(({cmd, payload}) => ['CG', cmd, payload]));
  assert.equal(crc32(ascii('123456789')), 0xcbf43926);
});

test('helper responses match their request ID after delay or duplicate reply', async () => {
  let receiver;
  const parser = new Frames();
  let requests = 0;
  const port = {
    async open() {},
    async close() {},
    async setSignals() {},
    readable: new ReadableStream({start(controller) { receiver = controller; }}),
    writable: new WritableStream({
      write(bytes) {
        parser.feed(bytes, (protocol, command, payload) => {
          const id = payload.subarray(0, 4);
          requests++;
          // The first command times out once. The retry must keep its ID.
          if (requests === 1) return;
          if (requests === 2) assert.deepEqual(bytes, first);
          receiver.enqueue(frame(protocol, command | 128, join(new Uint8Array(4), Uint8Array.of(0), ascii('wrong'))));
          receiver.enqueue(frame(protocol, command | 128, join(id, Uint8Array.of(0), ascii('SDtoSerial/1'))));
        });
        first ??= bytes;
      },
    }),
  };
  let first;
  const link = await Link.open(port);
  try {
    const card = new SerialCard(link);
    assert.equal(Buffer.from(await card.call(16, undefined, 20)).toString(), 'SDtoSerial/1');
    assert.equal(requests, 2);
  } finally {
    await link.close();
  }
});

test('USB reset can replace the preferred browser port without making two granted consoles ambiguous', async () => {
  const getInfo = () => ({usbVendorId: 0x16c0, usbProductId: 0x27dd});
  const previous = {getInfo, connected: false};
  const next = {getInfo, connected: true};
  let ports = [previous, next];
  const serial = {async getPorts() { return ports; }};
  assert.equal(await grantedCHGame(serial, previous), next);
  ports = [previous, next, {getInfo, connected: true}];
  assert.equal(await grantedCHGame(serial, previous), null);
  previous.connected = true;
  assert.equal(await grantedCHGame(serial, previous), previous);
});

test('bootloader upload uses sequential pages and reconnects to the SD helper', async () => {
  const written = [];
  const image = Uint8Array.from({length: 294}, (_, i) => i % 251);
  const padded = join(image, Uint8Array.of(255, 255));
  const info = Buffer.alloc(30);
  info[1] = 1;
  info[2] = 1;
  info.writeUInt16LE(3, 4);
  info.writeUInt32LE(0x3000, 6);
  info.writeUInt32LE(50944, 10);
  info.writeUInt16LE(256, 14);
  info.writeUInt16LE(512, 16);
  let running = false;
  const port = {
    getInfo() { return {usbVendorId: 0x16c0, usbProductId: 0x27dd}; },
    async setSignals() {},
    async close() {},
    async open({baudRate}) {
      assert.equal(baudRate, 115200);
      let receiver;
      this.readable = new ReadableStream({start(controller) { receiver = controller; }});
      const parser = new Frames();
      this.writable = new WritableStream({write(bytes) {
        parser.feed(bytes, (protocol, command, payload) => {
          if (protocol === 'CG') {
            assert.equal(running, false);
            if (command === 2) assert.deepEqual(payload, join(word(padded.length), word(crc32(padded))));
            if (command === 3) {
              const offset = view(payload).getUint32(0, true);
              assert.equal(offset, written.length * 256);
              written.push(payload.subarray(4));
            }
            if (command === 4) assert.deepEqual(join(...written), padded);
            if (command === 5) running = true;
            receiver.enqueue(frame(protocol, command | 128, command === 1 ? info : Uint8Array.of(0)));
          } else {
            assert.equal(running, true);
            const hello = new Uint8Array(14);
            hello.set([1, 0]);
            view(hello).setUint16(10, 512, true);
            const responses = {1: hello, 13: Uint8Array.of(1, 1, 224, 1), 16: ascii('SDtoSerial/1')};
            receiver.enqueue(frame(protocol, command | 128, join(payload.subarray(0, 4), Uint8Array.of(0), responses[command])));
          }
        });
      }});
    },
  };
  const serial = {async getPorts() { return [port]; }};
  const progress = [];
  const card = await installHelper(serial, await Link.open(port), image, (done, total) => progress.push([done, total]));
  try {
    assert.deepEqual(progress, [[256, 296], [296, 296]]);
    assert.equal(card.maxRead, 480);
  } finally {
    await card.link.close();
  }
});

const generatedCover = () => {
  const pixels = new Uint8ClampedArray(128 * 128 * 4);
  pixels.set([255, 0, 0, 255], 4);
  return encodeCover(pixels, [[0, 0, 0], [255, 0, 0]]);
};

test('cover shuffling changes font and colors and encodes CHB1 pixel pairs', () => {
  const previous = coverStyle();
  const next = coverStyle(previous);
  assert.notEqual(next.font, previous.font);
  assert.notEqual(next.palette, previous.palette);
  const cover = generatedCover();
  assert.equal(cover.length, 8704);
  assert.equal(Buffer.from(cover.subarray(0, 4)).toString(), 'CHB1');
  assert.equal(view(cover).getUint16(10, true), 0xf800);
  assert.equal(cover[512], 1);
});

test('auto organize restores the draft order from before the first sort', () => {
  const [c, a, b] = [{title: 'C', modified: 9}, {title: 'A', modified: 0}, {title: 'B', modified: 10}];
  const folder = {entries: [c, a, b]};
  organizeFolder(folder, 'alphabetical');
  assert.deepEqual(folder.entries, [a, b, c]);
  organizeFolder(folder, 'newest');
  assert.deepEqual(folder.entries, [b, c, a]);
  organizeFolder(folder, 'restore');
  assert.deepEqual(folder.entries, [c, a, b]);
});

test('linked imports prefer the fragment and prepare an HTTPS cart without credentials', async () => {
  const url = 'https://example.com/cart.chgame?version=1&release=2';
  const encoded = encodeURIComponent(url);
  assert.equal(linkedPackageUrl(`file:///organizer.html?import=https://other.example/cart#${'import=' + encoded}`).href, url);
  assert.equal(linkedPackageUrl(`https://example.com/organizer.html?import=${encoded}`).href, url);
  assert.equal(linkedPackageUrl('file:///organizer.html'), null);
  assert.throws(() => linkedPackageUrl('file:///organizer.html#import=http://example.com/cart'), /HTTPS/);
  assert.throws(() => linkedPackageUrl('file:///organizer.html#import=https://user:pass@example.com/cart'), /credentials/);

  const bytes = readFileSync(new URL('./fixtures/single.chgame', import.meta.url));
  const remote = await prepareLinkedPackage(new URL(url), async (requested, options) => {
    assert.equal(requested.href, url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    return new Response(bytes);
  });
  assert.deepEqual(remote, await preparePackage(new File([bytes], 'single.chgame')));
});

test('latest GitHub links resolve the current versioned cart through the relay', async () => {
  const latest = new URL('https://github.com/example/carts/releases/latest');
  const endpoint = new URL('https://organizer.example/api/github-release');
  const fixture = readFileSync(new URL('./fixtures/single.chgame', import.meta.url));
  const fetchVersion = tag => async url => {
    const name = `Pinball-${tag}.chgame`;
    const asset = {name, state: 'uploaded', browser_download_url: `https://github.com/example/carts/releases/download/${tag}/${name}`};
    if (url.origin === 'https://api.github.com') {
      assert.equal(url.pathname, '/repos/example/carts/releases/latest');
      return Response.json({assets: [asset, {name: 'notes.txt', state: 'uploaded'}]});
    }
    assert.equal(url.origin + url.pathname, endpoint.href);
    assert.equal(url.searchParams.get('url'), asset.browser_download_url);
    return new Response(fixture);
  };
  for (const tag of ['v1', 'v2']) {
    assert.equal((await prepareLinkedPackage(latest, fetchVersion(tag), endpoint)).title, 'HELLO');
  }
  await assert.rejects(prepareLinkedPackage(latest, async () => Response.json({assets: []}), endpoint), /no .chgame/);
});
