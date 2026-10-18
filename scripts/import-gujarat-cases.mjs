/**
 * Imports the Gujarat Police (Ahmedabad City) list of children still missing
 * (2007 to 31.08.2026) into Khozo, by driving the public HTTP API exactly as
 * the web app's Register FIR form does (POST /api/reports, multipart).
 *
 * The data itself is NOT in this repository and must never be committed: it is
 * real information about real children and families. The script reads a
 * directory prepared outside the repo that holds `cases.json` and `photos/`.
 *
 *   # look first: prints what would be sent, touches no network
 *   node scripts/import-gujarat-cases.mjs --data <dir> --dry-run
 *
 *   # then import (police / SJPU / admin account with Ahmedabad or Gujarat jurisdiction)
 *   KHOZO_IMPORT_PASSWORD=... node scripts/import-gujarat-cases.mjs \
 *     --data <dir> --api https://example.org --email officer@example.org --yes
 *
 * Options
 *   --data <dir>            directory with cases.json and photos/ (required)
 *   --api <url>             API origin, e.g. http://localhost:4000 (required unless --dry-run; no default)
 *   --email <email>         account to log in with (police, sjpu, admin or super_admin)
 *   --password <pw>         or set KHOZO_IMPORT_PASSWORD (keeps it out of shell history)
 *   --dry-run               print the payloads, no login, no requests, no log written
 *   --limit <n>             stop after n cases have been processed (created / found / failed)
 *   --only-with-photos      skip cases that have no usable photo
 *   --serials 1,2,3         import only these sheet serial numbers
 *   --delay-ms <ms>         pause after every write request (default 1500; each upload runs face screening)
 *   --publish               no longer supported (refused): public appeals are disabled on Khozo, so
 *                           imported records always stay inside the officer console.
 *   --name-format <fmt>     gu (default): Gujarati name only
 *                           gu+en: "ગુજરાતી નામ (Latin transliteration)" - the API has no alternate-name field
 *   --log <file>            progress log (default <data>/import-log.json); a rerun skips rows already done
 *   --no-duplicate-override when the server flags a possible duplicate of a DIFFERENT child, stop and
 *                           record it for review instead of resubmitting with allowDuplicate
 *   --yes                   required for any API that is not localhost
 *
 * Idempotency: a case counts as already imported when (a) the progress log has
 * a report id for its serial on this API, or (b) the server already holds a
 * report with the same child name, the same missing date and the same FIR /
 * diary reference. The server's own near-duplicate check (HTTP 409) is
 * resolved the same way; if the flagged record is a different child, the
 * case is resubmitted with allowDuplicate (the sheet is an official list of
 * distinct children), unless --no-duplicate-override is given.
 */

import { readFileSync, writeFileSync, existsSync, statSync, renameSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
function flag(name) {
  return argv.includes(`--${name}`);
}
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

const DATA_DIR = arg('data');
const DRY_RUN = flag('dry-run');
const API_RAW = arg('api');
const EMAIL = arg('email');
const PASSWORD = arg('password', process.env.KHOZO_IMPORT_PASSWORD);
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity;
const ONLY_WITH_PHOTOS = flag('only-with-photos');
const SERIALS = arg('serials') ? new Set(arg('serials').split(',').map((s) => Number(s.trim())).filter(Number.isFinite)) : null;
const DELAY_MS = Number(arg('delay-ms', '1500'));
const PUBLISH = flag('publish');
const PUBLISH_AUTH = arg('publish-authorisation');
const NAME_FORMAT = arg('name-format', 'gu');
const NO_OVERRIDE = flag('no-duplicate-override');
const YES = flag('yes');

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // server multer limit
const FORMAL_ROLES = ['police', 'sjpu', 'admin', 'super_admin'];
const STATE = 'Gujarat';
const DISTRICT = 'Ahmedabad';

function fail(message) {
  console.error(`\nImport stopped: ${message}`);
  process.exit(1);
}

if (!DATA_DIR) fail('--data <dir> is required (the folder holding cases.json and photos/).');
if (!['gu', 'gu+en'].includes(NAME_FORMAT)) fail('--name-format must be gu or gu+en.');
if (!Number.isFinite(DELAY_MS) || DELAY_MS < 0) fail('--delay-ms must be a non-negative number.');
if (!(LIMIT > 0)) fail('--limit must be a positive number.');
// Public appeals are disabled on Khozo: the API refuses every publish with 403,
// because names and photos of missing persons are never shown to the public.
// Refuse the flag here too, before anything is imported, rather than import
// every case and then fail each publish.
if (PUBLISH || PUBLISH_AUTH) {
  fail('--publish is no longer supported: public appeals are disabled on Khozo, and names and photos of missing persons are never shown to the public. Imported cases stay inside the officer console.');
}

let API = null;
if (!DRY_RUN) {
  if (!API_RAW) fail('--api <url> is required; there is deliberately no default target.');
  let url;
  try {
    url = new URL(API_RAW);
  } catch {
    fail(`--api is not a valid URL: ${API_RAW}`);
  }
  API = url.origin;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && !YES) {
    fail(
      `${API} is not a local server. Re-run with --yes once you have checked a --dry-run ` +
      'and are sure this is the server you mean to write real case records to.',
    );
  }
  if (!EMAIL || !PASSWORD) fail('--email and --password (or KHOZO_IMPORT_PASSWORD) are required.');
}

const LOG_FILE = arg('log', path.join(DATA_DIR, 'import-log.json'));

// ---------------------------------------------------------------- data

const casesFile = path.join(DATA_DIR, 'cases.json');
if (!existsSync(casesFile)) fail(`cases.json not found in ${DATA_DIR}`);
const CASES = JSON.parse(readFileSync(casesFile, 'utf8'));
if (!Array.isArray(CASES)) fail('cases.json must hold an array of cases.');

const norm = (v) => String(v || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const dayOf = (v) => {
  if (!v) return '';
  const t = new Date(v);
  return Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : String(v).slice(0, 10);
};
const clip = (text, max) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
};

function childNameFor(c) {
  if (NAME_FORMAT === 'gu+en' && c.childNameEn) return `${c.childName} (${c.childNameEn})`;
  return c.childName;
}

function firNoFor(c) {
  return c.referenceShort || `${c.station?.gu || ''} પો.સ્ટે. (Ahmedabad City list serial ${c.serial})`.trim();
}

function categoriesFor(c) {
  const reason = c.reasonEn || '';
  const out = [];
  if (/kidnap/i.test(reason)) out.push('trafficking_risk');
  if (/mental/i.test(reason)) out.push('mental_health_support');
  if (/institution/i.test(reason)) out.push('shelter_required');
  if (/mute/i.test(c.childNameEn || '')) out.push('disability_support');
  if (!out.length) out.push('unaccompanied');
  return out;
}

/** Everything the officer and the matcher should see, within the server's 600-character limit. */
function circumstancesFor(c) {
  const parts = [
    `Gujarat Police, Ahmedabad City: children still missing 2007 to 31.08.2026, serial ${c.serial}.`,
    `Police station: ${c.station?.en} (${c.station?.gu}).`,
    c.childNameEn ? `Name in English: ${c.childNameEn}.` : null,
    `Reason: ${c.reasonEn}${c.reason ? ` (${c.reason})` : ''}.`,
    c.dateApproximate ? `Missing date is approximate (sheet: ${c.missingDateText || c.missingDateRaw || 'not recorded'}).` : null,
    c.missingTimeText ? `When: ${c.missingTimeText}.` : null,
  ].filter(Boolean);
  const head = parts.join(' ');
  const room = 600 - head.length - ' Reference: .'.length;
  return room > 40 && c.reference ? `${head} Reference: ${clip(c.reference, room)}.` : clip(head, 600);
}

function payloadFor(c, user) {
  const fields = {
    childName: childNameFor(c),
    age: c.age,
    gender: c.gender,
    dateOfMissing: c.dateOfMissingForImport || '',
    firNo: firNoFor(c),
    parentName: c.complainantName || `${c.station?.en} Police Station`,
    parentPhone: c.contactPhones?.[0] || '',
    address: c.address || '',
    state: STATE,
    district: DISTRICT,
    circumstances: circumstancesFor(c),
    producedByType: 'police',
    mentalHealthConcern: /mental/i.test(c.reasonEn || '') ? 'yes' : 'unknown',
    disabilityStatus: /mute/i.test(c.childNameEn || '') ? 'yes' : 'unknown',
    educationLevel: 'unknown',
    declarationAccepted: 'true',
    declarationMethod: 'digital',
    declarationSignerName: user?.name || '(importing officer)',
    declarationSignerRole: user?.role || 'police',
    relationshipToChild: 'official',
    // The department's register is shared with police only (shared/scope.js).
    visibility: 'police',
  };
  const photo = c.photos?.[0] ? path.join(DATA_DIR, 'photos', c.photos[0]) : null;
  return { fields, categories: categoriesFor(c), photo };
}

/** Local checks that mirror validateMissingReport, so a bad row fails here, not on the server. */
function validate(c, p) {
  const errs = [];
  if (!p.fields.childName) errs.push('no child name');
  if (!Number.isInteger(p.fields.age) || p.fields.age < 0 || p.fields.age > 18) errs.push(`age ${p.fields.age} is not a whole number 0-18`);
  if (!['Male', 'Female'].includes(p.fields.gender)) errs.push(`gender ${p.fields.gender}`);
  if (!p.fields.dateOfMissing) errs.push('no missing date');
  else if (!Number.isFinite(new Date(p.fields.dateOfMissing).getTime())) errs.push(`bad date ${p.fields.dateOfMissing}`);
  else if (new Date(p.fields.dateOfMissing).getTime() > Date.now()) errs.push('missing date is in the future');
  if (p.fields.parentPhone && !/^\d{7,15}$/.test(p.fields.parentPhone)) errs.push('phone is not 7-15 digits');
  if (p.photo) {
    if (!existsSync(p.photo)) errs.push(`photo file missing: ${p.photo}`);
    else if (statSync(p.photo).size > MAX_PHOTO_BYTES) errs.push('photo is larger than 8 MB');
  }
  return errs;
}

// ---------------------------------------------------------------- progress log

function loadLog() {
  if (!existsSync(LOG_FILE)) return { apis: {} };
  try {
    const log = JSON.parse(readFileSync(LOG_FILE, 'utf8'));
    return log && typeof log === 'object' && log.apis ? log : { apis: {} };
  } catch (err) {
    fail(`could not read the progress log ${LOG_FILE}: ${err.message}`);
  }
}

function saveLog(log) {
  log.updatedAt = new Date().toISOString();
  const tmp = `${LOG_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(log, null, 2));
  renameSync(tmp, LOG_FILE);
}

// ---------------------------------------------------------------- HTTP

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let TOKEN = null;
let USER = null;

class HttpError extends Error {
  constructor(status, payload, message) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function request(pathname, { method = 'GET', body, form, auth = true } = {}, attempt = 0) {
  const headers = {};
  if (auth && TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${API}/api${pathname}`, {
      method,
      headers,
      body: form ? form() : body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (attempt < 5) {
      const wait = 2000 * 2 ** attempt;
      console.log(`    network error (${err.message}); retrying in ${wait / 1000}s`);
      await sleep(wait);
      return request(pathname, { method, body, form, auth }, attempt + 1);
    }
    throw err;
  }
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text.slice(0, 200) };
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
    console.log(`    ${method} ${pathname} -> ${res.status}; retrying in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return request(pathname, { method, body, form, auth }, attempt + 1);
  }
  if (res.status === 401 && auth && attempt === 0 && pathname !== '/auth/login') {
    await login();
    return request(pathname, { method, body, form, auth }, attempt + 1);
  }
  if (!res.ok) throw new HttpError(res.status, payload, `${method} ${pathname} -> ${res.status}: ${payload?.error || text.slice(0, 160)}`);
  return payload;
}

async function login() {
  const out = await request('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD }, auth: false });
  TOKEN = out.token;
  USER = out.user;
  return out.user;
}

function checkAccount(user) {
  if (!FORMAL_ROLES.includes(user.role)) {
    fail(`${user.email || EMAIL} has role "${user.role}". Use a police, sjpu, admin or super_admin account, ` +
      'otherwise every case lands as an unverified citizen intake.');
  }
  const j = user.jurisdiction || {};
  if (['police', 'sjpu'].includes(user.role) && j.district && norm(j.district) !== norm(DISTRICT)) {
    fail(`${user.role} account is scoped to district "${j.district}". It could create these Ahmedabad cases but ` +
      'would not see them afterwards (no idempotency check, no bulletin publishing). Use an Ahmedabad or Gujarat-wide account.');
  }
  if (user.role === 'admin' && j.state && norm(j.state) !== norm(STATE)) {
    fail(`admin account is scoped to state "${j.state}"; use a Gujarat or national account.`);
  }
}

async function existingReports() {
  const { reports } = await request('/reports');
  return reports || [];
}

/** Same child = same name (either name format) + same missing date + same station (FIR text or case notes). */
function matchesExisting(report, c, p) {
  const names = [c.childName, c.childNameEn ? `${c.childName} (${c.childNameEn})` : null].filter(Boolean).map(norm);
  const station = norm(c.station?.en);
  const notes = norm(report.vulnerabilityProfile?.circumstances);
  return (
    names.includes(norm(report.childName)) &&
    dayOf(report.dateOfMissing) === dayOf(p.fields.dateOfMissing) &&
    (norm(report.firNo) === norm(p.fields.firNo) || (station && notes.includes(`police station: ${station}`)))
  );
}

function buildForm(p, allowDuplicate) {
  return () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(p.fields)) if (v !== '' && v != null) fd.append(k, String(v));
    for (const cat of p.categories) fd.append('vulnerabilityCategories', cat);
    if (allowDuplicate) fd.append('allowDuplicate', 'true');
    if (p.photo) {
      // The register's photo was not given with anyone's consent; the
    // record says where it came from instead (DPIA G15).
    fd.append('photoBasis', 'department_register');
      fd.append('photo', new Blob([readFileSync(p.photo)], { type: 'image/jpeg' }), path.basename(p.photo));
    }
    return fd;
  };
}

// ---------------------------------------------------------------- main

async function main() {
  let selected = CASES.filter((c) => !SERIALS || SERIALS.has(c.serial));
  const noPhoto = selected.filter((c) => !c.photos?.length).length;
  if (ONLY_WITH_PHOTOS) selected = selected.filter((c) => c.photos?.length);

  console.log('Khozo import: Gujarat Police (Ahmedabad City) missing children');
  console.log(`  data     : ${DATA_DIR} (${CASES.length} cases, ${CASES.length - CASES.filter((c) => !c.photos?.length).length} with a photo)`);
  console.log(`  selected : ${selected.length}${ONLY_WITH_PHOTOS ? ` (skipping ${noPhoto} without a photo)` : ''}${Number.isFinite(LIMIT) ? `, limit ${LIMIT}` : ''}`);
  console.log(`  target   : ${DRY_RUN ? 'DRY RUN - nothing is sent' : API}`);
  console.log(`  names    : ${NAME_FORMAT}   publish bulletins: ${PUBLISH ? 'yes' : 'no'}   delay: ${DELAY_MS} ms\n`);

  // Local validation first, for every selected row.
  const prepared = selected.map((c) => {
    const p = payloadFor(c, null);
    return { c, p, errors: validate(c, p) };
  });
  const invalid = prepared.filter((x) => x.errors.length);
  for (const x of invalid) console.log(`  invalid  #${x.c.serial}: ${x.errors.join('; ')}`);

  if (DRY_RUN) {
    let shown = 0;
    for (const { c, p, errors } of prepared) {
      if (shown >= LIMIT) break;
      shown++;
      console.log(`--- #${c.serial} (sheet row ${c.sourceRow})${errors.length ? '  [WOULD FAIL: ' + errors.join('; ') + ']' : ''}`);
      console.log(JSON.stringify({
        ...p.fields,
        vulnerabilityCategories: p.categories,
        photo: p.photo ? `${path.basename(p.photo)} (${Math.round(statSync(p.photo).size / 1024)} KB)` : null,
        extraPhotosNotUploaded: (c.photos || []).slice(1),
        notes: c.notes,
      }, null, 2));
    }
    console.log(`\nDry run: ${shown} payloads printed, ${invalid.length} would fail local validation. Nothing was sent.`);
    return;
  }

  const user = await login();
  checkAccount(user);
  console.log(`Logged in as ${user.name} (${user.role}${user.jurisdiction?.district ? `, ${user.jurisdiction.district}` : ''}${user.jurisdiction?.state ? `, ${user.jurisdiction.state}` : ''}).\n`);

  const log = loadLog();
  log.apis[API] ||= { entries: {}, failures: {} };
  const book = log.apis[API];
  log.startedAt ||= new Date().toISOString();

  let existing = await existingReports();
  const summary = { created: 0, createdAfterDuplicateWarning: 0, alreadyInLog: 0, alreadyOnServer: 0, needsReview: 0, failed: 0, invalid: 0, published: 0 };
  let processed = 0;

  for (const { c, errors } of prepared) {
    if (processed >= LIMIT) break;
    const tag = `#${String(c.serial).padStart(3)} ${clip(c.childNameEn || c.childName, 34).padEnd(34)}`;
    const p = payloadFor(c, user);

    const done = book.entries[c.serial];
    if (done?.reportId) {
      summary.alreadyInLog++;
      if (PUBLISH && !done.published) await publish(done, tag, summary, log);
      continue;
    }
    processed++;
    if (errors.length) {
      summary.invalid++;
      book.failures[c.serial] = { error: `invalid: ${errors.join('; ')}`, at: new Date().toISOString() };
      saveLog(log);
      console.log(`  invalid   ${tag} ${errors.join('; ')}`);
      continue;
    }

    const already = existing.find((r) => matchesExisting(r, c, p));
    if (already) {
      book.entries[c.serial] = { reportId: already.id, status: 'already_on_server', childName: p.fields.childName, at: new Date().toISOString() };
      delete book.failures[c.serial];
      saveLog(log);
      summary.alreadyOnServer++;
      console.log(`  exists    ${tag} ${already.id}`);
      if (PUBLISH) await publish(book.entries[c.serial], tag, summary, log);
      continue;
    }

    try {
      let result;
      let status = 'created';
      let candidates = null;
      try {
        result = await request('/reports', { method: 'POST', form: buildForm(p, false) });
      } catch (err) {
        if (!(err instanceof HttpError) || err.status !== 409 || !err.payload?.duplicateCandidates) throw err;
        candidates = err.payload.duplicateCandidates;
        // Is the flagged record this very child (an earlier run whose log was lost)?
        existing = await existingReports();
        const same = candidates
          .map((d) => existing.find((r) => r.id === d.reportId))
          .find((r) => r && matchesExisting(r, c, p));
        if (same) {
          book.entries[c.serial] = { reportId: same.id, status: 'already_on_server', childName: p.fields.childName, at: new Date().toISOString() };
          delete book.failures[c.serial];
          saveLog(log);
          summary.alreadyOnServer++;
          console.log(`  exists    ${tag} ${same.id} (server duplicate check)`);
          if (PUBLISH) await publish(book.entries[c.serial], tag, summary, log);
          continue;
        }
        const list = candidates.map((d) => `${d.reportId} "${d.childName}" ${Math.round(d.score * 100)}%`).join(', ');
        if (NO_OVERRIDE) {
          book.failures[c.serial] = { error: 'possible duplicate - needs review', candidates, at: new Date().toISOString() };
          saveLog(log);
          summary.needsReview++;
          console.log(`  REVIEW    ${tag} server flags a possible duplicate: ${list}`);
          continue;
        }
        await sleep(DELAY_MS);
        result = await request('/reports', { method: 'POST', form: buildForm(p, true) });
        status = 'created_after_duplicate_warning';
        console.log(`            ${tag} server flagged ${list}; different child, submitted with allowDuplicate`);
      }
      const report = result.report;
      book.entries[c.serial] = {
        reportId: report.id,
        status,
        childName: p.fields.childName,
        firNo: report.firNo,
        photo: p.photo ? path.basename(p.photo) : null,
        duplicateCandidates: candidates ? candidates.map((d) => d.reportId) : undefined,
        at: new Date().toISOString(),
      };
      delete book.failures[c.serial];
      saveLog(log);
      existing.push(report);
      if (status === 'created') summary.created++;
      else summary.createdAfterDuplicateWarning++;
      console.log(`  created   ${tag} ${report.id}${p.photo ? '' : '  (no photo)'}`);
      await sleep(DELAY_MS);
      if (PUBLISH) await publish(book.entries[c.serial], tag, summary, log);
    } catch (err) {
      summary.failed++;
      book.failures[c.serial] = { error: err.message, at: new Date().toISOString() };
      saveLog(log);
      console.log(`  FAILED    ${tag} ${err.message}`);
      await sleep(DELAY_MS);
    }
  }

  const failures = Object.keys(book.failures).length;
  console.log('\n--- Summary ---');
  console.log(`Created                         : ${summary.created}`);
  console.log(`Created after duplicate warning : ${summary.createdAfterDuplicateWarning}`);
  console.log(`Already imported (progress log) : ${summary.alreadyInLog}`);
  console.log(`Already on the server           : ${summary.alreadyOnServer}`);
  console.log(`Needs review (possible dup)     : ${summary.needsReview}`);
  console.log(`Invalid locally                 : ${summary.invalid}`);
  console.log(`Failed                          : ${summary.failed}`);
  if (PUBLISH) console.log(`Bulletins published             : ${summary.published}`);
  console.log(`Imported in total on ${API}: ${Object.keys(book.entries).length} of ${CASES.length}`);
  console.log(`Progress log: ${LOG_FILE}${failures ? ` (${failures} open failure(s) recorded; rerun to retry)` : ''}`);
  if (summary.failed || summary.needsReview) process.exitCode = 1;
}

async function publish(entry, tag, summary, log) {
  try {
    await request(`/reports/${entry.reportId}/bulletin`, { method: 'POST', body: { publish: true, note: `Publication authorised: ${PUBLISH_AUTH}` } });
    entry.published = true;
    entry.publishAuthorisation = PUBLISH_AUTH;
    entry.publishedAt = new Date().toISOString();
    saveLog(log);
    summary.published++;
    console.log(`  published ${tag} ${entry.reportId}`);
  } catch (err) {
    entry.publishError = err.message;
    saveLog(log);
    console.log(`  publish failed ${tag} ${err.message}`);
  }
  await sleep(DELAY_MS);
}

main().catch((err) => {
  console.error(`\nImport failed: ${err.message}`);
  process.exit(1);
});
