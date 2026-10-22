/**
 * Sign-in, public self-registration (with phone OTP) and password change.
 *
 * Registered by both runtimes against their own router — see
 * shared/routes/reports.js for how the `deps` contract works.
 */

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { normalisePhone } from '../phone.js';
import { nanoid } from 'nanoid';

import { readFields } from '../case-domain.js';
import { sendSms, smsGatewayConfigured } from '../sms.js';
import { checkActivation } from '../bulk-accounts.js';

/**
 * Pending phone-verification challenges, keyed by phone number.
 *
 * Module scope rather than per-registration because the Worker builds its
 * router once per request; a challenge issued by `/otp/start` has to still be
 * there when `/register` verifies it. On Workers that means an OTP is only
 * verifiable by the isolate that issued it, so a citizen may occasionally have
 * to request a second code — an SMS gateway plus shared storage is what
 * removes that, and is required for production either way.
 */
const otpStore = new Map();

/**
 * bcrypt work factor for new password hashes. It was 8; each step doubles the
 * cost of guessing a leaked hash. A hash at a lower cost is upgraded the next
 * time its owner signs in (DPIA G9).
 */
export const BCRYPT_COST = 10;

export function hashPassword(password) {
  return bcrypt.hashSync(String(password), BCRYPT_COST);
}

export default function registerAuthRoutes(router, deps) {
  const {
    findUserByEmail, listUsers, addUser, addAudit, updateUser,
    signToken, publicUser, authRequired,
    auditPublicRateLimit, clientIp, fixedWindowRateLimit,
    settings = {},
  } = deps;


  
  /**
   * A token for `user`, or null after answering 503 when the server cannot
   * sign one (a deployed Worker without KHOZO_JWT_SECRET refuses to use the
   * repository's fallback; worker/src/http/express-compat.js).
   */
  async function tokenFor(res, user) {
    try {
      return await signToken(user);
    } catch (err) {
      if (err?.code !== 'JWT_SECRET_MISSING') throw err;
      res.status(503).json({ error: 'Sign-in is not configured on this server' });
      return null;
    }
  }

  const PUBLIC_ROLES = ['parent', 'ngo'];
  const OTP_TTL_MS = 10 * 60 * 1000;
  const registerLimit = fixedWindowRateLimit({
    name: 'auth_register',
    limit: 8,
    envLimit: settings.registerLimit,
    key: (req) => clientIp(req),
    onLimit: auditPublicRateLimit,
  });
  const loginLimit = fixedWindowRateLimit({
    name: 'auth_login',
    limit: 12,
    envLimit: settings.loginLimit,
    key: (req) => `${clientIp(req)}:${String(req.body?.email || '').trim().toLowerCase()}`,
    onLimit: auditPublicRateLimit,
  });
  
  function digits(value) {
    return String(value || '').replace(/\D/g, '');
  }
  
  // The number as it is stored and compared: "+91 98765 43210" and
  // "098765 43210" are the same account as 9876543210 (shared/phone.js).
  function otpKey(phone) {
    return normalisePhone(phone);
  }

  /**
   * The accounts that hold a mobile number. A citizen signs up with a mobile
   * number and need not have an email address (many people in villages have
   * none), so the number is how they sign in. Official accounts may share a
   * desk's number, so more than one can come back.
   */
  function usersByPhone(phone) {
    const want = normalisePhone(phone);
    if (!want || typeof listUsers !== 'function') return [];
    return listUsers().filter((u) => u && normalisePhone(u.phone) === want);
  }

  /** An email address as typed, or null when none was given. */
  function emailOf(value) {
    const text = String(value || '').trim().toLowerCase();
    return text || null;
  }
  const looksLikeEmail = (text) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  
  /**
   * Generates a one-time code.
   *
   * Must be unpredictable. This previously returned the last six digits of the
   * caller's own phone number, which meant anyone who knew a number could compute
   * its OTP and register an account against it — on a platform where a "parent"
   * account can see a child's case.
   */
  function generateOtp() {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  }
  
  /**
   * Delivers the code. Without a gateway configured there is no delivery channel,
   * so production refuses rather than issuing a code nobody can receive — and
   * that a caller might otherwise be able to guess.
   */
  async function deliverOtp(phone, code) {
    if (!smsGatewayConfigured(settings)) {
      if (settings.nodeEnv === 'production') {
        throw Object.assign(new Error('SMS gateway is not configured'), { statusCode: 503 });
      }
      console.warn(`[auth] no SMS gateway configured; OTP for ...${phone.slice(-4)} is ${code}`);
      return { delivered: false, channel: 'console' };
    }

    const result = await sendSms(
      { to: phone, message: `${code} is your Khozo verification code. It expires in 10 minutes. Never share it.` },
      { settings }
    );
    if (!result.sent) {
      throw Object.assign(new Error(`SMS gateway returned ${result.status ?? 'no answer'}`), { statusCode: 502 });
    }
    return { delivered: true, channel: 'sms' };
  }

  // The fields each public write takes, and what each must be (readFields in
  // shared/case-domain.js). A field sent as an object is refused, not stored.
  const REGISTER_FIELDS = {
    name: ['text', 120],
    email: ['text', 160],
    password: 'secret',
    role: ['text', 40],
    phone: ['text', 20],
    otp: ['text', 12],
    org: ['text', 120],
    state: ['text', 80],
    district: ['text', 80],
    station: ['text', 120],
  };

  router.post('/otp/start', registerLimit, async (req, res) => {
    const read = readFields(req.body, { phone: ['text', 20] });
    if (read.error) return res.status(400).json({ error: read.error });
    const phone = otpKey(read.body.phone);
    if (!/^\d{7,15}$/.test(phone)) return res.status(400).json({ error: 'Mobile number must be 7 to 15 digits' });
  
    const code = generateOtp();
    const expiresAt = Date.now() + OTP_TTL_MS;
  
    let delivery;
    try {
      delivery = await deliverOtp(phone, code);
    } catch (err) {
      addAudit({
        actorName: 'Public OTP portal',
        actorRole: 'public',
        action: 'auth.otp_delivery_failed',
        targetType: 'otp',
        summary: 'OTP could not be delivered',
        metadata: { phoneSuffix: phone.slice(-4), reason: err.message },
      });
      return res.status(err.statusCode || 502).json({ error: 'Could not send the verification code. Please try again later.' });
    }
  
    // Stored only after delivery succeeds, so a failed send cannot leave a live code.
    otpStore.set(phone, { code, expiresAt, attempts: 0 });
    addAudit({
      actorName: 'Public OTP portal',
      actorRole: 'public',
      action: 'auth.otp_started',
      targetType: 'otp',
      summary: 'Started public registration OTP verification',
      metadata: { phoneSuffix: phone.slice(-4), expiresAt, channel: delivery.channel },
    });
    res.json({
      ok: true,
      expiresAt,
      delivery: delivery.channel,
      // Development convenience only — never reachable with NODE_ENV=production.
      ...(settings.nodeEnv !== 'production' && !delivery.delivered ? { demoOtp: code } : {}),
    });
  });
  
  /**
   * Whether sign-up asks for an SMS code. It does whenever an SMS gateway is
   * configured, and in development, where the code is shown on screen. On a
   * live server with no gateway (khozo.org until one is connected, DPIA G6)
   * the code could never arrive and nobody could sign up at all, so there the
   * account is made without it and its number is recorded as not verified.
   * Connecting a gateway brings the code back with no change here.
   */
  function otpRequired() {
    return smsGatewayConfigured(settings) || settings.nodeEnv !== 'production';
  }

  /** What the sign-up form must ask for. */
  router.get('/signup-options', (req, res) => {
    res.json({ otp: otpRequired() });
  });

  router.post('/register', registerLimit, async (req, res) => {
    const read = readFields(req.body, REGISTER_FIELDS);
    if (read.error) return res.status(400).json({ error: read.error });
    const { name, password, phone, otp, org, state, district, station } = read.body;
    // Optional: the mobile number, verified by OTP below, is the account.
    const email = emailOf(read.body.email);
    const role = read.body.role || 'parent';
    if (!name || !password)
      return res.status(400).json({ error: 'Name, mobile number and password are required' });
    if (!PUBLIC_ROLES.includes(role)) {
      addAudit({
        actorName: email || (phone ? `mobile ...${digits(phone).slice(-4)}` : 'Unknown registrant'),
        actorRole: 'public',
        action: 'auth.privileged_registration_blocked',
        targetType: 'user',
        summary: `Blocked public registration attempt for role ${role}`,
        metadata: { requestedRole: role, email },
      });
      return res.status(403).json({ error: 'Police and government accounts must be provisioned by an administrator' });
    }
    if (email && !looksLikeEmail(email)) return res.status(400).json({ error: 'That email address does not look right. Correct it, or leave it empty.' });
    if (email && findUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists' });
    const cleanPhone = otpKey(phone);
    if (!/^\d{7,15}$/.test(cleanPhone)) return res.status(400).json({ error: 'Mobile number is required for OTP verification' });
    // Without an SMS gateway on a live server, the number is taken as given
    // and recorded as not verified (otpRequired above).
    const verified = otpRequired();
    if (verified) {
      const challenge = otpStore.get(cleanPhone);
      if (!challenge || challenge.expiresAt < Date.now()) return res.status(400).json({ error: 'OTP verification is required before registration' });
      challenge.attempts += 1;
      if (challenge.attempts > 5 || String(otp || '').trim() !== challenge.code) {
        otpStore.set(cleanPhone, challenge);
        addAudit({
          actorName: email || `mobile ...${cleanPhone.slice(-4)}`,
          actorRole: 'public',
          action: 'auth.otp_failed',
          targetType: 'otp',
          summary: 'Public registration OTP verification failed',
          metadata: { phoneSuffix: cleanPhone.slice(-4), attempts: challenge.attempts },
        });
        return res.status(400).json({ error: 'OTP verification failed' });
      }
      otpStore.delete(cleanPhone);
    }

    // One citizen account per mobile number: it is how an account without an
    // email signs in. Checked only after the OTP, so that nobody can learn
    // whether a number has an account without holding that phone (with no
    // gateway there is no OTP, and this can be learnt; so can much else
    // about a number nobody has checked). An official
    // desk sharing the number does not block it (the password tells the two
    // apart at sign-in).
    if (usersByPhone(cleanPhone).some((u) => PUBLIC_ROLES.includes(u.role))) {
      return res.status(409).json({ error: 'An account with this mobile number already exists. Sign in instead.', code: 'phone_taken' });
    }
  
    const levelByRole = {
      super_admin: 'national',
      admin: 'state',
      state_nodal: 'state',
      crime_bureau: 'state',
      police: 'station',
      sjpu: 'district',
      cwc: 'district',
      dcpu: 'district',
      rpf: 'station',
      cci: 'district',
      jjb: 'district',
      parent: 'citizen',
      ngo: 'citizen',
    };
    const user = addUser({
      id: `u_${nanoid(8)}`,
      name,
      email,
      passwordHash: hashPassword(password),
      role,
      phone: cleanPhone,
      // Officers verifying this person's report see whether the number was
      // checked by SMS; one that was not, they confirm by calling it.
      phoneVerified: verified,
      phoneVerifiedAt: verified ? Date.now() : null,
      org: org || null,
      jurisdiction: { level: levelByRole[role], state: state || null, district: district || null, station: station || null },
      createdAt: Date.now(),
    });
    addAudit({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'auth.public_user_registered',
      targetType: 'user',
      targetId: user.id,
      summary: verified ? `Public ${role} account registered` : `Public ${role} account registered; mobile not verified (no SMS service)`,
      scope: { state, district },
      metadata: { phoneVerified: verified, phoneSuffix: cleanPhone.slice(-4), withEmail: Boolean(email) },
    });
    const token = await tokenFor(res, user);
    if (!token) return;
    res.status(201).json({ token, user: publicUser(user) });
  });
  
  router.post('/login', loginLimit, async (req, res) => {
    const read = readFields(req.body, { email: ['text', 160], phone: ['text', 20], password: 'secret' });
    if (read.error) return res.status(400).json({ error: read.error });
    const { password } = read.body;
    // One box takes either: an email address, or the mobile number a citizen
    // signed up with. (The field is still called `email`, which the Android
    // app sends.)
    const login = String(read.body.email || read.body.phone || '').trim();
    let user = null;
    if (login.includes('@')) {
      user = findUserByEmail(login.toLowerCase()) || null;
    } else if (/^\d{7,15}$/.test(normalisePhone(login))) {
      const holders = usersByPhone(login);
      if (holders.length === 1) {
        user = holders[0];
      } else if (holders.length > 1) {
        // Desks can share a station's phone, and a citizen may share it too.
        // The password says whose account this is. Each check costs a bcrypt
        // comparison (tens of milliseconds of CPU, which the Worker's plan
        // limits), so at most two accounts are tried: citizens first, since
        // they are the ones who sign in by number. Two matches, or more
        // holders than were tried with none matching, means the email is
        // needed: every desk account has one.
        const ordered = [...holders.filter((u) => PUBLIC_ROLES.includes(u.role)), ...holders.filter((u) => !PUBLIC_ROLES.includes(u.role))];
        const tried = ordered.slice(0, 2);
        const matching = tried.filter((u) => u.passwordHash && bcrypt.compareSync(password || '', u.passwordHash));
        if (matching.length > 1 || (matching.length === 0 && ordered.length > tried.length)) {
          return res.status(409).json({ error: 'More than one account uses this mobile number. Sign in with your email address instead.', code: 'phone_shared' });
        }
        user = matching[0] || null;
      }
    }
    // An account made from a sheet has no password until its officer opens
    // the activation link (POST /activate below).
    if (user && !user.passwordHash && user.activation) {
      return res.status(403).json({ error: 'This account is not active yet. Open the activation link you were sent to set your password, or ask your state desk for a new one.', code: 'activation_required' });
    }
    if (!user || !user.passwordHash || !bcrypt.compareSync(password || '', user.passwordHash))
      return res.status(401).json({ error: 'Wrong email, mobile number or password' });
    // Signed first: a server that cannot sign changes nothing.
    const token = await tokenFor(res, user);
    if (!token) return;
    // A hash made at a lower work factor is replaced while the password is
    // in hand; nobody has to reset anything.
    let current = user;
    try {
      if (bcrypt.getRounds(user.passwordHash) < BCRYPT_COST) {
        current = updateUser(user.id, { passwordHash: hashPassword(password) }) || user;
      }
    } catch {
      // An unreadable hash still verified above; leave it as it is.
    }
    res.json({ token, user: publicUser(current) });
  });
  
  // --- Activation -----------------------------------------------------------
  //
  // An account made from a sheet (POST /api/dashboard/network/users/bulk) is
  // activated by its officer: the one-time link they were sent names the
  // account and carries a code, valid for a week (shared/bulk-accounts.js).
  // Opening it sets their own password and signs them in. Limited per
  // network address, so the codes cannot be guessed at speed.
  const activateLimit = fixedWindowRateLimit({
    name: 'auth_activate',
    limit: 20,
    envLimit: settings.activateLimit,
    key: (req) => clientIp(req),
    onLimit: auditPublicRateLimit,
  });

  function activationTarget(req) {
    const read = readFields(req.body, { email: ['text', 160], code: ['text', 80] });
    if (read.error) return { status: 400, error: read.error };
    const user = findUserByEmail(String(read.body.email || '').trim().toLowerCase());
    const state = checkActivation(user, read.body.code);
    if (state === 'expired') return { status: 410, error: 'This activation link has expired. Ask your state desk to send a new one.', code: 'activation_expired' };
    if (state !== 'ok') return { status: 404, error: 'This activation link is not valid, or the account is already active. Sign in instead.', code: 'activation_invalid' };
    return { user };
  }

  /** Whether a link still works, and whose account it is, before the password form. */
  router.post('/activate/check', activateLimit, (req, res) => {
    const target = activationTarget(req);
    if (target.error) return res.status(target.status).json({ error: target.error, code: target.code });
    const u = target.user;
    res.json({
      name: u.name,
      email: u.email,
      role: u.role,
      place: [u.jurisdiction?.station, u.jurisdiction?.district, u.jurisdiction?.state].filter(Boolean).join(', '),
      expiresAt: u.activation.expiresAt,
    });
  });

  router.post('/activate', activateLimit, async (req, res) => {
    const target = activationTarget(req);
    if (target.error) return res.status(target.status).json({ error: target.error, code: target.code });
    const read = readFields(req.body, { password: 'secret' });
    if (read.error) return res.status(400).json({ error: read.error });
    const password = String(read.body.password || '');
    if (password.length < 8) return res.status(400).json({ error: 'The password must be at least 8 characters' });
    const user = updateUser(target.user.id, {
      passwordHash: hashPassword(password),
      activation: null,
      activatedAt: Date.now(),
      passwordChangedAt: Date.now(),
      mustChangePassword: false,
    });
    addAudit({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'auth.account_activated',
      targetType: 'user',
      targetId: user.id,
      summary: 'Officer activated their account and set a password',
      scope: { state: user.jurisdiction?.state || null, district: user.jurisdiction?.district || null },
      metadata: { issuedById: target.user.activation?.issuedById || null },
    });
    const token = await tokenFor(res, user);
    if (!token) return;
    res.json({ token, user: publicUser(user) });
  });

  router.get('/me', authRequired, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  // A signed-in user may correct how they are named. Only the two display
  // fields the header prints; role, jurisdiction and email stay provisioning
  // decisions. This exists because an account's stored name is otherwise
  // uneditable through the app -- the only user route provisions new ones --
  // and a console that announces "National Command Centre" to a State
  // Department is a name nobody could change without a database session.
  router.post('/me/profile', authRequired, (req, res) => {
    const read = readFields(req.body, { name: ['text', 400], org: ['text', 400] });
    if (read.error) return res.status(400).json({ error: read.error });
    const tidy = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
    const patch = {};
    if (req.body?.name !== undefined) {
      const name = tidy(req.body.name, 80);
      if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
      patch.name = name;
    }
    if (req.body?.org !== undefined) patch.org = tidy(req.body.org, 120) || null;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
    const before = { name: req.user.name, org: req.user.org || null };
    updateUser(req.user.id, patch);
    const user = { ...req.user, ...patch };
    addAudit({
      actorId: req.user.id,
      actorName: user.name,
      actorRole: req.user.role,
      action: 'account.profile_updated',
      targetType: 'user',
      targetId: req.user.id,
      summary: `Updated own display name/organisation`,
      scope: { state: req.user.jurisdiction?.state || null, district: req.user.jurisdiction?.district || null },
      metadata: { before, after: { name: user.name, org: user.org || null } },
    });
    res.json({ user: publicUser(user) });
  });
  
  router.post('/change-password', authRequired, async (req, res) => {
    const read = readFields(req.body, { currentPassword: 'secret', newPassword: 'secret' });
    if (read.error) return res.status(400).json({ error: read.error });
    const { currentPassword, newPassword } = read.body;
    const nextPassword = String(newPassword || '');
    if (!bcrypt.compareSync(currentPassword || '', req.user.passwordHash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (nextPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    if (bcrypt.compareSync(nextPassword, req.user.passwordHash)) {
      return res.status(400).json({ error: 'New password must be different from the current password' });
    }
  
    // A new password signs out every other session: whoever had the old
    // password, or a token from a lost phone, is out (DPIA G9). This session
    // gets a fresh token in the response.
    const user = updateUser(req.user.id, {
      passwordHash: hashPassword(nextPassword),
      mustChangePassword: false,
      passwordChangedAt: Date.now(),
      tokenVersion: Number(req.user.tokenVersion || 0) + 1,
    });
    addAudit({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'auth.password_changed',
      targetType: 'user',
      targetId: user.id,
      summary: 'User changed their password',
      scope: {
        state: user.jurisdiction?.state || null,
        district: user.jurisdiction?.district || null,
      },
      metadata: { forcedChangeCompleted: Boolean(req.user.mustChangePassword), otherSessionsSignedOut: true },
    });
    const token = await tokenFor(res, user);
    if (!token) return;
    res.json({ token, user: publicUser(user) });
  });

  // Signs this account out on every device, this one included: for a lost or
  // shared phone. The caller signs in again.
  router.post('/logout-all', authRequired, (req, res) => {
    const user = updateUser(req.user.id, { tokenVersion: Number(req.user.tokenVersion || 0) + 1 });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'auth.sessions_revoked',
      targetType: 'user',
      targetId: req.user.id,
      summary: 'User signed out of every session',
      scope: { state: req.user.jurisdiction?.state || null, district: req.user.jurisdiction?.district || null },
      metadata: { tokenVersion: user?.tokenVersion ?? null },
    });
    res.json({ ok: true });
  });
  

  return router;
}
