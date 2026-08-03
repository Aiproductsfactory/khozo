import { Hono } from 'hono';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import {
  listReports, listFoundReports, listActivity, listUsers,
  listAudit, verifyAuditChain, addActivity, addAudit, addUser, findUserByEmail,
  BASE_TOTAL_MISSING, BASE_TOTAL_FOUND,
} from '../store.js';
import { authRequired, passwordChangeRequired, publicUser, requireRole } from '../auth.js';
import { scopeActivity, scopeAudit, scopeFoundReports, scopeReports, scopeLabel } from '../scope.js';
import { matchEngineInfo } from '../match.js';

const app = new Hono();

const NETWORK_ALERT_ROLES = ['super_admin', 'admin', 'state_nodal', 'sara', 'crime_bureau'];

app.get('/stats', authRequired, passwordChangeRequired, async (c) => {
  const user = c.get('user');
  const reports = await listReports(c.env);
  const foundReports = await listFoundReports(c.env);
  const scopedRep = scopeReports(user, reports);

  const missingCount = scopedRep.filter((r) => r.status !== 'found').length;
  const foundCount = scopedRep.filter((r) => r.status === 'found').length;

  return c.json({
    stats: {
      totalMissing: BASE_TOTAL_MISSING + missingCount,
      totalFound: BASE_TOTAL_FOUND + foundCount,
      scopedMissing: missingCount,
      scopedFound: foundCount,
      scopeLabel: scopeLabel(user),
      matchEngine: matchEngineInfo(c.env),
    },
  });
});

app.get('/overview', authRequired, passwordChangeRequired, async (c) => {
  const user = c.get('user');
  const reports = await listReports(c.env);
  const foundReports = await listFoundReports(c.env);
  const activityRows = await listActivity(c.env);

  const scopedRep = scopeReports(user, reports);
  const scopedFound = scopeFoundReports(user, foundReports, reports);
  const scopedAct = scopeActivity(user, activityRows, reports);

  return c.json({
    overview: {
      reportsCount: scopedRep.length,
      missingCount: scopedRep.filter((r) => r.status !== 'found').length,
      foundCount: scopedRep.filter((r) => r.status === 'found').length,
      sightingsPendingReview: scopedFound.filter((f) => f.status === 'pending_review').length,
      recentActivity: scopedAct.slice(0, 10),
      matchEngine: matchEngineInfo(c.env),
    },
  });
});

app.get('/activity', authRequired, passwordChangeRequired, async (c) => {
  const user = c.get('user');
  const reports = await listReports(c.env);
  const activityRows = await listActivity(c.env);
  const scoped = scopeActivity(user, activityRows, reports);
  return c.json({ activity: scoped });
});

app.get('/audit', authRequired, passwordChangeRequired, requireRole('super_admin', 'admin', 'state_nodal', 'crime_bureau', 'dcrb'), async (c) => {
  const user = c.get('user');
  const reports = await listReports(c.env);
  const auditRows = await listAudit(c.env);
  const scoped = scopeAudit(user, auditRows, reports);
  const verification = await verifyAuditChain(c.env);

  return c.json({
    audit: scoped,
    chainIntegrity: verification,
  });
});

app.get('/users', authRequired, passwordChangeRequired, requireRole('super_admin', 'admin', 'state_nodal'), async (c) => {
  const user = c.get('user');
  const users = await listUsers(c.env);

  let filtered = users;
  if (user.role === 'admin' || user.role === 'state_nodal') {
    const userState = user.jurisdiction?.state;
    filtered = users.filter((u) => !userState || u.jurisdiction?.state === userState);
  }

  return c.json({ users: filtered.map(publicUser) });
});

app.post('/users', authRequired, passwordChangeRequired, requireRole('super_admin', 'admin'), async (c) => {
  const currentUser = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const { name, email, role, phone, org, state, district, station } = body;

  if (!name || !email || !role) {
    return c.json({ error: 'Name, email and role are required' }, 400);
  }

  const existing = await findUserByEmail(c.env, email);
  if (existing) return c.json({ error: 'An account with this email already exists' }, 409);

  const initialPassword = 'khozo' + Math.floor(1000 + Math.random() * 9000);
  const newUser = await addUser(c.env, {
    id: `u_${nanoid(8)}`,
    name,
    email,
    passwordHash: bcrypt.hashSync(initialPassword, 8),
    mustChangePassword: true,
    role,
    phone: phone || null,
    org: org || null,
    jurisdiction: { level: 'district', state: state || currentUser.jurisdiction?.state || null, district: district || null, station: station || null },
    createdAt: Date.now(),
    createdBy: currentUser.id,
  });

  await addAudit(c.env, {
    actorId: currentUser.id,
    actorName: currentUser.name,
    actorRole: currentUser.role,
    action: 'dashboard.user_provisioned',
    targetType: 'user',
    targetId: newUser.id,
    summary: `Provisioned operational ${role} account for ${name}`,
  });

  return c.json({ user: publicUser(newUser), tempPassword: initialPassword }, 201);
});

export default app;
