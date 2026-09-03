// Express binding for the shared grievance routes. Handlers live in
// shared/routes/grievances.js so the Cloudflare Worker serves identical logic.
import { Router } from 'express';

import registerGrievanceRoutes from '../../../shared/routes/grievances.js';
import { addActivity, addAudit, addGrievance, findGrievance, listGrievances, updateGrievance } from '../store.js';
import { authRequired, passwordChangeRequired, requireRole } from '../auth.js';
import { auditPublicRateLimit, clientIp, fixedWindowRateLimit } from '../rateLimit.js';

export default registerGrievanceRoutes(Router(), {
  addActivity, addAudit, addGrievance, findGrievance, listGrievances, updateGrievance,
  authRequired, passwordChangeRequired, requireRole,
  auditPublicRateLimit, clientIp, fixedWindowRateLimit,
  settings: {
    grievanceLimit: process.env.KHOZO_GRIEVANCE_LIMIT,
    grievanceStatusLimit: process.env.KHOZO_GRIEVANCE_STATUS_LIMIT,
  },
});
