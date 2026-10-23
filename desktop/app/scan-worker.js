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
import { closeness, pictureSignature, trackSignature } from '../scanner/local-match.js';
import { loadRecognizer } from '../scanner/recognizer.js';
import { scanFile } from '../scanner/scan.js';
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
      checkpointMs: task.checkpointMs ?? 30000,
      onProgress: (p) => send({ id, event: 'progress', ...p }),
      onCheckpoint: (c) => send({ id, event: 'checkpoint', ...c }),
    });
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
    let done = 0;
    for (const track of task.tracks) {
      const signature = await trackSignature({
        track, detector: found, recognizer: r,
        readPicture: (t) => open(k, fs.readFileSync(path.join(task.fileDir, t.picture))),
      }).catch(() => null);
      if (signature) scores[track.key] = closeness(signature, caseSigs);
      done += 1;
      if (done % 25 === 0) send({ id, event: 'progress', stage: 'signatures', done, total: task.tracks.length });
    }
    return { scores };
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

if (port) port.on('message', (e) => handle(e.data));
else process.on('message', handle);
