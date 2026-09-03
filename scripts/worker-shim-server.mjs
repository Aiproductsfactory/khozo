/**
 * Runs the Cloudflare Worker's request stack on plain Node, so the existing API
 * smoke suite can exercise it.
 *
 * What is under test here is the Worker-only machinery: the Express-compatible
 * router shim, its multipart and query parsing, and the Workers-native auth and
 * rate-limit middleware. The route handlers are the shared ones, and storage is
 * the JSON file store — the same isolated store `api-smoke.mjs` gives the
 * Express server — so a difference in results between the two runs is a
 * difference in the shim, which is exactly what needs catching before a deploy.
 *
 * The per-request Postgres replica (worker/src/store-sync.js) is not covered
 * here; it needs a real database and is verified against the deployed API by
 * scripts/api-coverage.mjs.
 *
 *   node scripts/worker-shim-server.mjs        # PORT, KHOZO_* limits from env
 */

import http from 'node:http';

import '../server/src/env.js';

import registerAuthRoutes from '../shared/routes/auth.js';
import registerReportRoutes from '../shared/routes/reports.js';
import registerDashboardRoutes from '../shared/routes/dashboard.js';
import registerGrievanceRoutes from '../shared/routes/grievances.js';

import { createRouter, handleRequest } from '../worker/src/http/router.js';
import {
  createAuth,
  createAuditPublicRateLimit,
  clientIp,
  fixedWindowRateLimit,
} from '../worker/src/http/express-compat.js';

import * as store from '../server/src/store.js';
import { isPostgres } from '../server/src/db.js';
import { detectPerson, matchEngineInfo, rankMatches } from '../server/src/match.js';

const PORT = Number(process.env.PORT || 4500);

const MOUNTS = [
  ['/api/auth', registerAuthRoutes],
  ['/api/reports', registerReportRoutes],
  ['/api/dashboard', registerDashboardRoutes],
  ['/api/grievances', registerGrievanceRoutes],
];

function buildDeps(env) {
  const auth = createAuth(env, store);

  return {
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
    isPostgres,

    signToken: auth.signToken,
    publicUser: auth.publicUser,
    authRequired: auth.authRequired,
    optionalAuth: auth.optionalAuth,
    passwordChangeRequired: auth.passwordChangeRequired,
    requireRole: auth.requireRole,

    auditPublicRateLimit: createAuditPublicRateLimit(store),
    clientIp,
    fixedWindowRateLimit,

    rankMatches,
    detectPerson,
    matchEngineInfo,

    upload: { single: () => (_req, _res, next) => next() },

    settings: {
      nodeEnv: env.NODE_ENV,
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
  };
}

/** Node's `IncomingMessage` -> the WHATWG `Request` the shim consumes. */
async function toRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : null;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value != null) headers.set(key, value);
  }
  return new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
}

async function send(res, response) {
  const buffer = Buffer.from(await response.arrayBuffer());
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(buffer);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

await store.init();

const deps = buildDeps(process.env);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/api/health') return await send(res, json({ ok: true, service: 'khozo-worker-shim' }));

    const mount = MOUNTS.find(([base]) => url.pathname === base || url.pathname.startsWith(`${base}/`));
    if (!mount) return await send(res, json({ error: `No route for ${req.method} ${url.pathname}` }, 404));

    const [basePath, register] = mount;
    const request = await toRequest(req);
    const response = await handleRequest(register(createRouter(), deps), request, { basePath });

    if (!response) return await send(res, json({ error: `No route for ${req.method} ${url.pathname}` }, 404));
    return await send(res, response);
  } catch (err) {
    console.error('[worker-shim]', err?.stack || err?.message || err);
    return send(res, json({ error: 'Internal Server Error' }, 500));
  }
});

server.listen(PORT, () => {
  console.log(`\n  Khozo worker-shim API running on http://localhost:${PORT}\n`);
});
