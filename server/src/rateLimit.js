import crypto from 'node:crypto';
import { addAudit } from './store.js';

const DEFAULT_WINDOW_MS = Number(process.env.KHOZO_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function identityHash(identity) {
  const salt = process.env.KHOZO_RATE_LIMIT_AUDIT_SALT || 'khozo-demo-rate-limit-audit';
  return crypto.createHash('sha256').update(`${salt}:${identity || 'unknown'}`).digest('hex');
}

function routeTemplate(req) {
  const base = String(req.baseUrl || '');
  const path = req.route?.path;
  if (typeof path === 'string') return `${base}${path}`;
  return base || 'public-route';
}

export function auditPublicRateLimit(req, event) {
  addAudit({
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
      route: routeTemplate(req),
    },
  });
}

export function fixedWindowRateLimit({ name, limit, envLimit, windowMs = DEFAULT_WINDOW_MS, key, onLimit }) {
  const max = positiveInt(envLimit, limit);
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const identity = key ? key(req) : clientIp(req);
    const bucketKey = `${name}:${identity || clientIp(req)}`;
    const current = hits.get(bucketKey);
    const bucket = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + windowMs };

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

export { clientIp };
