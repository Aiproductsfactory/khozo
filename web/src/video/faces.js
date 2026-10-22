// Faces in video frames: the pure part, which also runs under Node
// (scripts/video-faces-smoke.mjs).
//
// The detector is YuNet (OpenCV Zoo, MIT licence, about 230 KB): a small
// network that finds faces and five points on each (the eyes, the nose tip and
// the corners of the mouth). It only finds faces. It does not recognise
// anyone: comparing a face with a missing person's photo is still done by the
// face engines on the server, exactly as for a photo.
//
// This file turns the network's raw output into face boxes, and groups the
// faces found in one frame after another into "tracks", so that a person seen
// in fifty frames is shown and checked once, with their clearest picture.

/** The three scales YuNet looks at, in pixels per output cell. */
const STRIDES = [8, 16, 32];

/** A face needs at least this detector score to count. */
export const FACE_SCORE_MIN = 0.7;

/** Two boxes overlapping more than this are the same face (non-maximum suppression). */
export const NMS_IOU = 0.3;

/**
 * Faces narrower than this, in the video's own pixels, are counted but not
 * used: no face engine can compare a face this small with any confidence.
 */
export const MIN_FACE_PX = 36;

/** The side of a face picture made from a frame, in pixels. */
export const CROP_SIDE = 360;

/** How much of the frame around the face a picture shows: the face is about 40% of its width. */
export const CROP_MARGIN = 2.5;

/**
 * The network's input from RGBA pixels: blue, green, red planes (OpenCV's
 * order) of 0-255 values, padded with black on the right and bottom to a
 * multiple of 32, as OpenCV's FaceDetectorYN does.
 */
export function networkInput(rgba, width, height) {
  const padW = Math.ceil(width / 32) * 32;
  const padH = Math.ceil(height / 32) * 32;
  const plane = padW * padH;
  const data = new Float32Array(3 * plane);
  for (let y = 0; y < height; y += 1) {
    let src = y * width * 4;
    let dst = y * padW;
    for (let x = 0; x < width; x += 1, src += 4, dst += 1) {
      data[dst] = rgba[src + 2];
      data[plane + dst] = rgba[src + 1];
      data[2 * plane + dst] = rgba[src];
    }
  }
  return { data, padW, padH };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Faces from YuNet's twelve outputs (cls_, obj_, bbox_ and kps_ at each
 * stride), as OpenCV decodes them: `[{ x, y, w, h, score, landmarks }]` in
 * the input's pixels, before suppression. `outputs[name]` is a typed array.
 */
export function decodeFaces(outputs, padW, padH, scoreMin = FACE_SCORE_MIN) {
  const faces = [];
  for (const stride of STRIDES) {
    const cols = padW / stride;
    const rows = padH / stride;
    const cls = outputs[`cls_${stride}`];
    const obj = outputs[`obj_${stride}`];
    const bbox = outputs[`bbox_${stride}`];
    const kps = outputs[`kps_${stride}`];
    if (!cls || !obj || !bbox || !kps) continue;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        const score = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i]));
        if (score < scoreMin) continue;
        const cx = (c + bbox[i * 4]) * stride;
        const cy = (r + bbox[i * 4 + 1]) * stride;
        const w = Math.exp(bbox[i * 4 + 2]) * stride;
        const h = Math.exp(bbox[i * 4 + 3]) * stride;
        const landmarks = [];
        for (let n = 0; n < 5; n += 1) {
          landmarks.push([(kps[i * 10 + 2 * n] + c) * stride, (kps[i * 10 + 2 * n + 1] + r) * stride]);
        }
        faces.push({ x: cx - w / 2, y: cy - h / 2, w, h, score, landmarks });
      }
    }
  }
  return faces;
}

/** Intersection over union of two boxes. */
export function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Keeps the best of each group of overlapping boxes, best first. */
export function suppress(faces, threshold = NMS_IOU) {
  const kept = [];
  for (const face of [...faces].sort((a, b) => b.score - a.score)) {
    if (kept.every((k) => iou(k, face) <= threshold)) kept.push(face);
  }
  return kept;
}

/** Faces scaled from the detector's input back to the video's own pixels. */
export function scaleFaces(faces, scale) {
  if (scale === 1) return faces;
  return faces.map((f) => ({
    ...f,
    x: f.x * scale,
    y: f.y * scale,
    w: f.w * scale,
    h: f.h * scale,
    landmarks: f.landmarks.map(([x, y]) => [x * scale, y * scale]),
  }));
}

/**
 * How much the face looks at the camera, 0 (side on) to 1 (straight on), from
 * where the nose tip sits between the eyes and how far apart the eyes are.
 */
export function frontalness(face) {
  const [a, b, nose] = face.landmarks || [];
  if (!a || !b || !nose || !(face.w > 0)) return 0.5;
  const eyeDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (!(eyeDist > 0)) return 0;
  const midX = (a[0] + b[0]) / 2;
  const centred = 1 - Math.min(1, Math.abs(nose[0] - midX) / (eyeDist * 0.6));
  const open = Math.min(1, eyeDist / face.w / 0.35);
  return centred * open;
}

/**
 * How sharp a patch of luma is: the variance of its Laplacian, scaled so a
 * clear face reads about 1. `luma` is a Float32Array of `w` by `h`.
 */
export function sharpness(luma, w, h) {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const lap = luma[i - w] + luma[i + w] + luma[i - 1] + luma[i + 1] - 4 * luma[i];
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }
  const mean = sum / n;
  return Math.min(1, (sumSq / n - mean * mean) / 150);
}

/**
 * How good a picture of a face this is, 0 to 1: large, clearly a face,
 * looking at the camera and sharp. Used only to choose which of a person's
 * pictures to keep; it says nothing about who the person is.
 */
export function faceQuality(face, sharp = 0.5) {
  const size = Math.min(1, face.w / 112);
  return face.score * (0.3 + 0.7 * size) * (0.4 + 0.6 * frontalness(face)) * (0.5 + 0.5 * sharp);
}

/**
 * The square of the frame a face picture is cut from: CROP_MARGIN times the
 * face, centred a little below its middle so the chin is in, kept inside the
 * frame. Whole pixels.
 */
export function cropBox(face, frameW, frameH, margin = CROP_MARGIN) {
  const side = Math.max(1, Math.min(frameW, frameH, Math.round(Math.max(face.w, face.h) * margin)));
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h * 0.55;
  const x = Math.round(Math.min(Math.max(0, cx - side / 2), frameW - side));
  const y = Math.round(Math.min(Math.max(0, cy - side / 2), frameH - side));
  return { x, y, w: side, h: side };
}

/**
 * Groups the faces found in successive frames into one track per person.
 *
 * A face joins a track when it is near where that track was last seen, about
 * the same size, and no other face is about as near: when two faces could be
 * the same person, each keeps its own track. Splitting one person in two only
 * shows them twice; joining two people would hide one of them, and the one
 * hidden could be the person being looked for.
 *
 * `add(time, faces)` takes the faces of one frame, in the video's pixels, each
 * with its `quality`; it returns, for each face, the track it joined and
 * whether it is now that track's best picture. `tracks()` lists them.
 */
export function createTracker({ maxGap = 3 } = {}) {
  const all = [];
  let nextId = 1;

  function reach(track, face, dt) {
    const last = track.last;
    const size = Math.max(last.w, face.w);
    const ratio = face.w / last.w;
    if (ratio < 0.67 || ratio > 1.5) return Infinity;
    const dx = last.x + last.w / 2 - (face.x + face.w / 2);
    const dy = last.y + last.h / 2 - (face.y + face.h / 2);
    const dist = Math.hypot(dx, dy) / size;
    return dist <= 1 + 2 * dt ? dist : Infinity;
  }

  return {
    add(time, faces) {
      const live = all.filter((t) => time - t.lastTime <= maxGap && time > t.lastTime);
      const cost = faces.map((face) => live.map((track) => reach(track, face, time - track.lastTime)));
      const takenTrack = new Set();
      const assigned = new Array(faces.length).fill(null);
      // The nearest pairs first; a pair is joined only when neither has a
      // rival nearly as near.
      const pairs = [];
      faces.forEach((_, fi) => live.forEach((_, ti) => {
        if (Number.isFinite(cost[fi][ti])) pairs.push([cost[fi][ti], fi, ti]);
      }));
      pairs.sort((a, b) => a[0] - b[0]);
      for (const [c, fi, ti] of pairs) {
        if (assigned[fi] != null || takenTrack.has(ti)) continue;
        const near = Math.max(c * 1.5, c + 0.25);
        const rivalFace = faces.some((_, other) => other !== fi && assigned[other] == null && cost[other][ti] < near);
        const rivalTrack = live.some((_, other) => other !== ti && !takenTrack.has(other) && cost[fi][other] < near);
        if (rivalFace || rivalTrack) continue;
        assigned[fi] = ti;
        takenTrack.add(ti);
      }
      return faces.map((face, fi) => {
        let track = assigned[fi] != null ? live[assigned[fi]] : null;
        if (!track) {
          track = { id: nextId, firstTime: time, lastTime: time, seen: 0, best: null, bestTime: time, last: face };
          nextId += 1;
          all.push(track);
        }
        track.seen += 1;
        track.last = face;
        track.lastTime = time;
        const better = !track.best || (face.quality ?? 0) > (track.best.quality ?? 0);
        if (better) {
          track.best = face;
          track.bestTime = time;
        }
        return { track, better };
      });
    },
    tracks() {
      return all.map((t) => ({ id: t.id, firstTime: t.firstTime, lastTime: t.lastTime, seen: t.seen, time: t.bestTime, face: t.best }));
    },
  };
}

/** "0:07", "12:05", "1:02:09": a time in a video, for people. */
export function formatVideoTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * How often to look at a video, in seconds, so that a long one is still read
 * in a reasonable time: every quarter second for a short phone video, up to
 * every two seconds, and never more than `maxSamples` looks in all unless the
 * caller asks for a set interval.
 */
export function sampleInterval(duration, { maxSamples = 300, min = 0.25, max = 2 } = {}) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d <= 0) return 1;
  return Math.min(max, Math.max(min, d / maxSamples));
}

/** The times at which a video of `duration` seconds is looked at. */
export function sampleTimes(duration, interval) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d <= 0) return [0];
  const step = Math.max(0.05, Number(interval) || 1);
  const times = [];
  // Half a step in, so a one-second clip is still looked at, and never at the
  // very end, where many videos have no frame to show.
  for (let t = Math.min(step / 2, d / 2); t < d - 0.05; t += step) times.push(Number(t.toFixed(3)));
  return times.length ? times : [d / 2];
}
