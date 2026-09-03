// Express binding for the shared case/sighting/bulletin routes.
//
// The handlers themselves live in shared/routes/reports.js so the Cloudflare
// Worker serves byte-identical logic; this file only supplies the Node-side
// capabilities they depend on.
import { Router } from 'express';
import multer from 'multer';

import registerReportRoutes from '../../../shared/routes/reports.js';
import {
  listReports, addReport, findReport, updateReport,
  listFoundReports, addFoundReport, findFoundReport, updateFoundReport,
  listUsers, addActivity, addAudit, addNotification,
  savePhoto, readPhoto, photoMimeType,
} from '../store.js';
import { authRequired, optionalAuth, passwordChangeRequired, requireRole } from '../auth.js';
import { rankMatches, detectPerson } from '../match.js';
import { auditPublicRateLimit, clientIp, fixedWindowRateLimit } from '../rateLimit.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

export default registerReportRoutes(Router(), {
  listReports, addReport, findReport, updateReport,
  listFoundReports, addFoundReport, findFoundReport, updateFoundReport,
  listUsers, addActivity, addAudit, addNotification,
  savePhoto, readPhoto, photoMimeType,
  authRequired, optionalAuth, passwordChangeRequired, requireRole,
  auditPublicRateLimit, clientIp, fixedWindowRateLimit,
  rankMatches,
  detectPerson,
  upload,
  settings: {
    foundReportLimit: process.env.KHOZO_FOUND_REPORT_LIMIT,
    caseStatusLimit: process.env.KHOZO_CASE_STATUS_LIMIT,
    sightingStatusLimit: process.env.KHOZO_SIGHTING_STATUS_LIMIT,
    bulletinLimit: process.env.KHOZO_BULLETIN_LIMIT,
    exportSigning: {
      keyId: process.env.KHOZO_EXPORT_SIGNING_KEY_ID,
      key: process.env.KHOZO_EXPORT_SIGNING_KEY,
    },
  },
});
