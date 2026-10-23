// The face finder on the laptop: the same YuNet model file the web ships
// (web/src/video/yunet-2026may.onnx), read the same way (faces.js), run with
// onnxruntime-node instead of the browser's WebAssembly build. It only finds
// faces; who they are is still the face engines' answer.
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import ort from 'onnxruntime-node';
import { FACE_SCORE_MIN, decodeFaces, networkInput, suppress } from '../../web/src/video/faces.js';

export const MODEL_PATH = fileURLToPath(new URL('../../web/src/video/yunet-2026may.onnx', import.meta.url));

/**
 * The face finder, loaded once: `{ detect(rgba, width, height), provider }`.
 * `detect` resolves to the faces in the picture, in its pixels, best first.
 *
 * With `gpu`, DirectML is tried first (Windows laptops with a graphics card),
 * falling back to the CPU; `provider` says which one answered.
 */
export async function loadDetector({ gpu = false, threads = 0, modelPath = MODEL_PATH } = {}) {
  const providers = gpu ? ['dml', 'cpu'] : ['cpu'];
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: providers,
    graphOptimizationLevel: 'all',
    intraOpNumThreads: threads || Math.max(1, Math.min(4, os.cpus().length - 1)),
  });
  const input = session.inputNames[0];
  return {
    provider: gpu ? 'dml or cpu' : 'cpu',
    async detect(rgba, width, height, scoreMin = FACE_SCORE_MIN) {
      const { data, padW, padH } = networkInput(rgba, width, height);
      const out = await session.run({ [input]: new ort.Tensor('float32', data, [1, 3, padH, padW]) });
      const raw = {};
      for (const [name, tensor] of Object.entries(out)) raw[name] = tensor.data;
      return suppress(decodeFaces(raw, padW, padH, scoreMin));
    },
    async close() { await session.release(); },
  };
}
