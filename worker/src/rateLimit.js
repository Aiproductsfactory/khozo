import crypto from 'node:crypto';
import { addAudit } from './store.js';

function clientIp(c) {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function identityHash(identity) {
  const salt = 'khozo-demo-rate-limit-audit';
  return crypto.createHash('sha256').update(`${salt}:${identity || 'unknown'}`).digest('hex');
}

export async function auditPublicRateLimit(c, event) {
  await addAudit(c.env, {
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
      method: c.req.method,
      route: c.req.path,
    },
  });
}

const hits = new Map();

export function fixedWindowRateLimit({ name, limit, windowMs = 15 * 60 * 1000, key, onLimit }) {
  return async (c, next) => {
    const now = Date.now();
    const identity = key ? key(c) : clientIp(c);
    const bucketKey = `${name}:${identity}`;
    const current = hits.get(bucketKey);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };

    bucket.count += 1;
    hits.set(bucketKey, bucket);

    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limit) {
      if (onLimit) {
        await onLimit(c, {
          name,
          identity,
          count: bucket.count,
          limit,
          resetAt: bucket.resetAt,
          retryAfter,
        });
      }
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'Too many attempts. Please wait before trying again.', retryAfterSeconds: retryAfter }, 429);
    }

    await next();
  };
}

export { clientIp };
