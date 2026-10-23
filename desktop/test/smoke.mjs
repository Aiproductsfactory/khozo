/**
 * Checks Khozo Desktop's scanner and its talk with Khozo, with no real case
 * and no real face:
 *
 * - lining a face up for recognition (align.js) and the model's input (recognizer.js);
 * - FFmpeg reading a file and a window of it (ffmpeg.js);
 * - a whole scan of a made-up video (scan.js, with the real face finder);
 * - compare.mjs against a stand-in Khozo that checks each request with
 *   Khozo's own rules (shared/video-search.js) and answers, in turn, "slow
 *   down", "no engine answered" and a server fault, to see the waiting and
 *   the one-at-a-time fallback; then a second run that sends nothing again,
 *   and a closed case that stops the run.
 *
 * With KHOZO_FACE_MODEL set to Aarakshak's model, the model is loaded and a
 * face's signature is checked to be stable.
 *
 *   cd desktop && npm test
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ARCFACE_POINTS, alignFace, robustSimilarity, similarityTransform } from '../scanner/align.js';
import { applyAdapter, cosine, fuse, loadAdapter, loadRecognizer, modelInput, normalise, readModelCard } from '../scanner/recognizer.js';
import { readNpz } from '../scanner/npz.js';
import { ffmpegPath, probe, readFrames, sha256File } from '../scanner/ffmpeg.js';
import { loadDetector } from '../scanner/detector.js';
import { parseTime, scanFile } from '../scanner/scan.js';
import { chooseToSend } from '../scanner/local-match.js';
import { VIDEO_SEARCH_BATCH, videoSearchRecord } from '../../shared/video-search.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const compareBin = path.join(here, '..', 'bin', 'compare.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khozo-desktop-smoke-'));
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`);
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function run(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

// ---- Lining a face up ------------------------------------------------------------

console.log('Lining faces up');
{
  const moved = ARCFACE_POINTS.map(([x, y]) => [x * 2 + 10, y * 2 + 20]);
  const m = similarityTransform(moved, ARCFACE_POINTS);
  check('a doubled, shifted face is brought back by half and shifted back', near(m.a, 0.5) && near(m.b, 0) && near(m.tx, -5) && near(m.ty, -10), JSON.stringify(m));

  const turn = Math.PI / 6;
  const turned = ARCFACE_POINTS.map(([x, y]) => [1.5 * (Math.cos(turn) * x - Math.sin(turn) * y) + 40, 1.5 * (Math.sin(turn) * x + Math.cos(turn) * y) + 7]);
  const back = similarityTransform(turned, ARCFACE_POINTS);
  check('a turned face is turned back by the same angle', near(Math.atan2(back.b, back.a), -turn, 1e-6) && near(Math.hypot(back.a, back.b), 1 / 1.5, 1e-6));
  check('points all in one place give no answer', similarityTransform([[1, 1], [1, 1]], [[0, 0], [5, 5]]) === null);

  // A picture whose colour says where each pixel is: the lined-up face must
  // take each of its five points from where the face's points were.
  const W = 400; const H = 400;
  const pixels = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 3;
      pixels[i] = Math.round((x / W) * 255); pixels[i + 1] = Math.round((y / H) * 255); pixels[i + 2] = 128;
    }
  }
  const points = ARCFACE_POINTS.map(([x, y]) => [x * 2.4 + 60, y * 2.4 + 50]);
  const lined = alignFace(pixels, W, H, 3, points);
  const off = ARCFACE_POINTS.map(([u, v], k) => {
    const i = (Math.round(v) * 112 + Math.round(u)) * 3;
    const want = [points[k][0] / W * 255, points[k][1] / H * 255];
    return Math.max(Math.abs(lined[i] - want[0]), Math.abs(lined[i + 1] - want[1]));
  });
  check('each of the five points is read from where the face had it', lined.length === 112 * 112 * 3 && off.every((d) => d <= 3), off.map((d) => d.toFixed(1)).join(' '));
  const outside = alignFace(pixels, W, H, 3, ARCFACE_POINTS.map(([x, y]) => [x - 300, y - 300]));
  check('what falls outside the picture is black', outside[0] === 0 && outside[1] === 0 && outside[2] === 0);

  // OpenCV's own answers (cv2.estimateAffinePartial2D, LMEDS, OpenCV 4.13),
  // which Aarakshak lines faces up with: a clean face, the same face with its
  // nose pushed aside (OpenCV leaves the nose out), and the five points of a
  // real photograph where OpenCV keeps three of them.
  const opencv = [
    ['a clean face', [[151.90704345703125, 174.07113647460938], [236.476318359375, 173.60336303710938], [194.46047973632812, 222.1678466796875], [159.71832275390625, 271.6772155761719], [229.7517547607422, 271.28985595703125]], [0.41666665561671345, -1.775469778366532e-8, -24.999994153989505, -20.833337887047005]],
    ['a nose pushed aside', [[151.90704345703125, 174.07113647460938], [236.476318359375, 173.60336303710938], [224.46047973632812, 222.1678466796875], [159.71832275390625, 271.6772155761719], [229.7517547607422, 271.28985595703125]], [0.41666665572929934, -1.774752985088035e-8, -24.99999423930228, -20.833338799739252]],
    ['a photograph whose mouth corners disagree', [[496, 353], [605, 359], [548, 417], [493, 454], [596, 459]], [0.3243495286052236, 0.018292685266638676, -129.2177378963587, -53.69722550230627]],
  ];
  for (const [name, points, [a, minusB, tx, ty]] of opencv) {
    const m = robustSimilarity(points, ARCFACE_POINTS);
    check(`${name} is lined up exactly as OpenCV lines it up`, near(m.a, a, 1e-9) && near(-m.b, minusB, 1e-9) && near(m.tx, tx, 1e-7) && near(m.ty, ty, 1e-7), JSON.stringify(m));
  }
  const lsq = similarityTransform([[496, 353], [605, 359], [548, 417], [493, 454], [596, 459]], ARCFACE_POINTS);
  check('a plain least-squares fit would line that photograph up differently', Math.abs(lsq.a - 0.3243495286052236) > 0.01);
}

// ---- The model's card and input ----------------------------------------------------

console.log('The face model');
{
  const modelPath = path.join(tmp, 'model.onnx');
  fs.writeFileSync(path.join(tmp, 'model.json'), JSON.stringify({ name: 'test-model' }));
  let refused = false;
  try { readModelCard(modelPath); } catch { refused = true; }
  check('a model whose card has no version is refused', refused);
  fs.writeFileSync(path.join(tmp, 'model.json'), JSON.stringify({ name: 'test-model', version: '1', input: { size: 2, channels: 'bgr', mean: 127.5, std: 127.5, layout: 'nchw' } }));
  const card = readModelCard(modelPath);
  check('the card is read with its size, order and scaling', card.size === 2 && card.channels === 'bgr' && card.mean.length === 3 && card.layout === 'nchw');
  // Four pixels, red ones: in a blue-green-red model the red plane comes last.
  const rgb = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]);
  const input = modelInput(rgb, card);
  check('a red face reaches a blue-green-red model in its last plane', near(input[0], -1) && near(input[8], 1, 1e-6) && near(input[11], 1, 1e-6));
  check('signatures are compared by their cosine', near(cosine(normalise([1, 0]), normalise([1, 1])), Math.SQRT1_2) && near(cosine([2, 0], [5, 0]), 1));
  check('without a model, nothing is loaded and every face goes to Khozo', (await loadRecognizer({ modelPath: '' })) === null);

  // A card given itself names its model, adapter and face finder, beside it.
  const cardPath = path.join(tmp, 'aarakshak.json');
  fs.writeFileSync(cardPath, JSON.stringify({ name: 'aarakshak-fr', version: 'test', model: 'r100.onnx', adapter: 'adapter.npz', fusionBaseWeight: 0, detector: 'yunet.onnx', detectorScore: 0.6, input: { channels: 'bgr', mean: 0, std: 1 } }));
  const given = readModelCard(cardPath);
  check('a card names its model, adapter and face finder, beside it', given.modelPath === path.join(tmp, 'r100.onnx') && given.adapterPath === path.join(tmp, 'adapter.npz') && given.detectorPath === path.join(tmp, 'yunet.onnx') && given.detectorScore === 0.6 && given.fusionBaseWeight === 0 && given.mean.join() === '0,0,0');
  fs.writeFileSync(cardPath, JSON.stringify({ name: 'x', version: '1', model: 'r100.onnx', fusionBaseWeight: 0.5 }));
  let noAdapter = false;
  try { readModelCard(cardPath); } catch { noAdapter = true; }
  check('joining signatures without an adapter is refused', noAdapter);
}

// ---- Aarakshak's adapter ----------------------------------------------------------

console.log('The adapter');
{
  // .npy arrays in a zip, as NumPy's savez writes them (stored, zip64 sizes).
  const npy = (shape, values) => {
    let header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
    header += ' '.repeat(63 - ((10 + header.length) % 64)) + '\n';
    const head = Buffer.alloc(10);
    head[0] = 0x93; head.write('NUMPY', 1, 'latin1'); head[6] = 1; head[7] = 0; head.writeUInt16LE(header.length, 8);
    const body = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => body.writeFloatLE(v, i * 4));
    return Buffer.concat([head, Buffer.from(header, 'latin1'), body]);
  };
  const zip = (files) => {
    const locals = []; const central = []; let offset = 0;
    for (const [name, data] of files) {
      const n = Buffer.from(name);
      const extra = Buffer.alloc(20); extra.writeUInt16LE(1, 0); extra.writeUInt16LE(16, 2); extra.writeBigUInt64LE(BigInt(data.length), 4); extra.writeBigUInt64LE(BigInt(data.length), 12);
      const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(45, 4); local.writeUInt32LE(0xffffffff, 18); local.writeUInt32LE(0xffffffff, 22); local.writeUInt16LE(n.length, 26); local.writeUInt16LE(extra.length, 28);
      locals.push(local, n, extra, data);
      const cextra = Buffer.alloc(20); cextra.writeUInt16LE(1, 0); cextra.writeUInt16LE(16, 2); cextra.writeBigUInt64LE(BigInt(data.length), 4); cextra.writeBigUInt64LE(BigInt(data.length), 12);
      const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(45, 4); entry.writeUInt16LE(45, 6); entry.writeUInt32LE(0xffffffff, 20); entry.writeUInt32LE(0xffffffff, 24); entry.writeUInt16LE(n.length, 28); entry.writeUInt16LE(cextra.length, 30); entry.writeUInt32LE(offset, 42);
      central.push(entry, n, cextra);
      offset += 30 + n.length + extra.length + data.length;
    }
    const dir = Buffer.concat(central);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, dir, end]);
  };
  const npzPath = path.join(tmp, 'adapter.npz');
  fs.writeFileSync(npzPath, zip([['weight.npy', npy([3, 3], [1, 0, 0, 0, 1, 0, 0, 0, 1])], ['bias.npy', npy([3], [0, 0, 0.5])]]));
  const arrays = readNpz(npzPath);
  check('NumPy’s zip of arrays is read, with zip64 sizes', arrays.weight.shape.join('x') === '3x3' && arrays.weight.data[4] === 1 && arrays.bias.data[2] === 0.5);
  const adapter = loadAdapter(npzPath, 3);
  const adapted = applyAdapter(normalise([1, 0, 0]), adapter);
  check('the adapter is weight times signature plus bias, made length 1', near(adapted[0], 1 / Math.sqrt(1.25)) && near(adapted[2], 0.5 / Math.sqrt(1.25)));
  let wrongShape = false;
  try { loadAdapter(npzPath, 512); } catch { wrongShape = true; }
  check('an adapter of the wrong size is refused', wrongShape);
  const a = [0.2, 0.9, 0.1]; const b = [0.7, 0.1, 0.4];
  check('joined with no weight on the plain signature, the score is the adapted one’s', near(cosine(fuse([1, 0, 0], a, 0), fuse([0, 1, 0], b, 0)), cosine(a, b)) && fuse([1, 0, 0], a, 0).length === 6);
  check('joined half and half, both count', near(cosine(fuse([1, 0, 0], a, 0.5), fuse([1, 0, 0], a, 0.5)), 1));
}

// ---- Choosing whom to send after the first pass -------------------------------------

console.log('The first pass');
{
  const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const scores = { 1: 0.1, 2: 0.5, 3: 0.3 };
  check('the closest is sent, and everyone above the line', chooseToSend(tracks, scores, { line: 0.25, top: 1 }).map((t) => t.id).join() === '2,3');
  check('the closest few are sent whatever their score', chooseToSend(tracks, scores, { line: 0.9, top: 3 }).map((t) => t.id).join() === '2,3,1');
  check('a person with no signature is not sent from the first pass', !chooseToSend(tracks, scores, { line: 0, top: 10 }).some((t) => t.id === 4));
}

// ---- FFmpeg ---------------------------------------------------------------------

console.log('Reading video');
const video = path.join(tmp, 'test.mp4');
{
  const made = await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-t', '20', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', video]);
  check('a test video is made', made.code === 0 && fs.existsSync(video), made.out);
  const info = await probe(video);
  check('its length, size and kind are read', Math.abs(info.duration - 20) < 0.2 && info.width === 640 && info.height === 360 && info.codec === 'h264', JSON.stringify(info));
  const times = [];
  const count = await readFrames(video, { from: 5, to: 15, fps: 2, width: 640, height: 360 }, async (frame, t) => {
    if (frame.length !== 640 * 360 * 4) throw new Error('wrong frame size');
    times.push(t);
  });
  check('a window is read at two looks a second, from its start', count >= 19 && count <= 21 && times[0] === 5 && times.at(-1) < 15, `${count} looks, ${times[0]} to ${times.at(-1)}`);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(video)).digest('hex');
  check('the fingerprint is the file’s SHA-256', (await sha256File(video)) === sha);
  check('times are read as people write them', parseTime('1:02:09') === 3729 && parseTime('12:05') === 725 && parseTime('734.5') === 734.5 && parseTime('') === null);
  let bad = false;
  try { parseTime('ten past two'); } catch { bad = true; }
  check('a time that is not one is refused', bad);
  let unreadable = false;
  const junk = path.join(tmp, 'junk.mp4');
  fs.writeFileSync(junk, 'not a video');
  try { await probe(junk); } catch { unreadable = true; }
  check('a file that is not a video says so', unreadable);
}

// ---- A whole scan ------------------------------------------------------------------

console.log('Scanning');
{
  const detector = await loadDetector();
  // The test clip is 640 x 360, a small video (faces.js isSmallVideo).
  const whole = await scanFile(video, { outDir: path.join(tmp, 'scan-whole'), detector, exactRate: true });
  check('the whole video is looked at twice a second', whole.looks >= 39 && whole.looks <= 41 && whole.window.from === 0, `${whole.looks} looks`);
  check('the scan records the file, its fingerprint and its counts', whole.sha256.length === 64 && whole.name === 'test.mp4' && Array.isArray(whole.tracks) && Number.isFinite(whole.facesFound));
  const part = await scanFile(video, { from: 5, to: 10, outDir: path.join(tmp, 'scan-part'), detector, exactRate: true });
  check('only the chosen window is read', part.looks >= 9 && part.looks <= 11 && part.window.from === 5 && part.window.to === 10, `${part.looks} looks`);
  const small = await scanFile(video, { outDir: path.join(tmp, 'scan-small'), detector });
  check('a small video is looked at more often, enlarged, with smaller faces kept', small.looks >= 88 && small.looks <= 92 && small.settings.fps === 4.5 && small.settings.minFace === 12 && small.settings.searchedAt === '1280x720', `${small.looks} looks, ${JSON.stringify(small.settings)}`);
  await detector.close();
}

// ---- compare.mjs against a stand-in Khozo ------------------------------------------

console.log('Comparing with a case');
{
  const scanDir = path.join(tmp, 'scan-compare');
  const fileDir = path.join(scanDir, 'gate1.mp4');
  fs.mkdirSync(path.join(fileDir, 'faces'), { recursive: true });
  const tracks = [];
  for (let i = 1; i <= 12; i += 1) {
    await sharp({ create: { width: 360, height: 360, channels: 3, background: { r: 20 * i, g: 90, b: 140 } } }).jpeg().toFile(path.join(fileDir, 'faces', `t${i}.jpg`));
    tracks.push({ id: i, time: i * 10, firstTime: i * 10 - 2, lastTime: i * 10 + 2, seen: 5, quality: i === 7 ? 0.99 : 0.5 - i / 100, face: { x: 0, y: 0, w: 60, h: 70, score: 0.9 }, picture: path.join('faces', `t${i}.jpg`), landmarks: [] });
  }
  const record = { file: 'gate1.mp4', name: 'gate1.mp4', bytes: 73400320, duration: 600, width: 1280, height: 720, sha256: 'c'.repeat(64), facesTooSmall: 2, looks: 1200, tracks, outDir: fileDir };
  fs.writeFileSync(path.join(scanDir, 'manifest.json'), JSON.stringify({ scannedAt: new Date().toISOString(), outDir: scanDir, files: [record] }));

  const password = 'secret-smoke-pass';
  const token = 'tok-smoke';
  const seen = [];
  const state = { n: 0, busy: false, fault: false };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const send = (status, data, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(data === undefined ? '' : JSON.stringify(data)); };
    const url = new URL(req.url, 'http://local');
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const { email, password: given } = JSON.parse(body.toString());
      return given === password && email === 'officer@smoke.test' ? send(200, { token, user: { name: 'Smoke Officer', role: 'police' } }) : send(401, { error: 'Invalid credentials' });
    }
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'Authentication required' });
    const caseMatch = url.pathname.match(/^\/api\/reports\/(r_[a-z]+)(\/video-search)?$/);
    if (!caseMatch) return send(404, { error: 'Not found' });
    const [, caseId, search] = caseMatch;
    if (req.method === 'GET' && !search) return send(200, { report: { id: caseId, status: caseId === 'r_closed' ? 'closed' : 'missing', extraPhotos: [] } });
    if (caseId === 'r_closed') return send(409, { error: 'This case is closed' });
    const form = await new Request('http://local', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body }).formData();
    const fields = {};
    for (const [k, v] of form.entries()) if (typeof v === 'string') fields[k] = v;
    const files = [...form.getAll('photo'), ...form.getAll('extraPhotos')];
    const recordCheck = videoSearchRecord(fields);
    const jpeg = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer()).subarray(0, 2).toString('hex') === 'ffd8'));
    seen.push({ batch: Number(fields.batch), faces: files.length, searchId: fields.searchId, recordedFrom: fields.recordedFrom, times: fields.times, ok: !recordCheck.error && jpeg.every(Boolean) && files.length <= VIDEO_SEARCH_BATCH });
    state.n += 1;
    if (state.n === 1) return send(429, { error: 'Too many requests' }, { 'Retry-After': '1' });
    const batch = Number(fields.batch);
    if (batch === 2 && !state.busy) {
      state.busy = true;
      return send(200, { results: files.map((_, index) => ({ index, verdict: 'no_answer', enginesAnswered: [] })) });
    }
    if (batch === 3 && files.length > 1 && !state.fault) {
      state.fault = true;
      return send(503);
    }
    const verdictFor = (index) => (batch === 1 && index === 0 ? 'likely' : batch === 2 && index === 0 ? 'possible' : batch === 3 ? 'no_face' : 'unlikely');
    return send(200, { results: files.map((_, index) => ({ index, verdict: verdictFor(index), enginesAnswered: ['aarakshak'] })) });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const env = { KHOZO_LOGIN: 'officer@smoke.test', KHOZO_PASSWORD: password, KHOZO_BUSY_WAIT_MS: '50', KHOZO_FACE_MODEL: '', KHOZO_TOKEN: '' };

  const first = await run(process.execPath, [compareBin, scanDir, '--case', 'r_smoke', '--camera', 'Smoke gate 1', '--api', api, '--recorded-from', '2026-10-20T14:30:00'], env);
  check('the run finishes', first.code === 0, first.out);
  check('the password is never printed', !first.out.includes(password));
  const saved = JSON.parse(fs.readFileSync(path.join(scanDir, 'compare-r_smoke.json'), 'utf8'));
  const answers = saved.files['c'.repeat(64)].answers;
  check('every person has an answer', Object.keys(answers).length === 12 && Object.values(answers).every((a) => a.verdict !== 'no_answer'), JSON.stringify(answers));
  check('the clearest picture is sent first', answers[7]?.verdict === 'likely');
  check('every request passes Khozo’s own checks, five faces at most', seen.length > 0 && seen.every((s) => s.ok));
  check('one search reference for the whole file', new Set(seen.map((s) => s.searchId)).size === 1 && /^vs_/.test(seen[0].searchId));
  check('the camera clock’s start is sent', seen.every((s) => s.recordedFrom === '2026-10-20T14:30:00'));
  check('after "slow down" the same faces are sent again', seen[0].batch === 1 && seen[1].batch === 1 && seen[1].faces === 5);
  check('when no engine answered, the faces are sent once more', seen.filter((s) => s.batch === 2).length === 2);
  check('when five were too much, they are sent one at a time', seen.filter((s) => s.batch === 3).map((s) => s.faces).join() === '2,1,1');
  const review = fs.readFileSync(path.join(scanDir, 'review-r_smoke.html'), 'utf8');
  check('the review sheet leads with the likely face, in clock time', review.includes('Faces to check for case r_smoke') && review.indexOf('Likely the same person') < review.indexOf('Possibly the same person') && review.includes('Everyone seen') && review.includes('2026'), '');
  check('the sheet says a match is a lead', review.includes('a lead, not an identification'));

  const before = seen.length;
  const again = await run(process.execPath, [compareBin, scanDir, '--case', 'r_smoke', '--camera', 'Smoke gate 1', '--api', api], env);
  check('a second run sends nothing already answered', again.code === 0 && seen.length === before, again.out);

  const closed = await run(process.execPath, [compareBin, scanDir, '--case', 'r_closed', '--camera', 'Smoke gate 1', '--api', api], env);
  check('a closed case stops the run with Khozo’s words', closed.code === 1 && closed.out.includes('This case is closed.'), closed.out);
  const wrong = await run(process.execPath, [compareBin, scanDir, '--case', 'r_smoke', '--camera', 'Smoke gate 1', '--api', api], { ...env, KHOZO_PASSWORD: 'wrong' });
  check('a wrong password stops the run and asks to sign in again', wrong.code === 1 && wrong.out.includes('Sign in again'), wrong.out);
  server.close();
}

// ---- Aarakshak's model, when it is on this laptop -------------------------------------

if (process.env.KHOZO_FACE_MODEL) {
  console.log('Aarakshak’s face model');
  const recognizer = await loadRecognizer();
  const face = new Uint8Array(recognizer.size * recognizer.size * 3).map((_, i) => (i * 37) % 256);
  const a = await recognizer.embed(face);
  const b = await recognizer.embed(face);
  check(`${recognizer.name} ${recognizer.version} gives a stable signature`, a.length >= 128 && cosine(a, b) > 0.9999, `${a.length} numbers`);
  await recognizer.close();
} else {
  console.log('  (Aarakshak’s face model not checked: KHOZO_FACE_MODEL is not set)');
}

fs.rmSync(tmp, { recursive: true, force: true });
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
