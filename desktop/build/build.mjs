#!/usr/bin/env node
/**
 * Builds Khozo Desktop for `electron .` and for the installer:
 *
 *   dist/main.mjs, dist/scan-worker.mjs   the main process and the scan worker, bundled
 *                                          with the code they share with khozo.org
 *   dist/preload.cjs, dist/renderer/       the bridge and the screens
 *   build/resources/yunet.onnx            Khozo's face finder (the same network Aarakshak uses)
 *   build/resources/model/                Aarakshak's model, only when KHOZO_FACE_MODEL names its card
 *
 *   node build/build.mjs            (KHOZO_FACE_MODEL=<card.json> to include the model)
 *
 * Aarakshak's model files are copied into build/resources for the installer
 * and never into the repository (desktop/.gitignore keeps build/resources out).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { readModelCard } from '../scanner/recognizer.js';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(desktop, '..');
const dist = path.join(desktop, 'dist');
const resources = path.join(desktop, 'build', 'resources');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'renderer'), { recursive: true });

// CommonJS, not ES modules: Electron's own loader trips over CommonJS packages
// (sharp, the ONNX runtime) imported from an ES module main process.
const node = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron', 'onnxruntime-node', 'sharp', 'ffmpeg-static', 'ffprobe-static'],
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: { js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  logLevel: 'warning',
  legalComments: 'none',
};
await esbuild.build({ ...node, entryPoints: [path.join(desktop, 'app', 'main.js')], outfile: path.join(dist, 'main.cjs') });
await esbuild.build({ ...node, entryPoints: [path.join(desktop, 'app', 'scan-worker.js')], outfile: path.join(dist, 'scan-worker.cjs') });
await esbuild.build({
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome130',
  entryPoints: [path.join(desktop, 'app', 'renderer', 'app.js')],
  outfile: path.join(dist, 'renderer', 'renderer.js'),
  logLevel: 'warning',
});
for (const file of ['index.html', 'style.css']) fs.copyFileSync(path.join(desktop, 'app', 'renderer', file), path.join(dist, 'renderer', file));
fs.copyFileSync(path.join(desktop, 'app', 'preload.cjs'), path.join(dist, 'preload.cjs'));

fs.mkdirSync(resources, { recursive: true });
fs.copyFileSync(path.join(repo, 'web', 'src', 'video', 'yunet-2026may.onnx'), path.join(resources, 'yunet.onnx'));

const modelDir = path.join(resources, 'model');
fs.rmSync(modelDir, { recursive: true, force: true });
if (process.env.KHOZO_FACE_MODEL) {
  const card = readModelCard(process.env.KHOZO_FACE_MODEL);
  fs.mkdirSync(modelDir, { recursive: true });
  fs.copyFileSync(card.modelPath, path.join(modelDir, 'model.onnx'));
  if (card.adapterPath) fs.copyFileSync(card.adapterPath, path.join(modelDir, 'adapter.npz'));
  fs.writeFileSync(path.join(modelDir, 'card.json'), JSON.stringify({
    name: card.name,
    version: card.version,
    provider: card.provider,
    model: 'model.onnx',
    ...(card.adapterPath ? { adapter: 'adapter.npz' } : {}),
    ...(card.fusionBaseWeight != null ? { fusionBaseWeight: card.fusionBaseWeight } : {}),
    ...(card.detectorScore != null ? { detectorScore: card.detectorScore } : {}),
    input: { size: card.size, channels: card.channels, mean: card.mean, std: card.std, layout: card.layout },
  }, null, 2));
  console.log(`Face model included: ${card.name} ${card.version}`);
} else {
  console.log('No face model included (set KHOZO_FACE_MODEL to the card to include Aarakshak\'s model)');
}
console.log(`Built ${path.relative(repo, dist)}`);
