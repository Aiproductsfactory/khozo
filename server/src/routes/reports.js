// Express binding for the shared case/sighting/bulletin routes.
//
// The handlers themselves live in shared/routes/reports.js so the Cloudflare
// Worker serves byte-identical logic; this file only supplies the Node-side
// capabilities they depend on.
import { Router } from 'express';
import multer from 'multer';

import registerReportRoutes from '../../../shared/routes/reports.js';
import { PHOTO_TOO_LARGE } from '../../../shared/case-domain.js';
import { createFaceIndex } from '../../../shared/face-index.js';
import { privacySecrets } from '../../../shared/privacy.js';
import { PHOTO_MAX_BYTES } from '../../../shared/photo-format.js';
import { EXTRA_PHOTO_FIELD, MAX_EXTRA_FILES, MULTIPART_MAX_BYTES, PHOTOS_TOO_LARGE, TOO_MANY_PHOTOS } from '../../../shared/photo-set.js';
import {
  listReports, addReport, findReport, updateReport,
  listFoundReports, addFoundReport, findFoundReport, updateFoundReport,
  listUsers, addActivity, addAudit, addNotification,
  savePhoto, readPhoto, deletePhoto, photoMimeType,
} from '../store.js';
import { authRequired, optionalAuth, passwordChangeRequired, requireRole } from '../auth.js';
import { rankMatches, rankSightingMatches, detectPerson, matchEngineInfo } from '../match.js';
import { auditPublicRateLimit, clientIp, fixedWindowRateLimit } from '../rateLimit.js';

const multipart = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 1 + MAX_EXTRA_FILES },
});

/**
 * multer, answering as the Worker's router does: a photo over 8 MB is a 413
 * with a sentence the console can show, not Express's default error page.
 *
 * `single(field)` takes the main photo from `field` and, alongside it, up to
 * MAX_EXTRA_FILES more under EXTRA_PHOTO_FIELD (shared/photo-set.js), as
 * `req.extraFiles`. Each route decides how many extras it keeps; a client
 * that sends only `photo` is served exactly as before.
 */
const upload = {
  single: (field) => {
    const parse = multipart.fields([
      { name: field, maxCount: 1 },
      { name: EXTRA_PHOTO_FIELD, maxCount: MAX_EXTRA_FILES },
    ]);
    return (req, res, next) => {
      if (Number(req.headers['content-length']) > MULTIPART_MAX_BYTES) {
        return res.status(413).json({ error: PHOTOS_TOO_LARGE });
      }
      return parse(req, res, (err) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: PHOTO_TOO_LARGE });
          if (err.code === 'LIMIT_FILE_COUNT' || (err.code === 'LIMIT_UNEXPECTED_FILE' && err.field === EXTRA_PHOTO_FIELD)) {
            return res.status(400).json({ error: TOO_MANY_PHOTOS });
          }
          return res.status(400).json({ error: 'The upload could not be read' });
        }
        req.file = req.files?.[field]?.[0] || null;
        req.extraFiles = req.files?.[EXTRA_PHOTO_FIELD] || [];
        return next();
      });
    };
  },
};

export default registerReportRoutes(Router(), {
  listReports, addReport, findReport, updateReport,
  listFoundReports, addFoundReport, findFoundReport, updateFoundReport,
  listUsers, addActivity, addAudit, addNotification,
  savePhoto, readPhoto, photoMimeType,
  authRequired, optionalAuth, passwordChangeRequired, requireRole,
  auditPublicRateLimit, clientIp, fixedWindowRateLimit,
  rankMatches,
  rankSightingMatches,
  detectPerson,
  matchEngineInfo,
  // The one-to-many index: none unless AARAKSHAK_GALLERY_URL and
  // AARAKSHAK_GALLERY_KEY are set (shared/face-index.js).
  faceIndex: createFaceIndex(process.env),
  deletePhoto,
  upload,
  settings: {
    foundReportLimit: process.env.KHOZO_FOUND_REPORT_LIMIT,
    caseStatusLimit: process.env.KHOZO_CASE_STATUS_LIMIT,
    sightingStatusLimit: process.env.KHOZO_SIGHTING_STATUS_LIMIT,
    bulletinLimit: process.env.KHOZO_BULLETIN_LIMIT,
    // The family alert goes through the same gateway as the registration OTP
    // (shared/sms.js); without one, Khozo says so instead of claiming a send.
    smsGatewayUrl: process.env.KHOZO_SMS_GATEWAY_URL,
    smsApiKey: process.env.KHOZO_SMS_API_KEY,
    // Set explicitly, or derived from the JWT secret; never a constant from
    // this repository (shared/privacy.js).
    exportSigning: privacySecrets(process.env).exportSigning,
    fieldHashKey: privacySecrets(process.env).fieldHashKey,
  },
});
