// The app icon: the site's square motif as a small week grid, one square red
// for "now". Drawn here as SVG and as PNG (no image tools needed), so the
// build makes every size the manifest and iOS ask for.

import { deflateSync } from 'node:zlib';

const BG = [0, 0, 0];
const ON = [255, 255, 255];
const OFF = [58, 58, 60];
const NOW = [215, 0, 21]; // --accent

// rows of a week: filled slots, empty slots, the one running now
const GRID = [
  ['on', 'off', 'on'],
  ['on', 'now', 'on'],
  ['off', 'on', 'on'],
];
const COLOURS = { on: ON, off: OFF, now: NOW };

// Geometry as shares of the icon side. The grid spans 52%, inside the 80%
// circle Android keeps of a maskable icon, so masks never clip it.
function layout({ rounded }) {
  const grid = 0.52, gap = 0.045, cell = (grid - 2 * gap) / 3, start = (1 - grid) / 2;
  const cells = GRID.flatMap((row, r) => row.map((kind, c) => ({ x: start + c * (cell + gap), y: start + r * (cell + gap), s: cell, kind })));
  return { tile: rounded ? 0.225 : 0, cells, radius: cell * 0.24 };
}

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

export function iconSVG({ rounded = true } = {}) {
  const { tile, cells, radius } = layout({ rounded });
  const n = (v) => +(v * 100).toFixed(3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="${n(tile)}" fill="${hex(BG)}"/>${cells
    .map((c) => `<rect x="${n(c.x)}" y="${n(c.y)}" width="${n(c.s)}" height="${n(c.s)}" rx="${n(radius)}" fill="${hex(COLOURS[c.kind])}"/>`).join('')}</svg>\n`;
}

// signed distance to a rounded rectangle (negative inside)
function roundedRect(px, py, x, y, w, h, r) {
  const cx = x + w / 2, cy = y + h / 2;
  const qx = Math.abs(px - cx) - (w / 2 - r), qy = Math.abs(py - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// RGBA pixels, 4×4 samples per pixel for smooth edges
function pixels(size, opts) {
  const { tile, cells, radius } = layout(opts);
  const out = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = (x + (sx + 0.5) / S) / size, py = (y + (sy + 0.5) / S) / size;
          if (tile && roundedRect(px, py, 0, 0, 1, 1, tile) > 0) continue; // outside the tile: transparent
          let col = BG;
          for (const c of cells) if (roundedRect(px, py, c.x, c.y, c.s, c.s, radius) <= 0) { col = COLOURS[c.kind]; break; }
          r += col[0]; g += col[1]; b += col[2]; a += 1;
        }
      }
      const i = (y * size + x) * 4, n = S * S;
      // colours are averaged over the covered samples only, alpha over all
      out[i] = a ? Math.round(r / a) : 0; out[i + 1] = a ? Math.round(g / a) : 0; out[i + 2] = a ? Math.round(b / a) : 0;
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// rounded: transparent corners (purpose "any"); square: full bleed, for
// maskable icons and iOS, which cut their own shape
export function iconPNG(size, { rounded = true } = {}) {
  const rgba = pixels(size, { rounded });
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); // filter byte 0 per row
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bit, RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
