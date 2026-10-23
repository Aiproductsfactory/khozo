// The first pass on the laptop, when Aarakshak's recognition model is here
// (recognizer.js): every person seen is compared with the case on this
// computer, and only the closest are sent to Khozo, where Aarakshak's cloud
// and AWS Rekognition give the answer that is recorded and the officer
// decides. Passers-by's faces stay on the laptop.
//
// The case's photos are read into memory to make their signatures and are
// never written to disk; the signatures are dropped when the run ends.
import path from 'node:path';
import sharp from 'sharp';
import { alignFace } from './align.js';
import { cosine } from './recognizer.js';

/** The pixels of a picture file or buffer, upright, as RGBA. */
async function rgbaOf(input) {
  const { data, info } = await sharp(input).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgba: data, width: info.width, height: info.height };
}

/** The largest face in a picture, found at most `maxSide` pixels on its longer side, in the picture's own pixels. */
async function largestFace(detector, { rgba, width, height }, maxSide = 960) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(32, Math.round(width * scale));
  const h = Math.max(32, Math.round(height * scale));
  const pixels = scale < 1 ? await sharp(rgba, { raw: { width, height, channels: 4 } }).resize(w, h, { fit: 'fill' }).raw().toBuffer() : rgba;
  const faces = await detector.detect(pixels, w, h);
  if (!faces.length) return null;
  const face = faces.reduce((best, f) => (f.w * f.h > best.w * best.h ? f : best));
  const back = width / w;
  return { ...face, landmarks: face.landmarks.map(([x, y]) => [x * back, y * back]) };
}

/**
 * Signatures of the case's photos: the main photo and each extra, the largest
 * face in each. `[{ photo, signature }]`; a photo with no face is left out.
 */
export async function caseSignatures({ client, report, detector, recognizer }) {
  const photos = [{ id: null }, ...(report.extraPhotos || []).map((p) => ({ id: p.id }))];
  const out = [];
  for (const photo of photos) {
    let bytes;
    try { bytes = await client.photo(report.id, photo.id); } catch { continue; }
    const picture = await rgbaOf(bytes);
    bytes = null;
    const face = await largestFace(detector, picture);
    if (!face) continue;
    const lined = alignFace(picture.rgba, picture.width, picture.height, 4, face.landmarks, recognizer.size);
    if (lined) out.push({ photo: photo.id || 'main', signature: await recognizer.embed(lined) });
  }
  return out;
}

/** The signature of one person's face picture, lined up by the points the scan kept. */
export async function trackSignature({ dir, track, recognizer }) {
  if (!track.landmarks?.length) return null;
  const { data, info } = await sharp(path.join(dir, track.picture)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lined = alignFace(data, info.width, info.height, info.channels, track.landmarks, recognizer.size);
  return lined ? recognizer.embed(lined) : null;
}

/** How close a person is to the case: the best cosine over the case's photos. */
export function closeness(signature, caseSigs) {
  let best = -1;
  for (const { signature: s } of caseSigs) best = Math.max(best, cosine(signature, s));
  return Math.round(best * 1000) / 1000;
}

/**
 * Which people to send to Khozo after the first pass: everyone at or above
 * `line`, and the `top` closest whatever their score, so the officer always
 * sees the nearest few. `scores` maps track id to closeness. Closest first.
 */
export function chooseToSend(tracks, scores, { line = 0.25, top = 10 } = {}) {
  const scored = tracks.filter((t) => Number.isFinite(scores[t.id])).sort((a, b) => scores[b.id] - scores[a.id]);
  return scored.filter((t, i) => i < top || scores[t.id] >= line);
}
