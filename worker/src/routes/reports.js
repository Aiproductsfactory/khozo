import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import {
  listReports, addReport, findReport, updateReport,
  listFoundReports, addFoundReport, findFoundReport, updateFoundReport,
  addActivity, addAudit,
  savePhoto, readPhoto, photoMimeType,
} from '../store.js';
import { authRequired, optionalAuth, passwordChangeRequired, requireRole } from '../auth.js';
import { canAccessReport, scopeFoundReports, scopeReports } from '../scope.js';
import { rankMatches } from '../match.js';
import { auditPublicRateLimit, clientIp, fixedWindowRateLimit } from '../rateLimit.js';

const app = new Hono();

const REVIEW_ROLES = ['police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'admin', 'super_admin', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'];
const CASE_WORKFLOW_ROLES = REVIEW_ROLES;

const sightingSubmitLimit = fixedWindowRateLimit({
  name: 'public_sighting_submit',
  limit: 15,
  key: (c) => `${clientIp(c)}:${String(c.get('body')?.reporterPhone || '').trim()}`,
  onLimit: auditPublicRateLimit,
});

// Photo retrieval endpoint (cached at Cloudflare Edge)
app.get('/photo/:key', optionalAuth, async (c) => {
  try {
    const key = c.req.param('key');
    const urlString = c.req.url.split('?')[0];

    try {
      if (typeof caches !== 'undefined' && caches.default) {
        const cached = await caches.default.match(urlString);
        if (cached) return cached;
      }
    } catch {
      // Ignore edge cache match error
    }

    const user = c.get('user');
    const cleanId = key.replace(/\.(jpg|jpeg|png|webp)$/i, '');

    const isMissingReportPhoto = cleanId.startsWith('r_');
    const isFoundReportPhoto = cleanId.startsWith('f_');

    if (isMissingReportPhoto) {
      const report = await findReport(c.env, cleanId);
      if (report && report.bulletin?.published === true) {
        // Published public bulletin photo
      } else {
        if (!user) return c.json({ error: 'Authentication required' }, 401);
        if (report && !canAccessReport(user, report)) {
          return c.json({ error: 'Access denied' }, 403);
        }
      }
    } else if (isFoundReportPhoto) {
      if (!user) return c.json({ error: 'Authentication required' }, 401);
      const foundReport = await findFoundReport(c.env, cleanId);
      if (foundReport && !['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'].includes(user.role)) {
        return c.json({ error: 'Access denied' }, 403);
      }
    }

    const buf = await readPhoto(c.env, cleanId, c.executionCtx);
    if (!buf) return c.json({ error: 'Photo not found' }, 404);

    const mime = photoMimeType(key);
    const arrayBuffer = buf.buffer instanceof ArrayBuffer
      ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      : new Uint8Array(buf).buffer;

    const response = new Response(arrayBuffer, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*',
      },
    });

    try {
      if (typeof caches !== 'undefined' && caches.default && c.executionCtx) {
        c.executionCtx.waitUntil(caches.default.put(urlString, response.clone()));
      }
    } catch {
      // Ignore edge cache put error
    }

    return response;
  } catch (e) {
    return c.json({ error: e.message, stack: e.stack }, 500);
  }
});

const handlePublicBulletins = async (c) => {
  const reports = await listReports(c.env);
  const published = reports.filter((r) => r.bulletin?.published === true && r.status !== 'found');
  return c.json({
    bulletins: published.map((r) => ({
      id: r.id,
      childName: r.childName,
      age: r.age,
      gender: r.gender,
      photoUrl: r.photoFile ? `/api/reports/photo/${r.id}` : null,
      lastSeenLocation: r.lastSeenLocation,
      lastSeenDate: r.lastSeenDate,
      state: r.state,
      district: r.district,
      station: r.station,
      firNo: r.firNo,
      bulletin: r.bulletin,
      rewardAmount: r.rewardAmount || null,
      contacts: r.contacts || [],
    })),
  });
};

const handlePublicTrack = async (c) => {
  const id = c.req.param('id');
  const report = await findReport(c.env, id);
  if (!report || !report.bulletin?.published) {
    return c.json({ error: 'Public bulletin not found' }, 404);
  }
  return c.json({
    bulletin: {
      id: report.id,
      childName: report.childName,
      age: report.age,
      gender: report.gender,
      photoUrl: report.photoFile ? `/api/reports/photo/${report.id}` : null,
      lastSeenLocation: report.lastSeenLocation,
      lastSeenDate: report.lastSeenDate,
      state: report.state,
      district: report.district,
      station: report.station,
      firNo: report.firNo,
      status: report.status,
      bulletin: report.bulletin,
    },
  });
};

app.get('/bulletins', handlePublicBulletins);
app.get('/public/bulletins', handlePublicBulletins);

app.get('/bulletins/track/:id', handlePublicTrack);
app.get('/public/bulletins/track/:id', handlePublicTrack);

// Public Search
app.get('/public/search', async (c) => {
  const queryStr = (c.req.query('q') || '').toLowerCase().trim();
  const stateStr = (c.req.query('state') || '').toLowerCase().trim();
  const districtStr = (c.req.query('district') || '').toLowerCase().trim();
  const genderStr = (c.req.query('gender') || '').toLowerCase().trim();

  const reports = await listReports(c.env);
  const published = reports.filter((r) => r.bulletin?.published === true);

  const results = published.filter((r) => {
    if (stateStr && (r.state || '').toLowerCase() !== stateStr) return false;
    if (districtStr && (r.district || '').toLowerCase() !== districtStr) return false;
    if (genderStr && (r.gender || '').toLowerCase() !== genderStr) return false;
    if (queryStr) {
      const matchName = (r.childName || '').toLowerCase().includes(queryStr);
      const matchFir = (r.firNo || '').toLowerCase().includes(queryStr);
      const matchLoc = (r.lastSeenLocation || '').toLowerCase().includes(queryStr);
      return matchName || matchFir || matchLoc;
    }
    return true;
  });

  return c.json({
    results: results.map((r) => ({
      id: r.id,
      childName: r.childName,
      age: r.age,
      gender: r.gender,
      photoUrl: r.photoFile ? `/api/reports/photo/${r.id}` : null,
      lastSeenLocation: r.lastSeenLocation,
      lastSeenDate: r.lastSeenDate,
      state: r.state,
      district: r.district,
      station: r.station,
      firNo: r.firNo,
      status: r.status,
      bulletin: r.bulletin,
    })),
  });
});

// Public Status Lookup
app.get('/public/status/:ref', async (c) => {
  const ref = c.req.param('ref');
  const reports = await listReports(c.env);
  const match = reports.find((r) => r.id === ref || r.firNo === ref);
  if (!match) return c.json({ error: 'Case reference not found' }, 404);
  return c.json({
    status: {
      id: match.id,
      firNo: match.firNo,
      status: match.status,
      updatedAt: match.anonymizedAt || Date.now(),
    },
  });
});

// Public Sighting Submission
app.post('/sighting', sightingSubmitLimit, async (c) => {
  const formData = await c.req.formData().catch(() => null);
  let payload = {};
  let photoBuffer = null;

  if (formData) {
    for (const [key, value] of formData.entries()) {
      if (key === 'photo' && value && typeof value === 'object' && value.arrayBuffer) {
        photoBuffer = Buffer.from(await value.arrayBuffer());
      } else {
        payload[key] = value;
      }
    }
  } else {
    payload = await c.req.json().catch(() => ({}));
  }

  const { foundLocation, lat, lng, reporterName, reporterPhone, note, gender, ageApprox } = payload;
  if (!foundLocation) {
    return c.json({ error: 'Location description is required' }, 400);
  }

  const id = `f_${nanoid(10)}`;
  let photoFile = null;
  if (photoBuffer && photoBuffer.length > 0) {
    photoFile = id;
    await savePhoto(c.env, photoFile, photoBuffer, 'image/jpeg');
  }

  let matchResult = null;
  let matchedReportId = null;
  let matchScore = null;

  if (photoBuffer && photoBuffer.length > 0) {
    matchResult = await rankMatches(c.env, photoBuffer, { gender, ageApprox });
    if (matchResult.candidates?.length) {
      const topMatch = matchResult.candidates[0];
      matchedReportId = topMatch.report.id;
      matchScore = topMatch.score;
    }
  }

  const now = Date.now();
  const sighting = {
    id,
    photoUrl: photoFile ? `/api/reports/photo/${photoFile}` : null,
    photoFile,
    foundLocation,
    lat: lat ? Number(lat) : null,
    lng: lng ? Number(lng) : null,
    reporterName: reporterName || 'Anonymous Citizen',
    reporterPhone: reporterPhone || null,
    note: note || '',
    gender: gender || null,
    ageApprox: ageApprox ? Number(ageApprox) : null,
    matchedReportId,
    matchScore,
    matchCandidates: matchResult?.candidates ? matchResult.candidates.map((c) => ({ reportId: c.report.id, childName: c.report.childName, score: c.score })) : [],
    matchEngine: matchResult?.engine || null,
    status: matchedReportId && matchScore >= 0.35 ? 'pending_review' : 'unmatched',
    createdAt: now,
  };

  await addFoundReport(c.env, sighting);
  await addActivity(c.env, {
    actor: sighting.reporterName,
    action: 'Reported sighting of a child',
    target: foundLocation,
    icon: 'location',
    scope: { state: payload.state || null, district: payload.district || null, matchedReportId },
  });

  return c.json({
    ok: true,
    sightingId: sighting.id,
    matchedReportId: sighting.matchedReportId,
    matchScore: sighting.matchScore,
    status: sighting.status,
  }, 201);
});

// List reports (gated)
app.get('/', authRequired, passwordChangeRequired, async (c) => {
  const user = c.get('user');
  const allReports = await listReports(c.env);
  const scoped = scopeReports(user, allReports);
  return c.json({
    reports: scoped.map((r) => ({
      ...r,
      photoUrl: r.photoFile ? `/api/reports/photo/${r.id}` : null,
    })),
  });
});

// List found reports (gated)
app.get('/found/all', authRequired, passwordChangeRequired, requireRole(...REVIEW_ROLES), async (c) => {
  const user = c.get('user');
  const allFound = await listFoundReports(c.env);
  const allReports = await listReports(c.env);
  const scopedFound = scopeFoundReports(user, allFound, allReports);

  const reportsMap = new Map();
  for (const r of allReports) {
    if (r?.id) reportsMap.set(r.id, r);
  }

  const enriched = scopedFound.map((f) => {
    const matched = f.matchedReportId ? reportsMap.get(f.matchedReportId) || null : null;
    return {
      ...f,
      photoUrl: f.photoUrl || (f.photoFile ? `/api/reports/photo/${f.id}` : null),
      matchedReport: matched
        ? {
            ...matched,
            photoUrl: matched.photoUrl || (matched.photoFile ? `/api/reports/photo/${matched.id}` : null),
          }
        : null,
    };
  });

  return c.json({ foundReports: enriched });
});

// Get single report
app.get('/:id', authRequired, passwordChangeRequired, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const report = await findReport(c.env, id);

  if (!report) return c.json({ error: 'Report not found' }, 404);
  if (!canAccessReport(user, report)) return c.json({ error: 'Access denied' }, 403);

  return c.json({
    report: {
      ...report,
      photoUrl: report.photoFile ? `/api/reports/photo/${report.id}` : null,
    },
  });
});

// Create new missing report
app.post('/', authRequired, passwordChangeRequired, async (c) => {
  const user = c.get('user');
  const formData = await c.req.formData().catch(() => null);
  let payload = {};
  let photoBuffer = null;

  if (formData) {
    for (const [key, value] of formData.entries()) {
      if (key === 'photo' && value && typeof value === 'object' && value.arrayBuffer) {
        photoBuffer = Buffer.from(await value.arrayBuffer());
      } else {
        payload[key] = value;
      }
    }
  } else {
    payload = await c.req.json().catch(() => ({}));
  }

  const { childName, age, gender, state, district, station, lastSeenLocation, lastSeenDate, parentName, parentPhone, firNo } = payload;
  if (!childName || !state || !district) {
    return c.json({ error: 'Child name, state and district are required' }, 400);
  }

  const id = `r_${nanoid(8)}`;
  let photoFile = null;
  if (photoBuffer && photoBuffer.length > 0) {
    photoFile = id;
    await savePhoto(c.env, photoFile, photoBuffer, 'image/jpeg');
  }

  const now = Date.now();
  const report = {
    id,
    childName,
    age: age ? Number(age) : null,
    gender: gender || null,
    state,
    district,
    station: station || user.jurisdiction?.station || null,
    lastSeenLocation: lastSeenLocation || '',
    lastSeenDate: lastSeenDate || new Date().toISOString().split('T')[0],
    parentName: parentName || '',
    parentPhone: parentPhone || '',
    firNo: firNo || null,
    photoFile,
    photoUrl: photoFile ? `/api/reports/photo/${photoFile}` : null,
    status: 'missing',
    registeredById: user.id,
    registeredByName: user.name,
    registeredByRole: user.role,
    history: [{ ts: now, action: 'Report registered', actor: user.name }],
    createdAt: now,
  };

  await addReport(c.env, report);
  await addActivity(c.env, {
    actor: user.name,
    action: `Registered missing child: ${childName}`,
    target: childName,
    icon: 'person_add',
    actorId: user.id,
    scope: { state, district, reportId: id },
  });

  return c.json({ report }, 201);
});

// Update sighting status (review candidate match)
app.post('/found/:id/status', authRequired, passwordChangeRequired, requireRole(...CASE_WORKFLOW_ROLES), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const sighting = await findFoundReport(c.env, id);

  if (!sighting) return c.json({ error: 'Sighting record not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const { status, note } = body;

  const now = Date.now();
  const updated = await updateFoundReport(c.env, id, {
    status: status || sighting.status,
    reviewNote: note || sighting.reviewNote,
    reviewedAt: now,
    reviewedById: user.id,
    reviewedByName: user.name,
  });

  if (status === 'confirmed_match' && sighting.matchedReportId) {
    await updateReport(c.env, sighting.matchedReportId, {
      status: 'found',
      foundDate: new Date().toISOString().split('T')[0],
      foundLocation: sighting.foundLocation,
      reunitedAt: now,
    });
  }

  await addActivity(c.env, {
    actor: user.name,
    action: `Updated sighting status to ${status}`,
    target: sighting.foundLocation,
    icon: 'check_circle',
    actorId: user.id,
    scope: { state: sighting.state, district: sighting.district },
  });

  return c.json({ sighting: updated });
});

export default app;
