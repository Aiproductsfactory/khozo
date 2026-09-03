// Express binding for the shared auth routes. Handlers live in
// shared/routes/auth.js so the Cloudflare Worker serves identical logic.
import { Router } from 'express';

import registerAuthRoutes from '../../../shared/routes/auth.js';
import { findUserByEmail, addUser, addAudit, updateUser } from '../store.js';
import { signToken, publicUser, authRequired } from '../auth.js';
import { auditPublicRateLimit, clientIp, fixedWindowRateLimit } from '../rateLimit.js';

export default registerAuthRoutes(Router(), {
  findUserByEmail, addUser, addAudit, updateUser,
  signToken, publicUser, authRequired,
  auditPublicRateLimit, clientIp, fixedWindowRateLimit,
  settings: {
    nodeEnv: process.env.NODE_ENV,
    registerLimit: process.env.KHOZO_REGISTER_LIMIT,
    loginLimit: process.env.KHOZO_LOGIN_LIMIT,
    otpLimit: process.env.KHOZO_OTP_LIMIT,
    smsGatewayUrl: process.env.KHOZO_SMS_GATEWAY_URL,
    smsApiKey: process.env.KHOZO_SMS_API_KEY,
  },
});
