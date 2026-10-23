// Watching one live camera for one person (spec scenario 11), on the laptop.
//
// The same method as reading a recorded video (scan.js): look a few times a
// second, find the faces, follow each person from one look to the next. What
// differs is what is kept. A recorded check keeps a picture of everyone seen,
// for "Everyone seen"; a live watch keeps nothing of a passer-by. Each
// person's face is compared on the laptop, with Aarakshak's model, against the
// case's face signatures as it is seen; only a face at or above the line is
// kept (its picture, and the whole frame with the face marked, both handed to
// the caller to store encrypted), and everyone else is forgotten at once.
// Nothing of the stream is recorded.
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import {
  CROP_SIDE, MIN_FACE_PX, createTracker, cropBox, faceQuality, scaleFaces, sharpness,
} from '../../web/src/video/faces.js';
import { ffmpegPath, ffprobePath } from './ffmpeg.js';
import { comparisonCopy, pointsOnCopy } from './compare-copy.js';
import { closeness, pictureSignature } from './local-match.js';

/** The addresses a camera's stream may have: RTSP (most DVRs and IP cameras), HTTP, UDP, RTP, SRT. */
const STREAM = /^(rtsps?|https?|udp|rtp|srt):\/\//i;
export const isStreamAddress = (value) => STREAM.test(String(value || '').trim());

/** A stream address with any password in it hidden, for screens and logs. */
export function safeAddress(value) {
  return String(value || '').replace(/\/\/([^@/\s]+)@/, '//***@');
}

/** FFmpeg's input options for a stream: TCP for RTSP (the DVRs' usual), and a time limit on silence. */
function inputArgs(address) {
  // Two seconds to learn what the stream holds, not FFmpeg's five: the watch starts sooner.
  const args = ['-analyzeduration', '2000000', '-probesize', '2000000'];
  if (/^rtsps?:/i.test(address)) args.push('-rtsp_transport', 'tcp');
  // Give up after 15 seconds with no data, so a camera that went off is noticed.
  if (/^(rtsps?|https?|srt):/i.test(address)) args.push('-rw_timeout', '15000000');
  if (/^udp:/i.test(address)) args.push('-timeout', '15000000');
  return args;
}

/** The size of a stream's pictures, or throws when the camera does not answer. */
export function probeStream(address, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, ['-v', 'error', ...inputArgs(address), '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', address], { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('The camera did not answer. Check its address and that this laptop can reach it.')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const stream = JSON.parse(out || '{}').streams?.[0];
        if (code === 0 && stream?.width > 0 && stream?.height > 0) return resolve({ width: stream.width, height: stream.height });
      } catch { /* answered below */ }
      reject(new Error(safeAddress(err.trim()) || 'The camera did not answer. Check its address and that this laptop can reach it.'));
    });
  });
}

/** A frame's RGBA pixels as a sharp image. */
const image = (rgba, width, height) => sharp(rgba, { raw: { width, height, channels: 4 } });

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

async function cropPicture(rgba, width, height, face) {
  const box = cropBox(face, width, height);
  const side = Math.max(CROP_SIDE, Math.min(960, box.w));
  const k = side / box.w;
  const jpeg = await image(rgba, width, height).extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .resize(side, side).jpeg({ quality: 90 }).toBuffer();
  const landmarks = (face.landmarks || []).map(([x, y]) => [Math.round((x - box.x) * k * 10) / 10, Math.round((y - box.y) * k * 10) / 10]);
  return { jpeg, landmarks };
}

async function markedFrame(rgba, width, height, face) {
  const pad = Math.round(face.w * 0.25);
  const stroke = Math.max(3, Math.round(Math.max(width, height) / 400));
  const box = `<svg width="${width}" height="${height}"><rect x="${face.x - pad}" y="${face.y - pad}" width="${face.w + 2 * pad}" height="${face.h + 2 * pad}" fill="none" stroke="#facc15" stroke-width="${stroke}"/></svg>`;
  return image(rgba, width, height).composite([{ input: Buffer.from(box), top: 0, left: 0 }]).jpeg({ quality: 88 }).toBuffer();
}

/** A person's face is compared again only when its picture is this much clearer, at most this often. */
const RESCORE_GAIN = 1.2;
const MAX_SCORES = 3;

/**
 * Watches `address` until `until` (a time in ms) or `signal`, and resolves to
 * what was seen: `{ seconds, looks, people, facesTooSmall, close }`.
 *
 *   caseSignatures  the case's face signatures, `[{ signature }]`
 *   line            closeness at or above which a face is kept
 *   onClose({ id, time, firstTime, lastTime, closeness, quality, face, picture, frame, landmarks })
 *                   a face close to the case: `picture` and `frame` are JPEG
 *                   bytes for the caller to store; called again with a clearer
 *                   picture of the same person
 *   onProgress({ seconds, looks, people, facesTooSmall, close })   every few seconds
 *   onStall(err)    the stream stopped; it is opened again after a pause
 */
export async function watchStream(address, {
  until, fps = 2, maxSide = 960, minFace = MIN_FACE_PX, scoreMin, detector, recognizer, caseSignatures, line = 0.25,
  idPrefix = '', startedAt = Date.now(), onClose = () => {}, onProgress = () => {}, onStall = () => {}, signal, reconnectMs = 10000,
}) {
  const tracker = createTracker({ maxGap: Math.max(3, 3 / fps) });
  const scored = new Map(); // track id -> { quality, times, kept }
  const sigs = caseSignatures.map((s) => ({ signature: s.signature instanceof Float32Array ? s.signature : Float32Array.from(s.signature) }));
  let looks = 0;
  let tooSmall = 0;
  let close = 0;
  let lastProgress = 0;
  const seconds = () => (Date.now() - startedAt) / 1000;
  const over = () => signal?.aborted || Date.now() >= until;
  const report = () => onProgress({ seconds: Math.round(seconds()), looks, people: tracker.tracks().length, facesTooSmall: tooSmall, close });

  async function look(rgba, width, height, detW, detH, back) {
    const t = Math.round(seconds() * 10) / 10;
    const det = detW !== width ? await image(rgba, width, height).resize(detW, detH, { fit: 'fill' }).raw().toBuffer() : rgba;
    const found = scaleFaces(await detector.detect(det, detW, detH, scoreMin ?? undefined), back);
    looks += 1;
    const usable = [];
    for (const face of found) {
      if (face.w < minFace) { tooSmall += 1; continue; }
      const inDet = { x: face.x / back, y: face.y / back, w: face.w / back, h: face.h / back };
      usable.push({ ...face, quality: faceQuality(face, faceSharpness(det, detW, detH, inDet)) });
    }
    for (const { track, better } of tracker.add(t, usable)) {
      if (!better) continue;
      const seen = scored.get(track.id) || { quality: 0, times: 0, kept: false };
      if (seen.times >= MAX_SCORES && !seen.kept) continue;
      if (seen.times && track.best.quality < seen.quality * RESCORE_GAIN) continue;
      const { jpeg, landmarks } = await cropPicture(rgba, width, height, track.best);
      // The copy Khozo is sent, as for a recorded video (local-match.js trackSignature).
      const side = (await sharp(jpeg).metadata()).width;
      const signature = await pictureSignature(await comparisonCopy(jpeg), { detector, recognizer, points: pointsOnCopy(landmarks, side) }).catch(() => null);
      seen.times += 1;
      seen.quality = track.best.quality;
      scored.set(track.id, seen);
      if (!signature) continue;
      const score = closeness(signature, sigs);
      if (score < line) continue;
      if (!seen.kept) close += 1;
      seen.kept = true;
      await onClose({
        id: `${idPrefix}t${track.id}`, time: t, firstTime: track.firstTime, lastTime: track.lastTime, closeness: score,
        quality: Math.round(track.best.quality * 1000) / 1000,
        face: { x: Math.round(track.best.x), y: Math.round(track.best.y), w: Math.round(track.best.w), h: Math.round(track.best.h), score: Math.round(track.best.score * 1000) / 1000 },
        picture: jpeg, landmarks, frame: await markedFrame(rgba, width, height, track.best),
      });
    }
    if (Date.now() - lastProgress > 5000) {
      lastProgress = Date.now();
      report();
    }
  }

  async function readOnce() {
    const { width, height } = await probeStream(address);
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const detW = Math.max(32, Math.round((width * scale) / 2) * 2);
    const detH = Math.max(32, Math.round((height * scale) / 2) * 2);
    const back = width / detW;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', ...inputArgs(address), '-i', address, '-an', '-vf', `fps=${fps}`, '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1'];
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    const stop = () => child.kill();
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setInterval(() => { if (Date.now() >= until) child.kill(); }, 1000);
    const frameBytes = width * height * 4;
    let pending = [];
    let pendingBytes = 0;
    try {
      for await (const chunk of child.stdout) {
        pending.push(chunk);
        pendingBytes += chunk.length;
        while (pendingBytes >= frameBytes) {
          const all = pending.length === 1 ? pending[0] : Buffer.concat(pending);
          const frame = all.subarray(0, frameBytes);
          const rest = all.subarray(frameBytes);
          pending = rest.length ? [rest] : [];
          pendingBytes = rest.length;
          if (over()) { child.kill(); break; }
          await look(frame, width, height, detW, detH, back);
        }
      }
    } finally {
      clearInterval(timer);
      signal?.removeEventListener('abort', stop);
    }
    if (!over()) throw new Error(safeAddress(err.trim()) || 'The camera stopped sending pictures.');
  }

  while (!over()) {
    try {
      await readOnce();
    } catch (err) {
      if (over()) break;
      onStall(err);
      report();
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, reconnectMs);
        signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  }
  report();
  return { seconds: Math.round(seconds()), looks, people: tracker.tracks().length, facesTooSmall: tooSmall, close };
}
