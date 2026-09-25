#!/usr/bin/env node
// Генерирует PWA-иконки SmartTube WEB (чистый Node, без внешних зависимостей):
// красный квадрат + белый play-треугольник. PNG кодируется вручную (zlib + CRC32).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '../apps/web/public/icons');
mkdirSync(OUT, { recursive: true });

const RED = [230, 33, 23, 255]; // #e62117
const WHITE = [255, 255, 255, 255];

function inTriangle(px, py, a, b, c) {
  const sign = (x1, y1, x2, y2, x, y) => (x1 - x) * (y2 - y) - (x2 - x) * (y1 - y);
  const d1 = sign(a[0], a[1], b[0], b[1], px, py);
  const d2 = sign(b[0], b[1], c[0], c[1], px, py);
  const d3 = sign(c[0], c[1], a[0], a[1], px, py);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function inRoundedRect(px, py, s, r) {
  const x = px < r ? r : px > s - r ? s - r : px;
  const y = py < r ? r : py > s - r ? s - r : py;
  const dx = px - x;
  const dy = py - y;
  return dx * dx + dy * dy <= r * r;
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * 4);
    raw[rowStart] = 0; // filter none
    rgba.copy(raw, rowStart + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIcon(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  // правильный play-треугольник: основание слева, остриё справа по центру
  const tri = [
    [0.28 * size, 0.30 * size],
    [0.28 * size, 0.70 * size],
    [0.72 * size, 0.50 * size],
  ];
  const r = 0.18 * size; // радиус скругления углов
  const SS = 3; // суперсэмплинг 3x3
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4;
      let red = 0;
      let white = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = px + (sx + 0.5) / SS;
          const fy = py + (sy + 0.5) / SS;
          const x = fx + 0.5;
          const y = fy + 0.5;
          if (inTriangle(x, y, tri[0], tri[1], tri[2])) white++;
          else if (inRoundedRect(x, y, size, r) || maskable) red++;
        }
      }
      const total = SS * SS;
      const a = (red + white) / total;
      if (a <= 0) continue;
      const mix = white / total;
      rgba[i] = Math.round(WHITE[0] * mix + RED[0] * (1 - mix));
      rgba[i + 1] = Math.round(WHITE[1] * mix + RED[1] * (1 - mix));
      rgba[i + 2] = Math.round(WHITE[2] * mix + RED[2] * (1 - mix));
      rgba[i + 3] = Math.round(255 * (maskable ? a : Math.min(1, a)));
    }
  }
  return encodePng(size, size, rgba);
}

writeFileSync(join(OUT, 'icon-192.png'), makeIcon(192, false));
writeFileSync(join(OUT, 'icon-512.png'), makeIcon(512, false));
writeFileSync(join(OUT, 'icon-maskable-512.png'), makeIcon(512, true));
console.log(`Icons generated in ${OUT}`);