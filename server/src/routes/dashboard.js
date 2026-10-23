// Express binding for the shared dashboard routes. Handlers live in
// shared/routes/dashboard.js so the Cloudflare Worker serves identical logic.
import { Router } from 'express';

import registerDashboardRoutes from '../../../shared/routes/dashboard.js';
import { createFaceIndex } from '../../../shared/face-index.js';
import { privacySecrets } from '../../../shared/privacy.js';
import {
  listReports, listFoundReports, listActivity, listUsers,
  listAudit, verifyAuditChain, updateFoundReport, updateReport,
  addActivity, addAudit, addUser, findUserByEmail,
  listNotifications, markNotificationsRead, addNotification,
  findReport, findFoundReport, updateUser,
  readPhoto, deletePhoto, rewriteActivity,
  listVideoJobs, updateVideoJob,
} from '../store.js';
import { isPostgres } from '../db.js';
import { authRequired, passwordChangeRequired, publicUser, requireRole } from '../auth.js';
import { detectPerson, matchEngineInfo, probeMatchProviders, rankMatches, rankSightingMatches } from '../match.js';
import { auditPublicRateLimit, clientIp, fixedWindowRateLimit } from '../rateLimit.js';

export default registerDashboardRoutes(Router(), {
  listReports, listFoundReports, listActivity, listUsers,
  listAudit, verifyAuditChain, updateFoundReport, updateReport,
  addActivity, addAudit, addUser, findUserByEmail,
  listNotifications, markNotificationsRead,
  readPhoto, probeMatchProviders,
  deletePhoto, rewriteActivity,
  // The re-match batch (shared/routes/matching-admin.js) runs the forward
  // search, links, and alerts a newly linked case's officers.
  findReport, findFoundReport, addNotification,
  // Push tokens and where an account's alerts go (shared/station-alerts.js).
  updateUser,
  // CCTV checks from the desktop app: the command centre's figures (GET /video-checks).
  listVideoJobs, updateVideoJob,
  rankMatches, rankSightingMatches, detectPerson,
  faceIndex: createFaceIndex(process.env),
  isPostgres,
  authRequired, passwordChangeRequired, publicUser, requireRole,
  auditPublicRateLimit, clientIp, fixedWindowRateLimit,
  matchEngineInfo,
  settings: {
    nodeEnv: process.env.NODE_ENV,
    directoryLimit: process.env.KHOZO_DIRECTORY_LIMIT,
    smsGatewayUrl: process.env.KHOZO_SMS_GATEWAY_URL,
    smsApiKey: process.env.KHOZO_SMS_API_KEY,
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN,
    // Set explicitly, or derived from the JWT secret; never a constant from
    // this repository (shared/privacy.js).
    exportSigning: privacySecrets(process.env).exportSigning,
    fieldHashKey: privacySecrets(process.env).fieldHashKey,
    fieldHashKeyDerived: privacySecrets(process.env).fieldHashKeyDerived,
  },
});
