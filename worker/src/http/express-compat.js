/**
 * Worker implementations of the middleware the shared routes expect.
 *
 * Same `(req, res, next)` contract as the Express originals in `server/src/`,
 * but built on Workers-native primitives: `jose` for JWTs (Node's
 * `jsonwebtoken` does not run here) and the per-request store replica for user
 * lookups.
 */

import * as jose from 'jose';

import { derivedSecret, identityHashWith } from '../../../shared/privacy.js';

const DEFAULT_SECRET = 'khozo-dev-secret-change-me';
const TOKEN_TTL = '7d';
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

// Per-isolate, best-effort counters. Cloudflare may run several isolates for one
// Worker, so this throttles abuse rather than enforcing an exact global quota —
// the same guarantee the single-process Express limiter gives.
const hits = new Map();

/**
 * The JWT signing key. A deployed Worker (one bound to the database) without
 * KHOZO_JWT_SECRET refuses to sign or accept tokens: the fallback is written in
 * this public repository, so accepting it would let anyone mint a super-admin
 * token. The local test shim has no database binding and keeps the fallback.
 */
function secretKey(env) {
  if (!env?.KHOZO_JWT_SECRET && env?.HYPERDRIVE) {
    throw Object.assign(new Error('KHOZO_JWT_SECRET is not set'), { code: 'JWT_SECRET_MISSING' });
  }
  return new TextEncoder().encode(env?.KHOZO_JWT_SECRET || DEFAULT_SECRET);
}

/**
 * Whether a token is still current for its user. Every token carries the
 * user's token version; changing a password (or signing out everywhere) bumps
 * it, so a token on a lost phone stops working (DPIA G9). Tokens issued before
 * versions existed carry none and count as version 0.
 */
export function tokenIsCurrent(payload, user) {
  return Number(payload?.tv || 0) === Number(user?.tokenVersion || 0);
}

export function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

/** Builds the auth middleware bound to this request's env and store replica. */
export function createAuth(env, store) {
  async function verify(token) {
    const { payload } = await jose.jwtVerify(token, secretKey(env));
    return payload;
  }

  function bearer(req) {
    const header = req.headers.authorization || '';
    return header.startsWith('Bearer ') ? header.slice(7) : null;
  }

  return {
    async signToken(user) {
      return new jose.SignJWT({ sub: user.id, role: user.role, tv: Number(user.tokenVersion || 0) })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(TOKEN_TTL)
        .sign(secretKey(env));
    },

    publicUser,

    async authRequired(req, res, next) {
      const token = bearer(req);
      if (!token) return res.status(401).json({ error: 'Authentication required' });
      try {
        const payload = await verify(token);
        const user = store.findUserById(payload.sub);
        if (!user) return res.status(401).json({ error: 'User no longer exists' });
        if (!tokenIsCurrent(payload, user)) return res.status(401).json({ error: 'This session was signed out. Sign in again.' });
        req.user = user;
        next();
      } catch (err) {
        if (err?.code === 'JWT_SECRET_MISSING') return res.status(503).json({ error: 'Sign-in is not configured on this server' });
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    },

    async optionalAuth(req, res, next) {
      const token = bearer(req);
      if (token) {
        try {
          const payload = await verify(token);
          const user = store.findUserById(payload.sub);
          if (user && tokenIsCurrent(payload, user)) req.user = user;
        } catch {
          // An unusable token on an optional route is simply anonymous access.
        }
      }
      next();
    },

    passwordChangeRequired(req, res, next) {
      if (!req.user) return res.status(401).json({ error: 'Authentication required' });
      if (req.user.mustChangePassword) {
        return res.status(403).json({
          error: 'Password change required before using operational workflows',
          code: 'PASSWORD_CHANGE_REQUIRED',
        });
      }
      next();
    },

    requireRole(...roles) {
      return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        if (!roles.includes(req.user.role)) {
          return res.status(403).json({ error: 'Insufficient permissions for this action' });
        }
        next();
      };
    },
  };
}

export function clientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.ip ||
    'unknown'
  );
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Records a throttled public request in the tamper-evident audit log.
 *
 * The identity (an IP, or an IP and a phone number) is kept as an HMAC under a
 * deployment secret. It used to be a SHA-256 under a salt written in this
 * public repository, so anyone could recover a phone number from the log by
 * hashing every number (DPIA G18).
 */
export function createAuditPublicRateLimit(store, salt = derivedSecret(DEFAULT_SECRET, 'rate-limit-audit')) {
  const identityHash = (identity) => identityHashWith(salt, identity);
  return (req, event) => {
    store.addAudit({
      actorName: 'Public endpoint',
      actorRole: 'public',
      action: 'security.public_rate_limited',
      targetType: 'publicEndpoint',
      targetId: event.name,
      summary: `Public rate limit exceeded: ${event.name}`,
      metadata: {
        limiter: event.name,
        identityHash: identityHash(event.identity),
        count: event.count,
        limit: event.limit,
        retryAfterSeconds: event.retryAfter,
        method: req.method,
        route: `${req.baseUrl || ''}${req.route?.path || ''}` || 'public-route',
      },
    });
  };
}

export function fixedWindowRateLimit({ name, limit, envLimit, windowMs = DEFAULT_WINDOW_MS, key, onLimit }) {
  const max = positiveInt(envLimit, limit);

  return (req, res, next) => {
    const now = Date.now();
    const identity = key ? key(req) : clientIp(req);
    const bucketKey = `${name}:${identity || clientIp(req)}`;
    const current = hits.get(bucketKey);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };

    bucket.count += 1;
    hits.set(bucketKey, bucket);

    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      if (onLimit) {
        onLimit(req, {
          name,
          identity: identity || clientIp(req),
          count: bucket.count,
          limit: max,
          resetAt: bucket.resetAt,
          retryAfter,
        });
      }
      return res
        .status(429)
        .setHeader('Retry-After', String(retryAfter))
        .json({ error: 'Too many attempts. Please wait before trying again.', retryAfterSeconds: retryAfter });
    }

    return next();
  };
}
