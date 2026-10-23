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
 * The face lined up in a `size` x `size` picture: RGB bytes, row by row.
 * `pixels` is the picture the face is in, `channels` bytes a pixel (3 for RGB,
 * 4 for RGBA), and `points` the five points in its pixels. Each pixel of the
 * result is read from the picture between its four nearest pixels; what falls
 * outside the picture is black, as OpenCV's warpAffine leaves it.
 */
export function alignFace(pixels, width, height, channels, points, size = 112) {
  const target = ARCFACE_POINTS.map(([x, y]) => [(x * size) / 112, (y * size) / 112]);
  const m = similarityTransform(points, target);
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
