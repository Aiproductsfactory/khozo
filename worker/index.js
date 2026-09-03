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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

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
