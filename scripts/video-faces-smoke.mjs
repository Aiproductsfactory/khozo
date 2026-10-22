/**
 * Checks video in Khozo (shared/video-search.js, web/src/video/): the face
 * finder's output read the way OpenCV reads it, faces followed from frame to
 * frame without two people ever being joined, the file fingerprint, and the
 * engines' verdict on each face from a video.
 *
 * Needs no fixtures. When a folder of real photographs is given, the face
 * finder itself is also run on them (the photos are never committed: see
 * test-assets/faces/README.md):
 *
 *   node scripts/video-faces-smoke.mjs
 *   KHOZO_FACE_SAMPLES=path/to/photos node scripts/video-faces-smoke.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  CROP_MARGIN, MIN_FACE_PX, createTracker, cropBox, decodeFaces, faceQuality, formatVideoTime, frontalness,
  iou, networkInput, sampleInterval, sampleTimes, scaleFaces, sharpness, suppress,
} from '../web/src/video/faces.js';
import { createSha256 } from '../web/src/video/sha256.js';
import { compareFramesWithCase, frameVerdict } from '../shared/match-pipeline.js';
import { FRAME_VERDICTS, VIDEO_SEARCH_BATCH, videoFrameTimesOf, videoSearchRecord } from '../shared/video-search.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// ---- The network's input --------------------------------------------------------

{
  // A 2 x 1 picture: one red pixel, one blue.
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
  const { data, padW, padH } = networkInput(rgba, 2, 1);
  const plane = padW * padH;
  check('the input is padded to a multiple of 32', padW === 32 && padH === 32);
  check('in blue, green, red order, as OpenCV feeds it', data[0] === 0 && data[2 * plane] === 255 && data[1] === 255 && data[2 * plane + 1] === 0);
  check('the padding is black', data[2] === 0 && data[plane + 40] === 0);
}

// ---- Reading the network's output -----------------------------------------------

/** YuNet-shaped outputs with nothing found, and a way to put one face in. */
function emptyOutputs(padW, padH) {
  const out = {};
  for (const s of [8, 16, 32]) {
    const n = (padW / s) * (padH / s);
    out[`cls_${s}`] = new Float32Array(n);
    out[`obj_${s}`] = new Float32Array(n);
    out[`bbox_${s}`] = new Float32Array(n * 4);
    out[`kps_${s}`] = new Float32Array(n * 10);
  }
  return out;
}
function putFace(out, padW, stride, row, col, { score = 0.95, dx = 0.5, dy = 0.5, w = 4, h = 5 } = {}) {
  const i = row * (padW / stride) + col;
  out[`cls_${stride}`][i] = score;
  out[`obj_${stride}`][i] = score;
  out[`bbox_${stride}`].set([dx, dy, Math.log(w), Math.log(h)], i * 4);
  out[`kps_${stride}`].set([-0.6, -0.5, 1.6, -0.5, 0.5, 0.3, -0.3, 1.2, 1.3, 1.2], i * 10);
}

{
  const out = emptyOutputs(64, 64);
  putFace(out, 64, 16, 1, 2);
  const faces = decodeFaces(out, 64, 64);
  const f = faces[0];
  check('one face is read where the network put it', faces.length === 1 && Math.abs(f.x - (2.5 * 16 - 32)) < 1e-4 && Math.abs(f.y - (1.5 * 16 - 40)) < 1e-4 && Math.abs(f.w - 64) < 1e-4, JSON.stringify(f && { x: f.x, y: f.y, w: f.w, h: f.h }));
  check('its score is the root of class and object scores', Math.abs(f.score - 0.95) < 1e-6);
  check('its five points are placed on the grid', Math.abs(f.landmarks[2][0] - 2.5 * 16) < 1e-6 && Math.abs(f.landmarks[2][1] - 1.3 * 16) < 1e-6);
  const weak = emptyOutputs(64, 64);
  putFace(weak, 64, 8, 2, 2, { score: 0.5 });
  check('a weak score is not a face', decodeFaces(weak, 64, 64).length === 0);
}

{
  const a = { x: 0, y: 0, w: 10, h: 10, score: 0.9 };
  const b = { x: 1, y: 1, w: 10, h: 10, score: 0.95 };
  const c = { x: 30, y: 30, w: 10, h: 10, score: 0.8 };
  check('overlap is measured', Math.abs(iou(a, b) - 81 / 119) < 1e-9 && iou(a, c) === 0);
  const kept = suppress([a, b, c]);
  check('overlapping boxes keep only the best', kept.length === 2 && kept[0] === b && kept[1] === c);
  const scaled = scaleFaces([{ ...a, landmarks: [[2, 3]] }], 2)[0];
  check('faces scale back to the video’s pixels', scaled.w === 20 && scaled.landmarks[0][0] === 4);
}

// ---- Choosing each person's clearest picture -------------------------------------

const face = (x, y, w = 60, extra = {}) => ({
  x, y, w, h: w * 1.2, score: 0.9,
  landmarks: [[x + w * 0.3, y + w * 0.4], [x + w * 0.7, y + w * 0.4], [x + w * 0.5, y + w * 0.65], [x + w * 0.35, y + w * 0.9], [x + w * 0.65, y + w * 0.9]],
  ...extra,
});

{
  const straight = face(0, 0);
  const turned = { ...straight, landmarks: straight.landmarks.map(([x, y], i) => (i === 2 ? [x + 20, y] : [x, y])) };
  check('a face looking at the camera reads as frontal', frontalness(straight) > 0.9, frontalness(straight).toFixed(2));
  check('a turned face reads as less frontal', frontalness(turned) < frontalness(straight) - 0.3, frontalness(turned).toFixed(2));
  check('a larger, frontal, sharper face is a better picture', faceQuality(face(0, 0, 112), 1) > faceQuality(face(0, 0, 40), 1) && faceQuality(straight, 1) > faceQuality(turned, 1) && faceQuality(straight, 1) > faceQuality(straight, 0));
  const flat = new Float32Array(32 * 32).fill(100);
  const checker = Float32Array.from({ length: 32 * 32 }, (_, i) => (((i % 32) + Math.floor(i / 32)) % 2 ? 0 : 255));
  check('a flat patch is not sharp, a busy one is', sharpness(flat, 32, 32) === 0 && sharpness(checker, 32, 32) === 1);
}

{
  const box = cropBox(face(10, 10, 40), 640, 360);
  check('a face picture is a square around the face, inside the frame', box.w === box.h && box.w === Math.round(48 * CROP_MARGIN) && box.x >= 0 && box.y >= 0, JSON.stringify(box));
  const edge = cropBox(face(620, 330, 40), 640, 360);
  check('near the edge it is moved in, not cut off', edge.x + edge.w <= 640 && edge.y + edge.h <= 360, JSON.stringify(edge));
  const huge = cropBox(face(0, 0, 500), 640, 360);
  check('it is never larger than the frame', huge.w <= 360 && huge.h <= 360);
}

{
  // One person walking slowly across, seen every half second.
  const tracker = createTracker();
  let best = null;
  for (let i = 0; i < 8; i += 1) {
    const f = face(100 + i * 20, 100, 60, { quality: i === 5 ? 0.9 : 0.3 });
    const [joined] = tracker.add(i * 0.5, [f]);
    if (joined.better) best = joined.track.best;
  }
  const tracks = tracker.tracks();
  check('a person seen in eight frames is one track', tracks.length === 1 && tracks[0].seen === 8, `${tracks.length} tracks`);
  check('and keeps their clearest picture', tracks[0].time === 2.5 && best?.quality === 0.9, String(tracks[0].time));
}

{
  // Two people side by side, each staying put: two tracks, never one.
  const tracker = createTracker();
  for (let i = 0; i < 4; i += 1) tracker.add(i, [face(100, 100, 60, { quality: 0.5 }), face(170, 100, 60, { quality: 0.5 })]);
  const tracks = tracker.tracks();
  check('two people side by side stay two people', tracks.length === 2 && tracks.every((t) => t.seen === 4), tracks.map((t) => t.seen).join());
}

{
  // A face that could be either of two people is given a track of its own.
  const tracker = createTracker();
  tracker.add(0, [face(100, 100, 60, { quality: 0.5 }), face(220, 100, 60, { quality: 0.5 })]);
  tracker.add(1, [face(160, 100, 60, { quality: 0.5 })]);
  check('a face halfway between two people joins neither', tracker.tracks().length === 3, `${tracker.tracks().length} tracks`);
}

{
  const tracker = createTracker({ maxGap: 3 });
  tracker.add(0, [face(100, 100, 60, { quality: 0.5 })]);
  tracker.add(10, [face(100, 100, 60, { quality: 0.5 })]);
  tracker.add(11, [face(100, 100, 120, { quality: 0.5 })]);
  check('a face seen again long after, or twice the size, starts a new track', tracker.tracks().length === 3);
}

{
  check('times in a video read as people say them', formatVideoTime(7.9) === '0:07' && formatVideoTime(725) === '12:05' && formatVideoTime(3729) === '1:02:09');
  check('a short video is looked at often, a long one less', sampleInterval(20) === 0.25 && sampleInterval(3600) === 2 && sampleInterval(150) === 0.5);
  const times = sampleTimes(10, 1);
  check('looks start half a step in and stop before the end', times[0] === 0.5 && times.at(-1) === 9.5 && times.length === 10, times.join());
  check('a very short clip is still looked at', sampleTimes(0.3, 1).length === 1);
  check('faces narrower than the minimum are not used', MIN_FACE_PX >= 32);
}

// ---- The file's fingerprint ---------------------------------------------------------

{
  let same = true;
  for (const size of [0, 1, 55, 56, 63, 64, 65, 119, 1000, 70000]) {
    const bytes = crypto.randomBytes(size);
    const whole = createSha256().update(bytes).hex();
    const pieces = createSha256();
    for (let i = 0; i < size;) {
      const n = 1 + Math.floor(Math.random() * 97);
      pieces.update(bytes.subarray(i, i + n));
      i += n;
    }
    const expected = crypto.createHash('sha256').update(bytes).digest('hex');
    if (whole !== expected || pieces.hex() !== expected) same = false;
  }
  check('the fingerprint is SHA-256, whole or in pieces', same);
  check('of nothing, it is the known value', createSha256().hex() === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
}

// ---- What the engines say about each face --------------------------------------------

{
  const t = { reviewThreshold: 0.35, confirmThreshold: 0.8 };
  const ans = (score) => ({ status: 'answered', score });
  const cases = [
    [ans(0.9), ans(0.95), 'likely'],
    [ans(0.9), ans(0.5), 'not_agreed'],
    [ans(0.9), { status: 'not_configured' }, 'possible'],
    [ans(0.9), { status: 'no_answer' }, 'possible'],
    [ans(0.1), { status: 'not_asked' }, 'unlikely'],
    [{ status: 'no_face' }, ans(0.85), 'possible'],
    [{ status: 'no_answer' }, ans(0.4), 'unlikely'],
    [{ status: 'no_face' }, { status: 'no_face' }, 'no_face'],
    [{ status: 'no_face' }, { status: 'not_configured' }, 'no_face'],
    [{ status: 'no_answer' }, { status: 'no_answer' }, 'no_answer'],
    [{ status: 'answered', score: 'x' }, { status: 'not_configured' }, 'no_answer'],
  ];
  const wrong = cases.filter(([a, r, want]) => frameVerdict(a, r, t).verdict !== want);
  check('each face gets the verdict the matching rules give it', !wrong.length, wrong.map(([a, r, w]) => `${a.status}/${r.status}→${w}`).join('; '));
  check('every verdict is one the client knows', cases.every(([a, r]) => FRAME_VERDICTS.includes(frameVerdict(a, r, t).verdict)));
}

{
  const calls = { aarakshak: [], rekognition: [] };
  const personOf = (buf) => /FACE:(\w+)/.exec(String(buf))?.[1] || null;
  const score = (a, b) => (String(a).includes('NOFACE') ? { status: 'no_face' } : { status: 'answered', score: personOf(a) === personOf(b) ? 0.9 : 0.05 });
  const providers = {
    aarakshak: { ready: true, compare: async (s, tg) => { calls.aarakshak.push([String(s), String(tg)]); return score(s, tg); } },
    rekognition: { ready: true, compare: async (s, tg) => { calls.rekognition.push([String(s), String(tg)]); return score(s, tg); } },
  };
  const frames = ['FACE:K', 'FACE:X', 'FACE:Y', 'NOFACE', 'FACE:K'].map((label, id) => ({ id, buffer: Buffer.from(label) }));
  const results = await compareFramesWithCase({ casePhotoBuf: Buffer.from('CASE FACE:K'), frames, providers, reviewThreshold: 0.35 });
  check('each face is answered in the order sent', results.map((r) => r.id).join() === '0,1,2,3,4');
  check('the person is found twice and strangers are not', results.map((r) => r.verdict).join() === 'likely,unlikely,unlikely,no_face,likely', results.map((r) => r.verdict).join());
  check('the face from the video is always the source', calls.aarakshak.every(([s, tg]) => !s.startsWith('CASE') && tg.startsWith('CASE')));
  check('the second engine is asked only about possible matches and faces the first could not read', calls.rekognition.length === 3, `${calls.rekognition.length} calls`);
}

// ---- The request and the sighting ------------------------------------------------------

{
  const good = videoSearchRecord({ searchId: 'vs_abc12345', cameraPlace: 'Kalupur station gate', videoSha256: 'A'.repeat(64), videoBytes: '2048', times: '1.25,7,x,-1', recordedFrom: '2026-10-20T14:30' });
  check('a search is recorded with its camera, fingerprint and moments', !good.error && good.cameraPlace === 'Kalupur station gate' && good.videoSha256 === 'a'.repeat(64) && good.videoBytes === 2048 && good.times.join() === '1.3,7' && good.recordedFrom === '2026-10-20T14:30', JSON.stringify(good));
  check('a search with no reference is refused', Boolean(videoSearchRecord({ cameraPlace: 'Gate 1' }).error));
  check('a search that does not say where the camera is, is refused', Boolean(videoSearchRecord({ searchId: 'vs_abc12345', cameraPlace: ' a ' }).error));
  check('a malformed fingerprint or time is dropped, not stored', videoSearchRecord({ searchId: 'vs_abc12345', cameraPlace: 'Gate 1', videoSha256: 'nothex', recordedFrom: 'soon' }).videoSha256 === null);
  check('a request carries at most five faces', VIDEO_SEARCH_BATCH === 5);
  check('a sighting keeps up to three video moments', videoFrameTimesOf('0:12, 1:02:09, 99, 0:47, 0:50')?.join() === '0:12,1:02:09,0:47' && videoFrameTimesOf('soon') === null);
}

// ---- The face finder itself, on real photographs, when given some ------------------------

const samples = process.env.KHOZO_FACE_SAMPLES || path.join(root, 'test-assets', 'faces');
const photos = fs.existsSync(samples) ? fs.readdirSync(samples).filter((f) => /\.(jpe?g|png)$/i.test(f)).map((f) => path.join(samples, f)) : [];
let sharp = null;
let ort = null;
try {
  sharp = (await import('sharp')).default;
  ort = await import('onnxruntime-web');
} catch {
  // Either is missing: the run on real photographs is skipped below.
}
if (!photos.length || !sharp || !ort) {
  console.log('  (no photographs, sharp or onnxruntime-web: the face finder is not run on real faces)');
} else {
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(path.join(root, 'web', 'src', 'video', 'yunet-2026may.onnx'));
  let withFace = 0;
  for (const file of photos) {
    const { data, info } = await sharp(file).resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const input = networkInput(data, info.width, info.height);
    const out = await session.run({ input: new ort.Tensor('float32', input.data, [1, 3, input.padH, input.padW]) });
    const raw = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.data]));
    if (suppress(decodeFaces(raw, input.padW, input.padH)).length) withFace += 1;
  }
  check('the face finder finds a face in the sample photographs', withFace === photos.length, `${withFace} of ${photos.length}`);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
