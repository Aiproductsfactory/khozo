import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = path.join(root, 'server', 'data', 'db.json');
const backupFile = path.join(root, 'server', 'data', 'db.json.smoke.bak');
const port = Number(process.env.KHOZO_SMOKE_PORT || 4400);
const base = `http://localhost:${port}/api`;

let server;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method, pathName, { token, body, form } = {}) {
  const headers = {};
  let payload;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${pathName}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `${method} ${pathName} failed with ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function expectStatus(status, fn, label) {
  try {
    await fn();
  } catch (err) {
    assert(err.status === status, `${label}: expected ${status}, got ${err.status || err.message}`);
    return;
  }
  throw new Error(`${label}: expected ${status}, request succeeded`);
}

function tinyPngFile() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  );
  return new File([png], 'tiny.png', { type: 'image/png' });
}

function textFile() {
  return new File(['not an image'], 'note.txt', { type: 'text/plain' });
}

function addDeclaration(form, signer = 'Smoke Declarant') {
  form.set('declarationAccepted', 'true');
  form.set('declarationSignerName', signer);
  form.set('relationshipToChild', 'guardian');
  form.set('declarationSignerRole', 'parent');
  form.set('declarationMethod', 'digital');
  return form;
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const health = await request('GET', '/health');
      if (health.ok) return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('API did not become healthy');
}

async function login(email) {
  const data = await request('POST', '/auth/login', { body: { email, password: 'khozo123' } });
  assert(data.token, `Missing token for ${email}`);
  return data;
}

async function publicOtp(phone) {
  const data = await request('POST', '/auth/otp/start', { body: { phone } });
  assert(data.demoOtp, 'demo OTP should be returned outside production');
  return data.demoOtp;
}

function uniquePassword() {
  return `KhozoSmoke-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function futureDate(days = 30) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

async function run() {
  if (fs.existsSync(dbFile)) {
    fs.copyFileSync(dbFile, backupFile);
    fs.rmSync(dbFile, { force: true });
  }
  server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(root, 'server'),
    env: {
      ...process.env,
      // Run against the isolated JSON store, not the real database. This suite
      // backs up and restores db.json and deliberately trips rate limits and
      // abuse paths — none of which belongs in the live Postgres instance.
      DATABASE_URL: '',
      PORT: String(port),
      KHOZO_FOUND_REPORT_LIMIT: '2',
      KHOZO_REGISTER_LIMIT: '20',
      KHOZO_LOGIN_LIMIT: '40',
      KHOZO_CASE_STATUS_LIMIT: '2',
      KHOZO_SIGHTING_STATUS_LIMIT: '2',
      KHOZO_GRIEVANCE_STATUS_LIMIT: '2',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (buf) => process.stdout.write(`[api] ${buf}`));
  server.stderr.on('data', (buf) => process.stderr.write(`[api] ${buf}`));
  await waitForServer();

  const superAdmin = await login('superadmin@khozo.org');
  const admin = await login('admin@khozo.org');
  const sjpu = await login('sjpu@khozo.org');
  const ahtu = await login('ahtu@khozo.org');
  const dcrb = await login('dcrb@khozo.org');
  const dlsa = await login('dlsa@khozo.org');
  const cwc = await login('cwc@khozo.org');
  const saa = await login('saa@khozo.org');
  const jjb = await login('jjb@khozo.org');
  const sara = await login('sara@khozo.org');
  const crimeBureau = await login('crimebureau@khozo.org');
  const parent = await login('parent@khozo.org');

  const parentReports = await request('GET', '/reports', { token: parent.token });
  assert(parentReports.reports.some((row) => row.childName === 'suresh'), 'demo parent should see owned seeded report');
  const publicDirectory = await request('GET', '/dashboard/public/directory');
  assert(publicDirectory.emergency.some((row) => row.phone === '1098'), 'public directory should include Childline');
  assert(publicDirectory.directory.some((row) => row.role === 'sjpu'), 'public directory should include SJPU contact points');
  assert(publicDirectory.directory.some((row) => row.role === 'ahtu'), 'public directory should include AHTU contact points');
  assert(publicDirectory.directory.some((row) => row.role === 'dcrb'), 'public directory should include DCRB contact points');
  assert(publicDirectory.directory.some((row) => row.role === 'dlsa'), 'public directory should include DLSA contact points');
  assert(publicDirectory.directory.some((row) => row.role === 'cwc'), 'public directory should include CWC contact points');
  assert(publicDirectory.directory.some((row) => row.role === 'saa'), 'public directory should include SAA contact points');
  assert(publicDirectory.directory.some((row) => row.role === 'sara'), 'public directory should include SARA contact points');
  assert(publicDirectory.directory.every((row) => !('email' in row)), 'public directory should not expose account emails');
  assert(publicDirectory.directory.every((row) => !('mustChangePassword' in row)), 'public directory should not expose account state');
  const mumbaiDirectory = await request('GET', '/dashboard/public/directory?state=Maharashtra&district=Mumbai');
  assert(mumbaiDirectory.directory.length > 0, 'Mumbai public directory should include contacts');
  assert(mumbaiDirectory.directory.every((row) => row.jurisdiction?.state === 'Maharashtra'), 'public directory state filter should apply');
  assert(mumbaiDirectory.directory.every((row) => row.jurisdiction?.district === 'Mumbai'), 'public directory district filter should apply');
  const dangerRouting = await request('GET', '/dashboard/public/directory?state=Maharashtra&district=Mumbai&incidentType=immediate_danger');
  assert(dangerRouting.emergencyPlan.primary?.phone === '112', 'immediate danger route should prioritize ERSS 112');
  assert(dangerRouting.emergencyPlan.secondary.some((row) => row.phone === '1098'), 'immediate danger route should include Childline backup');
  assert(dangerRouting.emergencyPlan.localContacts.some((row) => row.role === 'sjpu'), 'immediate danger route should include SJPU desks');
  assert(dangerRouting.emergencyPlan.localContacts.some((row) => row.role === 'ahtu'), 'immediate danger route should include AHTU desks');
  assert(dangerRouting.emergencyPlan.localContacts.some((row) => row.role === 'dcrb'), 'immediate danger route should include DCRB desks');
  assert(dangerRouting.emergencyPlan.localContacts.some((row) => row.role === 'dlsa'), 'immediate danger route should include DLSA desks');
  assert(dangerRouting.emergencyPlan.localContacts.some((row) => row.role === 'police'), 'immediate danger route should include police desks');
  assert(dangerRouting.emergencyPlan.localContacts.every((row) => !('email' in row)), 'emergency route contacts should not expose account emails');
  assert(dangerRouting.emergencyPlan.localContacts.every((row) => !('mustChangePassword' in row)), 'emergency route contacts should not expose account state');
  const welfareRouting = await request('GET', '/dashboard/public/directory?state=Maharashtra&district=Mumbai&incidentType=welfare');
  assert(welfareRouting.emergencyPlan.primary?.phone === '1098', 'welfare route should prioritize Childline 1098');
  assert(welfareRouting.emergencyPlan.localContacts.some((row) => row.role === 'cwc'), 'welfare route should include CWC desks');
  assert(welfareRouting.emergencyPlan.localContacts.some((row) => row.role === 'dcpu'), 'welfare route should include DCPU desks');
  assert(welfareRouting.emergencyPlan.localContacts.some((row) => row.role === 'saa'), 'welfare route should include SAA desks');
  assert(welfareRouting.emergencyPlan.localContacts.some((row) => row.role === 'dlsa'), 'welfare route should include DLSA desks');
  const railwayRouting = await request('GET', '/dashboard/public/directory?state=Maharashtra&district=Mumbai&incidentType=railway');
  assert(railwayRouting.emergencyPlan.primary?.phone === '139', 'railway route should prioritize railway helpline 139');
  assert(railwayRouting.emergencyPlan.secondary.some((row) => row.phone === '1098'), 'railway route should include Childline backup');
  assert(railwayRouting.emergencyPlan.localContacts.some((row) => row.role === 'rpf'), 'railway route should include RPF desks');
  const sjpuDirectory = await request('GET', '/dashboard/public/directory?role=sjpu');
  assert(sjpuDirectory.directory.some((row) => row.email === undefined && row.role === 'sjpu'), 'SJPU public directory should be redacted');
  const grievance = await request('POST', '/grievances', {
    body: {
      grievanceType: 'sighting_followup',
      reportToLevel: 'cwc',
      name: 'Smoke Grievance Citizen',
      phone: '9000000888',
      email: 'smoke.grievance@example.org',
      state: 'Maharashtra',
      district: 'Mumbai',
      linkedReceiptId: 'f_public_receipt',
      subject: 'Smoke grievance follow-up',
      description: 'Smoke grievance description should stay out of audit payloads and only appear in the grievance queue.',
      attachmentName: 'smoke-supporting-note.pdf',
    },
  });
  assert(grievance.grievance.id?.startsWith('g_'), 'public grievance should return receipt id');
  assert(grievance.grievance.status === 'submitted', 'public grievance should start submitted');
  const grievanceStatus = await request('GET', `/grievances/status/${grievance.grievance.id}`);
  assert(grievanceStatus.grievance.id === grievance.grievance.id, 'public grievance status should resolve by receipt id');
  assert(!('description' in grievanceStatus.grievance), 'public grievance status should not expose description');
  await request('GET', `/grievances/status/${grievance.grievance.id}`);
  await expectStatus(429, () => request('GET', `/grievances/status/${grievance.grievance.id}`), 'public grievance status rate limit');
  await expectStatus(404, () => request('GET', '/grievances/status/g_missing_receipt'), 'missing public grievance receipt');
  const adoptionGrievance = await request('POST', '/grievances', {
    body: {
      grievanceType: 'adoption_carings',
      reportToLevel: 'saa',
      name: 'Smoke Adoption Citizen',
      phone: '9000000889',
      email: 'smoke.adoption.grievance@example.org',
      state: 'Maharashtra',
      district: 'Mumbai',
      linkedReceiptId: 'CARINGS/SMOKE/GRIEVANCE',
      subject: 'Smoke adoption grievance',
      description: 'CARINGS smoke grievance detail should stay out of audit payloads and only appear in the grievance queue.',
      attachmentName: 'smoke-carings-note.pdf',
    },
  });
  assert(adoptionGrievance.grievance.grievanceType === 'adoption_carings', 'adoption grievance should preserve type');
  assert(adoptionGrievance.grievance.reportToLevel === 'saa', 'adoption grievance should preserve SAA report-to level');
  assert(adoptionGrievance.grievance.grievanceLabel === 'Adoption / CARINGS support', 'adoption grievance should return public label');
  assert(adoptionGrievance.grievance.reportToLabel === 'SAA', 'adoption grievance should return SAA public label');
  await expectStatus(403, () => request('POST', '/auth/register', {
    body: {
      name: 'Blocked Public Police',
      email: 'blocked.public.police@khozo.org',
      password: 'khozo123',
      role: 'police',
      phone: '9788197572',
      state: 'Maharashtra',
      district: 'Mumbai',
    },
  }), 'public privileged registration blocked');
  await expectStatus(400, () => request('POST', '/auth/register', {
    body: {
      name: 'No OTP Parent',
      email: 'no.otp.parent@khozo.org',
      password: 'khozo123',
      role: 'parent',
      phone: '9788197571',
      state: 'Tamil Nadu',
      district: 'Perambalur',
    },
  }), 'public registration without OTP');
  const samePhoneOtp = await publicOtp('9788197570');
  await expectStatus(400, () => request('POST', '/auth/register', {
    body: {
      name: 'Bad OTP Parent',
      email: 'bad.otp.parent@khozo.org',
      password: 'khozo123',
      role: 'parent',
      phone: '9788197570',
      otp: '000000',
      state: 'Tamil Nadu',
      district: 'Perambalur',
    },
  }), 'public registration wrong OTP');
  const samePhone = await request('POST', '/auth/register', {
    body: {
      name: 'Same Phone Parent',
      email: 'same.phone.parent@khozo.org',
      password: 'khozo123',
      role: 'parent',
      phone: '9788197570',
      otp: samePhoneOtp,
      state: 'Tamil Nadu',
      district: 'Perambalur',
    },
  });
  const samePhoneReports = await request('GET', '/reports', { token: samePhone.token });
  assert(samePhoneReports.reports.length === 0, 'unverified same-phone parent should not inherit another parent report');

  const badAgeReportForm = new FormData();
  badAgeReportForm.set('childName', 'Impossible Age Child');
  badAgeReportForm.set('age', '27');
  await expectStatus(400, () => request('POST', '/reports', { token: parent.token, form: badAgeReportForm }), 'invalid child age');

  const noDeclarationForm = new FormData();
  noDeclarationForm.set('childName', 'No Declaration Child');
  await expectStatus(400, () => request('POST', '/reports', { token: parent.token, form: noDeclarationForm }), 'missing report declaration');

  const futureReportForm = new FormData();
  futureReportForm.set('childName', 'Future Missing Child');
  addDeclaration(futureReportForm);
  futureReportForm.set('dateOfMissing', '2999-01-01');
  await expectStatus(400, () => request('POST', '/reports', { token: parent.token, form: futureReportForm }), 'future missing date');

  const badFileReportForm = new FormData();
  badFileReportForm.set('childName', 'Bad File Child');
  addDeclaration(badFileReportForm);
  badFileReportForm.set('photoConsent', 'true');
  badFileReportForm.set('photo', textFile());
  await expectStatus(400, () => request('POST', '/reports', { token: parent.token, form: badFileReportForm }), 'non-image child photo');

  const photoReportForm = new FormData();
  photoReportForm.set('childName', 'Smoke Photo Child');
  addDeclaration(photoReportForm, 'Smoke Report Declarant');
  photoReportForm.set('gender', 'Female');
  photoReportForm.set('age', '6');
  photoReportForm.set('state', 'Tamil Nadu');
  photoReportForm.set('district', 'Perambalur');
  photoReportForm.append('vulnerabilityCategories', 'unaccompanied');
  photoReportForm.append('vulnerabilityCategories', 'language_barrier');
  photoReportForm.set('producedByType', 'citizen');
  photoReportForm.set('educationLevel', 'primary');
  photoReportForm.set('disabilityStatus', 'unknown');
  photoReportForm.set('mentalHealthConcern', 'no');
  photoReportForm.set('complexion', 'Smoke complexion detail should stay private.');
  photoReportForm.set('clothing', 'Smoke clothing detail should stay private.');
  photoReportForm.set('identificationMark', 'Smoke identification mark should stay private.');
  photoReportForm.set('circumstances', 'Smoke Form-J circumstances should stay out of audit payloads and public lookup.');
  photoReportForm.set('photoConsent', 'true');
  photoReportForm.set('photo', tinyPngFile());
  const photoReport = await request('POST', '/reports', { token: parent.token, form: photoReportForm });
  assert(photoReport.report.photoUrl, 'photo report should include photoUrl');
  assert(photoReport.report.status === 'intake_pending', 'citizen report should start as pending intake');
  assert(photoReport.report.declaration?.accepted === true, 'missing-child report should store accepted declaration');
  assert(photoReport.report.declaration?.signerName === 'Smoke Report Declarant', 'missing-child declaration should store signer name');
  assert(photoReport.report.identificationProfile?.clothing?.includes('Smoke clothing detail'), 'missing-child report should store identification profile');
  assert(photoReport.report.vulnerabilityProfile?.categories?.includes('language_barrier'), 'missing-child report should store vulnerability categories');
  const badProfileForm = new FormData();
  badProfileForm.set('childName', 'Bad Profile Child');
  addDeclaration(badProfileForm);
  badProfileForm.set('vulnerabilityCategories', 'bad_category');
  await expectStatus(400, () => request('POST', '/reports', { token: parent.token, form: badProfileForm }), 'invalid vulnerability category');
  await expectStatus(409, () => request('POST', `/reports/${photoReport.report.id}/bulletin`, {
    token: superAdmin.token,
    body: { publish: true },
  }), 'publish pending citizen intake');
  await expectStatus(409, () => request('POST', `/reports/${photoReport.report.id}/confirm-match`, {
    token: superAdmin.token,
    body: { sendSms: true },
  }), 'confirm pending citizen intake');
  await expectStatus(409, () => request('POST', `/reports/${photoReport.report.id}/case-workflow`, {
    token: superAdmin.token,
    body: { action: 'refer_cwc' },
  }), 'workflow pending citizen intake');
  await expectStatus(403, () => request('POST', `/reports/${photoReport.report.id}/verify-intake`, {
    token: parent.token,
    body: { note: 'Parent cannot verify intake' },
  }), 'parent verify intake');
  const verifiedPhotoReport = await request('POST', `/reports/${photoReport.report.id}/verify-intake`, {
    token: superAdmin.token,
    body: { note: 'Smoke verification of citizen intake' },
  });
  assert(verifiedPhotoReport.report.status === 'missing', 'verified citizen intake should become a missing case');
  assert(verifiedPhotoReport.report.intakeStatus === 'verified', 'verified citizen intake should record verified status');
  assert(verifiedPhotoReport.report.firNo, 'verified citizen intake should receive a formal FIR/GD number');
  const publicCaseStatus = await request('GET', `/reports/public/status/${encodeURIComponent(verifiedPhotoReport.report.firNo)}`);
  assert(publicCaseStatus.status.id === photoReport.report.id, 'public case status should resolve by FIR/GD number');
  assert(publicCaseStatus.status.status === 'missing', 'public case status should expose safe case status');
  assert(publicCaseStatus.status.publicName === 'Identity restricted', 'unpublished public case status should restrict child name');
  assert(!('parentPhone' in publicCaseStatus.status), 'public case status should not expose parent phone');
  assert(!('parentName' in publicCaseStatus.status), 'public case status should not expose parent name');
  assert(!('childAadhar' in publicCaseStatus.status), 'public case status should not expose Aadhar');
  assert(!('address' in publicCaseStatus.status), 'public case status should not expose exact address');
  assert(!('photoUrl' in publicCaseStatus.status), 'public case status should not expose protected photo URL');
  assert(!('declaration' in publicCaseStatus.status), 'public case status should not expose report declaration');
  assert(!JSON.stringify(publicCaseStatus).includes('Smoke Report Declarant'), 'public case status should not expose declaration signer');
  assert(!('identificationProfile' in publicCaseStatus.status), 'public case status should not expose identification profile');
  assert(!('vulnerabilityProfile' in publicCaseStatus.status), 'public case status should not expose vulnerability profile');
  assert(!JSON.stringify(publicCaseStatus).includes('Smoke identification mark'), 'public case status should not expose identifying marks');
  await request('GET', `/reports/public/status/${encodeURIComponent(verifiedPhotoReport.report.firNo)}`);
  await expectStatus(429, () => request('GET', `/reports/public/status/${encodeURIComponent(verifiedPhotoReport.report.firNo)}`), 'public case status rate limit');
  await expectStatus(404, () => request('GET', '/reports/public/status/CASE-NOT-FOUND'), 'missing public case reference');
  const sjpuStats = await request('GET', '/dashboard/stats', { token: sjpu.token });
  assert(sjpuStats.scope === 'Mumbai SJPU', `SJPU scope should be Mumbai SJPU, got ${sjpuStats.scope}`);
  const readiness = await request('GET', '/dashboard/readiness', { token: superAdmin.token });
  // Storage reports what is actually configured, so assert it matches reality
  // rather than pinning it to the old JSON-file default.
  // This suite always runs against the JSON store (see DATABASE_URL above), so
  // storage must report the warning that tells an operator to move to Postgres.
  const storageCheck = readiness.checks.find((row) => row.id === 'storage');
  assert(storageCheck && storageCheck.status === 'warning',
    `storage readiness should warn in JSON mode, got ${storageCheck && storageCheck.status}`);
  assert(readiness.summary.warning >= 1, 'readiness should flag demo/pilot warnings');
  assert(readiness.checks.some((row) => row.id === 'audit_integrity' && row.status === 'pass'), 'readiness should verify audit integrity');
  assert(readiness.checks.some((row) => row.id === 'match_provider' && row.detail), 'readiness should include match provider status');
  assert(readiness.checks.some((row) => row.id === 'public_abuse'), 'readiness should include public abuse monitoring');
  await expectStatus(403, () => request('GET', '/dashboard/readiness', { token: parent.token }), 'parent readiness report');
  const sjpuForm = new FormData();
  sjpuForm.set('childName', 'SJPU Smoke Child');
  addDeclaration(sjpuForm, 'Smoke SJPU Declarant');
  sjpuForm.set('gender', 'Male');
  sjpuForm.set('age', '8');
  sjpuForm.set('state', 'Maharashtra');
  sjpuForm.set('district', 'Mumbai');
  sjpuForm.set('firNo', 'SJPU/SMOKE/2026/01');
  const sjpuReport = await request('POST', '/reports', { token: sjpu.token, form: sjpuForm });
  assert(sjpuReport.report.status === 'missing', 'SJPU should register verified formal cases');
  assert(sjpuReport.report.intakeStatus === 'verified', 'SJPU cases should start verified');
  assert(sjpuReport.report.registeredByRole === 'sjpu', 'SJPU case should preserve registered role');
  const sjpuReports = await request('GET', '/reports', { token: sjpu.token });
  assert(sjpuReports.reports.some((row) => row.id === sjpuReport.report.id), 'SJPU should see own district report');
  const sjpuMis = await request('GET', '/dashboard/mis', { token: sjpu.token });
  assert(sjpuMis.demographics.byRegistrationSource.some((row) => row.name === 'SJPU/FIR'), 'MIS should identify SJPU/FIR source');
  const ahtuStats = await request('GET', '/dashboard/stats', { token: ahtu.token });
  assert(ahtuStats.scope === 'Mumbai AHTU', `AHTU scope should be Mumbai AHTU, got ${ahtuStats.scope}`);
  const ahtuReports = await request('GET', '/reports', { token: ahtu.token });
  assert(ahtuReports.reports.some((row) => row.district === 'Mumbai'), 'AHTU should see Mumbai district reports');
  await expectStatus(403, () => request('POST', `/reports/${sjpuReport.report.id}/confirm-match`, {
    token: ahtu.token,
    body: { sendSms: true },
  }), 'AHTU confirm match');
  const dcrbStats = await request('GET', '/dashboard/stats', { token: dcrb.token });
  assert(dcrbStats.scope === 'Mumbai DCRB', `DCRB scope should be Mumbai DCRB, got ${dcrbStats.scope}`);
  const dcrbReports = await request('GET', '/reports', { token: dcrb.token });
  assert(dcrbReports.reports.some((row) => row.district === 'Mumbai'), 'DCRB should see Mumbai district reports');
  await expectStatus(403, () => request('POST', `/reports/${sjpuReport.report.id}/confirm-match`, {
    token: dcrb.token,
    body: { sendSms: true },
  }), 'DCRB confirm match');
  const dlsaStats = await request('GET', '/dashboard/stats', { token: dlsa.token });
  assert(dlsaStats.scope === 'Mumbai DLSA', `DLSA scope should be Mumbai DLSA, got ${dlsaStats.scope}`);
  const dlsaReports = await request('GET', '/reports', { token: dlsa.token });
  assert(dlsaReports.reports.some((row) => row.district === 'Mumbai'), 'DLSA should see Mumbai district reports');
  await expectStatus(403, () => request('POST', `/reports/${sjpuReport.report.id}/confirm-match`, {
    token: dlsa.token,
    body: { sendSms: true },
  }), 'DLSA confirm match');
  const saaStats = await request('GET', '/dashboard/stats', { token: saa.token });
  assert(saaStats.scope === 'Mumbai SAA', `SAA scope should be Mumbai SAA, got ${saaStats.scope}`);
  const saaReports = await request('GET', '/reports', { token: saa.token });
  assert(saaReports.reports.some((row) => row.district === 'Mumbai'), 'SAA should see Mumbai district reports');
  await expectStatus(403, () => request('POST', `/reports/${sjpuReport.report.id}/confirm-match`, {
    token: saa.token,
    body: { sendSms: true },
  }), 'SAA confirm match');
  const saraStats = await request('GET', '/dashboard/stats', { token: sara.token });
  assert(saraStats.scope === 'Maharashtra', `SARA scope should be Maharashtra, got ${saraStats.scope}`);
  const saraReports = await request('GET', '/reports', { token: sara.token });
  assert(saraReports.reports.some((row) => row.state === 'Maharashtra'), 'SARA should see Maharashtra reports');
  assert(!saraReports.reports.some((row) => row.state === 'Goa'), 'SARA should not see Goa reports');
  await expectStatus(403, () => request('POST', `/reports/${photoReport.report.id}/transfer-jurisdiction`, {
    token: parent.token,
    body: { state: 'Karnataka', district: 'Bengaluru Urban', reason: 'Parent cannot transfer jurisdiction' },
  }), 'parent jurisdiction transfer');
  const transferredPhotoReport = await request('POST', `/reports/${photoReport.report.id}/transfer-jurisdiction`, {
    token: superAdmin.token,
    body: { state: 'Karnataka', district: 'Bengaluru Urban', station: 'Bengaluru CWC Desk', reason: 'Smoke cross-state transfer' },
  });
  assert(transferredPhotoReport.report.state === 'Karnataka', 'transfer should update case state');
  assert(transferredPhotoReport.report.district === 'Bengaluru Urban', 'transfer should update case district');
  assert(transferredPhotoReport.report.transfers?.length === 1, 'transfer history should be recorded');
  const publishedBulletin = await request('POST', `/reports/${photoReport.report.id}/bulletin`, {
    token: superAdmin.token,
    body: { publish: true },
  });
  assert(publishedBulletin.report.bulletin?.published === true, 'verified missing case should publish bulletin');
  const publicBulletins = await request('GET', '/reports/public/bulletins');
  const publicBulletin = publicBulletins.bulletins.find((row) => row.id === photoReport.report.id);
  assert(publicBulletin, 'published bulletin should appear publicly');
  assert(!('parentPhone' in publicBulletin), 'public bulletin should not expose parent phone');
  assert(!('parentName' in publicBulletin), 'public bulletin should not expose parent name');
  assert(!('childAadhar' in publicBulletin), 'public bulletin should not expose child Aadhar');
  assert(!('photoUrl' in publicBulletin), 'public bulletin should not expose protected photo URL');
  const publicSearch = await request('GET', '/reports/public/search?state=Karnataka&status=missing');
  const searchBulletin = publicSearch.results.find((row) => row.id === photoReport.report.id);
  assert(searchBulletin, 'public search should include active published bulletin');
  assert(searchBulletin.resultType === 'active_bulletin', 'public search should label active bulletins');
  assert(searchBulletin.publicName === 'Smoke Photo Child', 'active public bulletin search may expose published child name');
  assert(!('parentPhone' in searchBulletin), 'public search should not expose parent phone');
  assert(!('childAadhar' in searchBulletin), 'public search should not expose child Aadhar');
  assert(!('photoUrl' in searchBulletin), 'public search should not expose protected photo URL');
  const recoveredSearch = await request('GET', '/reports/public/search?status=found&state=Maharashtra');
  assert(recoveredSearch.results.some((row) => row.resultType === 'recovered_status'), 'public search should include recovered status records');
  assert(recoveredSearch.results.every((row) => row.publicName === 'Identity restricted'), 'recovered public search results should keep identity restricted');
  assert(recoveredSearch.results.every((row) => !('parentPhone' in row) && !('parentName' in row) && !('photoUrl' in row)), 'recovered public search results should stay redacted');
  const unpublishedBulletin = await request('POST', `/reports/${photoReport.report.id}/bulletin`, {
    token: superAdmin.token,
    body: { publish: false },
  });
  assert(unpublishedBulletin.report.bulletin?.published === false, 'bulletin should unpublish');
  const publicBulletinsAfterUnpublish = await request('GET', '/reports/public/bulletins');
  assert(
    !publicBulletinsAfterUnpublish.bulletins.some((row) => row.id === photoReport.report.id),
    'unpublished bulletin should not appear publicly'
  );
  await expectStatus(401, () => request('GET', photoReport.report.photoUrl.replace('/api', '')), 'anonymous report photo access');
  const parentPhoto = await fetch(`${base}${photoReport.report.photoUrl.replace('/api', '')}`, {
    headers: { Authorization: `Bearer ${parent.token}` },
  });
  assert(parentPhoto.ok, `parent should fetch own photo, got ${parentPhoto.status}`);
  await expectStatus(403, () => request('GET', photoReport.report.photoUrl.replace('/api', ''), { token: samePhone.token }), 'same-phone report photo access');

  const cwcStats = await request('GET', '/dashboard/stats', { token: cwc.token });
  assert(cwcStats.scope === 'Mumbai', `CWC scope should be Mumbai, got ${cwcStats.scope}`);
  const cwcReportsAfterTransfer = await request('GET', '/reports', { token: cwc.token });
  assert(!cwcReportsAfterTransfer.reports.some((row) => row.id === photoReport.report.id), 'Mumbai CWC should not see transferred Karnataka case');
  const cwcMis = await request('GET', '/dashboard/mis', { token: cwc.token });
  assert(cwcMis.scope === 'Mumbai', `CWC MIS scope should be Mumbai, got ${cwcMis.scope}`);
  assert(cwcMis.totals.reports >= 1, 'CWC MIS should include scoped reports');
  assert(cwcMis.demographics?.byAgeBand?.length > 0, 'CWC MIS should include age-band demographics');
  assert(cwcMis.demographics?.byGender?.length > 0, 'CWC MIS should include gender demographics');
  assert(cwcMis.demographics?.byRegistrationSource?.length > 0, 'CWC MIS should include registration-source split');
  assert(Array.isArray(cwcMis.compliance?.pendingWork), 'CWC MIS should include pending-work compliance split');
  assert(cwcMis.signature?.type === 'mis_export', 'CWC MIS should include signature type');
  assert(cwcMis.signature?.algorithm === 'sha256-hmac', 'CWC MIS should include signature algorithm');
  assert(/^[a-f0-9]{64}$/.test(cwcMis.signature?.digest || ''), 'CWC MIS should include SHA-256 digest');
  const cwcMisVerify = await request('POST', '/dashboard/export/verify', {
    token: cwc.token,
    body: cwcMis,
  });
  assert(cwcMisVerify.ok === true, 'MIS signature should verify');
  assert(cwcMisVerify.type === 'mis_export', 'MIS signature verification should return type');
  const tamperedMisVerify = await request('POST', '/dashboard/export/verify', {
    token: cwc.token,
    body: { ...cwcMis, totals: { ...cwcMis.totals, reports: cwcMis.totals.reports + 1 } },
  });
  assert(tamperedMisVerify.ok === false, 'tampered MIS signature should fail verification');
  assert(!cwcMis.byState.some((row) => row.name === 'Goa'), 'CWC MIS should not include Goa cases');
  await expectStatus(403, () => request('GET', '/dashboard/mis', { token: parent.token }), 'parent MIS report');
  const cwcFollowups = await request('GET', '/dashboard/followups', { token: cwc.token });
  assert(cwcFollowups.scope === 'Mumbai', `CWC follow-up scope should be Mumbai, got ${cwcFollowups.scope}`);
  assert(cwcFollowups.alerts.some((row) => row.district === 'Mumbai'), 'CWC should see Mumbai follow-up alerts');
  assert(!cwcFollowups.alerts.some((row) => row.state === 'Goa'), 'CWC should not see Goa follow-up alerts');
  await expectStatus(403, () => request('GET', '/dashboard/followups', { token: parent.token }), 'parent follow-up alerts');
  const cwcGrievances = await request('GET', '/grievances', { token: cwc.token });
  const cwcGrievance = cwcGrievances.grievances.find((row) => row.id === grievance.grievance.id);
  assert(cwcGrievance, 'Mumbai CWC should see Mumbai grievance');
  assert(cwcGrievance.description.includes('Smoke grievance description'), 'CWC grievance queue should include full description');
  const goaGrievance = await request('POST', '/grievances', {
    body: {
      grievanceType: 'service_access',
      reportToLevel: 'dcpu',
      state: 'Goa',
      district: 'South Goa',
      subject: 'Goa smoke grievance',
      description: 'Goa smoke grievance should stay outside Mumbai CWC scope.',
    },
  });
  const cwcGrievancesAfterGoa = await request('GET', '/grievances', { token: cwc.token });
  assert(!cwcGrievancesAfterGoa.grievances.some((row) => row.id === goaGrievance.grievance.id), 'Mumbai CWC should not see Goa grievance');
  const saaGrievances = await request('GET', '/grievances', { token: saa.token });
  const saaAdoptionGrievance = saaGrievances.grievances.find((row) => row.id === adoptionGrievance.grievance.id);
  assert(saaAdoptionGrievance, 'Mumbai SAA should see Mumbai adoption grievance');
  assert(saaAdoptionGrievance.description.includes('CARINGS smoke grievance detail'), 'SAA grievance queue should include adoption grievance details');
  const saraGrievances = await request('GET', '/grievances', { token: sara.token });
  assert(saraGrievances.grievances.some((row) => row.id === adoptionGrievance.grievance.id), 'Maharashtra SARA should see in-state adoption grievance');
  await expectStatus(403, () => request('GET', '/grievances', { token: parent.token }), 'parent grievance queue');
  await expectStatus(403, () => request('POST', `/grievances/${grievance.grievance.id}/status`, {
    token: parent.token,
    body: { status: 'under_review', publicMessage: 'Parent cannot update grievance status' },
  }), 'parent grievance status update');
  const updatedGrievance = await request('POST', `/grievances/${grievance.grievance.id}/status`, {
    token: cwc.token,
    body: {
      status: 'under_review',
      publicMessage: 'CWC desk has taken this grievance for review.',
      note: 'Internal smoke grievance note should not be exported through audit metadata.',
    },
  });
  assert(updatedGrievance.grievance.status === 'under_review', 'CWC should update grievance status');
  assert(updatedGrievance.grievance.publicMessage.includes('CWC desk'), 'updated grievance response should show public message');
  const updatedAdoptionGrievance = await request('POST', `/grievances/${adoptionGrievance.grievance.id}/status`, {
    token: sara.token,
    body: {
      status: 'referred',
      publicMessage: 'SARA desk has referred this adoption grievance to the SAA desk.',
      note: 'Internal CARINGS grievance note should not be exported through audit metadata.',
    },
  });
  assert(updatedAdoptionGrievance.grievance.status === 'referred', 'SARA should update adoption grievance status');
  assert(updatedAdoptionGrievance.grievance.publicMessage.includes('SARA desk'), 'SARA adoption grievance update should show public message');
  await expectStatus(403, () => request('POST', '/reports', {
    token: cwc.token,
    form: new FormData(),
  }), 'CWC report creation');

  const dupForm = new FormData();
  dupForm.set('childName', 'suresh');
  addDeclaration(dupForm);
  dupForm.set('gender', 'Male');
  dupForm.set('age', '4');
  dupForm.set('parentPhone', '9788197570');
  dupForm.set('state', 'Tamil Nadu');
  dupForm.set('district', 'Perambalur');
  try {
    await request('POST', '/reports', { token: parent.token, form: dupForm });
    throw new Error('parent duplicate report unexpectedly succeeded');
  } catch (err) {
    assert(err.status === 409, `parent duplicate report expected 409, got ${err.status || err.message}`);
    const duplicate = err.data?.duplicateCandidates?.[0];
    assert(duplicate, 'duplicate warning should include a candidate');
    assert(!('parentPhone' in duplicate), 'public duplicate warning should not expose parentPhone');
    assert(!('parentName' in duplicate), 'public duplicate warning should not expose parentName');
  }

  await expectStatus(400, () => request('POST', '/reports/found', { form: new FormData() }), 'empty text sighting');

  const badSightingPhone = new FormData();
  badSightingPhone.set('foundLocation', 'Near CST station, Mumbai');
  badSightingPhone.set('note', 'Lost child near station');
  badSightingPhone.set('reporterPhone', '123');
  await expectStatus(400, () => request('POST', '/reports/found', { form: badSightingPhone }), 'invalid reporter phone');

  const badSightingGeo = new FormData();
  badSightingGeo.set('foundLocation', 'Near CST station, Mumbai');
  badSightingGeo.set('note', 'Lost child near station');
  badSightingGeo.set('lat', '120');
  await expectStatus(400, () => request('POST', '/reports/found', { form: badSightingGeo }), 'invalid sighting latitude');

  await expectStatus(400, () => {
    const badProof = new FormData();
    badProof.set('foundLocation', 'Near CST station, Mumbai');
    badProof.set('note', 'Invalid proof type should be rejected');
    badProof.set('reporterPhone', '9000000998');
    badProof.set('idProofType', 'ration_card');
    return request('POST', '/reports/found', { form: badProof });
  }, 'invalid sighting id proof type');

  const sightingForm = new FormData();
  sightingForm.set('foundLocation', 'Outside CST station, Mumbai');
  sightingForm.set('state', 'Maharashtra');
  sightingForm.set('district', 'Mumbai');
  sightingForm.set('note', 'Child appears lost, blue shirt, about 8 years');
  sightingForm.set('ageApprox', '8');
  sightingForm.set('gender', 'Male');
  sightingForm.set('reporterPhone', '9000000001');
  const textSighting = await request('POST', '/reports/found', { form: sightingForm });
  assert(textSighting.foundReport.status === 'no_match', 'text sighting should be no_match');
  assert(textSighting.foundReport.matchScore === 0, 'text sighting should not score a match');
  assert(textSighting.candidates.length === 0, 'text sighting should not return candidates');
  const sightingStatus = await request('GET', `/reports/found/status/${textSighting.foundReport.id}`);
  assert(sightingStatus.status.id === textSighting.foundReport.id, 'public sighting status should resolve by receipt id');
  assert(sightingStatus.status.reviewStage === 'cwc_intake_queued', 'text sighting status should show CWC intake queue');
  assert(!('matchedReportId' in sightingStatus.status), 'public sighting status should not expose matched report id');
  assert(!('reporterPhone' in sightingStatus.status), 'public sighting status should not expose reporter phone');
  assert(!('photoUrl' in sightingStatus.status), 'public sighting status should not expose photo URL');
  await request('GET', `/reports/found/status/${textSighting.foundReport.id}`);
  await expectStatus(429, () => request('GET', `/reports/found/status/${textSighting.foundReport.id}`), 'public sighting status rate limit');
  await expectStatus(404, () => request('GET', '/reports/found/status/f_missing_receipt'), 'missing public sighting receipt');
  const cwcSightingsAfterMumbaiText = await request('GET', '/reports/found/all', { token: cwc.token });
  assert(
    cwcSightingsAfterMumbaiText.foundReports.some((row) => row.id === textSighting.foundReport.id),
    'Mumbai CWC should see Mumbai text sighting'
  );
  await expectStatus(403, () => request('POST', `/reports/found/${textSighting.foundReport.id}/cwc-followup`, {
    token: parent.token,
    body: { outcome: 'child_located_safe', note: 'Parent cannot close welfare follow-up' },
  }), 'parent CWC follow-up');
  const cwcFollowup = await request('POST', `/reports/found/${textSighting.foundReport.id}/cwc-followup`, {
    token: cwc.token,
    body: { outcome: 'shelter_intake_required', note: 'CWC smoke follow-up recorded for shelter intake' },
  });
  assert(cwcFollowup.foundReport.status === 'cwc_followup_complete', 'CWC follow-up should complete sighting workflow');
  assert(cwcFollowup.foundReport.cwcFollowup?.outcome === 'shelter_intake_required', 'CWC follow-up outcome should be recorded');
  assert(!('cwcFollowup' in sightingStatus.status), 'public status should not expose CWC note details');

  const confidentialForm = new FormData();
  confidentialForm.set('foundLocation', 'Near Byculla station, Mumbai');
  confidentialForm.set('state', 'Maharashtra');
  confidentialForm.set('district', 'Mumbai');
  confidentialForm.set('note', 'Confidential citizen saw a child waiting near station exit');
  confidentialForm.set('reporterName', 'Confidential Smoke Reporter');
  confidentialForm.set('reporterPhone', '9000000003');
  confidentialForm.set('confidentialReporter', 'true');
  confidentialForm.set('idProofType', 'aadhaar');
  confidentialForm.set('idProofNumber', '123456789012');
  const confidentialSighting = await request('POST', '/reports/found', { form: confidentialForm });
  assert(confidentialSighting.foundReport.status === 'no_match', 'confidential text sighting should be queued');
  assert(!('reporterPhone' in confidentialSighting.foundReport), 'public confidential sighting response should not expose reporter phone');
  const confidentialStatus = await request('GET', `/reports/found/status/${confidentialSighting.foundReport.id}`);
  assert(!('reporterPhone' in confidentialStatus.status), 'public confidential status should not expose reporter phone');
  const cwcConfidentialSightings = await request('GET', '/reports/found/all', { token: cwc.token });
  const confidentialRow = cwcConfidentialSightings.foundReports.find((row) => row.id === confidentialSighting.foundReport.id);
  assert(confidentialRow, 'CWC should see scoped confidential sighting');
  assert(confidentialRow.reporterName === 'Confidential citizen', 'confidential reporter name should be masked for reviewers');
  assert(confidentialRow.reporterPhone === null, 'confidential reporter phone should be hidden for reviewers');
  assert(confidentialRow.idProofType === 'aadhaar', 'confidential sighting should store proof type');
  assert(confidentialRow.idProofNumberMasked === '********9012', 'confidential sighting should store masked proof number only');
  assert(confidentialRow.idProofVerified === true, 'confidential sighting should mark proof metadata captured');
  await expectStatus(403, () => request('POST', `/reports/found/${confidentialSighting.foundReport.id}/formal-intake`, {
    token: parent.token,
    body: {
      childName: 'Parent cannot formalize found child',
      intakeAuthority: 'Parent',
      note: 'Parent cannot open formal found-child intake',
    },
  }), 'parent found-child formal intake');
  const foundChildIntake = await request('POST', `/reports/found/${confidentialSighting.foundReport.id}/formal-intake`, {
    token: cwc.token,
    body: {
      childName: 'Unknown child CST intake',
      guardianName: 'Unknown guardian',
      intakeAuthority: 'Smoke Found Child Intake Home',
      admissionDate: '2026-01-12',
      nextReviewDate: futureDate(30),
      ageApprox: '8',
      gender: 'Male',
      note: 'Formal found child intake smoke note should not be written to audit payloads.',
    },
  });
  assert(foundChildIntake.foundReport.status === 'formalized_case', 'formal intake should mark sighting as formalized');
  assert(foundChildIntake.foundReport.formalReportId === foundChildIntake.report.id, 'formalized sighting should link formal report id');
  assert(foundChildIntake.report.caseOrigin === 'found_child_intake', 'formal report should record found-child case origin');
  assert(foundChildIntake.report.intakeSource === 'found_child_sighting', 'formal report should record found sighting intake source');
  assert(foundChildIntake.report.sourceFoundReportId === confidentialSighting.foundReport.id, 'formal report should link source found report');
  assert(foundChildIntake.report.status === 'under_review', 'formal found-child case should start under review');
  assert(foundChildIntake.report.parentPhone === null, 'formal found-child case should not invent guardian phone');
  assert(foundChildIntake.report.cciCareRecords?.some((row) => row.cciName === 'Smoke Found Child Intake Home'), 'formal found-child intake should create a CCI care record');
  assert(foundChildIntake.report.lastWorkflowAction === 'found_child_intake_created', 'formal found-child intake should update workflow');
  const formalizedSightingStatus = await request('GET', `/reports/found/status/${confidentialSighting.foundReport.id}`);
  assert(formalizedSightingStatus.status.reviewStage === 'formal_case_created', 'public sighting status should show formal case created');
  assert(!('formalReportId' in formalizedSightingStatus.status), 'public sighting status should not expose formal report id');
  const goaForm = new FormData();
  goaForm.set('foundLocation', 'Margao bus stand, Goa');
  goaForm.set('state', 'Goa');
  goaForm.set('district', 'South Goa');
  goaForm.set('note', 'Child appears lost near bus stand');
  goaForm.set('reporterPhone', '9000000002');
  const goaSighting = await request('POST', '/reports/found', { form: goaForm });
  const cwcSightingsAfterGoaText = await request('GET', '/reports/found/all', { token: cwc.token });
  assert(
    !cwcSightingsAfterGoaText.foundReports.some((row) => row.id === goaSighting.foundReport.id),
    'Mumbai CWC should not see Goa unmatched text sighting'
  );
  const cwcActivity = await request('GET', '/dashboard/activity', { token: cwc.token });
  assert(
    cwcActivity.activity.some((row) => row.target === 'Outside CST station, Mumbai'),
    'Mumbai CWC should see Mumbai sighting activity'
  );
  assert(
    !cwcActivity.activity.some((row) => row.target === 'Margao bus stand, Goa'),
    'Mumbai CWC should not see Goa sighting activity'
  );

  for (let i = 0; i < 2; i++) {
    const floodForm = new FormData();
    floodForm.set('foundLocation', `Rate limit smoke location ${i}`);
    floodForm.set('state', 'Maharashtra');
    floodForm.set('district', 'Mumbai');
    floodForm.set('note', 'Repeated public sighting test');
    floodForm.set('reporterPhone', '9000000999');
    await request('POST', '/reports/found', { form: floodForm });
  }
  const blockedFlood = new FormData();
  blockedFlood.set('foundLocation', 'Rate limit smoke location blocked');
  blockedFlood.set('state', 'Maharashtra');
  blockedFlood.set('district', 'Mumbai');
  blockedFlood.set('note', 'Repeated public sighting test');
  blockedFlood.set('reporterPhone', '9000000999');
  await expectStatus(429, () => request('POST', '/reports/found', { form: blockedFlood }), 'public sighting rate limit');
  const publicAbuse = await request('GET', '/dashboard/fraud', { token: superAdmin.token });
  assert(publicAbuse.totals.rateLimited >= 4, 'public abuse queue should include rate-limit signals');
  assert(publicAbuse.totals.otpFailures >= 1, 'public abuse queue should include OTP failure signals');
  assert(
    publicAbuse.signals.some((row) => row.action === 'security.public_rate_limited' && row.signal?.limiter === 'public_found_report'),
    'public abuse queue should include found-report limiter signal'
  );
  assert(
    publicAbuse.signals.some((row) => row.action === 'security.public_rate_limited' && row.signal?.limiter === 'public_case_status'),
    'public abuse queue should include case-status limiter signal'
  );
  assert(
    publicAbuse.signals.some((row) => row.action === 'security.public_rate_limited' && row.signal?.limiter === 'public_sighting_status'),
    'public abuse queue should include sighting-status limiter signal'
  );
  assert(
    publicAbuse.signals.some((row) => row.action === 'security.public_rate_limited' && row.signal?.limiter === 'public_grievance_status'),
    'public abuse queue should include grievance-status limiter signal'
  );
  assert(
    publicAbuse.signals.every((row) => !row.signal?.identityHash || /^[a-f0-9]{16}$/.test(row.signal.identityHash)),
    'public abuse queue should expose only truncated hashed identities'
  );
  const abuseSignal = publicAbuse.signals.find((row) => row.action === 'security.public_rate_limited' && row.signal?.limiter === 'public_found_report');
  assert(abuseSignal?.disposition?.status === 'open', 'new public abuse signal should start open');
  assert(abuseSignal.sla?.hours === 24, 'medium public abuse signal should have 24h SLA');
  assert(['open', 'due_soon', 'breached'].includes(abuseSignal.sla?.state), 'open public abuse signal should expose active SLA state');
  const privilegedAbuse = publicAbuse.signals.find((row) => row.action === 'auth.privileged_registration_blocked');
  assert(privilegedAbuse?.severity === 'high', 'privileged signup abuse should be high severity');
  assert(privilegedAbuse?.sla?.hours === 4, 'high public abuse signal should have 4h SLA');
  const abuseDisposition = await request('POST', `/dashboard/fraud/${abuseSignal.id}/disposition`, {
    token: superAdmin.token,
    body: {
      disposition: 'escalated',
      note: 'Public abuse escalation smoke note should stay out of audit payloads.',
    },
  });
  assert(abuseDisposition.disposition.status === 'escalated', 'public abuse disposition should be saved');
  const publicAbuseAfterDisposition = await request('GET', '/dashboard/fraud', { token: superAdmin.token });
  const dispositionRow = publicAbuseAfterDisposition.signals.find((row) => row.id === abuseSignal.id);
  assert(dispositionRow?.disposition?.status === 'escalated', 'public abuse queue should show latest disposition');
  assert(dispositionRow?.sla?.state === 'closed', 'disposed public abuse signal should close SLA');
  assert(publicAbuseAfterDisposition.totals.escalated >= 1, 'public abuse totals should count escalated signals');
  assert(typeof publicAbuseAfterDisposition.totals.slaBreached === 'number', 'public abuse totals should include breached SLA count');
  const abuseActivity = await request('GET', '/dashboard/activity', { token: superAdmin.token });
  const escalatedAbuseActivity = abuseActivity.activity.find((row) => row.action === 'Escalated public abuse signal');
  assert(escalatedAbuseActivity, 'escalated public abuse signal should appear in command activity feed');
  assert(escalatedAbuseActivity.target === 'public_found_report', 'abuse activity target should be limiter name only');
  assert(!JSON.stringify(escalatedAbuseActivity).includes('9000000999'), 'abuse activity should not expose raw reporter phone');
  assert(!JSON.stringify(escalatedAbuseActivity).includes('Public abuse escalation smoke note'), 'abuse activity should not expose disposition note');
  await expectStatus(400, () => request('POST', `/dashboard/fraud/${abuseSignal.id}/disposition`, {
    token: superAdmin.token,
    body: { disposition: 'unknown' },
  }), 'invalid public abuse disposition');
  await expectStatus(403, () => request('POST', `/dashboard/fraud/${abuseSignal.id}/disposition`, {
    token: parent.token,
    body: { disposition: 'reviewed' },
  }), 'parent public abuse disposition');
  assert(!JSON.stringify(publicAbuse).includes('9000000999'), 'public abuse queue should not expose raw reporter phone');
  assert(!JSON.stringify(publicAbuse).includes(verifiedPhotoReport.report.firNo), 'public abuse queue should not expose raw FIR/GD reference');
  assert(!JSON.stringify(publicAbuse).includes(textSighting.foundReport.id), 'public abuse queue should not expose raw sighting receipt id');
  assert(!JSON.stringify(publicAbuse).includes(grievance.grievance.id), 'public abuse queue should not expose raw grievance receipt id');
  assert(!JSON.stringify(publicAbuseAfterDisposition).includes('Public abuse escalation smoke note'), 'public abuse queue should not expose disposition note text');
  const abuseExport = await request('GET', '/dashboard/fraud/export', { token: superAdmin.token });
  assert(abuseExport.signature?.type === 'public_abuse_export', 'public abuse export should include signature type');
  assert(abuseExport.signature?.algorithm === 'sha256-hmac', 'public abuse export should include signature algorithm');
  assert(/^[a-f0-9]{64}$/.test(abuseExport.signature?.digest || ''), 'public abuse export should include SHA-256 digest');
  assert(abuseExport.signals.some((row) => row.id === abuseSignal.id && row.disposition?.status === 'escalated'), 'public abuse export should include disposition state');
  assert(abuseExport.signals.every((row) => !row.source?.identityHash || /^[a-f0-9]{16}$/.test(row.source.identityHash)), 'public abuse export should include only truncated identity hashes');
  assert(!JSON.stringify(abuseExport).includes('9000000999'), 'public abuse export should not expose raw reporter phone');
  assert(!JSON.stringify(abuseExport).includes(verifiedPhotoReport.report.firNo), 'public abuse export should not expose raw FIR/GD reference');
  assert(!JSON.stringify(abuseExport).includes(textSighting.foundReport.id), 'public abuse export should not expose raw sighting receipt id');
  assert(!JSON.stringify(abuseExport).includes(grievance.grievance.id), 'public abuse export should not expose raw grievance receipt id');
  assert(!JSON.stringify(abuseExport).includes('Public abuse escalation smoke note'), 'public abuse export should not expose disposition note text');
  const abuseVerify = await request('POST', '/dashboard/export/verify', {
    token: superAdmin.token,
    body: abuseExport,
  });
  assert(abuseVerify.ok === true, 'public abuse export signature should verify');
  assert(abuseVerify.type === 'public_abuse_export', 'public abuse export verification should return type');
  const tamperedAbuseExport = { ...abuseExport, totals: { ...abuseExport.totals, signals: abuseExport.totals.signals + 1 } };
  const tamperedAbuseVerify = await request('POST', '/dashboard/export/verify', {
    token: superAdmin.token,
    body: tamperedAbuseExport,
  });
  assert(tamperedAbuseVerify.ok === false, 'tampered public abuse export signature should fail verification');
  await expectStatus(403, () => request('GET', '/dashboard/fraud/export', { token: parent.token }), 'parent public abuse export');
  await expectStatus(403, () => request('GET', '/dashboard/fraud', { token: parent.token }), 'parent public abuse queue');

  const reports = await request('GET', '/reports', { token: cwc.token });
  const openReport = reports.reports.find((r) => r.status !== 'found');
  assert(openReport, 'Expected at least one open CWC report');
  const assignableUsers = await request('GET', `/reports/${openReport.id}/assignable-users`, { token: cwc.token });
  assert(assignableUsers.users.some((row) => row.id === 'u_cwc'), 'assignable users should include scoped CWC desk');
  assert(assignableUsers.users.some((row) => row.id === 'u_sjpu'), 'assignable users should include scoped SJPU desk');
  assert(assignableUsers.users.some((row) => row.id === 'u_ahtu'), 'assignable users should include scoped AHTU desk');
  assert(assignableUsers.users.some((row) => row.id === 'u_dcrb'), 'assignable users should include scoped DCRB desk');
  assert(assignableUsers.users.some((row) => row.id === 'u_dlsa'), 'assignable users should include scoped DLSA desk');
  assert(assignableUsers.users.some((row) => row.id === 'u_saa'), 'assignable users should include scoped SAA desk');
  assert(assignableUsers.users.some((row) => row.id === 'u_sara'), 'assignable users should include state SARA desk');
  assert(!assignableUsers.users.some((row) => row.role === 'parent' || row.role === 'ngo'), 'assignable users should exclude public roles');
  await expectStatus(403, () => request('GET', `/reports/${openReport.id}/assignable-users`, {
    token: parent.token,
  }), 'parent assignable users');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/assign-owner`, {
    token: parent.token,
    body: {
      assigneeId: 'u_cwc',
      assignmentType: 'welfare',
      note: 'Parent cannot assign case owner',
    },
  }), 'parent case owner assignment');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/assign-owner`, {
    token: cwc.token,
    body: {
      assigneeId: 'u_parent',
      assignmentType: 'welfare',
      note: 'Public account cannot own operational case work',
    },
  }), 'public role case owner assignment');
  const assignment = await request('POST', `/reports/${openReport.id}/assign-owner`, {
    token: cwc.token,
    body: {
      assigneeId: 'u_cwc',
      assignmentType: 'welfare',
      dueDate: futureDate(30),
      note: 'Assignment smoke note should not be written to audit payloads.',
    },
  });
  assert(assignment.report.assignedToId === 'u_cwc', 'case owner assignment should set current assignee');
  assert(assignment.report.assignmentStatus === 'assigned', 'case owner assignment should set assignment status');
  assert(assignment.report.assignments?.length > 0, 'case owner assignment should append assignment history');
  assert(assignment.report.lastWorkflowAction === 'assign_owner', 'case owner assignment should update workflow action');
  assert(assignment.assignment.note.includes('Assignment smoke note'), 'case assignment response should include assignment note for operational users');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/investigation-checklist`, {
    token: parent.token,
    body: {
      items: ['fir_registered'],
      officerName: 'Parent cannot record checklist',
    },
  }), 'parent investigation checklist');
  const investigationChecklist = await request('POST', `/reports/${openReport.id}/investigation-checklist`, {
    token: ahtu.token,
    body: {
      items: ['fir_registered', 'trackchild_updated', 'cctns_linked', 'ncrb_scrb_alerted', 'childline_1098_alerted'],
      officerName: 'Smoke AHTU Investigation Desk',
      stationDiaryNo: 'INV/SMOKE/2026/01',
      actionDate: '2026-06-04',
      followupDate: futureDate(30),
      note: 'Investigation checklist smoke note should not be written to audit payloads.',
    },
  });
  assert(investigationChecklist.report.investigationChecklist?.length > 0, 'investigation checklist should append a structured record');
  assert(investigationChecklist.checklistRecord.items.includes('trackchild_updated'), 'investigation checklist should preserve selected TrackChild action');
  assert(investigationChecklist.checklistRecord.note.includes('Investigation checklist smoke note'), 'investigation checklist response should include operational note');
  assert(investigationChecklist.report.lastWorkflowAction === 'investigation_checklist_updated', 'investigation checklist should update workflow action');
  const dcrbChecklist = await request('POST', `/reports/${openReport.id}/investigation-checklist`, {
    token: dcrb.token,
    body: {
      items: ['trackchild_updated', 'cctns_linked', 'ncrb_scrb_alerted'],
      officerName: 'Smoke DCRB Records Desk',
      stationDiaryNo: 'DCRB/SMOKE/2026/01',
      actionDate: '2026-06-04',
      note: 'DCRB records smoke note should not be written to audit payloads.',
    },
  });
  assert(dcrbChecklist.checklistRecord.items.includes('ncrb_scrb_alerted'), 'DCRB should record records-focused checklist items');
  const workflow = await request('POST', `/reports/${openReport.id}/case-workflow`, {
    token: cwc.token,
    body: { action: 'assign_cci' },
  });
  assert(workflow.report.lastWorkflowAction === 'assign_cci', 'workflow action was not recorded');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/cci-care`, {
    token: parent.token,
    body: {
      admissionType: 'temporary_shelter',
      cciName: 'Smoke CCI Home',
      admissionDate: '2026-01-10',
      carePlan: 'CCI smoke care plan should not be visible to parent role',
    },
  }), 'parent CCI care record');
  const cciCare = await request('POST', `/reports/${openReport.id}/cci-care`, {
    token: cwc.token,
    body: {
      admissionType: 'temporary_shelter',
      cciName: 'Smoke CCI Home',
      admissionDate: '2026-01-10',
      nextReviewDate: futureDate(30),
      services: ['education', 'health_care', 'counselling', 'family_tracing'],
      progressStatus: 'active',
      healthStatus: 'Smoke CCI health care progress note should not be written to audit payloads.',
      educationStatus: 'Smoke CCI education progress note should not be written to audit payloads.',
      counsellingStatus: 'Smoke CCI counselling progress note should not be written to audit payloads.',
      familyTracingStatus: 'Smoke CCI family tracing progress note should not be written to audit payloads.',
      carePlan: 'CCI smoke care plan: temporary shelter, counselling review, and guardian tracing.',
    },
  });
  assert(cciCare.report.cciCareRecords?.length > 0, 'CCI care record should be appended to report');
  assert(cciCare.report.lastCciCareAt, 'CCI care record should update lastCciCareAt');
  assert(cciCare.report.lastWorkflowAction === 'cci_care_recorded', 'CCI care should update workflow action');
  assert(cciCare.report.workflowStatus?.includes('CCI care recorded'), 'CCI care should update workflow status');
  assert(cciCare.careRecord.services.includes('education'), 'CCI care should preserve structured services');
  assert(cciCare.careRecord.progressStatus === 'active', 'CCI care should preserve progress status');
  assert(cciCare.careRecord.serviceProgress?.healthStatus?.includes('health care progress'), 'CCI care should preserve service progress');
  const cciRegister = await request('GET', '/dashboard/cci-register', { token: cwc.token });
  assert(cciRegister.scope === 'Mumbai', `CCI register scope should be Mumbai, got ${cciRegister.scope}`);
  assert(cciRegister.totals.records >= 1, 'CCI register should count care records');
  assert(cciRegister.totals.institutions >= 1, 'CCI register should count institutions');
  assert(cciRegister.register.some((row) => row.reportId === openReport.id && row.cciName === 'Smoke CCI Home'), 'CCI register should include scoped care record');
  assert(cciRegister.register.some((row) => row.reportId === foundChildIntake.report.id && row.cciName === 'Smoke Found Child Intake Home'), 'CCI register should include formalized found-child intake');
  assert(!cciRegister.register.some((row) => row.state === 'Goa'), 'CCI register should exclude Goa records from Mumbai CWC scope');
  assert(cciRegister.byAdmissionType.some((row) => row.name === 'Temporary shelter'), 'CCI register should include admission type split');
  await expectStatus(403, () => request('GET', '/dashboard/cci-register', { token: parent.token }), 'parent CCI register');
  await expectStatus(403, () => request('GET', '/dashboard/cci-register', { token: crimeBureau.token }), 'crime bureau CCI register');
  const jjbWorkflow = await request('POST', `/reports/${openReport.id}/case-workflow`, {
    token: cwc.token,
    body: { action: 'refer_jjb' },
  });
  assert(jjbWorkflow.report.lastWorkflowAction === 'refer_jjb', 'JJB referral workflow action was not recorded');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/jjb-proceeding`, {
    token: parent.token,
    body: {
      proceedingType: 'preliminary_hearing',
      boardName: 'Smoke JJB Board',
      orderDate: '2026-01-11',
      directions: 'JJB smoke directions should not be visible to parent role',
    },
  }), 'parent JJB proceeding record');
  const jjbProceeding = await request('POST', `/reports/${openReport.id}/jjb-proceeding`, {
    token: jjb.token,
    body: {
      proceedingType: 'social_investigation_order',
      boardName: 'Smoke JJB Board',
      caseNo: 'JJB/SMOKE/2026/01',
      orderDate: '2026-01-11',
      nextHearingDate: futureDate(30),
      directions: 'JJB smoke directions: social investigation, rehabilitation review, and guardian tracing.',
    },
  });
  assert(jjbProceeding.report.jjbProceedings?.length > 0, 'JJB proceeding should be appended to report');
  assert(jjbProceeding.report.lastJjbProceedingAt, 'JJB proceeding should update lastJjbProceedingAt');
  assert(jjbProceeding.report.lastWorkflowAction === 'jjb_proceeding_recorded', 'JJB proceeding should update workflow action');
  assert(jjbProceeding.report.workflowStatus?.includes('JJB proceeding recorded'), 'JJB proceeding should update workflow status');
  const stateWorkflow = await request('POST', `/reports/${openReport.id}/case-workflow`, {
    token: cwc.token,
    body: { action: 'escalate_state' },
  });
  assert(stateWorkflow.report.lastWorkflowAction === 'escalate_state', 'state escalation workflow action was not recorded');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/state-escalation`, {
    token: parent.token,
    body: {
      escalationType: 'inter_district_coordination',
      escalationLevel: 'state_task_force',
      authorityName: 'Smoke State Nodal Desk',
      escalatedDate: '2026-01-12',
      actionRequired: 'State smoke action should not be visible to parent role',
    },
  }), 'parent state escalation record');
  const stateEscalation = await request('POST', `/reports/${openReport.id}/state-escalation`, {
    token: superAdmin.token,
    body: {
      escalationType: 'interstate_coordination',
      escalationLevel: 'national_command',
      priority: 'urgent',
      authorityName: 'Smoke National Command Desk',
      referenceNo: 'STATE/SMOKE/2026/01',
      escalatedDate: '2026-01-12',
      dueDate: futureDate(30),
      actionRequired: 'State smoke action: coordinate interstate rescue, district resource support, and nodal review.',
    },
  });
  assert(stateEscalation.report.stateEscalations?.length > 0, 'state escalation should be appended to report');
  assert(stateEscalation.report.lastStateEscalationAt, 'state escalation should update lastStateEscalationAt');
  assert(stateEscalation.report.lastWorkflowAction === 'state_escalation_recorded', 'state escalation should update workflow action');
  assert(stateEscalation.report.workflowStatus?.includes('State escalation recorded'), 'state escalation should update workflow status');
  const bureauWorkflow = await request('POST', `/reports/${openReport.id}/case-workflow`, {
    token: cwc.token,
    body: { action: 'notify_crime_bureau' },
  });
  assert(bureauWorkflow.report.lastWorkflowAction === 'notify_crime_bureau', 'crime bureau notification workflow action was not recorded');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/bureau-report`, {
    token: parent.token,
    body: {
      reportType: 'ncrb_missing_child_update',
      bureauLevel: 'ncrb',
      submittedDate: '2026-01-12',
      summary: 'Bureau smoke report should not be visible to parent role',
    },
  }), 'parent bureau report record');
  const bureauReport = await request('POST', `/reports/${openReport.id}/bureau-report`, {
    token: crimeBureau.token,
    body: {
      reportType: 'interstate_alert',
      bureauLevel: 'scrb',
      priority: 'priority',
      referenceNo: 'SCRB/SMOKE/2026/01',
      submittedDate: '2026-01-12',
      nextReviewDate: futureDate(30),
      summary: 'Bureau smoke report: interstate alert, pattern review, and district coordination.',
    },
  });
  assert(bureauReport.report.bureauReports?.length > 0, 'bureau report should be appended to report');
  assert(bureauReport.report.lastBureauReportAt, 'bureau report should update lastBureauReportAt');
  assert(bureauReport.report.lastWorkflowAction === 'bureau_report_recorded', 'bureau report should update workflow action');
  assert(bureauReport.report.workflowStatus?.includes('report recorded'), 'bureau report should update workflow status');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/external-id`, {
    token: parent.token,
    body: {
      idType: 'trackchild',
      externalId: 'TC-SMOKE-2026-01',
      issuingSystem: 'Mission Vatsalya TrackChild',
      remarks: 'Parent cannot link external IDs',
    },
  }), 'parent external id link');
  const externalId = await request('POST', `/reports/${openReport.id}/external-id`, {
    token: crimeBureau.token,
    body: {
      idType: 'trackchild',
      externalId: 'TC-SMOKE-2026-01',
      issuingSystem: 'Mission Vatsalya TrackChild',
      issuedDate: '2026-01-13',
      remarks: 'External ID smoke linking remarks should not be written to audit metadata.',
    },
  });
  assert(externalId.report.externalIds?.some((row) => row.externalId === 'TC-SMOKE-2026-01'), 'external id should be linked to report');
  assert(externalId.report.lastExternalIdAt, 'external id should update lastExternalIdAt');
  assert(externalId.report.lastWorkflowAction === 'external_id_linked', 'external id should update workflow action');
  assert(externalId.report.workflowStatus?.includes('External ID linked'), 'external id should update workflow status');
  const externalPublicStatus = await request('GET', '/reports/public/status/TC-SMOKE-2026-01');
  assert(externalPublicStatus.status.id === openReport.id, 'public case status should resolve by external TrackChild ID');
  assert(externalPublicStatus.status.externalId?.label === 'TrackChild ID', 'public case status should include safe external ID label');
  assert(externalPublicStatus.status.externalId?.externalId === 'TC-SMOKE-2026-01', 'public case status should include matched external ID');
  assert(!('remarks' in externalPublicStatus.status.externalId), 'public case status should not expose external ID remarks');
  assert(!('notes' in externalPublicStatus.status), 'public case status should not expose case notes');
  assert(!('cciCareRecords' in externalPublicStatus.status), 'public case status should not expose CCI care records');
  await expectStatus(403, () => request('GET', `/reports/${openReport.id}/handoff-export?targetSystem=trackchild`, {
    token: parent.token,
  }), 'parent case handoff export');
  const handoffExport = await request('GET', `/reports/${openReport.id}/handoff-export?targetSystem=trackchild&includeHistory=true`, {
    token: crimeBureau.token,
  });
  assert(handoffExport.exportType === 'case_handoff', 'case handoff export should declare export type');
  assert(handoffExport.schemaVersion === 'khozo.case_handoff.v1', 'case handoff export should declare schema version');
  assert(handoffExport.targetSystem === 'trackchild', 'case handoff export should preserve target system');
  assert(handoffExport.case.id === openReport.id, 'case handoff export should include case id');
  assert(handoffExport.case.externalIds.some((row) => row.externalId === 'TC-SMOKE-2026-01'), 'case handoff export should include external IDs');
  assert(handoffExport.profile.vulnerabilityCaptured === true, 'case handoff export should include safe vulnerability flags');
  assert(handoffExport.workflow.length > 0, 'case handoff export should include redacted workflow history when requested');
  assert(handoffExport.signature?.type === 'case_handoff_export', 'case handoff export should include signature type');
  assert(handoffExport.signature?.algorithm === 'sha256-hmac', 'case handoff export should include signature algorithm');
  assert(/^[a-f0-9]{64}$/.test(handoffExport.signature?.digest || ''), 'case handoff export should include SHA-256 digest');
  assert(/^[a-f0-9]{64}$/.test(handoffExport.signature?.value || ''), 'case handoff export should include HMAC signature');
  assert(!JSON.stringify(handoffExport).includes('External ID smoke linking remarks'), 'case handoff export should not expose external ID remarks');
  assert(!JSON.stringify(handoffExport).includes(openReport.parentPhone || '9788197570'), 'case handoff export should not expose guardian phone');
  const handoffVerify = await request('POST', '/dashboard/export/verify', {
    token: crimeBureau.token,
    body: handoffExport,
  });
  assert(handoffVerify.ok === true, 'case handoff export signature should verify');
  assert(handoffVerify.type === 'case_handoff_export', 'case handoff export verification should return type');
  const tamperedHandoffVerify = await request('POST', '/dashboard/export/verify', {
    token: crimeBureau.token,
    body: { ...handoffExport, targetSystem: 'ghar' },
  });
  assert(tamperedHandoffVerify.ok === false, 'tampered case handoff signature should fail verification');
  await expectStatus(409, () => request('POST', `/reports/${openReport.id}/external-id`, {
    token: crimeBureau.token,
    body: {
      idType: 'trackchild',
      externalId: 'TC-SMOKE-2026-01',
      issuingSystem: 'Mission Vatsalya TrackChild',
    },
  }), 'duplicate external id link');
  await expectStatus(400, () => request('POST', `/reports/${openReport.id}/external-id`, {
    token: crimeBureau.token,
    body: {
      idType: 'unknown_system',
      externalId: 'BAD-SMOKE',
    },
  }), 'invalid external id type');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/restoration-plan`, {
    token: parent.token,
    body: {
      restorationType: 'family_restoration',
      status: 'planned',
      toState: 'Maharashtra',
      toDistrict: 'Mumbai',
      handoverAuthority: 'Smoke CWC Desk',
      remarks: 'Parent cannot record GHAR restoration route',
    },
  }), 'parent restoration plan record');
  const restorationPlan = await request('POST', `/reports/${openReport.id}/restoration-plan`, {
    token: cwc.token,
    body: {
      restorationType: 'interstate_transfer',
      status: 'documents_pending',
      fromState: 'Maharashtra',
      fromDistrict: 'Mumbai',
      toState: 'Karnataka',
      toDistrict: 'Bengaluru Urban',
      guardianName: 'Smoke Guardian',
      handoverAuthority: 'Smoke CWC Bengaluru',
      plannedDate: futureDate(30),
      followupDate: futureDate(30),
      travelMode: 'rail',
      travelDate: futureDate(30),
      escortAuthority: 'Smoke DCPU Escort Desk',
      escortContact: '9000000456',
      documentStatus: 'verified',
      documentReference: 'RESTORE/DOC/SMOKE/2026/01',
      fundingSource: 'dcpu',
      fundingReference: 'FUND/SMOKE/2026/01',
      supports: ['interpreter', 'escort', 'documents'],
      remarks: 'GHAR smoke restoration route should not be written to audit payloads.',
    },
  });
  assert(restorationPlan.report.restorationPlans?.length > 0, 'restoration plan should be appended to report');
  assert(restorationPlan.report.lastRestorationPlanAt, 'restoration plan should update lastRestorationPlanAt');
  assert(restorationPlan.report.lastWorkflowAction === 'restoration_plan_recorded', 'restoration plan should update workflow action');
  assert(restorationPlan.report.workflowStatus?.includes('Restoration plan recorded'), 'restoration plan should update workflow status');
  assert(restorationPlan.restorationPlan.supports.includes('interpreter'), 'restoration plan should preserve selected support needs');
  assert(restorationPlan.restorationPlan.travel?.mode === 'rail', 'restoration plan should preserve travel mode');
  assert(restorationPlan.restorationPlan.travel?.escortAuthority === 'Smoke DCPU Escort Desk', 'restoration plan should preserve escort authority');
  assert(restorationPlan.restorationPlan.documents?.status === 'verified', 'restoration plan should preserve document status');
  assert(restorationPlan.restorationPlan.funding?.source === 'dcpu', 'restoration plan should preserve funding source');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/welfare-referral`, {
    token: parent.token,
    body: {
      scheme: 'sponsorship',
      status: 'referred',
      agencyName: 'Smoke DCPU Desk',
      referredDate: '2026-01-21',
      eligibilityNote: 'Parent cannot record welfare referral',
    },
  }), 'parent welfare referral record');
  const welfareReferral = await request('POST', `/reports/${openReport.id}/welfare-referral`, {
    token: cwc.token,
    body: {
      scheme: 'sponsorship',
      status: 'eligibility_review',
      agencyName: 'Smoke DCPU Sponsorship Desk',
      referralNo: 'WELFARE/SMOKE/2026/01',
      referredDate: '2026-01-21',
      reviewDate: futureDate(30),
      eligibilityNote: 'Welfare smoke eligibility note should not be written to audit payloads.',
    },
  });
  assert(welfareReferral.report.welfareReferrals?.length > 0, 'welfare referral should be appended to report');
  assert(welfareReferral.report.lastWelfareReferralAt, 'welfare referral should update lastWelfareReferralAt');
  assert(welfareReferral.report.lastWorkflowAction === 'welfare_referral_recorded', 'welfare referral should update workflow action');
  assert(welfareReferral.report.workflowStatus?.includes('Welfare referral recorded'), 'welfare referral should update workflow status');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/legal-aid-referral`, {
    token: parent.token,
    body: {
      serviceType: 'legal_aid',
      status: 'referred',
      authorityName: 'Smoke DLSA Desk',
      referredDate: '2026-01-21',
      note: 'Parent cannot record legal aid referral',
    },
  }), 'parent legal-aid referral record');
  const legalAidReferral = await request('POST', `/reports/${openReport.id}/legal-aid-referral`, {
    token: dlsa.token,
    body: {
      serviceType: 'victim_compensation',
      status: 'application_filed',
      authorityName: 'Smoke DLSA Compensation Desk',
      applicationNo: 'LEGAL/SMOKE/2026/01',
      referredDate: '2026-01-21',
      hearingDate: futureDate(30),
      reviewDate: futureDate(30),
      note: 'Legal aid smoke note should not be written to audit payloads.',
    },
  });
  assert(legalAidReferral.report.legalAidReferrals?.length > 0, 'legal-aid referral should be appended to report');
  assert(legalAidReferral.report.lastLegalAidReferralAt, 'legal-aid referral should update lastLegalAidReferralAt');
  assert(legalAidReferral.report.lastWorkflowAction === 'legal_aid_referral_recorded', 'legal-aid referral should update workflow action');
  assert(legalAidReferral.report.workflowStatus?.includes('Legal-aid referral recorded'), 'legal-aid referral should update workflow status');
  assert(legalAidReferral.legalAidReferral.applicationNo === 'LEGAL/SMOKE/2026/01', 'legal-aid referral should preserve application number in case record');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/adoption-record`, {
    token: parent.token,
    body: {
      recordType: 'carings_registration',
      status: 'initiated',
      agencyName: 'Smoke SAA Desk',
      orderDate: '2026-01-21',
      note: 'Parent cannot record adoption follow-up',
    },
  }), 'parent adoption record');
  const adoptionRecord = await request('POST', `/reports/${openReport.id}/adoption-record`, {
    token: saa.token,
    body: {
      recordType: 'carings_registration',
      status: 'carings_updated',
      agencyName: 'Smoke SAA Adoption Desk',
      caringsId: 'CARINGS/SMOKE/2026/01',
      orderNo: 'ADOPT/ORDER/SMOKE/2026/01',
      orderDate: '2026-01-21',
      nextReviewDate: futureDate(30),
      note: 'Adoption smoke note should not be written to audit payloads.',
    },
  });
  assert(adoptionRecord.report.adoptionRecords?.length > 0, 'adoption record should be appended to report');
  assert(adoptionRecord.report.lastAdoptionRecordAt, 'adoption record should update lastAdoptionRecordAt');
  assert(adoptionRecord.report.lastWorkflowAction === 'adoption_recorded', 'adoption record should update workflow action');
  assert(adoptionRecord.report.workflowStatus?.includes('Adoption follow-up recorded'), 'adoption record should update workflow status');
  assert(adoptionRecord.adoptionRecord.caringsId === 'CARINGS/SMOKE/2026/01', 'adoption record should preserve CARINGS reference in case record');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/case-assessment`, {
    token: parent.token,
    body: {
      assessmentType: 'social_investigation_report',
      riskLevel: 'medium',
      assessorName: 'Smoke Assessor',
      assessmentDate: '2026-01-22',
      findings: 'Parent cannot record social investigation findings',
      carePlan: 'Parent cannot record individual care plan',
    },
  }), 'parent case assessment record');
  const caseAssessment = await request('POST', `/reports/${openReport.id}/case-assessment`, {
    token: cwc.token,
    body: {
      assessmentType: 'social_investigation_report',
      riskLevel: 'high',
      assessorName: 'Smoke CWC Assessor',
      assessmentDate: '2026-01-22',
      nextReviewDate: futureDate(30),
      findings: 'SIR smoke findings should not be written to audit payloads.',
      carePlan: 'ICP smoke care plan should not be written to audit payloads.',
      recommendation: 'Smoke recommendation should stay in case record only.',
    },
  });
  assert(caseAssessment.report.caseAssessments?.length > 0, 'case assessment should be appended to report');
  assert(caseAssessment.report.lastCaseAssessmentAt, 'case assessment should update lastCaseAssessmentAt');
  assert(caseAssessment.report.lastWorkflowAction === 'case_assessment_recorded', 'case assessment should update workflow action');
  assert(caseAssessment.report.workflowStatus?.includes('Case assessment recorded'), 'case assessment should update workflow status');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/production-record`, {
    token: parent.token,
    body: {
      productionType: 'cwc',
      outcome: 'care_order_pending',
      authorityName: 'Smoke CWC Bench',
      rescueAt: '2026-01-22T08:00',
      producedAt: '2026-01-22T18:00',
      nextAction: 'Parent cannot record CWC production',
    },
  }), 'parent production record');
  const productionRecord = await request('POST', `/reports/${openReport.id}/production-record`, {
    token: cwc.token,
    body: {
      productionType: 'cwc',
      outcome: 'sent_cci',
      authorityName: 'Smoke CWC Bench',
      orderNo: 'CWC/PROD/SMOKE/2026/01',
      rescueAt: '2026-01-22T08:00',
      producedAt: '2026-01-22T18:00',
      nextAction: 'Production next action smoke text should not be written to audit payloads.',
    },
  });
  assert(productionRecord.report.productionRecords?.length > 0, 'production record should be appended to report');
  assert(productionRecord.report.lastProductionRecordAt, 'production record should update lastProductionRecordAt');
  assert(productionRecord.report.lastWorkflowAction === 'production_recorded', 'production record should update workflow action');
  assert(productionRecord.report.workflowStatus?.includes('Production recorded'), 'production record should update workflow status');
  assert(productionRecord.productionRecord.deadlineStatus === 'within_24h', 'production record should compute 24h deadline status');
  const delayedProductionRecord = await request('POST', `/reports/${openReport.id}/production-record`, {
    token: cwc.token,
    body: {
      productionType: 'cwc',
      outcome: 'care_order_pending',
      authorityName: 'Smoke CWC Bench',
      orderNo: 'CWC/PROD/SMOKE/2026/02',
      rescueAt: '2026-01-22T08:00',
      producedAt: '2026-01-23T15:00',
      nextAction: 'Production next action smoke text should not be written to audit payloads.',
    },
  });
  assert(delayedProductionRecord.productionRecord.deadlineStatus === 'delayed', 'production record should flag delayed 24h production');
  const formalFollowups = await request('GET', '/dashboard/followups', { token: cwc.token });
  assert(formalFollowups.totals.formalFollowups >= 6, 'formal record dates should contribute to dashboard follow-up totals');
  for (const type of [
    'cci_review_due',
    'jjb_hearing_due',
    'state_escalation_due',
    'bureau_review_due',
    'restoration_due',
    'welfare_review_due',
    'legal_aid_review_due',
    'adoption_review_due',
    'case_assessment_review_due',
    'production_delayed',
  ]) {
    assert(formalFollowups.alerts.some((row) => row.type === type && row.reportId === openReport.id), `CWC follow-ups should include ${type}`);
  }
  assert(!formalFollowups.alerts.some((row) => row.state === 'Goa'), 'formal follow-up alerts should stay scoped away from Goa');
  const cwcMisAfterFormalRecords = await request('GET', '/dashboard/mis', { token: cwc.token });
  assert(cwcMisAfterFormalRecords.totals.formalFollowups >= 6, 'MIS should count formal follow-ups due');
  assert(cwcMisAfterFormalRecords.totals.productionRecords >= 2, 'MIS should count production records');
  assert(cwcMisAfterFormalRecords.totals.productionWithin24h >= 1, 'MIS should count within-24h production records');
  assert(cwcMisAfterFormalRecords.totals.productionDelayed >= 1, 'MIS should count delayed production records');
  assert(
    cwcMisAfterFormalRecords.compliance.formalFollowups.some((row) => row.name === 'production delayed'),
    'MIS should include production delayed in formal follow-up split'
  );
  assert(
    cwcMisAfterFormalRecords.compliance.production.some((row) => row.name === 'delayed' && row.count >= 1),
    'MIS should include delayed production compliance count'
  );
  await expectStatus(400, () => request('POST', `/reports/${openReport.id}/production-record`, {
    token: cwc.token,
    body: {
      productionType: 'bad_production',
      outcome: 'sent_cci',
      authorityName: 'Smoke CWC Bench',
      rescueAt: '2026-01-22T08:00',
      producedAt: '2026-01-22T18:00',
      nextAction: 'Invalid production type should be rejected',
    },
  }), 'invalid production type');
  await expectStatus(400, () => request('POST', `/reports/${openReport.id}/case-assessment`, {
    token: cwc.token,
    body: {
      assessmentType: 'unknown_assessment',
      riskLevel: 'medium',
      assessorName: 'Smoke Assessor',
      assessmentDate: '2026-01-22',
      findings: 'Invalid assessment type should be rejected',
      carePlan: 'Invalid assessment type should be rejected',
    },
  }), 'invalid case assessment type');
  await expectStatus(400, () => request('POST', `/reports/${openReport.id}/welfare-referral`, {
    token: cwc.token,
    body: {
      scheme: 'bad_scheme',
      status: 'referred',
      agencyName: 'Smoke DCPU Desk',
      referredDate: '2026-01-21',
      eligibilityNote: 'Invalid welfare scheme should be rejected',
    },
  }), 'invalid welfare scheme');
  await expectStatus(400, () => request('POST', `/reports/${openReport.id}/legal-aid-referral`, {
    token: dlsa.token,
    body: {
      serviceType: 'bad_legal_service',
      status: 'referred',
      authorityName: 'Smoke DLSA Desk',
      referredDate: '2026-01-21',
      note: 'Invalid legal service should be rejected',
    },
  }), 'invalid legal-aid service');
  await expectStatus(400, () => request('POST', `/reports/${openReport.id}/adoption-record`, {
    token: saa.token,
    body: {
      recordType: 'bad_adoption_record',
      status: 'initiated',
      agencyName: 'Smoke SAA Desk',
      orderDate: '2026-01-21',
      note: 'Invalid adoption record should be rejected',
    },
  }), 'invalid adoption record type');
  await expectStatus(400, () => request('POST', `/reports/${openReport.id}/restoration-plan`, {
    token: cwc.token,
    body: {
      restorationType: 'bad_type',
      status: 'planned',
      toState: 'Karnataka',
      toDistrict: 'Bengaluru Urban',
      handoverAuthority: 'Smoke CWC Bengaluru',
      remarks: 'Invalid restoration type should be rejected',
    },
  }), 'invalid restoration type');
  const noteResult = await request('POST', `/reports/${openReport.id}/notes`, {
    token: cwc.token,
    body: { note: 'CWC smoke note: family verification and care follow-up recorded.' },
  });
  assert(noteResult.report.notes.some((row) => row.note.includes('family verification')), 'case note was not recorded');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/notes`, {
    token: parent.token,
    body: { note: 'Parent should not add notes to a CWC-scoped case' },
  }), 'parent case note outside scope');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/confirm-match`, {
    token: cwc.token,
    body: { sendSms: true },
  }), 'CWC confirm match');
  const closedCase = await request('POST', `/reports/${openReport.id}/close-case`, {
    token: cwc.token,
    body: { reason: 'restored_family', foundLocation: 'CWC Mumbai restoration desk', note: 'Family restoration verified in smoke test' },
  });
  assert(closedCase.report.status === 'closed', 'case closure should set status closed');
  assert(closedCase.report.closure?.reason === 'restored_family', 'case closure reason was not recorded');
  await expectStatus(409, () => request('POST', `/reports/${openReport.id}/case-workflow`, {
    token: cwc.token,
    body: { action: 'refer_jjb' },
  }), 'workflow on closed case');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/close-case`, {
    token: parent.token,
    body: { reason: 'other' },
  }), 'parent close case');

  const cwcPrivacy = await request('GET', '/dashboard/privacy/retention', { token: cwc.token });
  assert(cwcPrivacy.capabilities.canReview === true, 'CWC should be able to review privacy retention');
  assert(cwcPrivacy.capabilities.canExport === false, 'CWC should not be able to export privacy reports');
  assert(cwcPrivacy.capabilities.canAnonymize === false, 'CWC should not be able to anonymize records');
  const cwcRetention = cwcPrivacy.retention[0];
  assert(cwcRetention, 'Expected CWC privacy queue to include a scoped record');
  await request('POST', `/dashboard/privacy/retention/${cwcRetention.type}/${cwcRetention.id}`, {
    token: cwc.token,
    body: { decision: 'close' },
  });
  await expectStatus(403, () => request('POST', `/dashboard/privacy/retention/${cwcRetention.type}/${cwcRetention.id}`, {
    token: cwc.token,
    body: { decision: 'anonymize' },
  }), 'CWC privacy anonymize');
  await expectStatus(403, () => request('GET', '/dashboard/privacy/export', { token: cwc.token }), 'CWC privacy export');

  const crimePrivacy = await request('GET', '/dashboard/privacy/retention', { token: crimeBureau.token });
  assert(crimePrivacy.capabilities.canReview === false, 'crime bureau privacy queue should be read-only');
  assert(crimePrivacy.capabilities.canExport === true, 'crime bureau should export privacy reports');
  const privacyExport = await request('GET', '/dashboard/privacy/export', { token: crimeBureau.token });
  assert(privacyExport.signature?.type === 'privacy_export', 'privacy export should include signature type');
  assert(privacyExport.signature?.algorithm === 'sha256-hmac', 'privacy export should include signature algorithm');
  assert(/^[a-f0-9]{64}$/.test(privacyExport.signature?.digest || ''), 'privacy export should include SHA-256 digest');
  assert(/^[a-f0-9]{64}$/.test(privacyExport.signature?.value || ''), 'privacy export should include HMAC signature');
  const privacyVerify = await request('POST', '/dashboard/export/verify', {
    token: crimeBureau.token,
    body: privacyExport,
  });
  assert(privacyVerify.ok === true, 'privacy export signature should verify');
  assert(privacyVerify.type === 'privacy_export', 'privacy export verification should return type');
  const crimeReportRetention = crimePrivacy.retention.find((row) => row.type === 'report');
  if (crimeReportRetention) {
    await expectStatus(403, () => request('POST', `/dashboard/privacy/retention/report/${crimeReportRetention.id}`, {
      token: crimeBureau.token,
      body: { decision: 'close' },
    }), 'crime bureau privacy mutation');
  }

  const adminPrivacy = await request('GET', '/dashboard/privacy/retention', { token: admin.token });
  assert(adminPrivacy.capabilities.canAnonymize === true, 'admin should be able to anonymize scoped privacy records');
  const adminSightingRetention = adminPrivacy.retention.find((row) => row.type === 'foundReport');
  assert(adminSightingRetention, 'Expected admin privacy queue to include a sighting');
  await expectStatus(400, () => request('POST', `/dashboard/privacy/retention/foundReport/${adminSightingRetention.id}`, {
    token: admin.token,
    body: { decision: 'anonymize' },
  }), 'anonymize without approval reference');
  await request('POST', `/dashboard/privacy/retention/foundReport/${adminSightingRetention.id}`, {
    token: admin.token,
    body: {
      decision: 'anonymize',
      approvalType: 'privacy_officer',
      approvalReference: 'PO-APPROVAL-2026-01',
      approvalNote: 'Privacy approval smoke note should stay out of audit payloads.',
    },
  });
  const privacyExportAfterAnonymize = await request('GET', '/dashboard/privacy/export', { token: crimeBureau.token });
  assert(
    privacyExportAfterAnonymize.items.some((row) => row.type === 'foundReport' && row.id === adminSightingRetention.id && row.anonymizationApproval?.reference === 'PO-APPROVAL-2026-01'),
    'privacy export should include anonymization approval reference'
  );
  assert(
    !JSON.stringify(privacyExportAfterAnonymize).includes('Privacy approval smoke note'),
    'privacy export should not include anonymization approval note text'
  );

  const created = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke CCI Provision',
      email: 'smoke.cci.provision@khozo.org',
      role: 'cci',
      state: 'Maharashtra',
      district: 'Mumbai',
      org: 'Smoke CCI',
    },
  });
  assert(created.user.role === 'cci', 'provisioned user should be CCI');
  assert(created.user.mustChangePassword === true, 'provisioned user should be marked for password change');
  assert(created.initialPassword && created.initialPassword !== 'khozo123', 'provisioned user should receive a unique temporary password');
  const createdSjpu = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke SJPU Provision',
      email: 'smoke.sjpu.provision@khozo.org',
      role: 'sjpu',
      state: 'Maharashtra',
      district: 'Mumbai',
      org: 'Smoke SJPU',
    },
  });
  assert(createdSjpu.user.role === 'sjpu', 'provisioned user should be SJPU');
  assert(createdSjpu.user.jurisdiction?.district === 'Mumbai', 'provisioned SJPU should stay in requested district');
  const createdAhtu = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke AHTU Provision',
      email: 'smoke.ahtu.provision@khozo.org',
      role: 'ahtu',
      state: 'Maharashtra',
      district: 'Mumbai',
      org: 'Smoke AHTU',
    },
  });
  assert(createdAhtu.user.role === 'ahtu', 'provisioned user should be AHTU');
  assert(createdAhtu.user.jurisdiction?.district === 'Mumbai', 'provisioned AHTU should stay in requested district');
  const createdDcrb = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke DCRB Provision',
      email: 'smoke.dcrb.provision@khozo.org',
      role: 'dcrb',
      state: 'Maharashtra',
      district: 'Mumbai',
      org: 'Smoke DCRB',
    },
  });
  assert(createdDcrb.user.role === 'dcrb', 'provisioned user should be DCRB');
  assert(createdDcrb.user.jurisdiction?.district === 'Mumbai', 'provisioned DCRB should stay in requested district');
  const createdDlsa = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke DLSA Provision',
      email: 'smoke.dlsa.provision@khozo.org',
      role: 'dlsa',
      state: 'Maharashtra',
      district: 'Mumbai',
      org: 'Smoke DLSA',
    },
  });
  assert(createdDlsa.user.role === 'dlsa', 'provisioned user should be DLSA');
  assert(createdDlsa.user.jurisdiction?.district === 'Mumbai', 'provisioned DLSA should stay in requested district');
  const createdSaa = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke SAA Provision',
      email: 'smoke.saa.provision@khozo.org',
      role: 'saa',
      state: 'Maharashtra',
      district: 'Mumbai',
      org: 'Smoke SAA',
    },
  });
  assert(createdSaa.user.role === 'saa', 'provisioned user should be SAA');
  assert(createdSaa.user.jurisdiction?.district === 'Mumbai', 'provisioned SAA should stay in requested district');
  const createdSara = await request('POST', '/dashboard/network/users', {
    token: superAdmin.token,
    body: {
      name: 'Smoke SARA Provision',
      email: 'smoke.sara.provision@khozo.org',
      role: 'sara',
      state: 'Maharashtra',
      org: 'Smoke SARA',
    },
  });
  assert(createdSara.user.role === 'sara', 'provisioned user should be SARA');
  assert(createdSara.user.jurisdiction?.state === 'Maharashtra', 'provisioned SARA should stay in requested state');
  const createdPunePolice = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke Pune Police Coverage',
      email: 'smoke.pune.police.coverage@khozo.org',
      role: 'police',
      state: 'Maharashtra',
      district: 'Pune',
      org: 'Smoke Pune Police Coverage Desk',
    },
  });
  const adminNetworkBeforeDcpu = await request('GET', '/dashboard/network', { token: admin.token });
  assert(adminNetworkBeforeDcpu.coverage?.totals?.missingSlots > 0, 'network coverage should identify missing stakeholder desks');
  assert(adminNetworkBeforeDcpu.coverage.rows.some((row) => row.district === 'Pune' && row.roles.some((role) => role.role === 'dcpu' && role.status === 'missing')), 'Pune coverage should flag missing DCPU before provisioning');
  const createdDcpu = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke DCPU Coverage',
      email: 'smoke.dcpu.coverage@khozo.org',
      role: 'dcpu',
      state: 'Maharashtra',
      district: 'Pune',
      org: 'Smoke DCPU Coverage Desk',
    },
  });
  assert(createdDcpu.user.role === 'dcpu', 'provisioned coverage user should be DCPU');
  const adminNetworkAfterDcpu = await request('GET', '/dashboard/network', { token: admin.token });
  assert(adminNetworkAfterDcpu.coverage.rows.some((row) => row.district === 'Pune' && row.roles.some((role) => role.role === 'dcpu' && role.status === 'covered')), 'Pune coverage should mark DCPU covered after provisioning');
  assert(adminNetworkAfterDcpu.coverage.totals.missingSlots === adminNetworkBeforeDcpu.coverage.totals.missingSlots - 1, 'network coverage missing count should decrease after DCPU provisioning');
  await expectStatus(401, () => request('POST', '/auth/login', {
    body: { email: 'smoke.cci.provision@khozo.org', password: 'khozo123' },
  }), 'provisioned account shared password login');
  const provisionedLogin = await request('POST', '/auth/login', {
    body: { email: 'smoke.cci.provision@khozo.org', password: created.initialPassword },
  });
  assert(provisionedLogin.user.mustChangePassword === true, 'provisioned login should expose password-change requirement');
  await expectStatus(403, () => request('GET', '/dashboard/stats', {
    token: provisionedLogin.token,
  }), 'provisioned user dashboard before password change');
  await expectStatus(403, () => request('GET', '/reports', {
    token: provisionedLogin.token,
  }), 'provisioned user reports before password change');
  const newProvisionedPassword = uniquePassword();
  await expectStatus(400, () => request('POST', '/auth/change-password', {
    token: provisionedLogin.token,
    body: { currentPassword: created.initialPassword, newPassword: created.initialPassword },
  }), 'password change to same temporary password');
  const changedProvisioned = await request('POST', '/auth/change-password', {
    token: provisionedLogin.token,
    body: { currentPassword: created.initialPassword, newPassword: newProvisionedPassword },
  });
  assert(changedProvisioned.user.mustChangePassword === false, 'password change should clear forced-change flag');
  await request('GET', '/dashboard/stats', { token: provisionedLogin.token });
  await expectStatus(401, () => request('POST', '/auth/login', {
    body: { email: 'smoke.cci.provision@khozo.org', password: created.initialPassword },
  }), 'temporary password after password change');
  const provisionedRelogin = await request('POST', '/auth/login', {
    body: { email: 'smoke.cci.provision@khozo.org', password: newProvisionedPassword },
  });
  assert(provisionedRelogin.user.mustChangePassword === false, 'new password login should not require password change');
  const goaPolice = await request('POST', '/dashboard/network/users', {
    token: superAdmin.token,
    body: {
      name: 'Smoke Goa Police',
      email: 'smoke.goa.police@khozo.org',
      role: 'police',
      state: 'Goa',
      district: 'South Goa',
      org: 'Smoke Police',
    },
  });
  const superNetwork = await request('GET', '/dashboard/network', { token: superAdmin.token });
  assert(superNetwork.users.some((row) => row.id === goaPolice.user.id), 'super admin should see Goa provisioned user');
  const adminNetwork = await request('GET', '/dashboard/network', { token: admin.token });
  assert(adminNetwork.users.some((row) => row.id === created.user.id), 'Maharashtra admin should see in-state provisioned user');
  assert(adminNetwork.users.some((row) => row.id === createdSjpu.user.id), 'Maharashtra admin should see in-state SJPU user');
  assert(adminNetwork.users.some((row) => row.id === createdAhtu.user.id), 'Maharashtra admin should see in-state AHTU user');
  assert(adminNetwork.users.some((row) => row.id === createdDcrb.user.id), 'Maharashtra admin should see in-state DCRB user');
  assert(adminNetwork.users.some((row) => row.id === createdDlsa.user.id), 'Maharashtra admin should see in-state DLSA user');
  assert(adminNetwork.users.some((row) => row.id === createdSaa.user.id), 'Maharashtra admin should see in-state SAA user');
  assert(adminNetwork.users.some((row) => row.id === createdSara.user.id), 'Maharashtra admin should see in-state SARA user');
  assert(adminNetwork.users.some((row) => row.id === createdPunePolice.user.id), 'Maharashtra admin should see in-state Pune police coverage user');
  assert(adminNetwork.users.some((row) => row.id === createdDcpu.user.id), 'Maharashtra admin should see in-state DCPU coverage user');
  assert(!adminNetwork.users.some((row) => row.id === goaPolice.user.id), 'Maharashtra admin should not see Goa provisioned user');
  assert(!adminNetwork.coverage.rows.some((row) => row.state === 'Goa'), 'Maharashtra network coverage should not include Goa jurisdictions');
  const sjpuNetworkAlert = await request('POST', '/dashboard/network/alerts', {
    token: admin.token,
    body: {
      audience: 'police_rpf',
      state: 'Maharashtra',
      district: 'Mumbai',
      subject: 'Smoke police SJPU alert',
      message: 'SJPU police alert body should not be written to audit metadata.',
    },
  });
  assert(sjpuNetworkAlert.recipients.some((row) => row.role === 'sjpu'), 'police/RPF audience should include SJPU recipients');
  assert(sjpuNetworkAlert.recipients.some((row) => row.role === 'ahtu'), 'police/RPF audience should include AHTU recipients');
  assert(sjpuNetworkAlert.recipients.some((row) => row.role === 'dcrb'), 'police/RPF audience should include DCRB recipients');
  assert(sjpuNetworkAlert.recipients.every((row) => ['police', 'sjpu', 'ahtu', 'dcrb', 'rpf', 'crime_bureau'].includes(row.role)), 'police/RPF audience should stay in police/SJPU/AHTU/DCRB/RPF/bureau roles');
  const recordsAlert = await request('POST', '/dashboard/network/alerts', {
    token: admin.token,
    body: {
      audience: 'records',
      state: 'Maharashtra',
      district: 'Mumbai',
      subject: 'Smoke records bureau alert',
      message: 'Records bureau alert body should not be written to audit metadata.',
    },
  });
  assert(recordsAlert.recipients.some((row) => row.role === 'dcrb'), 'records audience should include DCRB recipients');
  assert(!recordsAlert.recipients.some((row) => row.role === 'crime_bureau'), 'district records audience should not include state-only bureau recipients');
  assert(recordsAlert.recipients.every((row) => ['dcrb', 'crime_bureau', 'police', 'sjpu', 'ahtu', 'rpf'].includes(row.role)), 'records audience should stay in record/police roles');
  const stateRecordsAlert = await request('POST', '/dashboard/network/alerts', {
    token: admin.token,
    body: {
      audience: 'records',
      state: 'Maharashtra',
      subject: 'Smoke state records bureau alert',
      message: 'State records bureau alert body should not be written to audit metadata.',
    },
  });
  assert(stateRecordsAlert.recipients.some((row) => row.role === 'crime_bureau'), 'state records audience should include crime bureau recipients');
  assert(stateRecordsAlert.recipients.some((row) => row.role === 'dcrb'), 'state records audience should include district DCRB recipients');
  const networkAlert = await request('POST', '/dashboard/network/alerts', {
    token: admin.token,
    body: {
      audience: 'welfare',
      state: 'Maharashtra',
      district: 'Mumbai',
      caseRef: 'TC-SMOKE-2026-01',
      subject: 'Smoke network alert',
      message: 'Network alert smoke body should not be written to audit metadata.',
    },
  });
  assert(networkAlert.alert.recipientCount >= 1, 'network alert should find in-scope recipients');
  assert(networkAlert.recipients.every((row) => row.jurisdiction?.state === 'Maharashtra'), 'network alert recipients should stay in-state');
  assert(networkAlert.recipients.every((row) => !row.jurisdiction?.district || row.jurisdiction.district === 'Mumbai'), 'network alert recipients should stay in district when district is selected');
  assert(networkAlert.recipients.some((row) => row.role === 'dlsa'), 'welfare network alert should include DLSA recipients');
  assert(networkAlert.recipients.some((row) => row.role === 'saa'), 'welfare network alert should include SAA recipients');
  assert(networkAlert.recipients.every((row) => ['cwc', 'dcpu', 'cci', 'saa', 'jjb', 'dlsa', 'state_nodal', 'sara'].includes(row.role)), 'welfare network alert should target welfare/legal/adoption roles');
  const legalAlert = await request('POST', '/dashboard/network/alerts', {
    token: admin.token,
    body: {
      audience: 'legal',
      state: 'Maharashtra',
      district: 'Mumbai',
      subject: 'Smoke DLSA legal alert',
      message: 'Legal aid alert body should not be written to audit metadata.',
    },
  });
  assert(legalAlert.recipients.some((row) => row.role === 'dlsa'), 'legal audience should include DLSA recipients');
  assert(legalAlert.recipients.every((row) => ['dlsa', 'cwc', 'dcpu', 'jjb', 'state_nodal'].includes(row.role)), 'legal audience should stay in DLSA/welfare oversight roles');
  const districtAdoptionAlert = await request('POST', '/dashboard/network/alerts', {
    token: sara.token,
    body: {
      audience: 'adoption',
      state: 'Maharashtra',
      district: 'Mumbai',
      subject: 'Smoke SARA adoption alert',
      message: 'Adoption alert body should not be written to audit metadata.',
    },
  });
  assert(districtAdoptionAlert.recipients.some((row) => row.role === 'saa'), 'district adoption audience should include SAA recipients');
  assert(districtAdoptionAlert.recipients.every((row) => ['sara', 'saa', 'cwc', 'dcpu', 'cci', 'state_nodal'].includes(row.role)), 'district adoption audience should stay in SARA/SAA/welfare oversight roles');
  assert(districtAdoptionAlert.recipients.every((row) => row.jurisdiction?.state === 'Maharashtra'), 'district adoption audience should stay in-state');
  assert(districtAdoptionAlert.recipients.every((row) => !row.jurisdiction?.district || row.jurisdiction.district === 'Mumbai'), 'district adoption audience should respect district filter');
  const stateAdoptionAlert = await request('POST', '/dashboard/network/alerts', {
    token: sara.token,
    body: {
      audience: 'adoption',
      state: 'Maharashtra',
      subject: 'Smoke SARA state adoption alert',
      message: 'State adoption alert body should not be written to audit metadata.',
    },
  });
  assert(stateAdoptionAlert.recipients.some((row) => row.role === 'sara'), 'state adoption audience should include SARA recipients');
  assert(stateAdoptionAlert.recipients.every((row) => ['sara', 'saa', 'cwc', 'dcpu', 'cci', 'state_nodal'].includes(row.role)), 'state adoption audience should stay in SARA/SAA/welfare oversight roles');
  await expectStatus(403, () => request('POST', '/dashboard/network/alerts', {
    token: admin.token,
    body: {
      audience: 'welfare',
      state: 'Goa',
      district: 'South Goa',
      subject: 'Out of scope alert',
      message: 'Admin cannot alert outside state',
    },
  }), 'admin outside-state network alert');
  await expectStatus(403, () => request('POST', '/dashboard/network/alerts', {
    token: parent.token,
    body: {
      audience: 'ngo',
      subject: 'Parent alert',
      message: 'Parent cannot send network alerts',
    },
  }), 'parent network alert');
  await expectStatus(403, () => request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: { name: 'Outside CCI', email: 'outside.smoke@khozo.org', role: 'cci', state: 'Gujarat', district: 'Ahmedabad' },
  }), 'admin outside-state provisioning');
  await expectStatus(403, () => request('POST', '/dashboard/network/users', {
    token: parent.token,
    body: { name: 'Bad Police', email: 'bad.police@khozo.org', role: 'police' },
  }), 'parent provisioning');

  const audit = await request('GET', '/dashboard/audit', { token: admin.token });
  assert(audit.integrity?.ok === true, 'audit chain should verify on audit list');
  assert(audit.audit.some((row) => row.action === 'auth.privileged_user_provisioned'), 'missing provisioning audit event');
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes(created.initialPassword)),
    'temporary password should not be written to audit events'
  );
  assert(audit.audit.some((row) => row.action === 'auth.password_changed'), 'missing password change audit event');
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes(newProvisionedPassword)),
    'new password should not be written to audit events'
  );
  assert(audit.audit.some((row) => row.action === 'case.assigned_owner'), 'missing case owner assignment audit event');
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Assignment smoke note')),
    'case assignment notes should not be written to audit events'
  );
  assert(audit.audit.some((row) => row.action === 'case.investigation_checklist_updated'), 'missing investigation checklist audit event');
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Investigation checklist smoke note')),
    'investigation checklist notes should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('DCRB records smoke note')),
    'DCRB checklist notes should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('INV/SMOKE/2026/01')),
    'station diary references should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('DCRB/SMOKE/2026/01')),
    'DCRB station diary references should not be written to audit events'
  );
  assert(audit.audit.some((row) => row.action === 'case.assigned_cci'), 'missing workflow audit event');
  assert(audit.audit.some((row) => row.action === 'case.cci_care_recorded'), 'missing CCI care audit event');
  assert(audit.audit.some((row) => row.action === 'sighting.formal_intake_created'), 'missing sighting formal intake audit event');
  assert(audit.audit.some((row) => row.action === 'case.found_child_intake_created'), 'missing found-child case intake audit event');
  assert(audit.audit.some((row) => row.action === 'case.referred_jjb'), 'missing JJB referral audit event');
  assert(audit.audit.some((row) => row.action === 'case.jjb_proceeding_recorded'), 'missing JJB proceeding audit event');
  assert(audit.audit.some((row) => row.action === 'case.escalated_state'), 'missing state escalation workflow audit event');
  assert(audit.audit.some((row) => row.action === 'case.state_escalation_recorded'), 'missing state escalation audit event');
  assert(audit.audit.some((row) => row.action === 'case.notified_crime_bureau'), 'missing crime bureau notification audit event');
  assert(audit.audit.some((row) => row.action === 'case.bureau_report_recorded'), 'missing bureau report audit event');
  assert(audit.audit.some((row) => row.action === 'case.external_id_linked'), 'missing external id audit event');
  assert(audit.audit.some((row) => row.action === 'case.handoff_exported'), 'missing case handoff export audit event');
  assert(audit.audit.some((row) => row.action === 'case.restoration_plan_recorded'), 'missing restoration plan audit event');
  assert(audit.audit.some((row) => row.action === 'case.welfare_referral_recorded'), 'missing welfare referral audit event');
  assert(audit.audit.some((row) => row.action === 'case.legal_aid_referral_recorded'), 'missing legal-aid referral audit event');
  assert(audit.audit.some((row) => row.action === 'case.adoption_recorded'), 'missing adoption record audit event');
  assert(audit.audit.some((row) => row.action === 'case.assessment_recorded'), 'missing case assessment audit event');
  assert(audit.audit.some((row) => row.action === 'case.production_recorded'), 'missing production record audit event');
  assert(audit.audit.some((row) => row.action === 'grievance.submitted'), 'missing grievance submitted audit event');
  assert(audit.audit.some((row) => row.action === 'grievance.status_updated'), 'missing grievance status audit event');
  assert(audit.audit.some((row) => row.action === 'network.alert_sent'), 'missing network alert audit event');
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Network alert smoke body')),
    'network alert body should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke Form-J circumstances')),
    'child profile circumstances should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke Report Declarant')),
    'report declaration signer should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke identification mark')),
    'child identification marks should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('SJPU police alert body')),
    'SJPU network alert body should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Records bureau alert body')),
    'records network alert body should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('State records bureau alert body')),
    'state records network alert body should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('temporary shelter, counselling review')),
    'CCI care plan details should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke CCI health care progress note')),
    'CCI health progress text should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Formal found child intake smoke note')),
    'found-child formal intake notes should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke CCI education progress note')),
    'CCI education progress text should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke CCI counselling progress note')),
    'CCI counselling progress text should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke CCI family tracing progress note')),
    'CCI family tracing progress text should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('social investigation, rehabilitation review')),
    'JJB directions should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('coordinate interstate rescue')),
    'state escalation action text should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('interstate alert, pattern review')),
    'bureau report summary should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('External ID smoke linking remarks')),
    'external id remarks should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('GHAR smoke restoration route')),
    'restoration remarks should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('9000000456')),
    'restoration escort contact should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('RESTORE/DOC/SMOKE')),
    'restoration document reference should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('FUND/SMOKE')),
    'restoration funding reference should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Welfare smoke eligibility note')),
    'welfare eligibility notes should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Legal aid smoke note')),
    'legal-aid notes should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('LEGAL/SMOKE/2026/01')),
    'legal-aid application references should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Adoption smoke note')),
    'adoption notes should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('CARINGS/SMOKE/2026/01')),
    'CARINGS references should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('ADOPT/ORDER/SMOKE/2026/01')),
    'adoption order references should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('SIR smoke findings')),
    'case assessment findings should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('ICP smoke care plan')),
    'case assessment care plans should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Production next action smoke text')),
    'production next action should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Confidential Smoke Reporter')),
    'confidential reporter name should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('123456789012')),
    'raw id proof number should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke grievance description')),
    'grievance description should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Internal smoke grievance note')),
    'grievance internal note should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('CARINGS smoke grievance detail')),
    'adoption grievance description should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Internal CARINGS grievance note')),
    'adoption grievance internal note should not be written to audit events'
  );
  await expectStatus(403, () => request('GET', '/dashboard/audit/export', { token: parent.token }), 'parent audit export');
  await expectStatus(403, () => request('GET', '/dashboard/audit/integrity', { token: parent.token }), 'parent audit integrity');
  await expectStatus(403, () => request('POST', '/dashboard/export/verify', {
    token: parent.token,
    body: privacyExport,
  }), 'parent export signature verify');
  const auditIntegrity = await request('GET', '/dashboard/audit/integrity', { token: admin.token });
  assert(auditIntegrity.integrity?.ok === true, 'audit integrity endpoint should verify hash chain');
  assert(auditIntegrity.integrity.checked > 0, 'audit integrity should check at least one event');
  const auditExport = await request('GET', '/dashboard/audit/export', { token: admin.token });
  assert(auditExport.scope === 'Maharashtra', `audit export scope should be Maharashtra, got ${auditExport.scope}`);
  assert(auditExport.signature?.type === 'audit_export', 'audit export should include signature type');
  assert(auditExport.signature?.algorithm === 'sha256-hmac', 'audit export should include signature algorithm');
  assert(/^[a-f0-9]{64}$/.test(auditExport.signature?.digest || ''), 'audit export should include SHA-256 digest');
  assert(/^[a-f0-9]{64}$/.test(auditExport.signature?.value || ''), 'audit export should include HMAC signature');
  assert(auditExport.integrity?.ok === true, 'audit export should include valid pre-export integrity');
  assert(auditExport.exportAuditIntegrity?.ok === true, 'audit export should include valid post-export integrity');
  const auditVerify = await request('POST', '/dashboard/export/verify', {
    token: admin.token,
    body: auditExport,
  });
  assert(auditVerify.ok === true, 'audit export signature should verify');
  assert(auditVerify.type === 'audit_export', 'audit export verification should return type');
  const tamperedAuditExport = { ...auditExport, totals: { ...auditExport.totals, events: auditExport.totals.events + 1 } };
  const tamperedVerify = await request('POST', '/dashboard/export/verify', {
    token: admin.token,
    body: tamperedAuditExport,
  });
  assert(tamperedVerify.ok === false, 'tampered audit export signature should fail verification');
  assert(tamperedVerify.reason === 'digest_mismatch', 'tampered audit export should report digest mismatch');
  assert(auditExport.totals.events >= audit.audit.length, 'audit export should include at least the visible audit rows');
  assert(auditExport.audit.some((row) => row.action === 'case.state_escalation_recorded'), 'audit export should include scoped state escalation event');
  assert(!auditExport.audit.some((row) => row.scope?.state === 'Goa'), 'Maharashtra audit export should not include Goa-scoped events');
  assert(
    !JSON.stringify(auditExport).includes('coordinate interstate rescue'),
    'audit export should not include redacted state escalation action text'
  );
  assert(audit.audit.some((row) => row.action === 'case.note_added'), 'missing case note audit event');
  assert(audit.audit.some((row) => row.action === 'case.closed'), 'missing case closure audit event');
  assert(audit.audit.some((row) => row.action === 'privacy.record_anonymized'), 'missing privacy anonymization audit event');
  assert(
    audit.audit.some((row) => row.action === 'privacy.record_anonymized' && row.metadata?.approvalReference === 'PO-APPROVAL-2026-01'),
    'privacy anonymization audit should include approval reference'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Privacy approval smoke note')),
    'privacy anonymization approval note should not be written to audit events'
  );
  const nationalAudit = await request('GET', '/dashboard/audit', { token: superAdmin.token });
  const nationalAuditExport = await request('GET', '/dashboard/audit/export', { token: superAdmin.token });
  assert(nationalAuditExport.audit.some((row) => row.action === 'audit.report_exported'), 'national audit export should include export audit event');
  assert(nationalAuditExport.audit.some((row) => row.action === 'audit.integrity_checked'), 'national audit export should include integrity check audit event');
  assert(nationalAuditExport.audit.some((row) => row.action === 'export.signature_verified'), 'national audit export should include signature verification audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'auth.public_user_registered'), 'missing public registration audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'auth.otp_started'), 'missing OTP start audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'auth.otp_failed'), 'missing OTP failure audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'security.public_rate_limited'), 'missing public rate-limit audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'security.abuse_signal_escalated'), 'missing public abuse disposition audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'security.abuse_report_exported'), 'missing public abuse export audit event');
  assert(
    !nationalAudit.audit.some((row) => JSON.stringify(row).includes(samePhoneOtp)),
    'OTP code should not be written to audit events'
  );
  assert(
    !nationalAudit.audit.some((row) => JSON.stringify(row).includes('9000000999')),
    'raw public reporter phone should not be written to rate-limit audit events'
  );
  assert(
    !nationalAudit.audit.some((row) => JSON.stringify(row).includes('Public abuse escalation smoke note')),
    'public abuse disposition note should not be written to audit events'
  );
  assert(
    !nationalAuditExport.audit
      .filter((row) => row.action === 'export.signature_verified')
      .some((row) => JSON.stringify(row).includes('privacyReviewStatus')),
    'signature verification audit should not store uploaded export payloads'
  );
  assert(nationalAudit.audit.some((row) => row.action === 'case.intake_verified'), 'missing intake verification audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'case.bulletin_published'), 'missing bulletin publish audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'case.bulletin_unpublished'), 'missing bulletin unpublish audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'case.jurisdiction_transferred'), 'missing jurisdiction transfer audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'mis.report_generated'), 'missing MIS report audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'sighting.cwc_followup_completed'), 'missing CWC follow-up audit event');

  console.log('API smoke checks passed.');
}

async function cleanup() {
  if (server && !server.killed) {
    server.kill();
    await sleep(250);
  }
  // Photos uploaded during the run land in the local uploads directory (this
  // suite runs in JSON-file mode), so remove them alongside the restored db.
  const uploadsDir = path.join(root, 'server', 'data', 'uploads');
  if (fs.existsSync(uploadsDir)) {
    for (const file of fs.readdirSync(uploadsDir)) {
      if (/\.(jpg|jpeg|png|webp)$/i.test(file)) fs.rmSync(path.join(uploadsDir, file), { force: true });
    }
  }
  if (fs.existsSync(backupFile)) {
    fs.copyFileSync(backupFile, dbFile);
    fs.rmSync(backupFile, { force: true });
  }
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(cleanup);
