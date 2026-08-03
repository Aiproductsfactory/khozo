import { Hono } from 'hono';
import { cors } from 'hono/cors';

import authRoutes from './src/routes/auth.js';
import reportRoutes from './src/routes/reports.js';
import dashboardRoutes from './src/routes/dashboard.js';
import grievanceRoutes from './src/routes/grievances.js';

const app = new Hono();

// Global CORS middleware
app.use('*', cors());

// Error handling
app.onError((err, c) => {
  console.error('[Worker Error]', err.stack || err.message || err);
  return c.json({ error: err.message || 'Internal Server Error', stack: String(err.stack || '') }, 500);
});

// Healthcheck
app.get('/api/health', (c) => c.json({ ok: true, service: 'khozo-worker-api' }));

// Mount API routes
app.route('/api/auth', authRoutes);
app.route('/api/reports', reportRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/grievances', grievanceRoutes);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // If request is for /api/*, process with Hono app
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }

    // Otherwise serve static web assets directly from Cloudflare ASSETS binding
    return env.ASSETS.fetch(request);
  },
};
