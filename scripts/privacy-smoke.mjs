/**
 * Checks the personal-data rules in shared/privacy.js and the retention
 * schedule in shared/retention.js, against in-memory records: no server, no
 * database.
 *
 *   node scripts/privacy-smoke.mjs
 */
import process from 'node:process';

import {
  aadhaarFields,
  aadhaarFingerprint,
  anonymisedReportPatch,
  anonymisedSightingPatch,
  derivedSecret,
  deskCaseView,
  identityHashWith,
  maskAadhaar,
  privacySecrets,
} from '../shared/privacy.js';
import { planRetention, runRetentionSweep } from '../shared/retention.js';
import { duplicateScore } from '../shared/case-domain.js';
import { runRetention } from '../worker/src/ops.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const DAY = 86400000;
const NOW = Date.parse('2027-06-01T00:00:00Z');
const iso = (offsetDays) => new Date(NOW + offsetDays * DAY).toISOString();

// ---- Secrets
{
  const a = privacySecrets({ KHOZO_JWT_SECRET: 'deployment-secret-1' });
  const b = privacySecrets({ KHOZO_JWT_SECRET: 'deployment-secret-2' });
  check('each purpose gets its own key', new Set([a.fieldHashKey, a.rateLimitAuditSalt, a.exportSigning.key]).size === 3);
  check('keys follow the deployment secret', a.fieldHashKey !== b.fieldHashKey && a.exportSigning.key !== b.exportSigning.key);
  check('no key is a constant from the repository', ![a.exportSigning.key, a.rateLimitAuditSalt].includes('khozo-demo-export-signing-key') && a.rateLimitAuditSalt !== 'khozo-demo-rate-limit-audit');
  const explicit = privacySecrets({ KHOZO_JWT_SECRET: 'x', KHOZO_EXPORT_SIGNING_KEY: 'set-by-operator', KHOZO_EXPORT_SIGNING_KEY_ID: 'k1' });
  check('an explicit key wins', explicit.exportSigning.key === 'set-by-operator' && explicit.exportSigning.keyId === 'k1');
  check('a derived key cannot be the root', derivedSecret('root', 'p') !== 'root' && derivedSecret('root', 'p').length === 64);
  check('a throttled phone cannot be recovered without the salt', identityHashWith('s1', '9876543210') !== identityHashWith('s2', '9876543210'));
}

// ---- Aadhaar
{
  const key = 'field-key';
  const f = aadhaarFields('4321 8765 1098', key);
  check('an Aadhaar number is kept as its last four digits', f.childAadhar === 'XXXX XXXX 1098');
  check('and a keyed fingerprint', /^[a-f0-9]{64}$/.test(f.childAadharHash) && !f.childAadharHash.includes('432187651098'));
  check('the fingerprint needs the key', aadhaarFingerprint('432187651098', 'other-key') !== f.childAadharHash);
  check('anything but twelve digits is not stored', aadhaarFields('12345', key).childAadhar === null);
  check('a masked value stays masked', maskAadhaar('XXXX XXXX 1098') === 'XXXX XXXX 1098');
  const base = { childName: 'Asha', gender: 'Female', age: 9, state: 'Gujarat', district: 'Ahmedabad' };
  const stored = { ...base, ...aadhaarFields('432187651098', key) };
  const again = { ...base, childName: 'A. Kumari', ...aadhaarFields('4321-8765-1098', key) };
  const other = { ...base, childName: 'Bina', ...aadhaarFields('999988881098', key) };
  const legacy = { ...base, childName: 'Old record', childAadhar: '432187651098' };
  check('the same number scores as a duplicate', duplicateScore(stored, again, { aadhaarKey: key }) >= 0.58);
  check('the same last four digits do not', duplicateScore({ ...stored, childName: 'Zed' }, { ...other, childName: 'Yam' }, { aadhaarKey: key }) < 0.58);
  check('a number stored whole before the rule still matches', duplicateScore(legacy, again, { aadhaarKey: key }) >= 0.58);
}

// ---- Desk views
{
  const report = { id: 'r_1', childAadhar: '432187651098', childAadharHash: 'abc', parentPhone: '9000000001', parentEmail: 'p@example.org', address: '1 Lane' };
  const cci = deskCaseView({ role: 'cci' }, report);
  const police = deskCaseView({ role: 'police' }, report);
  check('a CCI desk sees no family contact', cci.parentPhone === null && cci.parentEmail === null && cci.address === null && Boolean(cci.familyContactWithheld));
  check('the police see the family contact', police.parentPhone === '9000000001' && police.address === '1 Lane');
  check('every desk sees a legacy Aadhaar number masked', police.childAadhar === 'XXXX XXXX 1098' && cci.childAadhar === 'XXXX XXXX 1098');
  check('no desk receives the fingerprint', !('childAadharHash' in police) && !('childAadharHash' in cci));
  check('the stored record is not changed by a view', report.parentPhone === '9000000001' && report.childAadhar === '432187651098');
}

// ---- Anonymisation patches
{
  const report = {
    id: 'r_9', childName: 'Zarina', personCategory: 'child', gender: 'Female', age: 11, state: 'Gujarat', district: 'Ahmedabad',
    status: 'closed', firNo: 'FIR/12/2026', childAadhar: 'XXXX XXXX 1098', childAadharHash: 'h', parentName: 'Rafiq', parentPhone: '9',
    parentEmail: 'e', address: 'Lane', zip: '380001', photoFile: 'r_9.jpg', photoUrl: '/api/reports/photo/r_9', height: 140, weight: 32,
    identificationProfile: { identificationMark: 'Mole' }, vulnerabilityProfile: { categories: ['trafficking_risk'], categoryLabels: ['Trafficking risk'], circumstances: 'Left with a man' },
    declaration: { signerName: 'Rafiq' }, notes: [{ id: 'n1', ts: 1, text: 'Uncle Salim took her', actorRole: 'police', actorName: 'PSI Shah' }],
    workflow: [{ id: 'w1', ts: 2, action: 'refer_cwc', label: 'Referred to CWC', note: 'Spoke to Rafiq', actorRole: 'police' }],
    externalIds: [{ id: 'x1', system: 'trackchild', value: 'TC-8812', recordedAt: '2026-01-01' }],
    closure: { reason: 'restored_family', label: 'Restored to family', note: 'Handed to mother at Vatva', closedAt: '2026-02-01' },
    foundLocation: '23.0, 72.6', dateOfMissing: '2026-01-14T10:00:00Z', createdAt: 5, retentionUntil: iso(-1),
  };
  const patch = anonymisedReportPatch(report, { now: NOW, approval: { reference: 'ORDER-1' } });
  const after = { ...report, ...patch };
  const text = JSON.stringify(after);
  const leaks = ['Zarina', 'Rafiq', 'FIR/12/2026', 'Mole', 'Left with a man', 'Salim', 'PSI Shah', 'TC-8812', 'Vatva', '23.0, 72.6', 'r_9.jpg', '380001'].filter((t) => text.includes(t));
  check('an anonymised case keeps nothing identifying', leaks.length === 0, leaks.join(', '));
  check('it keeps the statistics', after.gender === 'Female' && after.age === 11 && after.district === 'Ahmedabad' && after.status === 'closed');
  check('it keeps the history as counts and kinds', after.workflow.length === 1 && after.workflow[0].action === 'refer_cwc' && after.notes.length === 1 && !after.notes[0].text);
  check('it keeps the vulnerability categories', after.vulnerabilityProfile.categories[0] === 'trafficking_risk' && !after.vulnerabilityProfile.circumstances);
  check('it keeps why the case closed, not the note', after.closure.reason === 'restored_family' && !after.closure.note);
  check('the date gone missing keeps only its month', after.dateOfMissing === '2026-01-01');
  check('height and weight go', after.height === null && after.weight === null);
  const sighting = {
    id: 'f_1', status: 'pending_review', state: 'Gujarat', district: 'Ahmedabad', lat: 23.01, lng: 72.55, foundLocation: 'Kalupur station platform 3',
    reporterName: 'Kiran', reporterPhone: '9111111111', reporterPhoneVisible: '9111111111', idProofNumberMasked: '**1234', note: 'Girl in red, crying',
    photoFile: 'f_1.jpg', matchCandidates: [{ reportId: 'r_9', rank: 1, score: 0.8, status: 'proposed', warnings: ['face_small'] }], createdAt: 7,
  };
  const s = { ...sighting, ...anonymisedSightingPatch(sighting, { now: NOW }) };
  const sText = JSON.stringify(s);
  const sLeaks = ['Kalupur', 'Kiran', '9111111111', '1234', 'crying', 'f_1.jpg'].filter((t) => sText.includes(t));
  check('an anonymised sighting keeps nothing identifying', sLeaks.length === 0 && s.lat === null && s.lng === null, sLeaks.join(', '));
  check('its place is still text', s.foundLocation === 'Location removed');
  check('its candidate list keeps ids and scores only', s.matchCandidates[0].reportId === 'r_9' && s.matchCandidates[0].score === 0.8 && !s.matchCandidates[0].warnings);
}

// ---- Retention plan
function world() {
  const reports = [
    { id: 'r_open_old', status: 'missing', retentionUntil: iso(-10), photoFile: 'a.jpg' },
    { id: 'r_closed_old', status: 'closed', retentionUntil: iso(-10), photoFile: 'b.jpg', childName: 'Closed Child' },
    { id: 'r_closed_new', status: 'closed', retentionUntil: iso(400) },
    { id: 'r_soon', status: 'found', retentionUntil: iso(10) },
    { id: 'r_done', status: 'closed', retentionUntil: iso(-50), anonymizedAt: iso(-40) },
  ];
  const foundReports = [
    { id: 'f_plain', status: 'referred_cwc', retentionUntil: iso(-1), photoFile: 'fp.jpg', foundLocation: 'Platform 3, Kalupur' },
    { id: 'f_linked', status: 'pending_review', matchedReportId: 'r_open_old', retentionUntil: iso(-1), photoFile: 'fl.jpg' },
    { id: 'f_confirmed_open', status: 'matched', matchedReportId: 'r_closed_new', retentionUntil: iso(-1) },
    { id: 'f_confirmed_gone', status: 'matched', matchedReportId: 'r_closed_old', retentionUntil: iso(-1) },
    { id: 'f_fresh', status: 'pending_review', retentionUntil: iso(100) },
  ];
  return { reports, foundReports };
}
{
  const plan = planRetention({ ...world(), now: NOW });
  const ids = (list) => list.map((x) => x.id).sort().join(',');
  check('an expired, unescalated sighting is due', ids(plan.sightings.anonymise).includes('f_plain'));
  check('a sighting linked to an open case is kept with it', plan.sightings.extend.some((x) => x.id === 'f_linked' && x.reason === 'linked_to_open_case'));
  check('a confirmed sighting lives as long as its case', plan.sightings.extend.some((x) => x.id === 'f_confirmed_open' && x.until === iso(400)));
  check('a confirmed sighting goes when its case has ended', plan.sightings.anonymise.some((x) => x.id === 'f_confirmed_gone' && x.reason === 'case_ended'));
  check('a closed case past its date is due', ids(plan.cases.anonymise) === 'r_closed_old');
  check('an open case past its date is never due, only reviewed', ids(plan.cases.review) === 'r_open_old');
  check('records due within 30 days are counted', plan.dueSoon.cases === 1);
  check('an anonymised record is left alone', !JSON.stringify(plan).includes('r_done'));
}

// ---- Sweep, dry run and applied
function memoryDeps() {
  const { reports, foundReports } = world();
  const deleted = [];
  const audit = [];
  const activity = [
    { id: 'a1', target: 'Closed Child', scope: { reportId: 'r_closed_old' } },
    { id: 'a2', target: 'Platform 3, Kalupur', scope: { state: 'Gujarat' } },
    { id: 'a3', target: 'Someone else', scope: { reportId: 'r_open_old' } },
  ];
  return {
    deleted, audit, activity,
    listReports: () => reports.map((r) => ({ ...r })),
    listFoundReports: () => foundReports.map((f) => ({ ...f })),
    updateReport: (id, patch) => Object.assign(reports.find((r) => r.id === id), patch),
    updateFoundReport: (id, patch) => Object.assign(foundReports.find((f) => f.id === id), patch),
    addAudit: (row) => audit.push(row),
    deletePhoto: async (file) => deleted.push(file),
    rewriteActivity: (fn) => { for (const row of activity) { const p = fn(row); if (p) Object.assign(row, p); } },
    faceIndex: null,
    reports, foundReports,
  };
}
{
  const deps = memoryDeps();
  const dry = await runRetentionSweep(deps, { now: NOW, apply: false });
  check('a dry run changes nothing', !dry.applied && deps.deleted.length === 0 && deps.audit.length === 0 && !deps.reports.some((r) => r.anonymizedAt && r.id !== 'r_done'));
  const done = await runRetentionSweep(deps, { now: NOW, apply: true });
  check('an applied sweep anonymises what is due', done.done.sightingsAnonymised === 2 && done.done.casesAnonymised === 1);
  check('and deletes their photographs', ['fp.jpg', 'b.jpg'].every((f) => deps.deleted.includes(f)) && !deps.deleted.includes('a.jpg'));
  check('an open case is untouched', !deps.reports.find((r) => r.id === 'r_open_old').anonymizedAt);
  check('a kept sighting gets its case’s date', deps.foundReports.find((f) => f.id === 'f_confirmed_open').retentionUntil === iso(400));
  check('every change is audited by id', deps.audit.length === 5 && deps.audit.every((row) => row.targetId && !JSON.stringify(row).includes('Closed Child')));
  check('the activity feed is rewritten', deps.activity[0].target === 'Anonymised case r_closed_old' && deps.activity[1].target === 'Location removed' && deps.activity[2].target === 'Someone else');
  const again = await runRetentionSweep(deps, { now: NOW, apply: true });
  check('a second sweep finds nothing more to do', again.done.sightingsAnonymised === 0 && again.done.casesAnonymised === 0 && again.done.sightingsExtended === 0);
}

// ---- The Worker's nightly job
{
  const makeStore = () => {
    const deps = memoryDeps();
    const notifications = [];
    let flushed = false;
    const store = {
      ...deps,
      listUsers: () => [{ id: 'u_sa', role: 'super_admin' }, { id: 'u_p', role: 'police' }],
      addNotification: (row) => notifications.push(row),
    };
    return { deps, notifications, store, flush: async () => { flushed = true; }, flushed: () => flushed };
  };
  const queries = [];
  const io = { query: async (_env, sql, params) => { queries.push({ sql, params }); return { rowCount: 3, rows: [] }; } };

  let made = makeStore();
  const off = await runRetention({}, null, { now: NOW, io, createStore: async () => made, faceIndex: null });
  check('without KHOZO_RETENTION_ENFORCE nothing is deleted', !off.enforce && made.deps.deleted.length === 0);
  check('the super admins are told what is due', made.notifications.length === 1 && made.notifications[0].userId === 'u_sa' && /past their date/.test(made.notifications[0].title));
  check('an open case past its date is raised as high priority', made.notifications[0].priority === 'high');
  check('no notification or activity is purged without a period set', queries.length === 0);

  made = makeStore();
  const on = await runRetention({ KHOZO_RETENTION_ENFORCE: 'on', KHOZO_NOTIFICATION_RETENTION_DAYS: '90', KHOZO_ACTIVITY_RETENTION_DAYS: '730' }, null, { now: NOW, io, createStore: async () => made, faceIndex: null });
  check('with KHOZO_RETENTION_ENFORCE=on the schedule is carried out', on.enforce && on.done.casesAnonymised === 1 && made.deps.deleted.includes('b.jpg'));
  check('the changes are flushed', made.flushed());
  check('notifications older than the set period are deleted', queries.some((q) => /delete from public\.notifications/.test(q.sql) && q.params[0] === NOW - 90 * DAY));
  check('activity older than the set period is deleted', queries.some((q) => /delete from public\.activity/.test(q.sql) && q.params[0] === NOW - 730 * DAY));
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) process.exit(1);
console.log('Privacy and retention checks passed.');
