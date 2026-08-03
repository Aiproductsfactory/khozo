/**
 * Seeds Khozo with realistic missing-child cases and sightings, backed by real
 * photographs, by driving the public HTTP API exactly as the apps do.
 *
 * The image set matters: several people appear more than once, so the same
 * person can be registered as a missing child from one photo and then "spotted"
 * in a different photo. That is what makes it possible to tell whether face
 * matching genuinely works, rather than only that the plumbing runs.
 *
 *   node scripts/seed-test-data.mjs
 *   node scripts/seed-test-data.mjs --images "D:/random images" --api http://localhost:4000
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const API = arg('api', process.env.KHOZO_API || 'http://localhost:4000').replace(/\/+$/, '');
const IMAGE_DIR = arg('images', process.env.KHOZO_TEST_IMAGES || 'D:/random images');
const PASSWORD = arg('password', 'khozo123');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function loadImage(name) {
  const file = path.join(IMAGE_DIR, name);
  if (!existsSync(file)) throw new Error(`Image not found: ${file}`);
  const ext = path.extname(name).toLowerCase();
  return { blob: new Blob([readFileSync(file)], { type: MIME[ext] || 'image/jpeg' }), name };
}

async function api(pathname, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}/api${pathname}`, {
    method,
    headers,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status}: ${payload?.error || text.slice(0, 160)}`);
  return payload;
}

const login = (email) => api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } });

/**
 * Cases to register. `photo` is the image filed with the report; `sightingPhoto`
 * is a *different* photo of the same person, used later to test recognition.
 */
const CASES = [
  {
    photo: 'Aamir_Khan_3.jpg',
    sightingPhoto: 'Aamir_Khan_5.jpg',
    childName: 'Aarav Khan',
    age: 11, gender: 'Male',
    parentName: 'Nasreen Khan', parentPhone: '9820011221',
    address: 'Bandra West, Mumbai', state: 'Maharashtra', district: 'Mumbai', zip: '400050',
    clothing: 'Blue school shirt, grey trousers',
    identificationMark: 'Small scar above the left eyebrow',
    sightingLocation: 'Bandra Terminus, Platform 1',
    filedBy: 'police@khozo.org',
  },
  {
    photo: 'Akshay_Kumar_0.jpg',
    sightingPhoto: 'Akshay_Kumar_4.jpg',
    childName: 'Rohan Kumar',
    age: 13, gender: 'Male',
    parentName: 'Vinod Kumar', parentPhone: '9833044556',
    address: 'Kurla East, Mumbai', state: 'Maharashtra', district: 'Mumbai', zip: '400024',
    clothing: 'Red t-shirt, black shorts',
    identificationMark: 'Birthmark on right forearm',
    sightingLocation: 'Kurla Bus Depot, near ticket counter',
    filedBy: 'sjpu@khozo.org',
  },
  {
    photo: 'Asin_0.jpg',
    sightingPhoto: 'Asin_13.jpg',
    childName: 'Ananya Nair',
    age: 12, gender: 'Female',
    parentName: 'Latha Nair', parentPhone: '9845567788',
    address: 'Powai, Mumbai', state: 'Maharashtra', district: 'Mumbai', zip: '400076',
    clothing: 'Green kurta with white leggings',
    identificationMark: 'Mole on the right cheek',
    sightingLocation: 'Powai Lake promenade',
    filedBy: 'police@khozo.org',
  },
];

/**
 * Control sighting: a face that belongs to none of the registered cases.
 *
 * This is the half of the test that catches a broken matcher. A scorer that
 * returns high numbers for everything looks correct on the three positive cases
 * above and is only exposed here, where the honest answer is a low score.
 */
const CONTROL_SIGHTING = {
  photo: '0.jpg',
  foundLocation: 'Dadar Station, west subway',
  note: 'Child alone near the subway exit, would not give a name.',
  state: 'Maharashtra',
  district: 'Mumbai',
};

/**
 * A second sighting of a person who IS registered, from a third photo.
 * Confirms recognition is not a fluke of one particular image pair.
 */
const SECOND_LOOK_SIGHTING = {
  photo: 'Aamir_Khan_7.jpg',
  expectedChild: 'Aarav Khan',
  foundLocation: 'Bandra West market road',
  note: 'Second reported sighting of the same child, different day.',
  state: 'Maharashtra',
  district: 'Mumbai',
};

async function registerCase(token, entry) {
  const image = loadImage(entry.photo);
  const form = new FormData();
  form.append('childName', entry.childName);
  form.append('age', String(entry.age));
  form.append('gender', entry.gender);
  form.append('parentName', entry.parentName);
  form.append('parentPhone', entry.parentPhone);
  form.append('address', entry.address);
  form.append('state', entry.state);
  form.append('district', entry.district);
  form.append('zip', entry.zip);
  form.append('clothing', entry.clothing);
  form.append('identificationMark', entry.identificationMark);
  form.append('dateOfMissing', new Date(Date.now() - 3 * 86400000).toISOString());
  form.append('photoConsent', 'true');
  form.append('declarationAccepted', 'true');
  form.append('declarationMethod', 'digital');
  form.append('relationshipToChild', 'official');
  form.append('vulnerabilityCategories', 'unaccompanied');
  form.append('photo', image.blob, image.name);
  try {
    const result = await api('/reports', { method: 'POST', token, form });
    return { report: result.report, reused: false };
  } catch (err) {
    // The server rejects near-duplicate registrations, which is correct - but it
    // also means a second seed run would fail. Reuse the existing case instead so
    // the script stays repeatable and still exercises sighting + matching.
    if (!/409/.test(err.message)) throw err;
    const { reports } = await api('/reports', { token });
    const existing = reports.find((r) => r.childName === entry.childName);
    if (!existing) throw err;
    return { report: existing, reused: true };
  }
}

async function submitSighting(photoName, details) {
  const image = loadImage(photoName);
  const form = new FormData();
  form.append('foundLocation', details.foundLocation);
  form.append('note', details.note);
  form.append('state', details.state);
  form.append('district', details.district);
  form.append('reporterName', details.reporterName || 'Seed volunteer');
  form.append('reporterPhone', details.reporterPhone || '9000000123');
  form.append('photoConsent', 'true');
  if (details.lat != null) form.append('lat', String(details.lat));
  if (details.lng != null) form.append('lng', String(details.lng));
  form.append('photo', image.blob, image.name);
  return api('/reports/found', { method: 'POST', form });
}

async function main() {
  console.log(`Khozo seed\n  API    : ${API}\n  images : ${IMAGE_DIR}\n`);

  if (!existsSync(IMAGE_DIR)) throw new Error(`Image directory not found: ${IMAGE_DIR}`);
  console.log(`Found ${readdirSync(IMAGE_DIR).length} files in the image directory.\n`);

  const health = await api('/health');
  if (!health?.ok) throw new Error('API health check failed');

  const registered = [];
  for (const entry of CASES) {
    const { token } = await login(entry.filedBy);
    const { report, reused } = await registerCase(token, entry);
    registered.push({ entry, report });
    console.log(
      `  ${reused ? 'reused    ' : 'registered'}  ${report.id}  ${entry.childName.padEnd(14)} (${entry.photo}) by ${entry.filedBy}`,
    );
  }

  console.log('\nPublishing bulletins...');
  const { token: adminToken } = await login('admin@khozo.org');
  for (const { report } of registered) {
    await api(`/reports/${report.id}/bulletin`, { method: 'POST', token: adminToken, body: { publish: true } });
    console.log(`  published   ${report.id}`);
  }

  console.log('\nSubmitting sightings (a different photo of the same person)...');
  const outcomes = [];
  for (const { entry, report } of registered) {
    const result = await submitSighting(entry.sightingPhoto, {
      foundLocation: entry.sightingLocation,
      note: `Child matching the description seen alone. Wearing ${entry.clothing.toLowerCase()}.`,
      state: entry.state,
      district: entry.district,
      lat: 19.076, lng: 72.877,
    });
    outcomes.push({ expected: report.id, entry, result });
    console.log(
      `  sighting    ${result.foundReport.id}  ${entry.sightingPhoto.padEnd(20)} ` +
      `score=${result.foundReport.matchScore} engine=${result.foundReport.matchEngine.provider}`,
    );
  }

  console.log('\nSubmitting a second sighting of an already-registered child...');
  const second = await submitSighting(SECOND_LOOK_SIGHTING.photo, SECOND_LOOK_SIGHTING);
  console.log(`  repeat      ${second.foundReport.id}  score=${second.foundReport.matchScore}`);

  console.log('\nSubmitting a control sighting whose face matches no case...');
  const control = await submitSighting(CONTROL_SIGHTING.photo, CONTROL_SIGHTING);
  console.log(`  control     ${control.foundReport.id}  score=${control.foundReport.matchScore}`);

  const engine = outcomes[0]?.result?.foundReport?.matchEngine;
  const positives = [...outcomes.map((o) => o.result.foundReport.matchScore), second.foundReport.matchScore];
  const worstPositive = Math.min(...positives);
  const controlScore = control.foundReport.matchScore;

  console.log('\n--- Result ---');
  console.log(`Match engine        : ${engine?.provider} (biometric: ${engine?.biometric})`);
  console.log(`Same-person scores  : ${positives.join(', ')}  (lowest ${worstPositive})`);
  console.log(`Control score       : ${controlScore}`);

  if (!engine?.biometric) {
    console.log(
      '\nWARNING: these are NOT face comparisons — the biometric tiers are not configured,\n' +
      '         so scores come from the non-biometric fallback and carry no meaning.\n' +
      '         Set AARAKSHAK_API_KEY (or AWS credentials) and re-run to test recognition.',
    );
  } else if (controlScore >= worstPositive) {
    console.log(
      `\nFAIL: the control face scored ${controlScore}, at or above the weakest genuine\n` +
      `      match (${worstPositive}). The matcher is not separating people.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`\nPASS: every same-person sighting outscored the control by ${(worstPositive - controlScore).toFixed(2)}.`);
  }

  console.log(`\nSeeded ${registered.length} cases, ${outcomes.length + 1} matching sightings, 1 control.`);
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  process.exit(1);
});
