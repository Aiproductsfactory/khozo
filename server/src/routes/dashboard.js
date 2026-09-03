// Express binding for the shared dashboard routes. Handlers live in
// shared/routes/dashboard.js so the Cloudflare Worker serves identical logic.
import { Router } from 'express';

import registerDashboardRoutes from '../../../shared/routes/dashboard.js';
import {
  listReports, listFoundReports, listActivity, listUsers,
  listAudit, verifyAuditChain, updateFoundReport, updateReport,
  addActivity, addAudit, addUser, findUserByEmail,
  BASE_TOTAL_MISSING, BASE_TOTAL_FOUND,
} from '../store.js';
import { isPostgres } from '../db.js';
import { authRequired, passwordChangeRequired, publicUser, requireRole } from '../auth.js';
import { matchEngineInfo } from '../match.js';

export default registerDashboardRoutes(Router(), {
  listReports, listFoundReports, listActivity, listUsers,
  listAudit, verifyAuditChain, updateFoundReport, updateReport,
  addActivity, addAudit, addUser, findUserByEmail,
  BASE_TOTAL_MISSING, BASE_TOTAL_FOUND,
  isPostgres,
  authRequired, passwordChangeRequired, publicUser, requireRole,
  matchEngineInfo,
  settings: {
    nodeEnv: process.env.NODE_ENV,
    smsGatewayUrl: process.env.KHOZO_SMS_GATEWAY_URL,
    smsApiKey: process.env.KHOZO_SMS_API_KEY,
    exportSigning: {
      keyId: process.env.KHOZO_EXPORT_SIGNING_KEY_ID,
      key: process.env.KHOZO_EXPORT_SIGNING_KEY,
    },
  },
});
