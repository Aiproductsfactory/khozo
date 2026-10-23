// The heavy work, in a process of its own so the window stays responsive and
// a crash cannot take the app down: reading footage and finding people
// (scanner/scan.js), and making face signatures with Aarakshak's model
// (scanner/local-match.js). Runs as an Electron utility process, or as a
// plain Node child process in tests.
//
// Messages in:  { id, type: 'scan' | 'caseSignatures' | 'signatures', ...task }
// Messages out: { id, event: 'progress' | 'checkpoint', ... } while working,
//               then { id, ok: true, result } or { id, ok: false, error }.
import path from 'node:path';
import { loadDetector } from '../scanner/detector.js';
import { closestOf, pictureSignature, trackSignatures } from '../scanner/local-match.js';
import { loadRecognizer } from '../scanner/recognizer.js';
import { scanFile } from '../scanner/scan.js';
import { watchStream } from '../scanner/live.js';
import { open, seal } from './secure-store.js';
import fs from 'node:fs';

const port = process.parentPort;
const send = (message) => (port ? port.postMessage(message) : process.send(message));

let detector = null;
let detectorKey = null;
let recognizer = null;
let recognizerKey = null;

async function detectorFor(modelPath) {
  if (!detector || detectorKey !== modelPath) {
    if (detector) await detector.close();
    detector = await loadDetector({ modelPath: modelPath || undefined });
    detectorKey = modelPath;
  }
  return detector;
}

async function recognizerFor(card) {
  if (!recognizer || recognizerKey !== card) {
    if (recognizer) await recognizer.close();
    recognizer = await loadRecognizer({ modelPath: card });
    recognizerKey = card;
  }
  return recognizer;
}

const key = (task) => Buffer.from(task.key);
const watching = new Map(); // request id -> AbortController of a live watch

const tasks = {
  async scan(task, id) {
    const found = await detectorFor(task.detectorPath);
    const k = key(task);
    return scanFile(task.file, {
      from: task.from,
      to: task.to,
      fps: task.fps,
      maxSide: task.maxSide,
      scoreMin: task.scoreMin ?? undefined,
      idPrefix: task.idPrefix,
      detector: found,
      outDir: task.fileDir,
      savePicture: (relative, jpeg) => {
        const file = path.join(task.fileDir, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, seal(k, jpeg));
      },
      deletePicture: (relative) => fs.rmSync(path.join(task.fileDir, relative), { force: true }),
      checkpointMs: task.checkpointMs ?? 30000,
      onProgress: (p) => send({ id, event: 'progress', ...p }),
      onCheckpoint: (c) => send({ id, event: 'checkpoint', ...c }),
    });
  },

  /**
   * A live camera, until `until`: only faces close to the case are kept, as
   * encrypted files in `fileDir` (the face, and the whole frame with the face
   * marked); every other face is forgotten as soon as it is compared.
   */
  async watch(task, id) {
    const r = await recognizerFor(task.card);
    const found = await detectorFor(task.detectorPath);
    const k = key(task);
    const store = (relative, bytes) => {
      const file = path.join(task.fileDir, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, seal(k, bytes));
    };
    const controller = new AbortController();
    watching.set(id, controller);
    try {
      return await watchStream(task.address, {
        until: task.until,
        fps: task.fps,
        maxSide: task.maxSide,
        scoreMin: task.scoreMin ?? undefined,
        detector: found,
        recognizer: r,
        caseSignatures: task.caseSignatures,
        line: task.line,
        idPrefix: task.idPrefix,
        startedAt: task.startedAt,
        signal: controller.signal,
        onClose: (face) => {
          const picture = path.join('faces', `${face.id}.jpg`);
          const frame = path.join('frames', `${face.id}.jpg`);
          store(picture, face.picture);
          store(frame, face.frame);
          const { picture: _p, frame: _f, ...rest } = face;
          send({ id, event: 'close', track: { ...rest, picture, frame } });
        },
        onProgress: (p) => send({ id, event: 'progress', ...p }),
        onStall: (err) => send({ id, event: 'stall', error: err.message }),
      });
    } finally {
      watching.delete(id);
    }
  },

  /** Stops a watch: it resolves with what it saw. */
  async stopWatch(task) {
    watching.get(task.watchId)?.abort();
    return { stopped: watching.has(task.watchId) };
  },

  async caseSignatures(task) {
    const r = await recognizerFor(task.card);
    const found = await detectorFor(task.detectorPath);
    const out = [];
    for (const [i, bytes] of task.photos.entries()) {
      const signature = await pictureSignature(Buffer.from(bytes), { detector: found, recognizer: r });
      if (signature) out.push({ photo: i, signature: Array.from(signature) });
    }
    return { model: { name: r.name, version: r.version }, signatures: out };
  },

  async signatures(task, id) {
    const r = await recognizerFor(task.card);
    const found = await detectorFor(task.detectorPath);
    const k = key(task);
    const caseSigs = task.caseSignatures.map((s) => ({ signature: Float32Array.from(s.signature) }));
    const scores = {};
    // Which of a person's pictures scored best: the one the officer sees and Khozo is sent first.
    const best = {};
    let done = 0;
    for (const track of task.tracks) {
      const signatures = await trackSignatures({
        track, detector: found, recognizer: r,
        readPicture: (t, file = t.picture) => open(k, fs.readFileSync(path.join(task.fileDir, file))),
      }).catch(() => []);
      const closest = closestOf(signatures, caseSigs);
      if (closest.score != null) {
        scores[track.key] = closest.score;
        best[track.key] = closest.file;
      }
      done += 1;
      if (done % 25 === 0) send({ id, event: 'progress', stage: 'signatures', done, total: task.tracks.length });
    }
    return { scores, best };
  },
};

async function handle(message) {
  const { id, type } = message || {};
  try {
    if (!tasks[type]) throw new Error(`Unknown task ${type}`);
    const result = await tasks[type](message, id);
    send({ id, ok: true, result });
  } catch (err) {
    send({ id, ok: false, error: err?.message || String(err) });
  }
}

// Each request is handled as it comes: a watch runs for hours, and its stop must get through.
if (port) port.on('message', (e) => { handle(e.data); });
else process.on('message', (m) => { handle(m); });
