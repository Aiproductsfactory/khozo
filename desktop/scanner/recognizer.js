// Face signatures on the laptop, with Aarakshak's own recognition model.
//
// Aarakshak recognises faces with ArcFace on a ResNet100 backbone: each face,
// lined up (align.js), becomes 512 numbers, and two faces are as alike as the
// cosine of their signatures. Running the same model here, with the same
// weights, gives the same scores as Aarakshak's cloud, so the laptop can
// shortlist the people worth sending and keep passers-by's faces at home.
//
// The model is Aarakshak's and is not part of this repository. It is used only
// when KHOZO_FACE_MODEL points at its .onnx file, and only with its card: a
// .json file beside it that names the model and its version and says how it
// takes a face. Every score made with it is recorded with that name and
// version. Without a model, every face is compared on Khozo as before.
import fs from 'node:fs';
import os from 'node:os';
import ort from 'onnxruntime-node';

const three = (value, fallback) => {
  const list = [].concat(value ?? fallback).map(Number);
  return list.length === 1 ? [list[0], list[0], list[0]] : list.slice(0, 3);
};

/**
 * The model's card, from `<model>.json`:
 *
 *   { "name": "aarakshak-fr", "version": "1.82", "provider": "Aarakshak",
 *     "input": { "size": 112, "channels": "rgb", "mean": 127.5, "std": 127.5, "layout": "nchw" } }
 *
 * `channels` is the order the model takes them in; `mean` and `std` are per
 * channel in that order (one number for all three). The name and version are
 * required: a score is no use later without knowing which model made it.
 */
export function readModelCard(modelPath) {
  const cardPath = `${modelPath.replace(/\.onnx$/i, '')}.json`;
  if (!fs.existsSync(cardPath)) throw new Error(`The face model needs its card beside it: ${cardPath}`);
  const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
  if (!card.name || !card.version) throw new Error(`The face model's card must give its name and version (${cardPath})`);
  const input = card.input || {};
  const channels = String(input.channels || 'rgb').toLowerCase();
  const layout = String(input.layout || 'nchw').toLowerCase();
  if (!['rgb', 'bgr'].includes(channels)) throw new Error(`Unknown channel order "${input.channels}" in ${cardPath}`);
  if (!['nchw', 'nhwc'].includes(layout)) throw new Error(`Unknown layout "${input.layout}" in ${cardPath}`);
  return {
    name: String(card.name),
    version: String(card.version),
    provider: card.provider ? String(card.provider) : null,
    size: Number(input.size) || 112,
    channels,
    layout,
    mean: three(input.mean, 127.5),
    std: three(input.std, 127.5),
  };
}

/** A signature scaled to length 1, so that a dot product is the cosine. */
export function normalise(values) {
  let sum = 0;
  for (const v of values) sum += v * v;
  const len = Math.sqrt(sum) || 1;
  return Float32Array.from(values, (v) => v / len);
}

/** How alike two signatures are: their cosine, from -1 to 1. */
export function cosine(a, b) {
  let dot = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i];
  }
  return aa > 0 && bb > 0 ? dot / Math.sqrt(aa * bb) : 0;
}

/** The model's input from a lined-up face (RGB bytes, `size` x `size`), as its card says. */
export function modelInput(rgb, card) {
  const n = card.size * card.size;
  const data = new Float32Array(3 * n);
  const order = card.channels === 'rgb' ? [0, 1, 2] : [2, 1, 0];
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const value = (rgb[i * 3 + order[c]] - card.mean[c]) / card.std[c];
      data[card.layout === 'nchw' ? c * n + i : i * 3 + c] = value;
    }
  }
  return data;
}

/**
 * The recogniser, or null when no model is set:
 * `{ name, version, size, embed(rgb) -> signature, close() }`.
 */
export async function loadRecognizer({ modelPath = process.env.KHOZO_FACE_MODEL, gpu = false } = {}) {
  if (!modelPath) return null;
  const card = readModelCard(modelPath);
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: gpu ? ['dml', 'cpu'] : ['cpu'],
    graphOptimizationLevel: 'all',
    intraOpNumThreads: Math.max(1, Math.min(4, os.cpus().length - 1)),
  });
  const input = session.inputNames[0];
  const output = session.outputNames[0];
  const dims = card.layout === 'nchw' ? [1, 3, card.size, card.size] : [1, card.size, card.size, 3];
  return {
    name: card.name,
    version: card.version,
    provider: card.provider,
    size: card.size,
    async embed(rgb) {
      const out = await session.run({ [input]: new ort.Tensor('float32', modelInput(rgb, card), dims) });
      return normalise(out[output].data);
    },
    async close() { await session.release(); },
  };
}
