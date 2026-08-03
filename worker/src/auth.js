import * as jose from 'jose';
import { findUserById } from './store.js';

const DEFAULT_SECRET = 'khozo-dev-secret-change-me-32bytes-secret-key-ok!';

function getSecretKey(env) {
  const secretStr = env?.KHOZO_JWT_SECRET || process.env.KHOZO_JWT_SECRET || DEFAULT_SECRET;
  return new TextEncoder().encode(secretStr);
}

export const ROLE_RANK = {
  super_admin: 4,
  admin: 3,
  police: 2,
  sjpu: 2,
  ahtu: 2,
  cwc: 2,
  dcpu: 2,
  rpf: 2,
  cci: 2,
  jjb: 2,
  state_nodal: 3,
  sara: 3,
  crime_bureau: 3,
  dcrb: 2,
  dlsa: 2,
  saa: 2,
  ngo: 1,
  parent: 1,
};

export async function signToken(env, user) {
  const secretKey = getSecretKey(env);
  return new jose.SignJWT({ sub: user.id, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey);
}

export function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

export async function authRequired(c, next) {
  const header = c.req.header('Authorization') || c.req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return c.json({ error: 'Authentication required' }, 401);

  try {
    const secretKey = getSecretKey(c.env);
    const { payload } = await jose.jwtVerify(token, secretKey);
    const user = await findUserById(c.env, payload.sub);
    if (!user) return c.json({ error: 'User no longer exists' }, 401);
    c.set('user', user);
    await next();
  } catch (err) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
}

export async function optionalAuth(c, next) {
  const header = c.req.header('Authorization') || c.req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return next();
  }
  try {
    const secretKey = getSecretKey(c.env);
    const { payload } = await jose.jwtVerify(token, secretKey);
    const user = await findUserById(c.env, payload.sub);
    if (user) c.set('user', user);
  } catch {
    // Ignore token errors for optional auth
  }
  await next();
}

export async function passwordChangeRequired(c, next) {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Authentication required' }, 401);
  if (user.mustChangePassword) {
    return c.json({
      error: 'Password change required before using operational workflows',
      code: 'PASSWORD_CHANGE_REQUIRED',
    }, 403);
  }
  await next();
}

export function requireRole(...roles) {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Authentication required' }, 401);
    if (!roles.includes(user.role)) {
      return c.json({ error: 'Insufficient permissions for this action' }, 403);
    }
    await next();
  };
}
