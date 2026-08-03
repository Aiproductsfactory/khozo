/**
 * Drives every image in the test set through the full Khozo pipeline and checks
 * that each one is stored, matched and logged correctly.
 *
 *   node scripts/test-image-pipeline.mjs
 *   node scripts/test-image-pipeline.mjs --images "D:/random images" --api http://localhost:4000
 *
 * For each image it verifies:
 *   1. the upload is accepted (or rejected for a documented reason)
 *   2. the bytes come back byte-for-byte from the photo endpoint
 *   3. the photo is in the database, not on the API server's local disk
 *   4. a match record, an audit entry and an activity entry were all written
 *
 * Identity checks use the fact that several people appear in more than one
 * photograph: a sighting is expected to match the case registered from a
 * *different* photo of the same person, and never one of anybody else.
 *
 * The public sighting endpoint is rate limited (correctly — it is the abuse
 * surface of the whole system), so this test needs the limit raised for its
 * run. Start the API with:
 *
 *   KHOZO_FOUND_REPORT_LIMIT=500 node server/src/index.js
 *
 * Do not raise it in production; the limiter is what stops the endpoint being
 * used to enumerate missing children.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';

import '../server/src/env.js';
import { readPhotoBlob, photoBlobStats, isPostgres, closePool } from '../server/src/db.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const API = arg('api', process.env.KHOZO_API || 'http://localhost:4000').replace(/\/+$/, '');
const IMAGE_DIR = arg('images', process.env.KHOZO_TEST_IMAGES || 'D:/random images');
const PASSWORD = 'khozo123';
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/**
 * Who each photograph shows. `null` means "nobody registered as a case", which
 * makes those images controls: a match against them is a false positive.
 *
 * `id.jpg` is deliberately excluded — it is a real student ID card containing a
 * living person's name, phone number and address, and does not belong in a
 * child-protection test fixture.
 */
const SUBJECTS = {
  'Aamir_Khan_3.jpg': 'aamir', 'Aamir_Khan_4.jpg': 'aamir', 'Aamir_Khan_5.jpg': 'aamir',
  'Aamir_Khan_6.jpg': 'aamir', 'Aamir_Khan_7.jpg': 'aamir',
  'Akshay_Kumar_0.jpg': 'akshay', 'Akshay_Kumar_1.jpg': 'akshay', 'Akshay_Kumar_2.jpg': 'akshay',
  'Akshay_Kumar_3.jpg': 'akshay', 'Akshay_Kumar_4.jpg': 'akshay', 'Akshay_Kumar_5.jpg': 'akshay',
  'Asin_0.jpg': 'asin', 'Asin_1.jpg': 'asin', 'Asin_2.jpg': 'asin',
  'Asin_12.jpg': 'asin', 'Asin_13.jpg': 'asin', 'Asin_14.jpg': 'asin',
  '0.jpg': null, '2.jpg': null, '4.jpg': null,
  'resixed-img.png': null,
  'c271f23f-7fd5-4a90-8eb7-9fa6cc5f1367_DSC05169.jpg': null,
  'd24489d4-e5e1-45ce-bed9-f3b559128224_DSC04487.jpg': null,
  'e7c44c90-94cd-404c-9e7e-f76aa7aa8345_DSC05169.jpg': null,
};

const EXCLUDED = { 'id.jpg': 'personal ID card — contains a real identity document' };

/** One case is registered per subject, from the photo named here. */
const REGISTRATION_PHOTO = {
  aamir: 'Aamir_Khan_3.jpg',
  akshay: 'Akshay_Kumar_0.jpg',
  asin: 'Asin_0.jpg',
};

const CASE_DETAIL = {
  aamir: { childName: 'Aarav Khan', age: 11, gender: 'Male', parentName: 'Nasreen Khan', parentPhone: '9820011221', district: 'Mumbai', zip: '400050', address: 'Bandra West, Mumbai' },
  akshay: { childName: 'Rohan Kumar', age: 13, gender: 'Male', parentName: 'Vinod Kumar', parentPhone: '9833044556', district: 'Mumbai', zip: '400024', address: 'Kurla East, Mumbai' },
  asin: { childName: 'Ananya Nair', age: 12, gender: 'Female', parentName: 'Latha Nair', parentPhone: '9845567788', district: 'Mumbai', zip: '400076', address: 'Powai, Mumbai' },
};

const results = [];
const record = (check, ok, detail = '') => results.push({ check, ok, detail });

async function api(pathname, { method = 'GET', token, body, form, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}/api${pathname}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  if (raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') };
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { error: text.slice(0, 200) }; }
  return { status: res.status, payload };
}

const login = async (email) => (await api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).payload;

function imageBlob(name) {
  const buf = fs.readFileSync(path.join(IMAGE_DIR, name));
  return { buf, blob: new Blob([buf], { type: MIME[path.extname(name).toLowerCase()] || 'image/jpeg' }) };
}

async function registerCase(token, subject, photoName) {
  const d = CASE_DETAIL[subject];
  const { blob } = imageBlob(photoName);
  const form = new FormData();
  Object.entries({
    childName: d.childName, age: String(d.age), gender: d.gender,
    parentName: d.parentName, parentPhone: d.parentPhone,
    address: d.address, state: 'Maharashtra', district: d.district, zip: d.zip,
    clothing: 'School uniform', identificationMark: 'Test fixture',
    dateOfMissing: new Date(Date.now() - 3 * 86400000).toISOString(),
    photoConsent: 'true', declarationAccepted: 'true', declarationMethod: 'digital',
    relationshipToChild: 'official', vulnerabilityCategories: 'unaccompanied',
  }).forEach(([k, v]) => form.append(k, v));
  form.append('photo', blob, photoName);

  const res = await api('/reports', { method: 'POST', token, form });
  if (res.status === 409) {
    const list = await api('/reports', { token });
    const existing = list.payload.reports.find((r) => r.childName === d.childName);
    if (existing) return existing;
  }
  if (res.status !== 201 && res.status !== 200) throw new Error(`register ${subject}: HTTP ${res.status} ${res.payload?.error || ''}`);
  return res.payload.report;
}

async function submitSighting(photoName) {
  const { blob } = imageBlob(photoName);
  const form = new FormData();
  Object.entries({
    foundLocation: `Pipeline test — ${photoName}`,
    note: 'Automated image pipeline test.',
    state: 'Maharashtra', district: 'Mumbai',
    reporterName: 'Pipeline test', reporterPhone: '9000000123',
    photoConsent: 'true', lat: '19.076', lng: '72.877',
  }).forEach(([k, v]) => form.append(k, v));
  form.append('photo', blob, photoName);
  return api('/reports/found', { method: 'POST', form });
}

async function main() {
  console.log(`Khozo image pipeline test\n  API    : ${API}\n  images : ${IMAGE_DIR}\n`);

  const all = fs.readdirSync(IMAGE_DIR).filter((f) => MIME[path.extname(f).toLowerCase()]);
  console.log(`Found ${all.length} image(s). Excluded: ${Object.keys(EXCLUDED).join(', ') || 'none'}\n`);

  const untracked = all.filter((f) => !(f in SUBJECTS) && !(f in EXCLUDED));
  record('every image is accounted for', untracked.length === 0, untracked.join(', '));

  const health = await api('/health');
  if (health.status !== 200) throw new Error(`API unreachable at ${API}`);
  record('database mode is postgres', isPostgres, isPostgres ? '' : 'DATABASE_URL not set — photos would be local');

  // --- register one case per subject ---------------------------------------
  const officer = await login('police@khozo.org');
  const cases = {};
  console.log('Registering cases:');
  for (const [subject, photo] of Object.entries(REGISTRATION_PHOTO)) {
    const report = await registerCase(officer.token, subject, photo);
    cases[subject] = report;
    console.log(`  ${subject.padEnd(8)} ${report.id.padEnd(13)} ${CASE_DETAIL[subject].childName.padEnd(13)} (${photo})`);
    record(`case registered for ${subject}`, Boolean(report.id));
    record(`case ${subject} stored a photo`, Boolean(report.photoFile), report.photoFile || 'no photoFile');
  }

  // --- every image through the sighting pipeline ----------------------------
  console.log('\nSubmitting every image as a sighting:');
  console.log('  image                         status   score  matched         expected     verdict');
  const rows = [];

  for (const name of all) {
    if (name in EXCLUDED) {
      console.log(`  ${name.padEnd(29)} SKIPPED  —      —               —            ${EXCLUDED[name]}`);
      continue;
    }
    const expectedSubject = SUBJECTS[name];
    const registrationPhoto = expectedSubject ? REGISTRATION_PHOTO[expectedSubject] : null;
    // The photo a case was registered from is not a fair identity test.
    const isRegistrationPhoto = name === registrationPhoto;

    const { buf } = imageBlob(name);
    const res = await submitSighting(name);

    if (res.status === 429) {
      console.error(
        `\nRate limited after ${rows.length} uploads. Restart the API with ` +
        'KHOZO_FOUND_REPORT_LIMIT=500 and re-run.',
      );
      record('rate limit headroom for the test run', false,
        'set KHOZO_FOUND_REPORT_LIMIT=500 on the API process');
      break;
    }
    if (res.status !== 201 && res.status !== 200) {
      console.log(`  ${name.padEnd(29)} HTTP ${String(res.status).padEnd(4)} —      —               —            ${res.payload?.error || ''}`);
      record(`upload accepted: ${name}`, false, `HTTP ${res.status}: ${res.payload?.error || ''}`);
      continue;
    }
    record(`upload accepted: ${name}`, true);

    const fr = res.payload.foundReport;
    // The public response deliberately omits which child was matched — a
    // reporter must not learn a child's identity. Resolve it through the
    // officer's review queue instead, which is where that data belongs.
    const queue = await api('/reports/found/all', { token: officer.token });
    const officerView = (queue.payload?.foundReports || []).find((f) => f.id === fr.id);
    const matchedName = officerView?.matchedReport?.childName || null;
    const expectedName = expectedSubject ? CASE_DETAIL[expectedSubject].childName : null;

    record(`public response hides child identity: ${name}`,
      fr.matchedReport === undefined && fr.matchedReportId === undefined,
      'POST /reports/found leaked a matched child to an unauthenticated reporter');

    let verdict;
    if (expectedSubject === null) {
      const ok = !matchedName;
      verdict = ok ? 'ok (no match)' : `FALSE POSITIVE -> ${matchedName}`;
      record(`control does not match: ${name}`, ok, matchedName || '');
    } else if (isRegistrationPhoto) {
      verdict = 'n/a (registration photo)';
    } else {
      const ok = matchedName === expectedName;
      verdict = ok ? 'ok' : `MISMATCH -> ${matchedName || 'none'}`;
      record(`identity match: ${name}`, ok, `expected ${expectedName}, got ${matchedName || 'none'}`);
    }

    console.log(
      `  ${name.padEnd(29)} ${String(res.status).padEnd(8)} ${String(fr.matchScore ?? '—').padEnd(6)} ` +
      `${(matchedName || '—').padEnd(15)} ${(expectedName || 'none').padEnd(12)} ${verdict}`,
    );

    // --- photo round-trips byte-for-byte, from the database ----------------
    const photoRes = await api(`/reports/photo/${fr.id}`, { token: officer.token, raw: true });
    const sameBytes = photoRes.status === 200 && crypto.createHash('sha256').update(photoRes.buffer).digest('hex')
      === crypto.createHash('sha256').update(buf).digest('hex');
    record(`photo round-trips intact: ${name}`, sameBytes,
      photoRes.status !== 200 ? `HTTP ${photoRes.status}` : `${photoRes.buffer.length} vs ${buf.length} bytes`);

    if (isPostgres && fr.photoFile) {
      const blob = await readPhotoBlob(fr.photoFile);
      record(`photo is in the database: ${name}`, Boolean(blob), blob ? '' : `${fr.photoFile} absent from photo_blobs`);
    }

    rows.push({ name, fr, expectedSubject });
  }

  // --- the database recorded all of it -------------------------------------
  console.log('\nVerifying database records:');
  const admin = await login('superadmin@khozo.org');
  const audit = (await api('/dashboard/audit', { token: admin.token })).payload;
  const activity = (await api('/dashboard/activity', { token: admin.token })).payload;
  const allFound = (await api('/reports/found/all', { token: admin.token })).payload.foundReports;

  for (const { name, fr } of rows) {
    const stored = allFound.find((f) => f.id === fr.id);
    record(`sighting persisted: ${name}`, Boolean(stored), stored ? '' : `${fr.id} missing from the review queue`);
  }
  const auditIds = new Set((audit.audit || []).map((a) => a.targetId));
  const withAudit = rows.filter((r) => auditIds.has(r.fr.id)).length;
  record('every sighting produced an audit entry', withAudit === rows.length, `${withAudit}/${rows.length}`);
  record('audit hash chain verifies', audit.integrity?.ok === true, JSON.stringify(audit.integrity));
  record('activity feed is populated', (activity.activity || []).length > 0, `${(activity.activity || []).length} entries`);

  const stats = await photoBlobStats();
  if (stats) {
    console.log(`  photo_blobs: ${stats.count} photos, ${(stats.totalBytes / 1024 / 1024).toFixed(2)} MB`);
    const localLeft = fs.existsSync(path.join(process.cwd(), 'server/data/uploads'))
      ? fs.readdirSync(path.join(process.cwd(), 'server/data/uploads')).filter((f) => MIME[path.extname(f).toLowerCase()]).length
      : 0;
    record('no photos left on local disk', localLeft === 0, `${localLeft} file(s) still in server/data/uploads`);
  }

  // --- report ---------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n--- ${results.length - failed.length}/${results.length} checks passed ---`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  ${f.check.padEnd(48)} ${f.detail}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(`\nImage pipeline test failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
