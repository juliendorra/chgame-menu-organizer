// CHGame covers are 128×128 pixels, packed two indices per byte.
import {decodePicture} from './menu.mjs';

const size = 128;
const palettes = [
  ['#20133d', '#3e2468', '#ff763e', '#ffce65', '#fff3d5', '#e66daf'],
  ['#102a34', '#1d5059', '#f37371', '#68d8c9', '#f7ffcf', '#40a9a1'],
  ['#2d1534', '#6b2855', '#ff9d49', '#f25c91', '#fff4da', '#a25ac7'],
  ['#15254e', '#2e53a2', '#ff655c', '#91d8ff', '#fff5cc', '#4c8ce4'],
  ['#1d2916', '#40582a', '#fb8b4b', '#b7e35e', '#fff2ca', '#6ea24c'],
  ['#291b16', '#723947', '#f0674a', '#ffa9af', '#fff4e1', '#b7677b'],
].map(palette => palette.map(color => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16))));
const fonts = [
  '900 SIZEpx "Archivo Black", "Arial Black", Helvetica, sans-serif',
  'bold SIZEpx "DM Serif Text", Georgia, serif',
  'bold SIZEpx "IBM Plex Mono", "Courier New", monospace',
  '900 SIZEpx "Barlow Condensed", Impact, "Arial Narrow", sans-serif',
];

function pick(length, previous) {
  if (previous === undefined) return Math.floor(Math.random() * length);
  const index = Math.floor(Math.random() * (length - 1));
  return index >= previous ? index + 1 : index;
}

export function coverStyle(previous) {
  return {palette: pick(palettes.length, previous?.palette), font: pick(fonts.length, previous?.font),
    pattern: pick(3, previous?.pattern)};
}

export function encodeCover(pixels, palette) {
  const bytes = new Uint8Array(8704);
  bytes.set([67, 72, 66, 49]); // CHB1
  const header = new DataView(bytes.buffer);
  for (const [i, [r, g, b]] of palette.entries()) {
    header.setUint16(8 + i * 2, ((r >>> 3) << 11) | ((g >>> 2) << 5) | (b >>> 3), true);
  }
  // Reserve index 15 for the console's rainbow colour.
  header.setUint16(38, 0xf81f, true);
  for (let pixel = 0; pixel < size * size; pixel++) {
    const offset = pixel * 4;
    let best = 0;
    let nearest = Infinity;
    for (const [index, [r, g, b]] of palette.entries()) {
      const distance = (r - pixels[offset]) ** 2 + (g - pixels[offset + 1]) ** 2 + (b - pixels[offset + 2]) ** 2;
      if (distance < nearest) {
        nearest = distance;
        best = index;
      }
    }
    bytes[512 + (pixel >> 1)] |= best << (pixel & 1 ? 0 : 4);
  }
  return bytes;
}

function titleLines(ctx, title, font) {
  ctx.font = font.replace('SIZE', 20);
  if (ctx.measureText(title).width <= 100 || title.split(' ').length < 2) return [title];
  const spaces = [...title.matchAll(/ /g)];
  return spaces.map(space => [title.slice(0, space.index).trimEnd(), title.slice(space.index + 1).trimStart()])
    .sort((a, b) => Math.max(...a.map(line => ctx.measureText(line).width)) -
      Math.max(...b.map(line => ctx.measureText(line).width)))[0];
}

export function generateCover(title, style = coverStyle()) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const palette = palettes[style.palette];
  const [dark, shade, accent, light, ink, mid] = palette.map(rgb => `rgb(${rgb.join(',')})`);
  const rect = (color, x, y, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };

  rect(dark, 0, 0, size, size);
  rect(shade, 4, 4, 120, 120);
  ctx.save();
  ctx.beginPath();
  ctx.rect(7, 7, 114, 114);
  ctx.clip();
  if (style.pattern === 0) {
    ctx.translate(64, 64);
    ctx.rotate(Math.PI / 4);
    for (let x = -96; x < 96; x += 18) rect(mid, x, -96, 6, 192);
  } else if (style.pattern === 1) {
    for (let y = 0; y < 128; y += 16) {
      for (let x = y % 32; x < 128; x += 32) rect(mid, x, y, 16, 16);
    }
  } else {
    for (let radius = 50; radius > 10; radius -= 10) {
      ctx.strokeStyle = mid;
      ctx.lineWidth = 2;
      ctx.strokeRect(64 - radius, 64 - radius, radius * 2, radius * 2);
    }
  }
  ctx.restore();

  rect(accent, 12, 34, 104, 60);
  rect(dark, 10, 31, 104, 60);
  rect(light, 12, 32, 100, 2);
  rect(light, 12, 88, 100, 2);
  for (const [x, y] of [[22, 18], [104, 107]]) {
    rect(light, x - 5, y - 1, 11, 3);
    rect(light, x - 1, y - 5, 3, 11);
  }
  rect(accent, 37, 15, 27, 3);
  rect(accent, 64, 109, 27, 3);

  const text = title.trim().toUpperCase() || 'NEW CATEGORY';
  const font = fonts[style.font];
  const lines = titleLines(ctx, text, font);
  for (let pixels = 24; pixels >= 8; pixels--) {
    ctx.font = font.replace('SIZE', pixels);
    if (lines.every(line => ctx.measureText(line).width <= 94)) break;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  lines.forEach((line, i) => ctx.fillText(line, 62, 61 + (i - (lines.length - 1) / 2) * 25, 94));

  const image = ctx.getImageData(0, 0, size, size);
  const bytes = encodeCover(image.data, palette);
  ctx.putImageData(new ImageData(decodePicture(bytes), size, size), 0, 0);
  return {bytes, preview: canvas.toDataURL('image/png'), style};
}
