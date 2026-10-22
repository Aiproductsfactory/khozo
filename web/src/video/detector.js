// The face finder, in the browser.
//
// Loaded only when someone opens the video option, never with the page: the
// runtime (onnxruntime-web, MIT licence) is about 3.7 MB to download the first
// time, and the browser keeps it after that. The model is YuNet from OpenCV
// Zoo (MIT licence, 230 KB). Both run on the device; no frame of the video is
// sent anywhere to find its faces.
import { FACE_SCORE_MIN, decodeFaces, networkInput, suppress } from './faces.js';
import modelUrl from './yunet-2026may.onnx?url';
import { msg } from '../i18n.jsx';

let loading = null;

/** Why the face finder could not start on this device, in words a person can act on. */
export class DetectorUnavailable extends Error {}

/**
 * The face finder, loaded once: `{ detect(imageData) }`. `detect` resolves to
 * the faces in the picture, in its pixels, best first.
 */
export function loadDetector() {
  if (!loading) {
    loading = (async () => {
      if (typeof WebAssembly !== 'object') throw new DetectorUnavailable(msg('This browser cannot run the face finder. Use a recent Chrome, Edge or Firefox.'));
      const ort = await import('onnxruntime-web/wasm');
      // One thread: several need the page to be cross-origin isolated, which
      // this site is not, and one is enough for a video read once.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      const session = await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      const input = session.inputNames[0];
      return {
        async detect(imageData, scoreMin = FACE_SCORE_MIN) {
          const { data, padW, padH } = networkInput(imageData.data, imageData.width, imageData.height);
          const out = await session.run({ [input]: new ort.Tensor('float32', data, [1, 3, padH, padW]) });
          const raw = {};
          for (const [name, tensor] of Object.entries(out)) raw[name] = tensor.data;
          return suppress(decodeFaces(raw, padW, padH, scoreMin));
        },
      };
    })().catch((err) => {
      loading = null;
      if (err instanceof DetectorUnavailable) throw err;
      throw new DetectorUnavailable(msg('The face finder could not be loaded. Check the internet connection and try again.'));
    });
  }
  return loading;
}
