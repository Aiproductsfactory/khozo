/**
 * Sign-in, public self-registration (with phone OTP) and password change.
 *
 * Registered by both runtimes against their own router — see
 * shared/routes/reports.js for how the `deps` contract works.
 */

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

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

export default function registerAuthRoutes(router, deps) {
  const {
    findUserByEmail, addUser, addAudit, updateUser,
    signToken, publicUser, authRequired,
    auditPublicRateLimit, clientIp, fixedWindowRateLimit,
    settings = {},
  } = deps;


  
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
  
  function otpKey(phone) {
    return digits(phone);
  }
  
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
    const gateway = settings.smsGatewayUrl;
    const apiKey = settings.smsApiKey;
  
    if (!gateway || !apiKey) {
      if (settings.nodeEnv === 'production') {
        throw Object.assign(new Error('SMS gateway is not configured'), { statusCode: 503 });
      }
      console.warn(`[auth] no SMS gateway configured; OTP for ...${phone.slice(-4)} is ${code}`);
      return { delivered: false, channel: 'console' };
    }
  
    const res = await fetch(gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        to: phone,
        message: `${code} is your Khozo verification code. It expires in 10 minutes. Never share it.`,
      }),
    });
    if (!res.ok) throw Object.assign(new Error(`SMS gateway returned ${res.status}`), { statusCode: 502 });
    return { delivered: true, channel: 'sms' };
  }
  
  router.post('/otp/start', registerLimit, async (req, res) => {
    const phone = otpKey(req.body?.phone);
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
  
  router.post('/register', registerLimit, async (req, res) => {
    const { name, email, password, role = 'parent', phone, otp, org, state, district, station } = req.body || {};
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required' });
    if (!PUBLIC_ROLES.includes(role)) {
      addAudit({
        actorName: email || 'Unknown registrant',
        actorRole: 'public',
        action: 'auth.privileged_registration_blocked',
        targetType: 'user',
        summary: `Blocked public registration attempt for role ${role}`,
        metadata: { requestedRole: role, email },
      });
      return res.status(403).json({ error: 'Police and government accounts must be provisioned by an administrator' });
    }
    if (findUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists' });
    const cleanPhone = otpKey(phone);
    if (!/^\d{7,15}$/.test(cleanPhone)) return res.status(400).json({ error: 'Mobile number is required for OTP verification' });
    const challenge = otpStore.get(cleanPhone);
    if (!challenge || challenge.expiresAt < Date.now()) return res.status(400).json({ error: 'OTP verification is required before registration' });
    challenge.attempts += 1;
    if (challenge.attempts > 5 || String(otp || '').trim() !== challenge.code) {
      otpStore.set(cleanPhone, challenge);
      addAudit({
        actorName: email || 'Unknown registrant',
        actorRole: 'public',
        action: 'auth.otp_failed',
        targetType: 'otp',
        summary: 'Public registration OTP verification failed',
        metadata: { phoneSuffix: cleanPhone.slice(-4), attempts: challenge.attempts },
      });
      return res.status(400).json({ error: 'OTP verification failed' });
    }
    otpStore.delete(cleanPhone);
  
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
      passwordHash: bcrypt.hashSync(password, 8),
      role,
      phone: cleanPhone,
      phoneVerified: true,
      phoneVerifiedAt: Date.now(),
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
      summary: `Public ${role} account registered`,
      scope: { state, district },
      metadata: { phoneVerified: true, phoneSuffix: cleanPhone.slice(-4) },
    });
    res.status(201).json({ token: await signToken(user), user: publicUser(user) });
  });
  
  router.post('/login', loginLimit, async (req, res) => {
    const { email, password } = req.body || {};
    const user = findUserByEmail(email || '');
    if (!user || !bcrypt.compareSync(password || '', user.passwordHash))
      return res.status(401).json({ error: 'Invalid email or password' });
    res.json({ token: await signToken(user), user: publicUser(user) });
  });
  
  router.get('/me', authRequired, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });
  
  router.post('/change-password', authRequired, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
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
  
    const user = updateUser(req.user.id, {
      passwordHash: bcrypt.hashSync(nextPassword, 8),
      mustChangePassword: false,
      passwordChangedAt: Date.now(),
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
      metadata: { forcedChangeCompleted: Boolean(req.user.mustChangePassword) },
    });
    res.json({ user: publicUser(user) });
  });
  

  return router;
}
