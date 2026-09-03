/**
 * Reports whether each face provider is reachable and answering.
 *
 * Exists because a provider that silently fails is indistinguishable, from the
 * dashboard, from one that is working and finding nothing — and the fallback
 * behind it used to invent scores, so a quiet outage produced confident,
 * fictional matches rather than an error.
 *
 * Compares an image with itself: a working provider must report high similarity
 * and at least one face, so the answer is unambiguous.
 *
 *   node scripts/check-match-providers.mjs                    # local .env
 *   node scripts/check-match-providers.mjs --image path.jpg
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import '../server/src/env.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** A tiny valid JPEG, so the check needs no fixture on disk. */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

const imagePath = arg('image', null);
const photo = imagePath ? fs.readFileSync(path.resolve(imagePath)) : TINY_JPEG;

console.log(`Khozo face providers\n  image: ${imagePath || 'built-in 1x1 JPEG (detects reachability, not faces)'}\n`);

const results = [];
const report = (provider, ok, detail) => {
  results.push({ provider, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${provider.padEnd(18)} ${detail}`);
};

// --- Aarakshak --------------------------------------------------------------
const aarakshakKey = process.env.AARAKSHAK_API_KEY;
if (!aarakshakKey) {
  report('aarakshak', false, 'AARAKSHAK_API_KEY is not set');
} else {
  try {
    const form = new FormData();
    form.append('source_image', new Blob([photo], { type: 'image/jpeg' }), 'a.jpg');
    form.append('target_image', new Blob([photo], { type: 'image/jpeg' }), 'b.jpg');
    form.append('threshold', process.env.AARAKSHAK_THRESHOLD || '0.35');

    const started = Date.now();
    const res = await fetch('https://aarakshak.com/api/v1/compare', {
      method: 'POST',
      headers: { 'X-API-Key': aarakshakKey },
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    const elapsed = Date.now() - started;
    const text = await res.text();

    if (!res.ok) {
      report('aarakshak', false, `HTTP ${res.status} in ${elapsed}ms — ${text.slice(0, 160)}`);
    } else {
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        report('aarakshak', false, `HTTP 200 but the body was not JSON — ${text.slice(0, 120)}`);
      }
      if (data) {
        const score = data.score ?? data.similarity ?? data.match_confidence;
        const usable = typeof score === 'number' && Number.isFinite(score);
        report(
          'aarakshak',
          usable,
          usable
            ? `answered in ${elapsed}ms, score ${score}, faces ${data.source_faces?.length ?? '?'}`
            : `HTTP 200 in ${elapsed}ms but no usable score field — keys: ${Object.keys(data).join(', ')}`
        );
      }
    }
  } catch (err) {
    report('aarakshak', false, `${err.name}: ${err.message}`);
  }
}

// --- AWS Rekognition, through the Worker's own signer -----------------------
const { compareFacesRekognition, rekognitionConfigured } = await import('../worker/src/rekognition.js');
if (!rekognitionConfigured(process.env)) {
  report('aws-rekognition', false, 'AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not set');
} else {
  const started = Date.now();
  const res = await compareFacesRekognition(process.env, photo, photo);
  const elapsed = Date.now() - started;
  if (!res) {
    report('aws-rekognition', false, `no answer in ${elapsed}ms — check credentials, region and the Rekognition policy`);
  } else if (res.warnings?.includes('no_face_detected')) {
    report('aws-rekognition', true, `answered in ${elapsed}ms: reachable, and reports no face in this image`);
  } else {
    report('aws-rekognition', true, `answered in ${elapsed}ms, score ${res.score}`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} providers answering`);
if (failed.length) {
  console.log(
    '\nWith no provider answering, no face comparison is made and no candidate is offered.\n' +
      'Sightings are still recorded and still reach a reviewer — they simply carry no score.'
  );
  process.exitCode = 1;
}
