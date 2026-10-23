#!/usr/bin/env node
/**
 * Finds every person in long CCTV footage, on this computer.
 *
 *   node desktop/bin/scan.mjs <video or folder>... [--out <dir>] [--from 10:00:00] [--to 12:00:00]
 *                             [--fps 2] [--max-side 960] [--min-face 36] [--gpu] [--frames] [--json]
 *
 * --from and --to are times into each file (h:mm:ss, mm:ss or seconds).
 * --max-side 1280 or 1920 finds the smaller faces of a camera high on a wall,
 * more slowly.
 *
 * Writes <out>/<file>/faces/t<id>.jpg, one clear picture per person, and
 * <out>/manifest.json with the moment each was seen. With --frames, the whole
 * frame at each person's moment, marked, as <out>/<file>/frames/t<id>.jpg.
 * With --json, one JSON line per event on stdout, for the desktop app.
 *
 * Nothing is sent anywhere. Comparing the people with a case is the next
 * step (compare.mjs), and it sends only face pictures.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { formatVideoTime, MIN_FACE_PX } from '../../web/src/video/faces.js';
import { loadDetector } from '../scanner/detector.js';
import { cardFromEnv } from '../scanner/recognizer.js';
import { markedFrame, parseTime, scanFile } from '../scanner/scan.js';

const USAGE = 'Usage: node desktop/bin/scan.mjs <video or folder>... [--out <dir>] [--from 10:00:00] [--to 12:00:00] [--fps 2] [--max-side 960] [--min-face 36] [--gpu] [--frames] [--json]';
const VIDEO = new Set(['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.3gp', '.m4v', '.dav', '.ts', '.mpg', '.mpeg', '.264', '.h264', '.265', '.h265', '.hevc']);

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      fps: { type: 'string' },
      'max-side': { type: 'string' },
      'min-face': { type: 'string' },
      gpu: { type: 'boolean' },
      frames: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
} catch (err) {
  console.error(`${err.message}\n${USAGE}`);
  process.exit(2);
}
const { values: opts, positionals } = parsed;
if (opts.help || !positionals.length) {
  console.error(USAGE);
  process.exit(2);
}

function listVideos(input) {
  const p = path.resolve(input);
  if (!fs.existsSync(p)) throw new Error(`Not found: ${p}`);
  if (fs.statSync(p).isFile()) return [p];
  const out = [];
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, entry.name);
    if (entry.isDirectory()) out.push(...listVideos(full));
    else if (VIDEO.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out.sort();
}

const safe = (s) => s.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
const json = Boolean(opts.json);
const emit = (ev) => { if (json) process.stdout.write(`${JSON.stringify(ev)}\n`); };
const say = (m) => { if (json) emit({ type: 'log', msg: m }); else console.log(m); };

const settings = {
  fps: Number(opts.fps) || 2,
  maxSide: Number(opts['max-side']) || 960,
  minFace: Number(opts['min-face']) || MIN_FACE_PX,
  from: parseTime(opts.from) || 0,
  to: parseTime(opts.to),
  gpu: Boolean(opts.gpu),
};
const videos = positionals.flatMap(listVideos);
if (!videos.length) {
  say('No video files found');
  process.exit(1);
}
const outDir = path.resolve(opts.out || `khozo-scan-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
fs.mkdirSync(outDir, { recursive: true });

const controller = new AbortController();
process.on('SIGINT', () => { say('Stopping; what was found so far is kept.'); controller.abort(); });

// With Aarakshak's model card set, faces are found with Aarakshak's own YuNet
// and threshold, so a face found here is a face Aarakshak would find.
const card = cardFromEnv();
if (card?.detectorPath) {
  settings.detector = `${card.name} ${card.version}`;
  settings.scoreMin = card.detectorScore ?? undefined;
}
const detector = await loadDetector({ gpu: settings.gpu, modelPath: card?.detectorPath || undefined });
const manifest = { scannedAt: new Date().toISOString(), outDir, settings, files: [] };
const t0 = Date.now();

for (const [i, file] of videos.entries()) {
  const fileOut = path.join(outDir, safe(path.basename(file)));
  emit({ type: 'file', index: i + 1, count: videos.length, file });
  if (!json) console.log(`\n[${i + 1}/${videos.length}] ${file}`);
  let lastLine = 0;
  let record;
  try {
    record = await scanFile(file, {
      ...settings,
      outDir: fileOut,
      detector,
      signal: controller.signal,
      onProgress: (p) => {
        const total = (p.to ?? p.t) - p.from;
        const frac = total > 0 ? Math.min(1, (p.t - p.from) / total) : 0;
        emit({ type: 'progress', index: i + 1, count: videos.length, t: p.t, frac: Math.round(frac * 1000) / 1000, looks: p.looks, people: p.people });
        if (!json && Date.now() - lastLine > 2000) {
          process.stdout.write(`\r  ${Math.round(frac * 100)}%  at ${formatVideoTime(p.t)}  ${p.people} people seen   `);
          lastLine = Date.now();
        }
      },
    });
  } catch (err) {
    // One file that will not open does not stop the others.
    emit({ type: 'fileError', index: i + 1, count: videos.length, file, msg: err.message });
    say(`  Could not read this file: ${err.message.split('\n')[0]}`);
    continue;
  }
  if (!json) process.stdout.write('\r');
  if (opts.frames) {
    const framesDir = path.join(fileOut, 'frames');
    fs.mkdirSync(framesDir, { recursive: true });
    for (const track of record.tracks) {
      try {
        fs.writeFileSync(path.join(framesDir, `t${track.id}.jpg`), await markedFrame(file, record, track));
        track.frame = path.join('frames', `t${track.id}.jpg`);
      } catch (err) {
        say(`  Frame for person ${track.id} at ${formatVideoTime(track.time)}: ${err.message}`);
      }
    }
  }
  record.outDir = fileOut;
  manifest.files.push(record);
  const read = (record.window.to ?? record.duration) - record.window.from;
  const speed = record.seconds > 0 ? Math.round((read / record.seconds) * 10) / 10 : null;
  emit({ type: 'fileDone', index: i + 1, count: videos.length, people: record.tracks.length, looks: record.looks, tooSmall: record.facesTooSmall, seconds: record.seconds, speed });
  say(`  ${record.width}x${record.height} ${record.codec}, ${formatVideoTime(record.duration)} long; read ${formatVideoTime(record.window.from)} to ${formatVideoTime(record.window.to ?? record.duration)} in ${record.seconds}s${speed ? ` (${speed}x real time)` : ''}`);
  say(`  ${record.tracks.length} people seen in ${record.looks} looks; ${record.facesTooSmall} faces too small to use; SHA-256 ${record.sha256.slice(0, 12)}…`);
  if (controller.signal.aborted) break;
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const people = manifest.files.reduce((n, f) => n + f.tracks.length, 0);
emit({ type: 'done', outDir, files: manifest.files.length, people, seconds: Math.round((Date.now() - t0) / 100) / 10 });
say(`\n${people} people in ${manifest.files.length} file${manifest.files.length === 1 ? '' : 's'}; pictures and manifest.json in ${outDir}`);
await detector.close();
