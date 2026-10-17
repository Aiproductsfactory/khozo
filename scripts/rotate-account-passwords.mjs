/**
 * Gives every official account on a Khozo deployment its own strong password.
 *
 * Every seeded account used to share one password, and that password was
 * printed on the login page and in this public repository's README. Super
 * admin sees every record, so a shared password means anyone can read every
 * missing person's file. This script logs in to each account with the old
 * shared password, changes it through the ordinary change-password endpoint
 * (so it is audited like any other change), and writes the new passwords to a
 * CSV that must live OUTSIDE the repository. Passwords are never printed.
 *
 *   node scripts/rotate-account-passwords.mjs --api https://khozo.org \
 *     --out <folder outside the repo>/khozo-accounts.csv --keep parent@khozo.org,ngo@khozo.org \
 *     --provision gujarat --dry-run
 *
 * The old password comes from KHOZO_OLD_PASSWORD. Accounts already off the
 * shared password are left alone and reported. Super admin is rotated last,
 * because its session is what lists the roster and provisions new accounts.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function fail(message) {
  console.error(`\nStopped: ${message}`);
  process.exit(1);
}

const API = String(arg('api', '') || '').replace(/\/+$/, '');
const OUT = arg('out');
const KEEP = new Set(String(arg('keep', '') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const PROVISION = arg('provision');
const DRY_RUN = Boolean(arg('dry-run', false));
const OLD = process.env.KHOZO_OLD_PASSWORD;
const ADMIN_EMAIL = String(arg('admin-email', 'superadmin@khozo.org')).toLowerCase();

if (!API) fail('--api <url> is required.');
if (!OUT || OUT === true) fail('--out <csv path outside the repository> is required.');
if (!OLD) fail('Set KHOZO_OLD_PASSWORD to the shared password being retired.');
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const outPath = path.resolve(OUT);
if (outPath.toLowerCase().startsWith(repoRoot.toLowerCase() + path.sep)) fail('--out must be outside the repository: it will hold live passwords.');
if (existsSync(outPath) && !DRY_RUN) fail(`${outPath} already exists; move it aside first so no password is overwritten.`);

// Accounts a state pilot needs on day one. Created only with --provision gujarat.
const PROVISIONS = {
  gujarat: [
    { name: 'Ahmedabad City Police (Khozo pilot)', email: 'ahmedabad.police@khozo.org', role: 'police', org: 'Ahmedabad City Police', state: 'Gujarat', district: 'Ahmedabad' },
    { name: 'Gujarat Police - State desk (Khozo pilot)', email: 'gujarat.admin@khozo.org', role: 'admin', org: 'Gujarat Police', state: 'Gujarat' },
  ],
};
if (PROVISION && PROVISION !== true && !PROVISIONS[PROVISION]) fail(`Unknown --provision set "${PROVISION}".`);

const strongPassword = () => {
  // 20 characters from an unambiguous alphabet: about 115 bits.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(20);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(pathname, { method = 'GET', token, body } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/api${pathname}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text.slice(0, 200) }; }
    return { status: res.status, data };
  }
}

const rows = [];
function record(row) {
  rows.push(row);
  console.log(`  ${row.status.padEnd(26)} ${row.email}${row.role ? `  (${row.role}${row.jurisdiction ? `, ${row.jurisdiction}` : ''})` : ''}`);
}

function saveCsv() {
  if (DRY_RUN) return;
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['email,role,jurisdiction,password,status', ...rows.filter((r) => r.password).map((r) => [r.email, r.role, r.jurisdiction, r.password, r.status].map(esc).join(','))];
  writeFileSync(outPath, '\ufeff' + lines.join('\r\n') + '\r\n', { mode: 0o600 });
}

async function rotate(user) {
  const email = user.email.toLowerCase();
  const jurisdiction = [user.jurisdiction?.district, user.jurisdiction?.state].filter(Boolean).join(', ');
  const login = await call('/auth/login', { method: 'POST', body: { email, password: OLD } });
  if (login.status !== 200) return record({ email, role: user.role, jurisdiction, status: login.status === 401 ? 'not on shared password' : `login ${login.status}` });
  if (DRY_RUN) return record({ email, role: user.role, jurisdiction, status: 'would rotate' });
  const password = strongPassword();
  const changed = await call('/auth/change-password', { method: 'POST', token: login.data.token, body: { currentPassword: OLD, newPassword: password } });
  if (changed.status !== 200) return record({ email, role: user.role, jurisdiction, status: `change failed ${changed.status}` });
  record({ email, role: user.role, jurisdiction, password, status: 'rotated' });
  saveCsv(); // after every change, so an interruption never loses a password
}

async function main() {
  console.log(`Khozo password rotation${DRY_RUN ? ' (dry run)' : ''}\n  api  : ${API}\n  out  : ${outPath}\n  keep : ${[...KEEP].join(', ') || '(none)'}\n`);

  const admin = await call('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: OLD } });
  if (admin.status !== 200) fail(`could not log in as ${ADMIN_EMAIL} with the old password (HTTP ${admin.status}); nothing was changed.`);
  const roster = await call('/dashboard/network', { token: admin.data.token });
  if (roster.status !== 200) fail(`could not list accounts (HTTP ${roster.status}); nothing was changed.`);
  const users = roster.data.users || [];
  console.log(`${users.length} accounts on the roster.\n`);

  if (PROVISION && PROVISION !== true) {
    for (const p of PROVISIONS[PROVISION]) {
      const jurisdiction = [p.district, p.state].filter(Boolean).join(', ');
      if (users.some((u) => u.email.toLowerCase() === p.email)) { record({ email: p.email, role: p.role, jurisdiction, status: 'already exists' }); continue; }
      if (DRY_RUN) { record({ email: p.email, role: p.role, jurisdiction, status: 'would create' }); continue; }
      const created = await call('/dashboard/network/users', { method: 'POST', token: admin.data.token, body: p });
      if (created.status !== 201) { record({ email: p.email, role: p.role, jurisdiction, status: `create failed ${created.status}: ${created.data?.error || ''}` }); continue; }
      // Provisioned accounts must change their temporary password at first login.
      const first = await call('/auth/login', { method: 'POST', body: { email: p.email, password: created.data.initialPassword } });
      const password = strongPassword();
      const changed = first.status === 200
        ? await call('/auth/change-password', { method: 'POST', token: first.data.token, body: { currentPassword: created.data.initialPassword, newPassword: password } })
        : first;
      if (changed.status === 200) { record({ email: p.email, role: p.role, jurisdiction, password, status: 'created' }); saveCsv(); }
      else record({ email: p.email, role: p.role, jurisdiction, status: `created; password set failed ${changed.status}` });
    }
  }

  const targets = users.filter((u) => !KEEP.has(u.email.toLowerCase()) && u.email.toLowerCase() !== ADMIN_EMAIL);
  for (const u of targets) await rotate(u);
  for (const u of users.filter((u) => KEEP.has(u.email.toLowerCase()))) record({ email: u.email.toLowerCase(), role: u.role, status: 'kept on demo password' });

  const self = users.find((u) => u.email.toLowerCase() === ADMIN_EMAIL) || { email: ADMIN_EMAIL, role: 'super_admin' };
  await rotate(self);

  saveCsv();
  const count = (s) => rows.filter((r) => r.status === s).length;
  console.log(`\nRotated ${count('rotated')}, created ${count('created')}, kept ${count('kept on demo password')}, already private ${count('not on shared password')}.`);
  const problems = rows.filter((r) => !['rotated', 'created', 'kept on demo password', 'not on shared password', 'would rotate', 'would create', 'already exists'].includes(r.status));
  if (problems.length) { console.log(`${problems.length} problem(s) above need attention.`); process.exitCode = 1; }
  if (!DRY_RUN) console.log(`New passwords: ${outPath} (keep it off shared drives and out of git).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
