// Finding every person in a long video, on the laptop.
//
// The same method as the browser's video check (web/src/video/videoScan.js):
// look at the video a few times a second, find the faces, follow each person
// from one look to the next, and keep one clear picture of each. The
// differences are what a laptop allows: FFmpeg reads any DVR export straight
// through, only the chosen window is read, and a ten-hour file is fine.
//
// What comes out is a list of people with the moment each was seen and a small
// picture of their face. The video itself goes nowhere.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  CROP_SIDE, MIN_FACE_PX, createTracker, cropBox, faceQuality, scaleFaces, sharpness,
} from '../../web/src/video/faces.js';
import { frameAt, probe, readFrames, sha256File } from './ffmpeg.js';

/** The largest face picture made, in pixels on a side (as the browser). */
export const CROP_MAX = 960;

/** A frame's RGBA pixels as a sharp image. */
const image = (rgba, width, height) => sharp(rgba, { raw: { width, height, channels: 4 } });

/** How sharp a face is, read from the detection-size frame at 64 px, as the browser does. */
function faceSharpness(rgba, width, height, face) {
  const side = 64;
  const luma = new Float32Array(side * side);
  for (let y = 0; y < side; y += 1) {
    const sy = Math.min(height - 1, Math.max(0, Math.floor(face.y + (y / side) * face.h)));
    for (let x = 0; x < side; x += 1) {
      const sx = Math.min(width - 1, Math.max(0, Math.floor(face.x + (x / side) * face.w)));
      const i = (sy * width + sx) * 4;
      luma[y * side + x] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }
  }
  return sharpness(luma, side, side);
}

/**
 * A face picture cut from the frame: `{ jpeg, landmarks }`, the face's five
 * points moved into the picture's own pixels, so the face can be lined up for
 * recognition later from the picture alone.
 */
async function cropPicture(rgba, width, height, face) {
  const box = cropBox(face, width, height);
  const side = Math.max(CROP_SIDE, Math.min(CROP_MAX, box.w));
  const k = side / box.w;
  const jpeg = await image(rgba, width, height).extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .resize(side, side).jpeg({ quality: 90 }).toBuffer();
  const landmarks = (face.landmarks || []).map(([x, y]) => [Math.round((x - box.x) * k * 10) / 10, Math.round((y - box.y) * k * 10) / 10]);
  return { jpeg, landmarks };
}

/** A time in seconds from "1:02:09", "12:05" or "734.5". */
export function parseTime(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.length > 3 || parts.some((n) => !Number.isFinite(n))) throw new Error(`Not a time: ${value}`);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Finds the people in one video file.
 *
 * Options:
 *   from, to   the window to read, in seconds of the file; the whole file by default
 *   fps        looks a second (2 by default, as the browser's longest videos)
 *   maxSide    the size frames are searched at on their longer side: 960 is
 *              quick; 1280 or 1920 finds the smaller faces of a wall camera
 *   minFace    faces narrower than this, in the video's pixels, are counted but not kept
 *   outDir     where face pictures go (`faces/t<id>.jpg`)
 *   detector   from loadDetector()
 *   onProgress({ t, from, to, looks, people })   every few looks
 *   signal     an AbortSignal: stopping keeps what was found so far
 *
 * Resolves to the file's record: what it holds, the window read, the counts,
 * and `tracks`, one per person seen, earliest first, each with the moment of
 * its clearest picture and that picture's file.
 */
export async function scanFile(file, {
  from = 0, to = null, fps = 2, maxSide = 960, minFace = MIN_FACE_PX, outDir, detector, onProgress, signal,
} = {}) {
  const info = await probe(file);
  const { width, height } = info;
  if (!(width > 0 && height > 0)) throw new Error('This video has no picture size');
  const start = Math.max(0, Math.min(from || 0, info.duration || from || 0));
  const end = to != null ? Math.min(to, info.duration || to) : info.duration || null;

  const scale = Math.min(1, maxSide / Math.max(width, height));
  const detW = Math.max(32, Math.round((width * scale) / 2) * 2);
  const detH = Math.max(32, Math.round((height * scale) / 2) * 2);
  const back = width / detW;

  const facesDir = path.join(outDir, 'faces');
  fs.mkdirSync(facesDir, { recursive: true });
  const fingerprint = sha256File(file);
  const tracker = createTracker({ maxGap: Math.max(3, (3 / fps)) });
  const pictures = new Map(); // track id -> { file, quality }
  let looks = 0;
  let tooSmall = 0;
  let faceCount = 0;
  const started = Date.now();

  await readFrames(file, { from: start, to: end, fps, width, height, signal }, async (rgba, t) => {
    const det = scale < 1 ? await image(rgba, width, height).resize(detW, detH, { fit: 'fill' }).raw().toBuffer() : rgba;
    const found = scaleFaces(await detector.detect(det, detW, detH), back);
    looks += 1;
    const usable = [];
    for (const face of found) {
      faceCount += 1;
      if (face.w < minFace) { tooSmall += 1; continue; }
      const inDet = { x: face.x / back, y: face.y / back, w: face.w / back, h: face.h / back };
      usable.push({ ...face, quality: faceQuality(face, faceSharpness(det, detW, detH, inDet)) });
    }
    for (const { track, better } of tracker.add(t, usable)) {
      if (!better) continue;
      const { jpeg, landmarks } = await cropPicture(rgba, width, height, track.best);
      const name = `t${track.id}.jpg`;
      fs.writeFileSync(path.join(facesDir, name), jpeg);
      pictures.set(track.id, { file: path.join('faces', name), quality: track.best.quality, landmarks });
    }
    if (onProgress && looks % 10 === 0) onProgress({ t, from: start, to: end, looks, people: pictures.size });
  });

  const tracks = tracker.tracks()
    .filter((track) => pictures.has(track.id))
    .map((track) => ({
      id: track.id,
      time: track.time,
      firstTime: track.firstTime,
      lastTime: track.lastTime,
      seen: track.seen,
      quality: Math.round(track.face.quality * 1000) / 1000,
      face: { x: Math.round(track.face.x), y: Math.round(track.face.y), w: Math.round(track.face.w), h: Math.round(track.face.h), score: Math.round(track.face.score * 1000) / 1000 },
      picture: pictures.get(track.id).file,
      landmarks: pictures.get(track.id).landmarks,
    }))
    .sort((a, b) => a.time - b.time);

  return {
    file: path.resolve(file),
    name: path.basename(file),
    ...info,
    sha256: await fingerprint,
    window: { from: start, to: end },
    settings: { fps, maxSide, minFace, searchedAt: `${detW}x${detH}` },
    looks,
    facesFound: faceCount,
    facesTooSmall: tooSmall,
    stopped: Boolean(signal?.aborted),
    seconds: Math.round((Date.now() - started) / 100) / 10,
    tracks,
  };
}

/**
 * The whole frame at a track's moment as a JPEG, with a box round the face so
 * the person looking knows which one is meant. Read from the file again, so
 * no frame is kept during the scan.
 */
export async function markedFrame(file, record, track) {
  const { rgba, width, height } = await frameAt(file, track.time, record);
  const pad = Math.round(track.face.w * 0.25);
  const stroke = Math.max(3, Math.round(Math.max(width, height) / 400));
  const box = `<svg width="${width}" height="${height}"><rect x="${track.face.x - pad}" y="${track.face.y - pad}" width="${track.face.w + 2 * pad}" height="${track.face.h + 2 * pad}" fill="none" stroke="#facc15" stroke-width="${stroke}"/></svg>`;
  return image(rgba, width, height).composite([{ input: Buffer.from(box), top: 0, left: 0 }]).jpeg({ quality: 92 }).toBuffer();
}
