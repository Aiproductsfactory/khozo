/**
 * Checks web/src/photoCheck.js: the advice a reporter gets on the phone when a
 * photo is very dark or blurred, and the silence when it is neither.
 *
 * Draws its own test pictures (a scene of sharp-edged shapes with fine grain)
 * so it needs no fixtures: photographs of real faces are never committed
 * (test-assets/faces/README.md). The limits themselves were set on the Kodak
 * test photographs; this keeps their behaviour from drifting.
 *
 *   node scripts/photo-check-smoke.mjs
 */
import process from 'node:process';

import { assessPixels, BLUR_LIMIT } from '../web/src/photoCheck.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const W = 800;
const H = 600;

// A seeded generator, so every run draws the same scene.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Overlapping rectangles and discs in mid tones, with a little grain.
function scene(seed = 7) {
  const rnd = random(seed);
  const px = new Float32Array(W * H * 3).fill(120);
  for (let s = 0; s < 140; s += 1) {
    const colour = [40 + rnd() * 180, 40 + rnd() * 180, 40 + rnd() * 180];
    const cx = rnd() * W;
    const cy = rnd() * H;
    const size = 8 + rnd() * 90;
    const disc = rnd() < 0.5;
    for (let y = Math.max(0, Math.floor(cy - size)); y < Math.min(H, cy + size); y += 1) {
      for (let x = Math.max(0, Math.floor(cx - size)); x < Math.min(W, cx + size); x += 1) {
        if (disc && (x - cx) ** 2 + (y - cy) ** 2 > size * size) continue;
        px.set(colour, (y * W + x) * 3);
      }
    }
  }
  for (let i = 0; i < px.length; i += 1) px[i] += (rnd() - 0.5) * 6;
  return px;
}

// A blur along one axis with the given weights, mirrored at the edges.
function convolve1d(px, weights, alongX) {
  const out = new Float32Array(px.length);
  const r = weights.length >> 1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        let sum = 0;
        for (let k = -r; k <= r; k += 1) {
          let xx = alongX ? x + k : x;
          let yy = alongX ? y : y + k;
          if (xx < 0) xx = -xx - 1;
          if (xx >= W) xx = 2 * W - xx - 1;
          if (yy < 0) yy = -yy - 1;
          if (yy >= H) yy = 2 * H - yy - 1;
          sum += weights[k + r] * px[(yy * W + xx) * 3 + c];
        }
        out[(y * W + x) * 3 + c] = sum;
      }
    }
  }
  return out;
}

function gaussian(px, sigma) {
  const r = Math.ceil(sigma * 3);
  const w = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const total = w.reduce((s, v) => s + v, 0);
  const weights = w.map((v) => v / total);
  return convolve1d(convolve1d(px, weights, true), weights, false);
}

const shake = (px, length) => convolve1d(px, Array(length).fill(1 / length), true);
const scale = (px, factor) => px.map((v) => v * factor);

function rgba(px) {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0, j = 0; i < W * H; i += 1, j += 3) {
    out[i * 4] = px[j];
    out[i * 4 + 1] = px[j + 1];
    out[i * 4 + 2] = px[j + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

const judge = (px) => assessPixels(rgba(px), W, H);
const fmt = (r) => `blur ${r.blur == null ? '-' : r.blur.toFixed(3)}, mean ${r.mean?.toFixed(0)}`;

const sharp = scene();

{
  const r = judge(sharp);
  check('a sharp photo gets no advice', r.verdict === null, fmt(r));
}
{
  const r = judge(gaussian(sharp, 4));
  check('a blurred photo is called blurred', r.verdict === 'blurred', fmt(r));
}
{
  const r = judge(shake(sharp, 25));
  check('camera shake one way is called blurred', r.verdict === 'blurred', fmt(r));
}
{
  // Portrait mode: the person sharp, everything around them soft.
  const soft = gaussian(sharp, 6);
  for (let y = Math.round(H * 0.3); y < Math.round(H * 0.7); y += 1) {
    for (let x = Math.round(W * 0.35); x < Math.round(W * 0.65); x += 1) {
      for (let c = 0; c < 3; c += 1) soft[(y * W + x) * 3 + c] = sharp[(y * W + x) * 3 + c];
    }
  }
  const r = judge(soft);
  check('a sharp subject on a soft background is not called blurred', r.verdict === null, fmt(r));
}
{
  const r = judge(gaussian(sharp, 1));
  check('mild softness is let through', r.verdict === null && r.blur < BLUR_LIMIT, fmt(r));
}
{
  const r = judge(scale(sharp, 0.15));
  check('a very dark photo is called dark', r.verdict === 'dark', fmt(r));
}
{
  // Night: most of the frame dark, but the person lit by a lamp.
  const night = scale(sharp, 0.12);
  for (let y = Math.round(H * 0.25); y < Math.round(H * 0.75); y += 1) {
    for (let x = Math.round(W * 0.4); x < Math.round(W * 0.6); x += 1) {
      for (let c = 0; c < 3; c += 1) night[(y * W + x) * 3 + c] = sharp[(y * W + x) * 3 + c] + 60;
    }
  }
  const r = judge(night);
  check('a dark scene with a lit person is not called dark', r.verdict !== 'dark', fmt(r));
}
{
  const r = judge(gaussian(scale(sharp, 0.15), 4));
  check('a dark, blurred photo is called dark first', r.verdict === 'dark', fmt(r));
}
{
  const r = assessPixels(new Uint8ClampedArray(8 * 8 * 4), 8, 8);
  check('a picture too small to judge gets no advice', r.verdict === null);
  check('no pixels at all gets no advice', assessPixels(null, 0, 0).verdict === null);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) process.exit(1);
console.log('Photo check smoke passed.');
