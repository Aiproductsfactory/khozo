/**
 * Exercises every provisioned Khozo account against the live API.
 *
 * Checks, per account: sign-in, /auth/me identity, whether the role can reach
 * the workflows it should, and - the part that actually matters for a
 * child-protection system - that jurisdiction scoping holds, so a district
 * officer cannot read cases belonging to another district.
 *
 *   node scripts/test-accounts.mjs
 *   node scripts/test-accounts.mjs --api http://localhost:4000
 */

import process from 'node:process';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const API = arg('api', process.env.KHOZO_API || 'http://localhost:4000').replace(/\/+$/, '');
const PASSWORD = arg('password', 'khozo123');

/** Every seeded account, with what its role is expected to be able to do. */
const ACCOUNTS = [
  { email: 'superadmin@khozo.org', role: 'super_admin', scope: 'national', review: true, confirm: true, network: true },
  { email: 'admin@khozo.org', role: 'admin', scope: 'Maharashtra', review: true, confirm: true, network: true },
  { email: 'police@khozo.org', role: 'police', scope: 'Mumbai', review: true, confirm: true, network: false },
  { email: 'sjpu@khozo.org', role: 'sjpu', scope: 'Mumbai', review: true, confirm: true, network: false },
  { email: 'ahtu@khozo.org', role: 'ahtu', scope: 'Mumbai', review: true, confirm: false, network: false },
  { email: 'dcrb@khozo.org', role: 'dcrb', scope: 'Mumbai', review: true, confirm: false, network: false },
  { email: 'dlsa@khozo.org', role: 'dlsa', scope: 'Mumbai', review: true, confirm: false, network: false },
  { email: 'cwc@khozo.org', role: 'cwc', scope: 'Mumbai', review: true, confirm: false, network: false },
  { email: 'dcpu@khozo.org', role: 'dcpu', scope: 'Mumbai', review: true, confirm: false, network: false },
  { email: 'rpf@khozo.org', role: 'rpf', scope: 'Mumbai', review: true, confirm: false, network: false },
  { email: 'cci@khozo.org', role: 'cci', scope: 'Mumbai', review: true, confirm: false, network: false },
  { email: 'saa@khozo.org', role: 'saa', scope: 'Mumbai', review: true, confirm: false, network: false },
  { email: 'jjb@khozo.org', role: 'jjb', scope: 'Mumbai', review: true, confirm: false, network: false },
  { email: 'nodal@khozo.org', role: 'state_nodal', scope: 'Maharashtra', review: true, confirm: false, network: true },
  { email: 'sara@khozo.org', role: 'sara', scope: 'Maharashtra', review: true, confirm: false, network: true },
  { email: 'crimebureau@khozo.org', role: 'crime_bureau', scope: 'Maharashtra', review: true, confirm: false, network: true },
  { email: 'parent@khozo.org', role: 'parent', scope: 'citizen', review: false, confirm: false, network: false },
  { email: 'ngo@khozo.org', role: 'ngo', scope: 'citizen', review: false, confirm: false, network: false },
];

async function call(pathname, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}/api${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return { status: res.status, payload };
}

const results = [];
function record(account, check, ok, detail = '') {
  results.push({ account, check, ok, detail });
}

async function testAccount(spec) {
  const label = spec.email;

  const login = await call('/auth/login', { method: 'POST', body: { email: spec.email, password: PASSWORD } });
  if (login.status !== 200 || !login.payload?.token) {
    record(label, 'sign-in', false, `HTTP ${login.status}`);
    return null;
  }
  record(label, 'sign-in', true);

  const token = login.payload.token;
  const user = login.payload.user;

  record(label, 'role', user.role === spec.role, `expected ${spec.role}, got ${user.role}`);
  record(label, 'password hash not returned', user.passwordHash === undefined, 'passwordHash leaked in /auth/login');

  const me = await call('/auth/me', { token });
  record(label, '/auth/me', me.status === 200 && me.payload?.user?.id === user.id, `HTTP ${me.status}`);

  // Review queue: REVIEW_ROLES only.
  const queue = await call('/reports/found/all', { token });
  const canReview = queue.status === 200;
  record(label, `review queue ${spec.review ? 'allowed' : 'denied'}`, canReview === spec.review, `HTTP ${queue.status}`);

  // Network admin: super_admin / admin / state-level roles only.
  const network = await call('/dashboard/network', { token });
  const canNetwork = network.status === 200;
  record(label, `network admin ${spec.network ? 'allowed' : 'denied'}`, canNetwork === spec.network, `HTTP ${network.status}`);

  // Scoped case list must never contain another jurisdiction's cases.
  const reports = await call('/reports', { token });
  if (reports.status === 200) {
    const rows = reports.payload?.reports || [];
    if (spec.scope === 'national') {
      record(label, 'jurisdiction scope', true, `${rows.length} cases (national)`);
    } else if (spec.scope === 'citizen') {
      const ownOnly = rows.every((r) => r.registeredById === user.id);
      record(label, 'sees only own filings', ownOnly, `${rows.length} cases`);
    } else {
      // Authority follows the role tier, not whichever fields happen to be set
      // on the user record: a state-level ACP has a district on their profile
      // but is scoped to the whole state (see server/src/scope.js).
      const stateTier = ['admin', 'state_nodal', 'sara', 'crime_bureau'].includes(user.role);
      const foreign = rows.filter((r) => {
        if (stateTier) return r.state && r.state !== user.jurisdiction?.state;
        return user.jurisdiction?.district && r.district && r.district !== user.jurisdiction.district;
      });
      record(label, 'jurisdiction scope', foreign.length === 0,
        foreign.length ? `${foreign.length} out-of-jurisdiction cases leaked` : `${rows.length} cases, all in scope`);
    }
  } else {
    record(label, 'case list', false, `HTTP ${reports.status}`);
  }

  return { token, user };
}

async function testUnauthenticated() {
  const label = '(no token)';
  for (const [name, pathname] of [
    ['case list', '/reports'],
    ['review queue', '/reports/found/all'],
    ['audit log', '/dashboard/audit'],
    ['network admin', '/dashboard/network'],
  ]) {
    const res = await call(pathname);
    record(label, `${name} rejected`, res.status === 401, `HTTP ${res.status}`);
  }

  // Public endpoints must stay reachable without a token.
  for (const [name, pathname] of [
    ['bulletins', '/reports/public/bulletins'],
    ['public search', '/reports/public/search'],
    ['health', '/health'],
  ]) {
    const res = await call(pathname);
    record(label, `${name} public`, res.status === 200, `HTTP ${res.status}`);
  }

  const bad = await call('/auth/login', { method: 'POST', body: { email: 'police@khozo.org', password: 'wrong-password' } });
  record(label, 'wrong password rejected', bad.status === 401, `HTTP ${bad.status}`);
}

async function main() {
  console.log(`Khozo account matrix\n  API: ${API}\n`);

  const health = await call('/health');
  if (health.status !== 200) throw new Error(`API not reachable at ${API}`);

  for (const spec of ACCOUNTS) {
    process.stdout.write(`  ${spec.email.padEnd(26)} `);
    const before = results.length;
    // eslint-disable-next-line no-await-in-loop
    await testAccount(spec);
    const mine = results.slice(before);
    const failed = mine.filter((r) => !r.ok);
    console.log(failed.length === 0 ? `ok (${mine.length} checks)` : `${failed.length}/${mine.length} FAILED`);
  }

  process.stdout.write(`  ${'(unauthenticated)'.padEnd(26)} `);
  const before = results.length;
  await testUnauthenticated();
  const anon = results.slice(before);
  console.log(anon.every((r) => r.ok) ? `ok (${anon.length} checks)` : `${anon.filter((r) => !r.ok).length}/${anon.length} FAILED`);

  const failures = results.filter((r) => !r.ok);
  console.log(`\n--- ${results.length - failures.length}/${results.length} checks passed ---`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ${f.account.padEnd(26)} ${f.check.padEnd(34)} ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nAccount tests failed: ${err.message}`);
  process.exit(1);
});
