// Whether a public sighting was sent by a person: Cloudflare Turnstile.
//
// Off unless the runtime has all three of TURNSTILE_SITE_KEY (public, for the
// form), TURNSTILE_SECRET and TURNSTILE_HOSTNAMES (the form's own hostnames,
// comma separated; never localhost on production). The form asks
// GET /api/reports/public/human-check for the site key, so switching the check
// on or off needs no rebuild of the web app.
//
// Siteverify as Cloudflare documents it: success, the expected action and an
// approved hostname are all required, with a timeout. One deliberate
// difference from the usual "fail closed": only a token Cloudflare rejects as
// false is refused. A report with no token, or an expired one - sent later
// from a phone's offline queue, which cannot solve a challenge, or from a page
// cached before the check was switched on - and a report sent while siteverify
// cannot be reached or is misconfigured are accepted, marked on the sighting,
// and held to a stricter rate limit. A sighting of a lost child must never be
// lost to a bot check.

export const HUMAN_CHECK_ACTION = 'sighting';
export const HUMAN_CHECK_FIELD = 'cf-turnstile-response';
export const HUMAN_CHECK_FAILED = 'Could not confirm this report was sent by a person. Please try sending it again.';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// Siteverify errors that are about the deployment, not the sender: refusing
// on these would turn every reporter away because of a wrong secret.
const NOT_THE_SENDERS_FAULT = new Set(['missing-input-secret', 'invalid-input-secret', 'internal-error']);
// A token that was real but is too old, or was already redeemed: what a report
// kept in a phone's offline queue, or resent over a slow network, carries.
const EXPIRED = 'timeout-or-duplicate';

/** The check's settings from the runtime's environment, or null when it is off. */
export function humanCheckConfig(env = {}) {
  const secret = typeof env.TURNSTILE_SECRET === 'string' ? env.TURNSTILE_SECRET.trim() : '';
  const siteKey = typeof env.TURNSTILE_SITE_KEY === 'string' ? env.TURNSTILE_SITE_KEY.trim() : '';
  const hostnames = new Set(
    String(env.TURNSTILE_HOSTNAMES || '')
      .split(',')
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!secret || !siteKey || hostnames.size === 0) return null;
  return { secret, siteKey, hostnames };
}

/**
 * Redeems one token at siteverify: 'passed', 'failed' (Cloudflare rejected
 * it, or it was for another action or site), 'expired' (too old or already
 * used) or 'unavailable' (no answer, or a deployment error). A token is
 * single-use.
 */
export async function verifyHumanToken(token, { config, remoteip = null, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return 'failed';
  let result;
  try {
    const body = new URLSearchParams({ secret: config.secret, response: token });
    if (remoteip && remoteip !== 'unknown') body.set('remoteip', remoteip);
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    if (!response.ok) return 'unavailable';
    result = await response.json();
  } catch {
    return 'unavailable';
  }
  if (!result || result.success !== true) {
    const codes = Array.isArray(result?.['error-codes']) ? result['error-codes'] : [];
    if (codes.some((code) => NOT_THE_SENDERS_FAULT.has(code))) return 'unavailable';
    return codes.includes(EXPIRED) ? 'expired' : 'failed';
  }
  if (result.action !== HUMAN_CHECK_ACTION) return 'failed';
  if (!config.hostnames.has(String(result.hostname || '').toLowerCase())) return 'failed';
  return 'passed';
}

/**
 * The middleware for POST /found. Sets `req.humanCheck` to null (check off,
 * or a signed-in account, which answers for its own reports), 'passed',
 * 'missing', 'expired' or 'unavailable'; refuses only 'failed', with 403. A
 * report without a passed check goes through `strictLimit`, a tighter rate
 * limit, so a replayed or absent token buys a bot very little.
 */
export function createHumanCheck({ config, fetchImpl = globalThis.fetch, clientIp = () => null, strictLimit = null }) {
  return async (req, res, next) => {
    req.humanCheck = null;
    if (!config || req.user) return next();
    const token = req.body?.[HUMAN_CHECK_FIELD];
    const status = token == null || token === ''
      ? 'missing'
      : await verifyHumanToken(String(token), { config, remoteip: clientIp(req), fetchImpl });
    if (status === 'failed') {
      return res.status(403).json({ error: HUMAN_CHECK_FAILED, code: 'human_check_failed' });
    }
    req.humanCheck = status;
    if (status !== 'passed' && strictLimit) return strictLimit(req, res, next);
    return next();
  };
}
