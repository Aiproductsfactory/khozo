// Must come first: modules below capture credentials at import time.
import { envSummary } from './env.js';

import express from 'express';
import cors from 'cors';
import { init, flushPending } from './store.js';
import authRoutes from './routes/auth.js';
import reportRoutes from './routes/reports.js';
import dashboardRoutes from './routes/dashboard.js';
import grievanceRoutes from './routes/grievances.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'khozo-api' }));
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/grievances', grievanceRoutes);

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

// Data must be loaded before the first request is served.
const env = envSummary();
await init();

const server = app.listen(PORT, () => {
  console.log(`\n  Khozo API running on http://localhost:${PORT}`);
  console.log(`     storage: ${env.database}   aarakshak: ${env.aarakshak ? 'on' : 'off'}   rekognition: ${env.rekognition ? 'on' : 'off'}${env.envFile ? '   (.env loaded)' : ''}`);
  if (!env.jwtSecret) console.warn('     WARNING: KHOZO_JWT_SECRET is unset — using the development signing secret.');
  // Never print credentials in production: server logs are routinely shipped to
  // third-party aggregators and read by people who are not operators.
  if (process.env.NODE_ENV !== 'production') {
    console.log('     Demo logins: superadmin@khozo.org, admin@khozo.org, police@khozo.org, sjpu@khozo.org, ahtu@khozo.org, dcrb@khozo.org, dlsa@khozo.org, cwc@khozo.org, dcpu@khozo.org, rpf@khozo.org, cci@khozo.org, saa@khozo.org, jjb@khozo.org, nodal@khozo.org, sara@khozo.org, crimebureau@khozo.org, parent@khozo.org, ngo@khozo.org  (password: khozo123)\n');
  } else {
    console.log('');
  }
});

// Queued Postgres writes must land before the process exits, or a deploy can
// drop the last few audit rows.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      const { pending, lastError } = await flushPending();
      if (lastError) console.error(`[shutdown] last write error: ${lastError}`);
      console.log(`[shutdown] flushed writes (${pending} still queued)`);
      process.exit(0);
    });
  });
}
