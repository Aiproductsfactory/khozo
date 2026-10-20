// A quick look at a photo on the phone, before it is sent: is it very dark,
// or blurred? Said while the reporter is still there and can take another.
// It only advises: a photo sent anyway is sent, and the face engines and the
// officer decide what it shows.
//
// No face detection runs here, so the check says only what it measured, and
// nothing at all when it found neither problem: "photo looks fine" would
// claim a check of the face that was never made.
//
// Blur is the re-blur measure of Crete et al. (2007), as scikit-image's
// blur_effect computes it: blur the photo once more and see how much edge
// detail that removes. A sharp photo loses a lot; a blurred one has little
// left to lose. It is taken across and down separately, since camera shake
// blurs one way, and on a 6 × 6 grid, where the sharpest part with enough
// detail to judge counts, so a portrait with a soft background reads as
// sharp. The limits were set on the 24 Kodak test photographs and copies of
// them blurred, shaken, darkened, enlarged and recompressed: no sharp,
// enlarged, recompressed or soft-background copy was flagged (the highest
// scored 0.44), while every heavily blurred one and about half the strongly
// shaken ones were. Mild softness is let through on purpose.
//
// The pure part (assessPixels) runs under Node for scripts/photo-check-smoke.mjs.
import { decodePicture, fitSize } from './bulk/photos.js';

/** The photo is judged at this size on its longer edge. */
export const CHECK_SIDE = 800;
/** At or above this re-blur score (0 sharp, 1 blurred) the photo is blurred. */
export const BLUR_LIMIT = 0.48;
/** Below this average brightness (0-255), with little that is bright... */
export const DARK_MEAN = 40;
/** ...meaning 95% of the photo darker than this, the photo is too dark. */
export const DARK_BRIGHT = 100;

const GRID = 6;
// Average edge strength a part needs before its sharpness is judged: a plain
// wall or the sky is neither sharp nor blurred.
const MIN_DETAIL = 6;
const REBLUR_SIZE = 11;

function lumaOf(rgba, n) {
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i += 1, j += 4) out[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return out;
}

// A box blur of REBLUR_SIZE along one axis, mirrored at the edges.
function boxBlur(img, w, h, alongX) {
  const out = new Float32Array(w * h);
  const r = REBLUR_SIZE >> 1;
  const len = alongX ? w : h;
  const step = alongX ? 1 : w;
  const lines = alongX ? h : w;
  const mirror = (k) => (k < 0 ? -k - 1 : k >= len ? 2 * len - k - 1 : k);
  for (let line = 0; line < lines; line += 1) {
    const base = alongX ? line * w : line;
    let sum = 0;
    for (let d = -r; d <= r; d += 1) sum += img[base + mirror(d) * step];
    for (let k = 0; k < len; k += 1) {
      out[base + k * step] = sum / REBLUR_SIZE;
      sum += img[base + mirror(k + r + 1) * step] - img[base + mirror(k - r) * step];
    }
  }
  return out;
}

// |Sobel| along one axis at pixel i, which must not be on the border.
function sobel(img, w, i, alongX) {
  return alongX
    ? Math.abs(img[i - w + 1] - img[i - w - 1] + 2 * (img[i + 1] - img[i - 1]) + img[i + w + 1] - img[i + w - 1])
    : Math.abs(img[i + w - 1] - img[i - w - 1] + 2 * (img[i + w] - img[i - w]) + img[i + w + 1] - img[i - w + 1]);
}

// The re-blur score of the sharpest part of the photo with enough detail, or
// of the whole photo when no part has.
function blurScore(img, w, h) {
  const tileX = Array.from({ length: w }, (_, x) => Math.min(GRID - 1, Math.floor((x * GRID) / w)));
  const tileY = Array.from({ length: h }, (_, y) => Math.min(GRID - 1, Math.floor((y * GRID) / h)));
  const score = (edges, lost) => (edges > 0 ? Math.abs(edges - lost) / edges : 1);
  const tiles = GRID * GRID;
  const worst = new Float64Array(tiles);
  const detail = new Float64Array(tiles);
  let whole = 0;
  for (const alongX of [true, false]) {
    const blurred = boxBlur(img, w, h, alongX);
    const edges = new Float64Array(tiles);
    const lost = new Float64Array(tiles);
    let allEdges = 0;
    let allLost = 0;
    for (let y = 2; y < h - 1; y += 1) {
      const row = tileY[y] * GRID;
      for (let x = 2; x < w - 1; x += 1) {
        const i = y * w + x;
        const sharp = sobel(img, w, i, alongX);
        const gone = sharp - sobel(blurred, w, i, alongX);
        const t = row + tileX[x];
        edges[t] += sharp;
        if (gone > 0) {
          lost[t] += gone;
          allLost += gone;
        }
        allEdges += sharp;
      }
    }
    for (let t = 0; t < tiles; t += 1) {
      worst[t] = Math.max(worst[t], score(edges[t], lost[t]));
      detail[t] += edges[t];
    }
    whole = Math.max(whole, score(allEdges, allLost));
  }
  const tilePixels = (w / GRID) * (h / GRID);
  let best = Infinity;
  for (let t = 0; t < tiles; t += 1) {
    if (detail[t] / (2 * tilePixels) >= MIN_DETAIL) best = Math.min(best, worst[t]);
  }
  return Number.isFinite(best) ? best : whole;
}

/**
 * What is wrong with a photo, from its RGBA pixels (about CHECK_SIDE on the
 * longer edge): `{ verdict: 'dark' | 'blurred' | null, blur, mean, bright }`.
 * Darkness is judged first: the grain of a dark photo reads as sharp detail.
 */
export function assessPixels(rgba, width, height) {
  if (!rgba || width < 16 || height < 16) return { verdict: null, blur: null, mean: null, bright: null };
  const n = width * height;
  const img = lumaOf(rgba, n);
  const histogram = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    histogram[Math.min(255, Math.round(img[i]))] += 1;
    total += img[i];
  }
  const mean = total / n;
  let bright = 0;
  for (let seen = 0; bright < 255; bright += 1) {
    seen += histogram[bright];
    if (seen >= n * 0.95) break;
  }
  if (mean < DARK_MEAN && bright < DARK_BRIGHT) return { verdict: 'dark', blur: null, mean, bright };
  const blur = blurScore(img, width, height);
  return { verdict: blur >= BLUR_LIMIT ? 'blurred' : null, blur, mean, bright };
}

/**
 * 'dark', 'blurred' or null for a photo File. Null too when the browser
 * cannot read it: the check is advice, never a reason to stop a report.
 */
export async function checkPhoto(file) {
  if (!file || typeof file.arrayBuffer !== 'function') return null;
  try {
    const ext = String(file.name || '').split('.').pop().toLowerCase() || 'jpg';
    const pic = await decodePicture(file, ext);
    const { width, height } = fitSize(pic.width, pic.height, CHECK_SIDE);
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pic.source, 0, 0, width, height);
    pic.close();
    return assessPixels(ctx.getImageData(0, 0, width, height).data, width, height).verdict;
  } catch {
    return null;
  }
}
