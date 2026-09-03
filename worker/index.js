/**
 * Khozo on Cloudflare Workers: the API plus the static web app.
 *
 * The route handlers are the ones in `shared/routes/`, the same copy the
 * Express server runs. They are written against Express's `(req, res)`
 * contract, so this entrypoint supplies a Worker-side router shim, a
 * per-request synchronous store over Hyperdrive, and Workers-native auth and
 * rate limiting, then hands them over. Nothing about the API's behaviour is
 * decided here — only how those capabilities are provided.
 */

import registerAuthRoutes from '../shared/routes/auth.js';
import registerReportRoutes from '../shared/routes/reports.js';
import registerDashboardRoutes from '../shared/routes/dashboard.js';
import registerGrievanceRoutes from '../shared/routes/grievances.js';

import { createRouter, handleRequest } from './src/http/router.js';
import {
  createAuth,
  createAuditPublicRateLimit,
  clientIp,
  fixedWindowRateLimit,
} from './src/http/express-compat.js';
import { createRequestStore } from './src/store-sync.js';
// The same redaction the public list and the public case endpoint use, so the
// share preview can never carry a field those two would have withheld.
import { bulletinPayload as sharedBulletinPayload } from '../shared/case-domain.js';
import { detectPerson, matchEngineInfo, probeMatchProviders, rankMatches } from './src/match.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/**
 * Everything the shared routes reach for, resolved against this request's
 * store replica. Built per request because the store is per request.
 */
function buildDeps(env, store, ctx) {
  const auth = createAuth(env, store);
  const auditPublicRateLimit = createAuditPublicRateLimit(store);

  return {
    // Storage
    listReports: store.listReports,
    addReport: store.addReport,
    findReport: store.findReport,
    updateReport: store.updateReport,
    listFoundReports: store.listFoundReports,
    addFoundReport: store.addFoundReport,
    findFoundReport: store.findFoundReport,
    updateFoundReport: store.updateFoundReport,
    listGrievances: store.listGrievances,
    findGrievance: store.findGrievance,
    addGrievance: store.addGrievance,
    updateGrievance: store.updateGrievance,
    listUsers: store.listUsers,
    findUserById: store.findUserById,
    findUserByEmail: store.findUserByEmail,
    addUser: store.addUser,
    updateUser: store.updateUser,
    listActivity: store.listActivity,
    addActivity: store.addActivity,
    listNotifications: store.listNotifications,
    addNotification: store.addNotification,
    markNotificationsRead: store.markNotificationsRead,
    listAudit: store.listAudit,
    addAudit: store.addAudit,
    verifyAuditChain: store.verifyAuditChain,
    savePhoto: store.savePhoto,
    readPhoto: store.readPhoto,
    photoMimeType: store.photoMimeType,

    // Postgres is the only storage mode the Worker has.
    isPostgres: true,

    // Auth
    signToken: auth.signToken,
    publicUser: auth.publicUser,
    authRequired: auth.authRequired,
    optionalAuth: auth.optionalAuth,
    passwordChangeRequired: auth.passwordChangeRequired,
    requireRole: auth.requireRole,

    // Rate limiting
    auditPublicRateLimit,
    clientIp,
    fixedWindowRateLimit,

    // Face matching. The Worker has its own provider client (the AWS SDK the
    // Node build uses does not run here), so only the call shape is adapted.
    rankMatches: (photoBuf, hints) =>
      rankMatches(env, photoBuf, hints, { reports: store.listReports(), readPhoto: store.readPhoto }),
    matchEngineInfo: () => matchEngineInfo(env),
    probeMatchProviders: (photoBuf) => probeMatchProviders(env, photoBuf),
    detectPerson: (photoBuf) => detectPerson(env, photoBuf),

    // Multipart is parsed by the router shim, so `upload.single` is a no-op that
    // keeps the shared route signatures unchanged.
    upload: { single: () => (_req, _res, next) => next() },

    settings: {
      nodeEnv: env.NODE_ENV || 'production',
      foundReportLimit: env.KHOZO_FOUND_REPORT_LIMIT,
      caseStatusLimit: env.KHOZO_CASE_STATUS_LIMIT,
      sightingStatusLimit: env.KHOZO_SIGHTING_STATUS_LIMIT,
      bulletinLimit: env.KHOZO_BULLETIN_LIMIT,
      registerLimit: env.KHOZO_REGISTER_LIMIT,
      loginLimit: env.KHOZO_LOGIN_LIMIT,
      otpLimit: env.KHOZO_OTP_LIMIT,
      grievanceLimit: env.KHOZO_GRIEVANCE_LIMIT,
      grievanceStatusLimit: env.KHOZO_GRIEVANCE_STATUS_LIMIT,
      smsGatewayUrl: env.KHOZO_SMS_GATEWAY_URL,
      smsApiKey: env.KHOZO_SMS_API_KEY,
      exportSigning: {
        keyId: env.KHOZO_EXPORT_SIGNING_KEY_ID,
        key: env.KHOZO_EXPORT_SIGNING_KEY,
      },
    },
    ctx,
  };
}

const MOUNTS = [
  ['/api/auth', registerAuthRoutes],
  ['/api/reports', registerReportRoutes],
  ['/api/dashboard', registerDashboardRoutes],
  ['/api/grievances', registerGrievanceRoutes],
];

/** Escapes a value for an HTML attribute. Case data is arbitrary user text. */
function attr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Serves /child/:id with the child's own share metadata baked into the HTML.
 *
 * The site is a client-rendered SPA, so every URL shipped one identical set of
 * meta tags: a case pasted into WhatsApp — the channel this product actually
 * travels through — previewed as a bare grey link with no name and no face.
 * Crawlers do not run JavaScript, so no amount of client-side work fixes it.
 *
 * Because the Worker already runs on every request, the fix needs no rendering
 * framework: fetch the same redacted bulletin payload the public page uses,
 * rewrite the <head> of the existing document, and hand the unmodified SPA to
 * the browser to hydrate as usual.
 *
 * Failure here is never allowed to cost a person the page. Anything unexpected
 * falls through to the normal asset response, which still renders the case
 * client-side — a missing preview is a bad share, a 500 is a lost child.
 */
async function childCaseDocument(request, env, ctx, id, url) {
  const assetRequest = new Request(new URL('/index.html', url.origin), request);
  const assetResponse = await env.ASSETS.fetch(assetRequest);

  // Crawlers issue GET and HEAD; anything else has no business here.
  if (!assetResponse.ok || (request.method !== 'GET' && request.method !== 'HEAD')) return assetResponse;

  let bulletin = null;
  let flush = null;
  try {
    const requestStore = await createRequestStore(env, ctx);
    flush = requestStore.flush;
    const report = requestStore.store.findReport(id);
    const visible =
      report &&
      report.status === 'missing' &&
      report.intakeStatus !== 'pending_verification' &&
      report.bulletin?.published === true &&
      !report.anonymizedAt;
    if (visible) bulletin = sharedBulletinPayload(report);
  } catch (err) {
    console.warn('[worker] child case metadata unavailable:', err?.message || err);
  } finally {
    // Read-only path, but the store contract expects the flush either way.
    if (flush) await flush().catch(() => {});
  }

  if (!bulletin) return assetResponse;

  const name = bulletin.childName || 'A missing child';
  const agePart = bulletin.age != null && bulletin.age !== '' ? `, ${bulletin.age}` : '';
  const title = `${name}${agePart} — missing from ${bulletin.lastSeen} | Khozo`;
  const description =
    `Have you seen ${name}? Report a sighting in under a minute. ` +
    `Every appeal on Khozo is issued by ${bulletin.agency} and reviewed by an authorised officer.`;
  const canonical = `${url.origin}/child/${encodeURIComponent(bulletin.id)}`;
  const image = bulletin.photoUrl ? `${url.origin}${bulletin.photoUrl}` : `${url.origin}/assets/share-default.jpg`;

  // Person + missing-appeal structured data, so a search engine can render the
  // case as more than a blue link.
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name,
    ...(bulletin.gender ? { gender: bulletin.gender } : {}),
    image,
    url: canonical,
    description,
  });

  const head =
    `<title>${attr(title)}</title>` +
    `<meta name="description" content="${attr(description)}" />` +
    `<link rel="canonical" href="${attr(canonical)}" />` +
    `<meta property="og:type" content="article" />` +
    `<meta property="og:site_name" content="Khozo" />` +
    `<meta property="og:title" content="${attr(title)}" />` +
    `<meta property="og:description" content="${attr(description)}" />` +
    `<meta property="og:image" content="${attr(image)}" />` +
    `<meta property="og:image:alt" content="${attr(`Photograph of ${name}`)}" />` +
    `<meta property="og:url" content="${attr(canonical)}" />` +
    `<meta name="twitter:card" content="summary_large_image" />` +
    `<meta name="twitter:title" content="${attr(title)}" />` +
    `<meta name="twitter:description" content="${attr(description)}" />` +
    `<meta name="twitter:image" content="${attr(image)}" />` +
    `<script type="application/ld+json">${jsonLd.replace(/</g, '\\u003c')}</script>`;

  let html = await assetResponse.text();
  // Drop the document's own title and description so the case's own values are
  // the only ones a crawler sees.
  html = html
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name=["']description["'][^>]*>/i, '')
    .replace('</head>', `${head}</head>`);

  const headers = new Headers(assetResponse.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.delete('content-length');
  headers.delete('etag');
  // A withdrawn appeal must stop being shared quickly, so this is deliberately
  // short-lived rather than cached at the edge for hours.
  headers.set('cache-control', 'public, max-age=0, s-maxage=60');
  return new Response(html, { status: 200, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      const child = url.pathname.match(/^\/child\/([A-Za-z0-9_-]{1,64})\/?$/);
      if (child) return childCaseDocument(request, env, ctx, child[1], url);
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (url.pathname === '/api/health') return json({ ok: true, service: 'khozo-worker-api' });

    const mount = MOUNTS.find(([base]) => url.pathname === base || url.pathname.startsWith(`${base}/`));
    if (!mount) return json({ error: `No route for ${request.method} ${url.pathname}` }, 404);

    const [basePath, register] = mount;

    let flush = null;
    try {
      const requestStore = await createRequestStore(env, ctx);
      flush = requestStore.flush;

      const router = register(createRouter(), buildDeps(env, requestStore.store, ctx));
      const response = await handleRequest(router, request, { basePath });

      // Writes are flushed before the response is released: a citizen who sees
      // "sighting received" must not be told that by a Worker that then failed
      // to persist it.
      await flush();

      if (!response) return json({ error: `No route for ${request.method} ${url.pathname}` }, 404);
      return withCors(response);
    } catch (err) {
      console.error('[worker]', err?.stack || err?.message || err);
      if (flush) await flush().catch(() => {});
      return json({ error: 'Internal Server Error' }, 500);
    }
  },
};
