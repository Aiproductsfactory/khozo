#!/usr/bin/env node
/**
 * Compares the people a scan found (scan.mjs) with one case, and leaves a
 * review sheet beside the pictures.
 *
 *   node desktop/bin/compare.mjs <scan folder> --case <case id> --camera "<where the camera is>"
 *        [--recorded-from <start>] [--api https://khozo.org/api] [--line 0.25] [--top 10]
 *        [--max-faces <n>] [--gpu] [--no-send]
 *
 * Signs in as the officer: KHOZO_TOKEN, or KHOZO_LOGIN (email or mobile) and
 * KHOZO_PASSWORD, or KHOZO_DEMO_EMAIL and KHOZO_DEMO_PASSWORD (the private
 * with-account helper). The password is never printed or saved.
 *
 * --recorded-from is when the recording starts by the camera's clock, for
 * example 2026-10-20T14:30:00; with several files, give it once a file as
 * "<file name>=<start>". Answers then read in clock time.
 *
 * With Aarakshak's recognition model on this laptop (KHOZO_FACE_MODEL, see
 * desktop/README.md), everyone seen is compared with the case here first and
 * only the closest are sent: those at or above --line, and the --top closest.
 * Without it, everyone is sent, clearest first, as the browser does.
 *
 * Faces are sent to POST /reports/:id/video-search, five a request; Khozo
 * compares them with Aarakshak and AWS Rekognition, keeps no picture, and
 * audits each request. Answers are saved after every request in
 * <scan folder>/compare-<case>.json, so a stopped run picks up where it
 * stopped. The sheet is <scan folder>/review-<case>.html.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { formatVideoTime } from '../../web/src/video/faces.js';
import { createClient, KhozoError, sendFaces, signInFromEnv } from '../scanner/khozo.js';
import { loadDetector } from '../scanner/detector.js';
import { loadRecognizer } from '../scanner/recognizer.js';
import { caseSignatures, chooseToSend, closestOf, trackSignatures } from '../scanner/local-match.js';
import { clockTime, peopleOf, reviewPage, toCheckFirst, VERDICT_WORDS } from '../scanner/review.js';

const USAGE = 'Usage: node desktop/bin/compare.mjs <scan folder> --case <case id> --camera "<where the camera is>" [--recorded-from <start>] [--api <url>] [--line 0.25] [--top 10] [--max-faces <n>] [--gpu] [--no-send]';

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      case: { type: 'string' },
      camera: { type: 'string' },
      'recorded-from': { type: 'string', multiple: true },
      api: { type: 'string' },
      line: { type: 'string' },
      top: { type: 'string' },
      'max-faces': { type: 'string' },
      gpu: { type: 'boolean' },
      'no-send': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
} catch (err) {
  console.error(`${err.message}\n${USAGE}`);
  process.exit(2);
}
const { values: opts, positionals } = parsed;
if (opts.help || positionals.length !== 1 || !opts.case || !opts.camera) {
  console.error(USAGE);
  process.exit(2);
}
if (opts.camera.trim().length < 3) {
  console.error('Say where the camera is, in a few words.');
  process.exit(2);
}

const scanDir = path.resolve(positionals[0]);
const manifestPath = path.join(scanDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`No scan here: ${manifestPath} is missing. Run scan.mjs first.`);
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const caseId = opts.case.trim();
const camera = opts.camera.trim();
const api = opts.api || process.env.KHOZO_API || 'https://khozo.org/api';
const line = opts.line != null ? Number(opts.line) : 0.25;
const top = opts.top != null ? Number(opts.top) : 10;
const maxFaces = opts['max-faces'] != null ? Number(opts['max-faces']) : 0;

const safe = (s) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
const runPath = path.join(scanDir, `compare-${safe(caseId)}.json`);
const reviewPath = path.join(scanDir, `review-${safe(caseId)}.html`);
const run = fs.existsSync(runPath) ? JSON.parse(fs.readFileSync(runPath, 'utf8')) : { caseId, api, camera, startedAt: new Date().toISOString(), files: {} };
run.camera = camera;
const save = () => {
  run.updatedAt = new Date().toISOString();
  fs.writeFileSync(`${runPath}.tmp`, JSON.stringify(run, null, 1));
  fs.renameSync(`${runPath}.tmp`, runPath);
};

/** The start of each file's recording, from --recorded-from: "<start>" for one file, "<name>=<start>" for several. */
function startsByFile() {
  const out = {};
  for (const value of opts['recorded-from'] || []) {
    const eq = value.lastIndexOf('=');
    const named = eq > 0 && manifest.files.some((f) => f.name === value.slice(0, eq));
    const [name, start] = named ? [value.slice(0, eq), value.slice(eq + 1)] : [null, value];
    if (!Number.isFinite(Date.parse(start))) throw new Error(`Not a date and time: ${start}`);
    if (name) out[name] = start;
    else if (manifest.files.length === 1) out[manifest.files[0].name] = start;
    else throw new Error('With several files, give each start as "<file name>=<start>"');
  }
  return out;
}

const controller = new AbortController();
process.on('SIGINT', () => { console.log('\nStopping; the answers so far are saved.'); controller.abort(); });

async function main() {
  const starts = startsByFile();
  const client = createClient({ api, token: process.env.KHOZO_TOKEN || null });
  const user = await signInFromEnv(client);
  if (user) console.log(`Signed in as ${user.name || 'the officer'} (${user.role || 'role not given'})`);
  const report = await client.getCase(caseId);
  console.log(`Case ${caseId}: ${report.status}`);

  let recognizer = await loadRecognizer({ gpu: Boolean(opts.gpu) });
  let detector = null;
  let caseSigs = [];
  if (recognizer) {
    // The face finder Aarakshak uses, when the card names it.
    detector = await loadDetector({ gpu: Boolean(opts.gpu), modelPath: recognizer.detectorPath || undefined });
    caseSigs = await caseSignatures({ client, report, detector, recognizer });
    if (caseSigs.length) {
      run.model = { name: recognizer.name, version: recognizer.version, provider: recognizer.provider, line, top };
      console.log(`Comparing on this laptop first with ${recognizer.name} ${recognizer.version}, using ${caseSigs.length} case photo${caseSigs.length === 1 ? '' : 's'}`);
    } else {
      console.log('No face was found in the case photos on this laptop, so everyone seen will be sent to Khozo.');
      await recognizer.close();
      recognizer = null;
    }
  }

  for (const record of manifest.files) {
    if (controller.signal.aborted) break;
    const fileRun = run.files[record.sha256] ||= { name: record.name, searchId: `vs_${crypto.randomBytes(9).toString('base64url')}`, answers: {}, scores: {} };
    fileRun.recordedFrom = starts[record.name] || fileRun.recordedFrom || record.recordedFrom || null;
    console.log(`\n${record.name}: ${record.tracks.length} people seen`);

    let candidates;
    if (recognizer) {
      let done = 0;
      for (const track of record.tracks) {
        if (controller.signal.aborted) break;
        if (fileRun.scores[track.id] == null) {
          // Every kept picture of the person; the best score counts, and that picture goes first.
          const closest = closestOf(await trackSignatures({ dir: record.outDir, track, detector, recognizer }), caseSigs);
          if (closest.score != null) {
            fileRun.scores[track.id] = closest.score;
            (fileRun.best ||= {})[track.id] = closest.file;
          }
        }
        done += 1;
        if (done % 50 === 0) process.stdout.write(`\r  compared ${done} of ${record.tracks.length} on this laptop   `);
      }
      process.stdout.write('\r');
      save();
      candidates = chooseToSend(record.tracks, fileRun.scores, { line, top });
      console.log(`  ${candidates.length} of ${record.tracks.length} are close enough to send to Khozo`);
    } else {
      candidates = [...record.tracks].sort((a, b) => b.quality - a.quality);
    }
    if (maxFaces > 0) candidates = candidates.slice(0, maxFaces);
    const toSend = candidates.filter((t) => !fileRun.answers[t.id] || fileRun.answers[t.id].verdict === 'no_answer');
    if (opts['no-send'] || !toSend.length) {
      if (toSend.length) console.log(`  ${toSend.length} not sent (--no-send)`);
      continue;
    }
    let sent = 0;
    await sendFaces({
      client,
      caseId,
      record,
      dir: record.outDir,
      tracks: toSend,
      // With the first pass, up to three pictures of each person, the best-scoring first.
      picturesOf: (t) => (fileRun.best?.[t.id]
        ? [fileRun.best[t.id], ...(t.pictures || []).map((p) => p.file).filter((f) => f !== fileRun.best[t.id])].slice(0, 3)
        : [t.picture]),
      camera,
      recordedFrom: fileRun.recordedFrom,
      searchId: fileRun.searchId,
      busyWaitMs: Number(process.env.KHOZO_BUSY_WAIT_MS) || 15000,
      signal: controller.signal,
      onAnswers: (answers) => {
        Object.assign(fileRun.answers, answers);
        sent += Object.keys(answers).length;
        save();
        process.stdout.write(`\r  checked ${sent} of ${toSend.length} on Khozo   `);
      },
      onWait: ({ reason, seconds }) => {
        const why = { limit: 'Khozo’s limit for this officer is reached', connection: 'No connection to Khozo', engines: 'The face engines did not answer' }[reason];
        console.log(`\n  ${why}; trying again in ${seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${Math.round(seconds)} seconds`}`);
      },
    });
    process.stdout.write('\n');
  }
  save();

  fs.writeFileSync(reviewPath, reviewPage({ scanDir, manifest, run }));
  const first = toCheckFirst(peopleOf(manifest, run));
  console.log(`\n${first.length ? `${first.length} to look at first:` : 'No face was close enough to the case.'}`);
  for (const p of first.slice(0, 20)) {
    const clock = clockTime(p.recordedFrom, p.track.time);
    console.log(`  ${VERDICT_WORDS[p.verdict]}: ${p.record.name} at ${formatVideoTime(p.track.time)}${clock ? ` (${clock})` : ''}${p.closeness != null ? `, closeness ${p.closeness.toFixed(2)}` : ''}`);
  }
  console.log(`\nReview sheet: ${reviewPath}`);
  if (recognizer) await recognizer.close();
  if (detector) await detector.close();
}

main().catch((err) => {
  save();
  const hint = err instanceof KhozoError && err.status === 401 ? ' Sign in again.' : '';
  console.error(`\n${err.message}${/[.!?]$/.test(err.message) ? '' : '.'}${hint}`);
  process.exit(1);
});
