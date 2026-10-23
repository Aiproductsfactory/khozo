// Face signatures on the laptop, with Aarakshak's own recognition model.
//
// Aarakshak finds faces with YuNet and recognises them with ArcFace on a
// ResNet100 backbone, which may be followed by an adapter: each lined-up face
// (align.js) becomes 512 numbers, the adapter turns them into Aarakshak's
// signature, and two faces
// are as alike as the cosine of their signatures. Running the same files with
// the same settings here gives the same scores as Aarakshak's cloud, so the
// laptop can shortlist the people worth sending and keep passers-by's faces
// at home.
//
// The model is used only when KHOZO_FACE_MODEL points at its card (a .json
// file) or at its .onnx file with the card beside it. The card names the
// model and its version, says how it takes a face, and where its adapter and
// face finder are. Every score made with it is recorded with that name and
// version. Without a model, every face is compared on Khozo as before.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ort from 'onnxruntime-node';
import { readNpz } from './npz.js';

const three = (value, fallback) => {
  const list = [].concat(value ?? fallback).map(Number);
  return list.length === 1 ? [list[0], list[0], list[0]] : list.slice(0, 3);
};

/**
 * The model's card:
 *
 *   { "name": "aarakshak-fr", "version": "<model and adapter version>", "provider": "Aarakshak",
 *     "model": "recognition.onnx",
 *     "adapter": "adapter.npz", "fusionBaseWeight": 0,
 *     "detector": "yunet.onnx", "detectorScore": 0.6,
 *     "input": { "size": 112, "channels": "bgr", "mean": 0, "std": 1, "layout": "nchw" } }
 *
 * Paths are relative to the card. `model` is needed only when the card is
 * given itself; beside an .onnx file, that file is the model. `adapter` is a
 * .npz with a 512 x 512 `weight` and a 512 `bias`; `fusionBaseWeight`, when
 * set, joins the plain and adapted signatures as Aarakshak does. `detector`
 * is the YuNet file the engine finds faces with, and `detectorScore` its
 * threshold. `channels` is the order the model takes them in; `mean` and
 * `std` are per channel in that order (one number for all three). The name
 * and version are required: a score is no use later without knowing which
 * model made it.
 */
export function readModelCard(file) {
  const given = /\.json$/i.test(file);
  const cardPath = given ? file : `${file.replace(/\.onnx$/i, '')}.json`;
  if (!fs.existsSync(cardPath)) throw new Error(`The face model needs its card beside it: ${cardPath}`);
  const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
  if (!card.name || !card.version) throw new Error(`The face model's card must give its name and version (${cardPath})`);
  const near = (p) => (p ? path.resolve(path.dirname(cardPath), p) : null);
  const modelPath = given ? near(card.model) : path.resolve(file);
  if (!modelPath) throw new Error(`The card does not say where the model is (${cardPath})`);
  const input = card.input || {};
  const channels = String(input.channels || 'rgb').toLowerCase();
  const layout = String(input.layout || 'nchw').toLowerCase();
  if (!['rgb', 'bgr'].includes(channels)) throw new Error(`Unknown channel order "${input.channels}" in ${cardPath}`);
  if (!['nchw', 'nhwc'].includes(layout)) throw new Error(`Unknown layout "${input.layout}" in ${cardPath}`);
  const fusion = card.fusionBaseWeight == null ? null : Number(card.fusionBaseWeight);
  if (fusion != null && !(fusion >= 0 && fusion <= 1)) throw new Error(`fusionBaseWeight must be between 0 and 1 (${cardPath})`);
  if (fusion != null && !card.adapter) throw new Error(`fusionBaseWeight needs an adapter (${cardPath})`);
  return {
    name: String(card.name),
    version: String(card.version),
    provider: card.provider ? String(card.provider) : null,
    modelPath,
    adapterPath: near(card.adapter),
    fusionBaseWeight: fusion,
    detectorPath: near(card.detector),
    detectorScore: card.detectorScore == null ? null : Number(card.detectorScore),
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

/** The adapter applied to a signature: weight x signature + bias, scaled to length 1. */
export function applyAdapter(vector, { weight, bias }) {
  const n = bias.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = bias[i];
    const row = i * n;
    for (let j = 0; j < n; j += 1) sum += weight[row + j] * vector[j];
    out[i] = sum;
  }
  return normalise(out);
}

/** The plain and adapted signatures joined, the plain one weighted `baseWeight`, as Aarakshak fuses them. */
export function fuse(base, adapted, baseWeight) {
  const a = Math.sqrt(baseWeight);
  const b = Math.sqrt(1 - baseWeight);
  const out = new Float32Array(base.length + adapted.length);
  const nb = normalise(base);
  const na = normalise(adapted);
  for (let i = 0; i < nb.length; i += 1) out[i] = a * nb[i];
  for (let i = 0; i < na.length; i += 1) out[nb.length + i] = b * na[i];
  return normalise(out);
}

/** The adapter in a card's .npz file: `{ weight, bias }`, checked to fit a signature of `dims`. */
export function loadAdapter(file, dims = 512) {
  const arrays = readNpz(file);
  const weight = arrays.weight;
  if (!weight || weight.shape.join('x') !== `${dims}x${dims}`) throw new Error(`The adapter's weight must be ${dims} x ${dims} (${file})`);
  const bias = arrays.bias?.data || new Float32Array(dims);
  if (bias.length !== dims) throw new Error(`The adapter's bias must have ${dims} numbers (${file})`);
  return { weight: weight.data, bias };
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

/** The card named by KHOZO_FACE_MODEL, or null. */
export function cardFromEnv(env = process.env) {
  return env.KHOZO_FACE_MODEL ? readModelCard(env.KHOZO_FACE_MODEL) : null;
}

/**
 * The recogniser, or null when no model is set:
 * `{ name, version, size, detectorPath, detectorScore, embed(rgb) -> signature, close() }`.
 */
export async function loadRecognizer({ modelPath = process.env.KHOZO_FACE_MODEL, gpu = false } = {}) {
  if (!modelPath) return null;
  const card = readModelCard(modelPath);
  const session = await ort.InferenceSession.create(card.modelPath, {
    executionProviders: gpu ? ['dml', 'cpu'] : ['cpu'],
    graphOptimizationLevel: 'all',
    intraOpNumThreads: Math.max(1, Math.min(4, os.cpus().length - 1)),
  });
  const adapter = card.adapterPath ? loadAdapter(card.adapterPath) : null;
  const input = session.inputNames[0];
  const output = session.outputNames[0];
  const dims = card.layout === 'nchw' ? [1, 3, card.size, card.size] : [1, card.size, card.size, 3];
  return {
    name: card.name,
    version: card.version,
    provider: card.provider,
    size: card.size,
    detectorPath: card.detectorPath,
    detectorScore: card.detectorScore,
    async embed(rgb) {
      const out = await session.run({ [input]: new ort.Tensor('float32', modelInput(rgb, card), dims) });
      const base = normalise(out[output].data);
      if (!adapter) return base;
      const adapted = applyAdapter(base, adapter);
      return card.fusionBaseWeight == null ? adapted : fuse(base, adapted, card.fusionBaseWeight);
    },
    async close() { await session.release(); },
  };
}
