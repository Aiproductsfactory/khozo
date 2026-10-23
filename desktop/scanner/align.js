// Lining a face up the way a recognition model expects to see it.
//
// Aarakshak recognises faces with ArcFace on a ResNet100 backbone. Models of
// that family are trained on faces placed the same way: the five points YuNet
// finds (the two eyes, the nose tip, the two corners of the mouth) moved onto
// fixed places in a 112 x 112 picture, by the closest turn, scale and shift.
// A face lined up here is the face such a model would be given.

/**
 * Where ArcFace models expect the five points in a 112 x 112 face: the eye on
 * the left of the picture first, as YuNet lists them (the reference template
 * published with the ArcFace models).
 */
export const ARCFACE_POINTS = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

/**
 * The turn, scale and shift that best carry the points `from` onto `to`
 * (least squares, no mirroring): `{ a, b, tx, ty }`, mapping (x, y) to
 * (a x - b y + tx, b x + a y + ty). Null when the points are all in one place.
 */
export function similarityTransform(from, to) {
  const n = Math.min(from.length, to.length);
  if (n < 2) return null;
  let mx = 0; let my = 0; let mu = 0; let mv = 0;
  for (let i = 0; i < n; i += 1) {
    mx += from[i][0]; my += from[i][1]; mu += to[i][0]; mv += to[i][1];
  }
  mx /= n; my /= n; mu /= n; mv /= n;
  let spread = 0; let along = 0; let across = 0;
  for (let i = 0; i < n; i += 1) {
    const x = from[i][0] - mx; const y = from[i][1] - my;
    const u = to[i][0] - mu; const v = to[i][1] - mv;
    spread += x * x + y * y;
    along += x * u + y * v;
    across += x * v - y * u;
  }
  if (!(spread > 0)) return null;
  const a = along / spread;
  const b = across / spread;
  return { a, b, tx: mu - (a * mx - b * my), ty: mv - (b * mx + a * my) };
}

/**
 * OpenCV's random numbers (cv::RNG), so that the robust fit below picks the
 * same pairs of points OpenCV does: a multiply-with-carry generator, started
 * where OpenCV starts it for each fit.
 */
function opencvRng(seed = 0xffffffffffffffffn) {
  let state = seed;
  return {
    next() {
      state = ((state & 0xffffffffn) * 4164903690n + (state >> 32n)) & 0xffffffffffffffffn;
      return Number(state & 0xffffffffn);
    },
    uniform(a, b) { return a === b ? a : (this.next() % (b - a)) + a; },
  };
}

const f32 = Math.fround;

/** The squared distance, in single precision as OpenCV measures it, between each point carried by `m` and its target. */
function squaredErrors(from, to, m) {
  const [F0, F1, F2, F3, F4, F5] = [m.a, -m.b, m.tx, m.b, m.a, m.ty].map(f32);
  return from.map(([x, y], i) => {
    const a = f32(f32(f32(f32(F0 * x) + f32(F1 * y)) + F2) - to[i][0]);
    const b = f32(f32(f32(f32(F3 * x) + f32(F4 * y)) + F5) - to[i][1]);
    return f32(f32(a * a) + f32(b * b));
  });
}

/**
 * The turn, scale and shift carrying `from` onto `to` as Aarakshak finds it:
 * OpenCV's estimateAffinePartial2D with LMEDS. Pairs of points are tried (13
 * pairs, drawn with OpenCV's generator and seed), the pair whose fit leaves
 * the smallest middle error wins, the points that fit it well are kept, and
 * the fit is made again over those points by least squares, which is where
 * OpenCV's refinement ends. A face whose five points disagree (a nose seen
 * from the side) is lined up by the points that agree.
 */
export function robustSimilarity(from, to) {
  const src = from.map(([x, y]) => [f32(x), f32(y)]);
  const dst = to.map(([x, y]) => [f32(x), f32(y)]);
  const n = src.length;
  if (n < 2) return null;
  if (n === 2) return similarityTransform(src, dst);
  const rng = opencvRng();
  // OpenCV's count for 99% confidence with 45% outliers and pairs of points.
  const tries = Math.max(3, Math.round(Math.log(0.01) / Math.log(1 - (1 - 0.45) ** 2)));
  let best = null;
  let bestMedian = Infinity;
  for (let t = 0; t < tries; t += 1) {
    const i = rng.uniform(0, n);
    let j = rng.uniform(0, n);
    while (j === i) j = rng.uniform(0, n);
    const m = similarityTransform([src[i], src[j]], [dst[i], dst[j]]);
    if (!m) continue;
    const median = [...squaredErrors(src, dst, m)].sort((a, b) => a - b)[Math.floor(n / 2)];
    if (median < bestMedian) { bestMedian = median; best = m; }
  }
  if (!best) return null;
  const sigma = Math.max(2.5 * 1.4826 * (1 + 5 / (n - 2)) * Math.sqrt(bestMedian), 0.001);
  const limit = f32(sigma * sigma);
  const keep = squaredErrors(src, dst, best).map((e) => e <= limit);
  const inSrc = src.filter((_, k) => keep[k]);
  const inDst = dst.filter((_, k) => keep[k]);
  return inSrc.length >= 2 ? similarityTransform(inSrc, inDst) : best;
}

/**
 * The face lined up in a `size` x `size` picture: RGB bytes, row by row.
 * `pixels` is the picture the face is in, `channels` bytes a pixel (3 for RGB,
 * 4 for RGBA), and `points` the five points in its pixels. The points are
 * fitted as Aarakshak fits them (robustSimilarity); `fit: 'lsq'` fits all
 * five by least squares instead. Each pixel of the result is read from the
 * picture between its four nearest pixels; what falls outside the picture is
 * black, as OpenCV's warpAffine leaves it.
 */
export function alignFace(pixels, width, height, channels, points, size = 112, { fit = 'lmeds' } = {}) {
  const target = ARCFACE_POINTS.map(([x, y]) => [(x * size) / 112, (y * size) / 112]);
  const m = fit === 'lsq' ? similarityTransform(points, target) : robustSimilarity(points, target);
  if (!m) return null;
  const det = m.a * m.a + m.b * m.b;
  const out = new Uint8Array(size * size * 3);
  const at = (x, y, c) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : pixels[(y * width + x) * channels + c]);
  for (let v = 0; v < size; v += 1) {
    for (let u = 0; u < size; u += 1) {
      const du = u - m.tx; const dv = v - m.ty;
      const x = (m.a * du + m.b * dv) / det;
      const y = (-m.b * du + m.a * dv) / det;
      const x0 = Math.floor(x); const y0 = Math.floor(y);
      const fx = x - x0; const fy = y - y0;
      const o = (v * size + u) * 3;
      for (let c = 0; c < 3; c += 1) {
        const value = at(x0, y0, c) * (1 - fx) * (1 - fy) + at(x0 + 1, y0, c) * fx * (1 - fy)
          + at(x0, y0 + 1, c) * (1 - fx) * fy + at(x0 + 1, y0 + 1, c) * fx * fy;
        out[o + c] = Math.round(value);
      }
    }
  }
  return out;
}
