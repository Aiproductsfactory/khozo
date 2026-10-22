/**
 * Puts the video-search demonstration case into a Khozo deployment, once,
 * and closes it again afterwards.
 *
 * The case is a missing woman named "DEMO - Video search (not a real case)",
 * FIR DEMO-VIDEO-1, visible to police desks only, in the signed-in officer's
 * own district. Its photo comes from the demo kit: a public-domain NASA
 * portrait, never a real missing person. The kit also holds a simulated CCTV
 * clip in which the same person appears in a different photograph, among
 * four passers-by. The kit stays outside this public repository, because it
 * holds photographs of real people's faces (test-assets/faces/README.md).
 *
 * Running it again finds the open demo case and changes nothing.
 *
 *   node scripts/seed-video-demo.mjs --kit D:/khozo-private/video-demo
 *   node scripts/seed-video-demo.mjs --kit D:/khozo-private/video-demo --api https://khozo.org/api
 *   node scripts/seed-video-demo.mjs --api https://khozo.org/api --close
 *
 * The officer signs in with KHOZO_DEMO_EMAIL and KHOZO_DEMO_PASSWORD (or
 * --email and --password). Use a police account in the district the demo is
 * for. Registering adds the face to the face search gallery when the
 * deployment has one; closing the case takes it out.
 *
 * --api defaults to the local API (http://localhost:4000/api). --state and
 * --district override the officer's own district.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const FIR = 'DEMO-VIDEO-1';
const NAME = 'DEMO - Video search (not a real case)';
const PHOTO = 'pictures/case-photo-eileen-collins-2005.jpg';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const api = String(arg('api') || 'http://localhost:4000/api').replace(/\/+$/, '');
const kit = arg('kit');
const email = arg('email') || process.env.KHOZO_DEMO_EMAIL;
const password = arg('password') || process.env.KHOZO_DEMO_PASSWORD;
const close = arg('close') === true;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function call(method, pathName, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${api}${pathName}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${pathName}: ${res.status} ${data.error || ''}`.trim());
  return data;
}

if (!email || !password) fail('Sign in as a police officer: set KHOZO_DEMO_EMAIL and KHOZO_DEMO_PASSWORD, or pass --email and --password.');

const { token, user } = await call('POST', '/auth/login', { body: { email, password } });
if (user?.mustChangePassword || user?.passwordChangeRequired) fail('This account must change its password first. Sign in on the website once, then run this again.');

const mine = (await call('GET', '/reports', { token })).reports || [];
const existing = mine.find((r) => r.firNo === FIR && !['closed', 'found'].includes(r.status));
// Where officers open the console: the site itself, or the local web app
// beside a local API (--web overrides both).
const web = arg('web');
const origin = typeof web === 'string'
  ? web.replace(/\/+$/, '')
  : /^https?:\/\/(localhost|127\.0\.0\.1):4000\/api$/.test(api) ? 'http://localhost:5173' : api.replace(/\/api$/, '');

if (close) {
  if (!existing) {
    console.log('No open demo case to close.');
    process.exit(0);
  }
  await call('POST', `/reports/${existing.id}/close-case`, { token, body: { reason: 'other', note: 'Demonstration finished. This was not a real case.' } });
  console.log(`Closed the demo case ${existing.id}.`);
  process.exit(0);
}

if (existing) {
  console.log(`The demo case is already there: ${existing.id}`);
  console.log(`Open it: ${origin}/app/cases?id=${existing.id}`);
  process.exit(0);
}

if (!kit || kit === true) fail('Say where the demo kit is: --kit D:/khozo-private/video-demo');
const photoPath = path.join(kit, PHOTO);
if (!fs.existsSync(photoPath)) fail(`The case photo is not in the kit: ${photoPath}`);

const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
const form = new FormData();
const fields = {
  personCategory: 'woman',
  childName: NAME,
  gender: 'Female',
  age: '40',
  firNo: FIR,
  dateOfMissing: twoDaysAgo,
  visibility: 'police',
  clothing: 'Orange flight suit',
  circumstances: 'Demonstration case for searching CCTV video. The photo is a public-domain NASA portrait. This is not a real missing person.',
  photoConsent: 'true',
  allowDuplicate: 'true',
  declarationAccepted: 'true',
  declarationSignerName: user?.name || 'Demo officer',
  declarationSignerRole: user?.role || 'police',
  relationshipToChild: 'official',
  declarationMethod: 'digital',
};
const state = arg('state');
const district = arg('district');
if (typeof state === 'string') fields.state = state;
if (typeof district === 'string') fields.district = district;
for (const [key, value] of Object.entries(fields)) form.set(key, value);
form.set('photo', new Blob([fs.readFileSync(photoPath)], { type: 'image/jpeg' }), 'case-photo.jpg');

const created = await call('POST', '/reports', { token, form });
const report = created.report;
console.log(`Registered the demo case ${report.id} in ${[report.district, report.state].filter(Boolean).join(', ')}.`);
console.log(`Photo check: ${report.photoCheck?.verdict || 'not checked'}.`);
console.log(`Open it: ${origin}/app/cases?id=${report.id}`);
console.log('Then open "Search a CCTV video for this person" and choose demo-cctv-kalupur-gate1.mp4 from the kit.');
