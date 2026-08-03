import { Hono } from 'hono';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { findUserByEmail, addUser, addAudit, updateUser } from '../store.js';
import { signToken, publicUser, authRequired } from '../auth.js';
import { auditPublicRateLimit, clientIp, fixedWindowRateLimit } from '../rateLimit.js';

const app = new Hono();

const PUBLIC_ROLES = ['parent', 'ngo'];
const OTP_TTL_MS = 10 * 60 * 1000;
const otpStore = new Map();

const registerLimit = fixedWindowRateLimit({
  name: 'auth_register',
  limit: 8,
  key: (c) => clientIp(c),
  onLimit: auditPublicRateLimit,
});

const loginLimit = fixedWindowRateLimit({
  name: 'auth_login',
  limit: 20,
  key: (c) => clientIp(c),
  onLimit: auditPublicRateLimit,
});

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function otpKey(phone) {
  return digits(phone);
}

function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

async function deliverOtp(env, phone, code) {
  const gateway = env?.KHOZO_SMS_GATEWAY_URL;
  const apiKey = env?.KHOZO_SMS_API_KEY;

  if (!gateway || !apiKey) {
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

app.post('/otp/start', registerLimit, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const phone = otpKey(body?.phone);
  if (!/^\d{7,15}$/.test(phone)) return c.json({ error: 'Mobile number must be 7 to 15 digits' }, 400);

  const code = generateOtp();
  const expiresAt = Date.now() + OTP_TTL_MS;

  let delivery;
  try {
    delivery = await deliverOtp(c.env, phone, code);
  } catch (err) {
    await addAudit(c.env, {
      actorName: 'Public OTP portal',
      actorRole: 'public',
      action: 'auth.otp_delivery_failed',
      targetType: 'otp',
      summary: 'OTP could not be delivered',
      metadata: { phoneSuffix: phone.slice(-4), reason: err.message },
    });
    return c.json({ error: 'Could not send the verification code. Please try again later.' }, err.statusCode || 502);
  }

  otpStore.set(phone, { code, expiresAt, attempts: 0 });
  await addAudit(c.env, {
    actorName: 'Public OTP portal',
    actorRole: 'public',
    action: 'auth.otp_started',
    targetType: 'otp',
    summary: 'Started public registration OTP verification',
    metadata: { phoneSuffix: phone.slice(-4), expiresAt, channel: delivery.channel },
  });
  return c.json({
    ok: true,
    expiresAt,
    delivery: delivery.channel,
    demoOtp: delivery.delivered ? undefined : code,
  });
});

app.post('/register', registerLimit, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { name, email, password, role = 'parent', phone, otp, org, state, district, station } = body;
  if (!name || !email || !password) {
    return c.json({ error: 'Name, email and password are required' }, 400);
  }
  if (!PUBLIC_ROLES.includes(role)) {
    await addAudit(c.env, {
      actorName: email || 'Unknown registrant',
      actorRole: 'public',
      action: 'auth.privileged_registration_blocked',
      targetType: 'user',
      summary: `Blocked public registration attempt for role ${role}`,
      metadata: { requestedRole: role, email },
    });
    return c.json({ error: 'Police and government accounts must be provisioned by an administrator' }, 403);
  }

  const existing = await findUserByEmail(c.env, email);
  if (existing) return c.json({ error: 'An account with this email already exists' }, 409);

  const cleanPhone = otpKey(phone);
  if (!/^\d{7,15}$/.test(cleanPhone)) return c.json({ error: 'Mobile number is required for OTP verification' }, 400);
  const challenge = otpStore.get(cleanPhone);
  if (!challenge || challenge.expiresAt < Date.now()) return c.json({ error: 'OTP verification is required before registration' }, 400);
  challenge.attempts += 1;
  if (challenge.attempts > 5 || String(otp || '').trim() !== challenge.code) {
    otpStore.set(cleanPhone, challenge);
    await addAudit(c.env, {
      actorName: email || 'Unknown registrant',
      actorRole: 'public',
      action: 'auth.otp_failed',
      targetType: 'otp',
      summary: 'Public registration OTP verification failed',
      metadata: { phoneSuffix: cleanPhone.slice(-4), attempts: challenge.attempts },
    });
    return c.json({ error: 'OTP verification failed' }, 400);
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

  const user = await addUser(c.env, {
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

  await addAudit(c.env, {
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

  const token = await signToken(c.env, user);
  return c.json({ token, user: publicUser(user) }, 201);
});

app.post('/login', loginLimit, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, password } = body;
  console.log('[Worker Login Attempt]', { email, hasPassword: Boolean(password) });
  const user = await findUserByEmail(c.env, email || '');
  console.log('[Worker User Found]', user ? { id: user.id, email: user.email, hasHash: Boolean(user.passwordHash) } : null);
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }
  const token = await signToken(c.env, user);
  return c.json({ token, user: publicUser(user) });
});

app.get('/me', authRequired, (c) => {
  const user = c.get('user');
  return c.json({ user: publicUser(user) });
});

app.post('/change-password', authRequired, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { currentPassword, newPassword } = body;
  const currentUser = c.get('user');
  const nextPassword = String(newPassword || '');

  if (!bcrypt.compareSync(currentPassword || '', currentUser.passwordHash)) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }
  if (nextPassword.length < 8) {
    return c.json({ error: 'New password must be at least 8 characters' }, 400);
  }
  if (bcrypt.compareSync(nextPassword, currentUser.passwordHash)) {
    return c.json({ error: 'New password must be different from the current password' }, 400);
  }

  const updatedUser = await updateUser(c.env, currentUser.id, {
    passwordHash: bcrypt.hashSync(nextPassword, 8),
    mustChangePassword: false,
    passwordChangedAt: Date.now(),
  });

  await addAudit(c.env, {
    actorId: updatedUser.id,
    actorName: updatedUser.name,
    actorRole: updatedUser.role,
    action: 'auth.password_changed',
    targetType: 'user',
    targetId: updatedUser.id,
    summary: 'User changed their password',
    scope: {
      state: updatedUser.jurisdiction?.state || null,
      district: updatedUser.jurisdiction?.district || null,
    },
    metadata: { forcedChangeCompleted: Boolean(currentUser.mustChangePassword) },
  });

  return c.json({ user: publicUser(updatedUser) });
});

export default app;
