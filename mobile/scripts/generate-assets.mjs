// Generates the Khozo app icon / splash / notification assets as PNGs.
//
// Everything is rasterised from signed-distance functions so the marks stay
// crisp at any size and the repo carries a generator instead of binary blobs.
// Run with: node scripts/generate-assets.mjs

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

const INDIGO_DEEP = [21, 20, 61];
const INDIGO = [67, 56, 202];
const VIOLET = [124, 58, 237];
const TEAL = [13, 148, 136];
const WHITE = [255, 255, 255];

// ---- PNG encoding ---------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  // One filter byte (0 = None) per scanline, then raw RGBA.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Drawing helpers ------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Antialiased coverage for a signed distance (negative = inside). */
function coverage(dist, edge = 1.2) {
  return clamp01(0.5 - dist / edge);
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdRoundedBox(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - halfW + radius;
  const qy = Math.abs(py - cy) - halfH + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/** How far the pin's point sits below the disc centre, in disc radii. */
const PIN_TIP = 1.95;

// Where the tangent lines from the tip touch the disc. With the tip a distance
// d = PIN_TIP*r below the centre, the tangent point sits at cos0 = r/d.
const PIN_COS = 1 / PIN_TIP;
const PIN_SIN = Math.sqrt(1 - PIN_COS * PIN_COS);
// Perpendicular-distance correction for the slanted edges.
const PIN_SLANT = (PIN_TIP - PIN_COS) / Math.hypot(PIN_SIN, PIN_TIP - PIN_COS);

/** Map-pin: a disc plus the tangent cone running down to the tip. */
function sdPin(px, py, cx, cy, r) {
  const disc = sdCircle(px, py, cx, cy, r);
  const tangentY = cy + r * PIN_COS;
  if (py <= tangentY) return disc;
  const apexY = cy + r * PIN_TIP;
  const t = (py - tangentY) / (apexY - tangentY);
  const halfWidth = r * PIN_SIN * (1 - t);
  const cone = Math.max((Math.abs(px - cx) - halfWidth) * PIN_SLANT, py - apexY);
  return Math.min(disc, cone);
}

/** Heart, sized so it sits inside the pin's disc. */
function sdHeart(px, py, cx, cy, s) {
  // Two lobes plus a triangle body - cheap, and reads correctly at icon sizes.
  const lobeR = s * 0.5;
  const left = sdCircle(px, py, cx - s * 0.44, cy - s * 0.26, lobeR);
  const right = sdCircle(px, py, cx + s * 0.44, cy - s * 0.26, lobeR);
  const apexY = cy + s * 0.92;
  const dy = apexY - py;
  const topY = cy - s * 0.26;
  const spread = dy <= 0 ? 0 : (dy / (apexY - topY)) * s * 0.94;
  const body = Math.max(Math.abs(px - cx) - spread, Math.max(py - apexY, topY - py));
  return Math.min(left, right, body);
}

function createCanvas(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

function setPixel(canvas, x, y, rgb, alpha) {
  if (alpha <= 0) return;
  const i = (y * canvas.width + x) * 4;
  const dstA = canvas.data[i + 3] / 255;
  const outA = alpha + dstA * (1 - alpha);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c++) {
    const dst = canvas.data[i + c];
    canvas.data[i + c] = Math.round((rgb[c] * alpha + dst * dstA * (1 - alpha)) / outA);
  }
  canvas.data[i + 3] = Math.round(outA * 255);
}

/** Fills every pixel using `shade(x, y) -> [r,g,b,a] | null`. */
function paint(canvas, shade) {
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = shade(x + 0.5, y + 0.5);
      if (px) setPixel(canvas, x, y, [px[0], px[1], px[2]], px[3]);
    }
  }
}

/**
 * Draws the Khozo mark - a location pin with a heart cut out of it - centred
 * on the canvas. `scale` is the pin disc radius as a fraction of the canvas.
 */
function drawMark(canvas, { scale = 0.2, offsetY = 0, color = WHITE, glow = true } = {}) {
  const cx = canvas.width / 2;
  const size = Math.min(canvas.width, canvas.height);
  const r = size * scale;
  // The mark spans cy-r .. cy+PIN_TIP*r, so bias cy upward to optically centre it.
  const cy = canvas.height / 2 - r * ((PIN_TIP - 1) / 2) + offsetY;
  const edge = Math.max(1.1, size / 700);

  paint(canvas, (x, y) => {
    const pin = sdPin(x, y, cx, cy, r);
    const heart = sdHeart(x, y, cx, cy - r * 0.06, r * 0.6);
    // Cut the heart out of the pin: max(pin, -heart).
    const mark = Math.max(pin, -heart);
    const alpha = coverage(mark, edge);
    if (alpha <= 0) {
      if (!glow) return null;
      // Soft halo so the mark separates from busy wallpapers.
      const halo = coverage(pin - r * 0.5, r * 1.6) * 0.1;
      return halo > 0.002 ? [...color, halo] : null;
    }
    return [...color, alpha];
  });
}

function gradientBackground(canvas, stops, { radius = 0 } = {}) {
  const { width, height } = canvas;
  const diag = width + height;
  paint(canvas, (x, y) => {
    const t = clamp01((x + y) / diag);
    // Piecewise-linear ramp through the stops.
    const seg = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(seg));
    const rgb = mix(stops[i], stops[i + 1], seg - i);
    if (radius <= 0) return [...rgb, 1];
    const d = sdRoundedBox(x, y, width / 2, height / 2, width / 2, height / 2, radius);
    const a = coverage(d, 1.5);
    return a > 0 ? [...rgb, a] : null;
  });
}

// ---- Asset definitions ----------------------------------------------------

function iconAsset(size) {
  const canvas = createCanvas(size, size);
  gradientBackground(canvas, [INDIGO_DEEP, INDIGO, VIOLET], { radius: 0 });
  drawMark(canvas, { scale: 0.27, glow: false });
  return canvas;
}

/**
 * Android adaptive foreground: the mark must live inside the middle 66% because
 * launchers mask the outer ring.
 */
function adaptiveForeground(size) {
  const canvas = createCanvas(size, size);
  drawMark(canvas, { scale: 0.16, glow: false });
  return canvas;
}

function splashAsset(size) {
  const canvas = createCanvas(size, size);
  drawMark(canvas, { scale: 0.2, glow: false });
  return canvas;
}

function notificationIcon(size) {
  // Android tints notification icons, so ship a white-on-transparent glyph.
  const canvas = createCanvas(size, size);
  drawMark(canvas, { scale: 0.26, glow: false });
  return canvas;
}

function faviconAsset(size) {
  const canvas = createCanvas(size, size);
  gradientBackground(canvas, [INDIGO, VIOLET, TEAL], { radius: size * 0.22 });
  drawMark(canvas, { scale: 0.24, glow: false });
  return canvas;
}

const ASSETS = [
  ['icon.png', () => iconAsset(1024)],
  ['adaptive-icon.png', () => adaptiveForeground(1024)],
  ['splash-icon.png', () => splashAsset(1024)],
  ['notification-icon.png', () => notificationIcon(256)],
  ['favicon.png', () => faviconAsset(96)],
];

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, build] of ASSETS) {
  const canvas = build();
  const png = encodePng(canvas.width, canvas.height, canvas.data);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`  ${name.padEnd(22)} ${canvas.width}x${canvas.height}  ${(png.length / 1024).toFixed(1)} KB`);
}
console.log(`\nWrote ${ASSETS.length} assets to ${OUT_DIR}`);
