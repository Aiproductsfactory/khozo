import express from 'express';
import cors from 'cors';
import { init } from './store.js';
import authRoutes from './routes/auth.js';
import reportRoutes from './routes/reports.js';
import dashboardRoutes from './routes/dashboard.js';
import grievanceRoutes from './routes/grievances.js';

init();

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

app.listen(PORT, () => {
  console.log(`\n  Khozo API running on http://localhost:${PORT}`);
  console.log('     Demo logins: superadmin@khozo.org, admin@khozo.org, police@khozo.org, sjpu@khozo.org, ahtu@khozo.org, dcrb@khozo.org, dlsa@khozo.org, cwc@khozo.org, dcpu@khozo.org, rpf@khozo.org, cci@khozo.org, saa@khozo.org, jjb@khozo.org, nodal@khozo.org, sara@khozo.org, crimebureau@khozo.org, parent@khozo.org, ngo@khozo.org  (password: khozo123)\n');
});
