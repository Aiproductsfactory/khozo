import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { findUserByEmail, addUser, addAudit, updateUser } from '../store.js';
import { signToken, publicUser, authRequired } from '../auth.js';
import { auditPublicRateLimit, clientIp, fixedWindowRateLimit } from '../rateLimit.js';

const router = Router();

const PUBLIC_ROLES = ['parent', 'ngo'];
const OTP_TTL_MS = 10 * 60 * 1000;
const otpStore = new Map();
const registerLimit = fixedWindowRateLimit({
  name: 'auth_register',
  limit: 8,
  envLimit: process.env.KHOZO_REGISTER_LIMIT,
  key: (req) => clientIp(req),
  onLimit: auditPublicRateLimit,
});
const loginLimit = fixedWindowRateLimit({
  name: 'auth_login',
  limit: 12,
  envLimit: process.env.KHOZO_LOGIN_LIMIT,
  key: (req) => `${clientIp(req)}:${String(req.body?.email || '').trim().toLowerCase()}`,
  onLimit: auditPublicRateLimit,
});

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function otpKey(phone) {
  return digits(phone);
}

function demoOtp(phone) {
  const clean = otpKey(phone);
  if (!clean) return '';
  return clean.slice(-6).padStart(6, '0');
}

router.post('/otp/start', registerLimit, (req, res) => {
  const phone = otpKey(req.body?.phone);
  if (!/^\d{7,15}$/.test(phone)) return res.status(400).json({ error: 'Mobile number must be 7 to 15 digits' });
  const code = demoOtp(phone);
  const expiresAt = Date.now() + OTP_TTL_MS;
  otpStore.set(phone, { code, expiresAt, attempts: 0 });
  addAudit({
    actorName: 'Public OTP portal',
    actorRole: 'public',
    action: 'auth.otp_started',
    targetType: 'otp',
    summary: 'Started public registration OTP verification',
    metadata: { phoneSuffix: phone.slice(-4), expiresAt },
  });
  res.json({
    ok: true,
    expiresAt,
    delivery: 'demo_sms',
    ...(process.env.NODE_ENV !== 'production' ? { demoOtp: code } : {}),
  });
});

router.post('/register', registerLimit, (req, res) => {
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
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', loginLimit, (req, res) => {
  const { email, password } = req.body || {};
  const user = findUserByEmail(email || '');
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash))
    return res.status(401).json({ error: 'Invalid email or password' });
  res.json({ token: signToken(user), user: publicUser(user) });
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

export default router;
