/**
 * Grievance intake and redressal routes.
 *
 * Registered by both runtimes against their own router — see
 * shared/routes/reports.js for how the `deps` contract works.
 */

import { nanoid } from 'nanoid';

export default function registerGrievanceRoutes(router, deps) {
  const {
    addActivity, addAudit, addGrievance, findGrievance, listGrievances, updateGrievance,
    authRequired, passwordChangeRequired, requireRole,
    auditPublicRateLimit, clientIp, fixedWindowRateLimit,
    settings = {},
  } = deps;


  const protectedRoute = [authRequired, passwordChangeRequired];
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
    envLimit: settings.grievanceLimit,
    key: (req) => `${clientIp(req)}:${String(req.body?.phone || req.body?.email || '').trim().toLowerCase()}`,
    onLimit: auditPublicRateLimit,
  });
  const grievanceStatusLimit = fixedWindowRateLimit({
    name: 'public_grievance_status',
    limit: 30,
    envLimit: settings.grievanceStatusLimit,
    key: (req) => `${clientIp(req)}:${String(req.params.id || '').trim().toLowerCase()}`,
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
  
  function scopedGrievances(user) {
    const rows = listGrievances();
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
  
  router.get('/status/:id', grievanceStatusLimit, (req, res) => {
    const grievance = findGrievance(req.params.id);
    if (!grievance) return res.status(404).json({ error: 'Grievance receipt not found' });
    res.json({ grievance: publicStatus(grievance) });
  });
  
  router.post('/', grievanceSubmitLimit, (req, res) => {
    const body = req.body || {};
    const grievanceType = cleanText(body.grievanceType, 60) || 'other';
    const reportToLevel = cleanText(body.reportToLevel, 40) || 'dcpu';
    if (!GRIEVANCE_TYPES[grievanceType]) {
      return res.status(400).json({ error: `Grievance type must be one of ${Object.keys(GRIEVANCE_TYPES).join(', ')}` });
    }
    if (!REPORT_TO_LEVELS[reportToLevel]) {
      return res.status(400).json({ error: `Report-to level must be one of ${Object.keys(REPORT_TO_LEVELS).join(', ')}` });
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
    if (!subject || subject.length < 4) return res.status(400).json({ error: 'Subject must be at least 4 characters' });
    if (!description || description.length < 15) return res.status(400).json({ error: 'Description must be at least 15 characters' });
    if (phone && !/^\d{7,15}$/.test(digits(phone))) return res.status(400).json({ error: 'Mobile number must be 7 to 15 digits' });
  
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
    addGrievance(grievance);
    addActivity({
      actor: 'Public grievance portal',
      action: 'Submitted grievance / feedback',
      target: grievance.subject,
      icon: 'feedback',
      scope: { state: grievance.state, district: grievance.district, grievanceId: grievance.id },
    });
    addAudit({
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
    res.status(201).json({ grievance: publicStatus(grievance) });
  });
  
  router.get('/', protectedRoute, requireRole(...OPERATIONAL_ROLES), (req, res) => {
    res.json({
      grievances: scopedGrievances(req.user)
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt),
    });
  });
  
  router.post('/:id/status', protectedRoute, requireRole(...UPDATE_ROLES), (req, res) => {
    const grievance = findGrievance(req.params.id);
    if (!grievance) return res.status(404).json({ error: 'Grievance not found' });
    if (!scopedGrievances(req.user).some((row) => row.id === grievance.id)) {
      return res.status(403).json({ error: 'Grievance is outside your jurisdiction' });
    }
    const status = cleanText(req.body?.status, 40);
    if (!GRIEVANCE_STATUSES[status]) {
      return res.status(400).json({ error: `Status must be one of ${Object.keys(GRIEVANCE_STATUSES).join(', ')}` });
    }
    const note = cleanText(req.body?.note, 1000);
    const publicMessage = cleanText(req.body?.publicMessage, 500) || GRIEVANCE_STATUSES[status];
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
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
      },
    ];
    updateGrievance(grievance.id, {
      status,
      publicMessage,
      history,
      updatedAt: now,
      updatedById: req.user.id,
      updatedByName: req.user.name,
    });
    addActivity({
      actor: req.user.name,
      action: `Updated grievance: ${GRIEVANCE_STATUSES[status]}`,
      target: grievance.subject,
      icon: 'feedback',
      actorId: req.user.id,
      scope: { state: grievance.state, district: grievance.district, grievanceId: grievance.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'grievance.status_updated',
      targetType: 'grievance',
      targetId: grievance.id,
      summary: `Updated grievance ${grievance.id}: ${GRIEVANCE_STATUSES[status]}`,
      scope: { state: grievance.state, district: grievance.district, grievanceId: grievance.id },
      metadata: { status, noteLength: note.length, publicMessageLength: publicMessage.length },
    });
    res.json({ grievance: findGrievance(grievance.id) });
  });
  

  return router;
}
