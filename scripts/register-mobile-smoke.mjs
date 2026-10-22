/**
 * Signing up and signing in without an email address.
 *
 * Many people in villages have a mobile number and no email. A citizen or NGO
 * account is the verified mobile number; email is optional; sign-in takes the
 * email or the mobile number. Official desks may share a station's phone, so
 * when a number matches more than one account the password decides whose it
 * is, and only two accounts sharing a password too are asked for the email.
 *
 * Handlers are called directly with stubbed dependencies: no server, no
 * database, no network.
 *
 *   node scripts/register-mobile-smoke.mjs
 */
import bcrypt from 'bcryptjs';
import process from 'node:process';

import registerAuthRoutes from '../shared/routes/auth.js';
import { publicUser } from '../worker/src/http/express-compat.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push(ok);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('Khozo sign-up without an email\n');

const hash = (p) => bcrypt.hashSync(p, 4);
// A station desk whose phone a citizen might also use.
const DESK = { id: 'u_desk', role: 'police', name: 'PS Kalupur desk', email: 'ps.kalupur@gujarat.test', passwordHash: hash('desk-pass-1'), phone: '9000000101', jurisdiction: { level: 'station', state: 'Gujarat', district: 'Ahmedabad', station: 'Kalupur' } };
const DESK2 = { id: 'u_desk2', role: 'police', name: 'PSO Kalupur', email: 'pso.kalupur@gujarat.test', passwordHash: hash('shared-pass'), phone: '9000000202', jurisdiction: { level: 'station', state: 'Gujarat', district: 'Ahmedabad', station: 'Kalupur' } };
const DESK3 = { id: 'u_desk3', role: 'police', name: 'PI Kalupur', email: 'pi.kalupur@gujarat.test', passwordHash: hash('shared-pass'), phone: '9000000202', jurisdiction: { level: 'station', state: 'Gujarat', district: 'Ahmedabad', station: 'Kalupur' } };

function harness() {
  const db = { users: [DESK, DESK2, DESK3].map((u) => structuredClone(u)), audit: [] };
  const routes = [];
  const router = {
    use: () => router,
    ...Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map((method) => [
      method,
      (path, ...handlers) => { routes.push({ method: method.toUpperCase(), path, handler: handlers.flat().at(-1) }); return router; },
    ])),
  };
  const pass = (_req, _res, next) => next?.();
  registerAuthRoutes(router, {
    listUsers: () => db.users,
    // As the stores do: an account may have no email, and a blank never matches.
    findUserByEmail: (email) => (email ? db.users.find((u) => typeof u.email === 'string' && u.email.toLowerCase() === String(email).toLowerCase()) : null) || null,
    addUser: (u) => { db.users.push(u); return u; },
    updateUser: (id, patch) => { const u = db.users.find((x) => x.id === id); if (u) Object.assign(u, patch); return u || null; },
    addAudit: (row) => db.audit.push(row),
    authRequired: pass, publicUser,
    signToken: async (u) => `token-${u.id}`,
    auditPublicRateLimit: () => {}, clientIp: () => 'test', fixedWindowRateLimit: () => pass,
    settings: {},
  });
  const call = async (method, path, body = {}) => {
    const route = routes.find((r) => r.method === method && r.path === path);
    if (!route) throw new Error(`no route ${method} ${path}`);
    let status = 200;
    let payload = null;
    const res = {
      status(code) { status = code; return res; }, json(data) { payload = data; return res; },
      set() { return res; }, setHeader() { return res; }, cookie() { return res; }, type() { return res; }, send() { return res; }, end() { return res; },
    };
    await route.handler({ body, params: {}, query: {}, headers: {}, user: null }, res);
    return { status, payload };
  };
  return { db, call };
}

async function signUp(h, body) {
  const otp = await h.call('POST', '/otp/start', { phone: body.phone });
  return h.call('POST', '/register', { ...body, otp: otp.payload?.demoOtp });
}

{
  const h = harness();
  const res = await signUp(h, { name: 'Ramila Ben', phone: '98250 11111', password: 'gaam-ma-rahu', role: 'parent', state: 'Gujarat', district: 'Ahmedabad' });
  check('a parent can sign up with a mobile number and no email', res.status === 201, `HTTP ${res.status} ${res.payload?.error || ''}`);
  const u = h.db.users.find((x) => x.name === 'Ramila Ben');
  check('the account has no email and a verified mobile number', u && u.email === null && u.phone === '9825011111' && u.phoneVerified === true);

  const byPhone = await h.call('POST', '/login', { email: '98250 11111', password: 'gaam-ma-rahu' });
  check('she signs in with her mobile number', byPhone.status === 200 && byPhone.payload?.user?.id === u?.id, `HTTP ${byPhone.status} ${byPhone.payload?.error || ''}`);
  const withPlus = await h.call('POST', '/login', { email: '9825011111', password: 'gaam-ma-rahu' });
  check('spaces in the number do not matter', withPlus.status === 200);
  const wrong = await h.call('POST', '/login', { email: '9825011111', password: 'nope' });
  check('a wrong password is refused, in plain words', wrong.status === 401 && /mobile number/.test(wrong.payload?.error || ''), wrong.payload?.error);
  const blank = await h.call('POST', '/login', { email: '', password: 'gaam-ma-rahu' });
  check('a blank sign-in finds no account', blank.status === 401);

  const again = await signUp(h, { name: 'Someone else', phone: '9825011111', password: 'another-one', role: 'parent' });
  check('a second citizen account on the same number is refused', again.status === 409 && again.payload?.code === 'phone_taken', `HTTP ${again.status}`);
}

{
  const h = harness();
  const bad = await signUp(h, { name: 'Typo', phone: '9825022222', email: 'not an email', password: 'abc12345', role: 'ngo' });
  check('an email that is given must look like one', bad.status === 400);
  const ok = await signUp(h, { name: 'Seva Trust', phone: '9825022222', email: '  Seva@Trust.ORG ', password: 'abc12345', role: 'ngo' });
  check('an email that is given is kept, in lower case', ok.status === 201 && h.db.users.find((u) => u.name === 'Seva Trust')?.email === 'seva@trust.org');
  const byEmail = await h.call('POST', '/login', { email: 'seva@trust.org', password: 'abc12345' });
  check('that account signs in with the email too', byEmail.status === 200);
  const dupe = await signUp(h, { name: 'Copy', phone: '9825033333', email: 'seva@trust.org', password: 'abc12345', role: 'ngo' });
  check('an email already in use is refused', dupe.status === 409);
  const noPhone = await h.call('POST', '/register', { name: 'No phone', password: 'abc12345', role: 'parent' });
  check('a mobile number is still required', noPhone.status === 400);
}

{
  const h = harness();
  // A citizen whose number is also a station desk's.
  const res = await signUp(h, { name: 'Desk neighbour', phone: '9000000101', password: 'my-own-pass', role: 'parent' });
  check('a desk sharing the number does not block a citizen sign-up', res.status === 201, `HTTP ${res.status} ${res.payload?.error || ''}`);
  const citizen = await h.call('POST', '/login', { email: '9000000101', password: 'my-own-pass' });
  check('the password tells the citizen apart from the desk', citizen.status === 200 && citizen.payload?.user?.role === 'parent');
  const desk = await h.call('POST', '/login', { email: '9000000101', password: 'desk-pass-1' });
  check('and the desk apart from the citizen', desk.status === 200 && desk.payload?.user?.id === 'u_desk');
  const shared = await h.call('POST', '/login', { email: '9000000202', password: 'shared-pass' });
  check('two desks sharing a number and a password are asked for their email', shared.status === 409 && shared.payload?.code === 'phone_shared', `HTTP ${shared.status}`);
  const officerEmail = await h.call('POST', '/login', { email: 'PI.Kalupur@gujarat.test', password: 'shared-pass' });
  check('an officer still signs in with an email', officerEmail.status === 200 && officerEmail.payload?.user?.id === 'u_desk3');
}

{
  const h = harness();
  const blocked = await signUp(h, { name: 'Fake officer', phone: '9825044444', password: 'abc12345', role: 'police' });
  check('police accounts still cannot be self-registered', blocked.status === 403);
}

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
