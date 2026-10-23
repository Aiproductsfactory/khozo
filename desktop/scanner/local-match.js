// The first pass on the laptop, when Aarakshak's recognition model is here
// (recognizer.js): every person seen is compared with the case on this
// computer, and only the closest are sent to Khozo, where Aarakshak's cloud
// and AWS Rekognition give the answer that is recorded and the officer
// decides. Passers-by's faces stay on the laptop.
//
// Each signature is made the way Aarakshak makes it, so the scores match its
// cloud: YuNet on the whole picture at its own size, the face with the
// largest box, its five points in whole pixels, lined up to 112 x 112. A
// person's signature is made from the very picture that is sent to Khozo,
// the 240 px copy (comparisonCopy), so the laptop and the cloud look at the
// same thing: on the same pictures the two agree within 0.014 (spec T3.1,
// 23 Oct 2026: 80 faces, 3,160 pairs). Signing the larger picture instead put
// them up to 0.33 apart.
//
// The case's photos are read into memory to make their signatures and are
// never written to disk; the signatures are dropped when the run ends.
import path from 'node:path';
import sharp from 'sharp';
import { alignFace } from './align.js';
import { comparisonCopy, pointsOnCopy } from './compare-copy.js';
import { cosine } from './recognizer.js';

/** The area of a face's box as Aarakshak measures it: whole pixels, kept inside the picture. */
function boxArea(face, width, height) {
  const x = Math.round(face.x); const y = Math.round(face.y);
  const x2 = Math.min(x + Math.round(face.w), width); const y2 = Math.min(y + Math.round(face.h), height);
  return Math.max(x2 - Math.max(x, 0), 0) * Math.max(y2 - Math.max(y, 0), 0);
}

/**
 * The signature of the largest face in a picture (a file path or the bytes of
 * one), or null when no face is found. `points` (optional) are five face
 * points to fall back on when the face finder sees no face in the picture.
 */
export async function pictureSignature(input, { detector, recognizer, points = null }) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const faces = await detector.detect(data, info.width, info.height, recognizer.detectorScore ?? undefined);
  let landmarks = points;
  if (faces.length) {
    const face = faces.reduce((best, f) => (boxArea(f, info.width, info.height) > boxArea(best, info.width, info.height) ? f : best));
    landmarks = face.landmarks.map(([x, y]) => [Math.round(x), Math.round(y)]);
  }
  if (!landmarks?.length) return null;
  const lined = alignFace(data, info.width, info.height, 4, landmarks, recognizer.size);
  return lined ? recognizer.embed(lined) : null;
}

/**
 * Signatures of the case's photos: the main photo and each extra.
 * `[{ photo, signature }]`; a photo with no face is left out.
 */
export async function caseSignatures({ client, report, detector, recognizer }) {
  const photos = [{ id: null }, ...(report.extraPhotos || []).map((p) => ({ id: p.id }))];
  const out = [];
  for (const photo of photos) {
    let bytes;
    try { bytes = await client.photo(report.id, photo.id); } catch { continue; }
    const signature = await pictureSignature(bytes, { detector, recognizer });
    bytes = null;
    if (signature) out.push({ photo: photo.id || 'main', signature });
  }
  return out;
}

/**
 * The signature of one person's face picture, the picture Khozo would be sent:
 * from `dir`, or through `readPicture(track)` (the desktop app keeps pictures
 * encrypted).
 */
export async function trackSignature({ dir, track, detector, recognizer, readPicture = null }) {
  const picture = readPicture ? await readPicture(track) : path.join(dir, track.picture);
  const { width } = await sharp(picture).metadata();
  return pictureSignature(await comparisonCopy(picture), { detector, recognizer, points: pointsOnCopy(track.landmarks, width) });
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
