import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { addActivity, addAudit, addGrievance, findGrievance, listGrievances, updateGrievance } from '../store.js';
import { authRequired, passwordChangeRequired, requireRole } from '../auth.js';
import { auditPublicRateLimit, clientIp, fixedWindowRateLimit } from '../rateLimit.js';

const app = new Hono();

const OPERATIONAL_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'];
const UPDATE_ROLES = ['super_admin', 'admin', 'cwc', 'dcpu', 'dlsa', 'saa', 'state_nodal', 'sara'];

const GRIEVANCE_TYPES = {
  missing_child_support: 'Missing child support',
  sighting_followup: 'Sighting follow-up',
  cci_care: 'CCI care concern',
  adoption_carings: 'Adoption / CARINGS support',
  restoration_repatriation: 'Restoration / repatriation',
  service_access: 'Service access',
  data_privacy: 'Data privacy',
  other: 'Other',
};

const REPORT_TO_LEVELS = {
  cci: 'CCI',
  dcpu: 'DCPU',
  cwc: 'CWC',
  saa: 'SAA',
  sara: 'SARA',
  scps: 'SCPS / State',
  ministry: 'Ministry',
};

const GRIEVANCE_STATUSES = {
  submitted: 'Submitted',
  under_review: 'Under review',
  referred: 'Referred',
  resolved: 'Resolved',
  closed: 'Closed',
};

const grievanceSubmitLimit = fixedWindowRateLimit({
  name: 'public_grievance_submit',
  limit: 10,
  key: (c) => `${clientIp(c)}:${String(c.get('body')?.phone || c.get('body')?.email || '').trim().toLowerCase()}`,
  onLimit: auditPublicRateLimit,
});

const grievanceStatusLimit = fixedWindowRateLimit({
  name: 'public_grievance_status',
  limit: 30,
  key: (c) => `${clientIp(c)}:${String(c.req.param('id') || '').trim().toLowerCase()}`,
  onLimit: auditPublicRateLimit,
});

function cleanText(value, max = 140) {
  const text = String(value || '').trim();
  return text.length <= max ? text : text.slice(0, max);
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function publicStatus(grievance) {
  return {
    id: grievance.id,
    status: grievance.status,
    statusLabel: GRIEVANCE_STATUSES[grievance.status] || grievance.status,
    submittedAt: grievance.createdAt,
    updatedAt: grievance.updatedAt || grievance.createdAt,
    grievanceType: grievance.grievanceType,
    grievanceLabel: grievance.grievanceLabel,
    reportToLevel: grievance.reportToLevel,
    reportToLabel: grievance.reportToLabel,
    state: grievance.state || null,
    district: grievance.district || null,
    linkedReceiptId: grievance.linkedReceiptId || null,
    message: grievance.publicMessage || 'Your grievance is recorded and queued for review.',
  };
}

async function scopedGrievances(env, user) {
  const rows = await listGrievances(env);
  if (user.role === 'super_admin') return rows;
  const userState = user.jurisdiction?.state || null;
  const userDistrict = user.jurisdiction?.district || null;
  if (['admin', 'state_nodal', 'sara', 'crime_bureau'].includes(user.role)) {
    return rows.filter((g) => !userState || g.state === userState || !g.state);
  }
  if (['police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb'].includes(user.role)) {
    return rows.filter((g) => {
      if (userState && g.state && g.state !== userState) return false;
      if (userDistrict && g.district && g.district !== userDistrict) return false;
      return true;
    });
  }
  return [];
}

app.get('/status/:id', grievanceStatusLimit, async (c) => {
  const id = c.req.param('id');
  const grievance = await findGrievance(c.env, id);
  if (!grievance) return c.json({ error: 'Grievance receipt not found' }, 404);
  return c.json({ grievance: publicStatus(grievance) });
});

app.post('/', grievanceSubmitLimit, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const grievanceType = cleanText(body.grievanceType, 60) || 'other';
  const reportToLevel = cleanText(body.reportToLevel, 40) || 'dcpu';
  if (!GRIEVANCE_TYPES[grievanceType]) {
    return c.json({ error: `Grievance type must be one of ${Object.keys(GRIEVANCE_TYPES).join(', ')}` }, 400);
  }
  if (!REPORT_TO_LEVELS[reportToLevel]) {
    return c.json({ error: `Report-to level must be one of ${Object.keys(REPORT_TO_LEVELS).join(', ')}` }, 400);
  }

  const name = cleanText(body.name, 120);
  const phone = cleanText(body.phone, 20);
  const email = cleanText(body.email, 120);
  const state = cleanText(body.state, 80);
  const district = cleanText(body.district, 80);
  const linkedReceiptId = cleanText(body.linkedReceiptId, 80) || null;
  const subject = cleanText(body.subject, 160);
  const description = cleanText(body.description, 2000);
  const attachmentName = cleanText(body.attachmentName, 180) || null;
  if (!subject || subject.length < 4) return c.json({ error: 'Subject must be at least 4 characters' }, 400);
  if (!description || description.length < 15) return c.json({ error: 'Description must be at least 15 characters' }, 400);
  if (phone && !/^\d{7,15}$/.test(digits(phone))) return c.json({ error: 'Mobile number must be 7 to 15 digits' }, 400);

  const now = Date.now();
  const grievance = {
    id: `g_${nanoid(8)}`,
    grievanceType,
    grievanceLabel: GRIEVANCE_TYPES[grievanceType],
    reportToLevel,
    reportToLabel: REPORT_TO_LEVELS[reportToLevel],
    name: name || 'Anonymous citizen',
    phone: phone || null,
    email: email || null,
    state: state || null,
    district: district || null,
    linkedReceiptId,
    subject,
    description,
    attachmentName,
    status: 'submitted',
    publicMessage: 'Your grievance is submitted and queued for review by the responsible child-protection desk.',
    history: [
      {
        id: `gh_${now}`,
        ts: now,
        status: 'submitted',
        label: 'Submitted',
        note: null,
        actorName: 'Public portal',
        actorRole: 'public',
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  await addGrievance(c.env, grievance);
  await addActivity(c.env, {
    actor: 'Public grievance portal',
    action: 'Submitted grievance / feedback',
    target: grievance.subject,
    icon: 'feedback',
    scope: { state: grievance.state, district: grievance.district, grievanceId: grievance.id },
  });
  await addAudit(c.env, {
    actorName: 'Public grievance portal',
    actorRole: 'public',
    action: 'grievance.submitted',
    targetType: 'grievance',
    targetId: grievance.id,
    summary: `Public grievance submitted: ${grievance.grievanceLabel}`,
    scope: { state: grievance.state, district: grievance.district, grievanceId: grievance.id },
    metadata: {
      grievanceType,
      reportToLevel,
      hasPhone: Boolean(phone),
      hasEmail: Boolean(email),
      linkedReceiptId,
      attachmentProvided: Boolean(attachmentName),
      descriptionLength: description.length,
    },
  });

  return c.json({ grievance: publicStatus(grievance) }, 201);
});

app.get('/', authRequired, passwordChangeRequired, requireRole(...OPERATIONAL_ROLES), async (c) => {
  const user = c.get('user');
  const rows = await scopedGrievances(c.env, user);
  return c.json({
    grievances: rows.slice().sort((a, b) => b.createdAt - a.createdAt),
  });
});

app.post('/:id/status', authRequired, passwordChangeRequired, requireRole(...UPDATE_ROLES), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const grievance = await findGrievance(c.env, id);
  if (!grievance) return c.json({ error: 'Grievance not found' }, 404);

  const allowedRows = await scopedGrievances(c.env, user);
  if (!allowedRows.some((row) => row.id === grievance.id)) {
    return c.json({ error: 'Grievance is outside your jurisdiction' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const status = cleanText(body?.status, 40);
  if (!GRIEVANCE_STATUSES[status]) {
    return c.json({ error: `Status must be one of ${Object.keys(GRIEVANCE_STATUSES).join(', ')}` }, 400);
  }

  const note = cleanText(body?.note, 1000);
  const publicMessage = cleanText(body?.publicMessage, 500) || GRIEVANCE_STATUSES[status];
  const now = Date.now();
  const history = [
    ...(Array.isArray(grievance.history) ? grievance.history : []),
    {
      id: `gh_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      status,
      label: GRIEVANCE_STATUSES[status],
      note,
      publicMessage,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
    },
  ];

  await updateGrievance(c.env, grievance.id, {
    status,
    publicMessage,
    history,
    updatedAt: now,
    updatedById: user.id,
    updatedByName: user.name,
  });

  await addActivity(c.env, {
    actor: user.name,
    action: `Updated grievance: ${GRIEVANCE_STATUSES[status]}`,
    target: grievance.subject,
    icon: 'feedback',
    actorId: user.id,
    scope: { state: grievance.state, district: grievance.district, grievanceId: grievance.id },
  });

  await addAudit(c.env, {
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: 'grievance.status_updated',
    targetType: 'grievance',
    targetId: grievance.id,
    summary: `Updated grievance ${grievance.id}: ${GRIEVANCE_STATUSES[status]}`,
    scope: { state: grievance.state, district: grievance.district, grievanceId: grievance.id },
    metadata: { status, noteLength: note.length, publicMessageLength: publicMessage.length },
  });

  const updated = await findGrievance(c.env, grievance.id);
  return c.json({ grievance: updated });
});

export default app;
