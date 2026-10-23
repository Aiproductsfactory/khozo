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
import registerGeoRoutes from '../shared/routes/geo.js';

import { createRouter, handleRequest } from './src/http/router.js';
import {
  createAuth,
  createAuditPublicRateLimit,
  clientIp,
  fixedWindowRateLimit,
} from './src/http/express-compat.js';
import { createRequestStore, tablesForRequest } from './src/store-sync.js';
import { checkDatabase, scheduled as runScheduledChecks } from './src/ops.js';
import { compareFramesWithCase, detectPerson, matchEngineInfo, probeMatchProviders, rankMatches, rankSightingMatches } from './src/match.js';
import { createFaceIndex } from '../shared/face-index.js';
import { humanCheckConfig } from '../shared/human-check.js';
import { privacySecrets } from '../shared/privacy.js';

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
  const secrets = privacySecrets(env);
  const auditPublicRateLimit = createAuditPublicRateLimit(store, secrets.rateLimitAuditSalt);

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
    // The reverse search links a sighting only if the database still holds
    // what this request's replica read seconds earlier (store-sync.js).
    claimFoundReport: store.claimFoundReport,
    claimReport: store.claimReport,
    listGrievances: store.listGrievances,
    findGrievance: store.findGrievance,
    addGrievance: store.addGrievance,
    updateGrievance: store.updateGrievance,
    // CCTV checks from the desktop app (shared/video-jobs.js).
    listVideoJobs: store.listVideoJobs,
    findVideoJob: store.findVideoJob,
    addVideoJob: store.addVideoJob,
    updateVideoJob: store.updateVideoJob,
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
    deletePhoto: store.deletePhoto,
    rewriteActivity: store.rewriteActivity,
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
    // The reverse search also compares open found-child intakes, so it is
    // given the cases too.
    rankSightingMatches: (photoBuf, hints) =>
      rankSightingMatches(env, photoBuf, hints, { foundReports: store.listFoundReports(), reports: store.listReports(), readPhoto: store.readPhoto }),
    matchEngineInfo: () => matchEngineInfo(env),
    probeMatchProviders: (photoBuf) => probeMatchProviders(env, photoBuf),
    detectPerson: (photoBuf) => detectPerson(env, photoBuf),
    // Faces from a video, each compared with one case (POST /reports/:id/video-search).
    compareFramesWithCase: (casePhotoBuf, frames, options) => compareFramesWithCase(env, casePhotoBuf, frames, options),
    // The one-to-many index: none unless AARAKSHAK_GALLERY_URL and
    // AARAKSHAK_GALLERY_KEY are set (shared/face-index.js).
    faceIndex: createFaceIndex(env),

    // Multipart is parsed by the router shim, so `upload.single` is a no-op that
    // keeps the shared route signatures unchanged.
    upload: { single: () => (_req, _res, next) => next() },

    settings: {
      nodeEnv: env.NODE_ENV || 'production',
      foundReportLimit: env.KHOZO_FOUND_REPORT_LIMIT,
      unverifiedFoundReportLimit: env.KHOZO_UNVERIFIED_FOUND_REPORT_LIMIT,
      // Cloudflare Turnstile on the public sighting form; off unless
      // TURNSTILE_SITE_KEY, TURNSTILE_SECRET and TURNSTILE_HOSTNAMES are set
      // (shared/human-check.js).
      humanCheck: humanCheckConfig(env),
      caseStatusLimit: env.KHOZO_CASE_STATUS_LIMIT,
      sightingStatusLimit: env.KHOZO_SIGHTING_STATUS_LIMIT,
      bulletinLimit: env.KHOZO_BULLETIN_LIMIT,
      videoSearchLimit: env.KHOZO_VIDEO_SEARCH_LIMIT,
      // The desktop app's requests a quarter-hour, and the faces one check may send.
      desktopJobLimit: env.KHOZO_DESKTOP_JOB_LIMIT,
      desktopJobFaces: env.KHOZO_DESKTOP_JOB_FACES,
      directoryLimit: env.KHOZO_DIRECTORY_LIMIT,
      registerLimit: env.KHOZO_REGISTER_LIMIT,
      loginLimit: env.KHOZO_LOGIN_LIMIT,
      otpLimit: env.KHOZO_OTP_LIMIT,
      grievanceLimit: env.KHOZO_GRIEVANCE_LIMIT,
      grievanceStatusLimit: env.KHOZO_GRIEVANCE_STATUS_LIMIT,
      smsGatewayUrl: env.KHOZO_SMS_GATEWAY_URL,
      smsApiKey: env.KHOZO_SMS_API_KEY,
      // Expo's push service needs no key; with "enhanced push security" on
      // in the Expo project it needs this one (shared/station-alerts.js).
      expoAccessToken: env.EXPO_ACCESS_TOKEN,
      // The export-signing key, the Aadhaar fingerprint key and the
      // rate-limit audit salt: each set explicitly, or derived from the JWT
      // secret, never a constant from this repository (shared/privacy.js).
      exportSigning: secrets.exportSigning,
      fieldHashKey: secrets.fieldHashKey,
      fieldHashKeyDerived: secrets.fieldHashKeyDerived,
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

/**
 * Serves /child/:id: always the plain SPA document, with the site's default
 * share card.
 *
 * This path once rewrote the document's <head> with a published case's name,
 * age, photograph and JSON-LD, so a case link previewed in WhatsApp with the
 * child's face. The public never sees the name or photograph of a missing
 * person now (isPublicAppeal in shared/case-domain.js), so nothing about any
 * case is injected, and the case store is not even read: whatever id is in the
 * link, the preview is the same default card, and it cannot be used to learn
 * whether a case exists.
 *
 * The handler stays (and /child/* stays in run_worker_first) for one reason:
 * the asset server answers an explicit "/index.html" with a 307 to "/", and
 * passing that redirect through sent shared links to the home page instead of
 * letting the client route them. Asking for "/" returns the document itself.
 */
async function childCaseDocument(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return env.ASSETS.fetch(request);
  const assetResponse = await env.ASSETS.fetch(new Request(new URL('/', url.origin), request));
  if (assetResponse.status !== 200) return env.ASSETS.fetch(request);
  return assetResponse;
}

export default {
  // Health checks every 15 minutes and the nightly backup (worker/src/ops.js).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledChecks(event, env, ctx));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      if (/^\/child\/[^/]+\/?$/.test(url.pathname)) return childCaseDocument(request, env, url);
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    // Health means the API can reach its data: an uptime monitor pointed here
    // used to stay green through a database outage. Where no database is bound
    // (the local test shim) it answers as before.
    if (url.pathname === '/api/health') {
      if (!env?.HYPERDRIVE) return json({ ok: true, service: 'khozo-worker-api' });
      const database = await checkDatabase(env, ctx);
      return json({ ok: database.ok, service: 'khozo-worker-api', database: database.ok ? 'ok' : 'unreachable' }, database.ok ? 200 : 503);
    }

    // The gazetteer's state and district lists read no store, so they are
    // answered without loading one: every other mount hydrates the whole case
    // store per request, which is the Worker's main CPU cost.
    if (url.pathname === '/api/geo' || url.pathname.startsWith('/api/geo/')) {
      const response = await handleRequest(registerGeoRoutes(createRouter()), request, { basePath: '/api/geo' });
      return response ? withCors(response) : json({ error: `No route for ${request.method} ${url.pathname}` }, 404);
    }

    const mount = MOUNTS.find(([base]) => url.pathname === base || url.pathname.startsWith(`${base}/`));
    if (!mount) return json({ error: `No route for ${request.method} ${url.pathname}` }, 404);

    const [basePath, register] = mount;

    let flush = null;
    try {
      // The alert inbox poll loads only the accounts table (store-sync.js).
      const requestStore = await createRequestStore(env, ctx, undefined, {
        tables: tablesForRequest(request.method, url.pathname),
      });
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
