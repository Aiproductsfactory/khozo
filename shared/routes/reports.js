/**
 * Missing-child case, sighting and public-bulletin routes.
 *
 * Registered against a router by both runtimes: Express in `server/` and a
 * Worker-side router shim in `worker/`. Every capability the two runtimes
 * implement differently — storage, photo blobs, token verification, multipart
 * parsing, face matching — arrives through `deps` rather than being imported,
 * which is what lets one copy of this logic serve both.
 *
 * Handlers are written against the Express `(req, res)` contract. The Worker
 * shim implements the same contract, so this file needs no runtime branching.
 */

import { nanoid } from 'nanoid';

import { canAccessReport, scopeFoundReports, scopeReports } from '../scope.js';
import { resolveSightingLocation } from '../geocode.js';
// The case vocabulary, validation and public-redaction rules are shared with the
// Cloudflare Worker build so the two runtimes cannot drift apart. See
// shared/case-domain.js.
import {
  DAY,
  REPORT_PHOTO_RETENTION_DAYS,
  SIGHTING_PHOTO_RETENTION_DAYS,
  FORMAL_CASE_ROLES,
  REPORT_CREATE_ROLES,
  REVIEW_ROLES,
  CWC_FOLLOWUP_ROLES,
  FOUND_INTAKE_ROLES,
  CASE_WORKFLOW_ROLES,
  CASE_CLOSE_ROLES,
  CASE_NOTE_ROLES,
  CCI_CARE_ROLES,
  JJB_PROCEEDING_ROLES,
  STATE_ESCALATION_ROLES,
  BUREAU_REPORT_ROLES,
  RESTORATION_PLAN_ROLES,
  EXTERNAL_ID_ROLES,
  CASE_HANDOFF_EXPORT_ROLES,
  WELFARE_REFERRAL_ROLES,
  LEGAL_AID_REFERRAL_ROLES,
  ADOPTION_RECORD_ROLES,
  CASE_ASSESSMENT_ROLES,
  PRODUCTION_RECORD_ROLES,
  INTAKE_VERIFY_ROLES,
  BULLETIN_ROLES,
  CASE_TRANSFER_ROLES,
  CASE_ASSIGN_ROLES,
  CASE_ASSIGNABLE_ROLES,
  INVESTIGATION_CHECKLIST_ROLES,
  ALLOWED_IMAGE_TYPES,
  MATCH_REVIEW_THRESHOLD,
  CASE_ASSIGNMENT_TYPES,
  INVESTIGATION_CHECKLIST_ITEMS,
  CHILD_VULNERABILITY_CATEGORIES,
  PRODUCED_BY_TYPES,
  EDUCATION_LEVELS,
  YES_NO_UNKNOWN,
  DECLARATION_METHODS,
  CASE_WORKFLOW_ACTIONS,
  CASE_CLOSE_REASONS,
  CWC_FOLLOWUP_OUTCOMES,
  CCI_ADMISSION_TYPES,
  CCI_SERVICE_TYPES,
  CCI_PROGRESS_STATES,
  JJB_PROCEEDING_TYPES,
  STATE_ESCALATION_TYPES,
  STATE_ESCALATION_LEVELS,
  BUREAU_REPORT_TYPES,
  BUREAU_LEVELS,
  BUREAU_PRIORITIES,
  SIGHTING_ID_PROOF_TYPES,
  EXTERNAL_ID_TYPES,
  RESTORATION_TYPES,
  RESTORATION_STATUSES,
  RESTORATION_SUPPORTS,
  RESTORATION_TRAVEL_MODES,
  RESTORATION_DOCUMENT_STATUSES,
  RESTORATION_FUNDING_SOURCES,
  WELFARE_SCHEMES,
  WELFARE_STATUSES,
  LEGAL_AID_SERVICE_TYPES,
  LEGAL_AID_STATUSES,
  ADOPTION_RECORD_TYPES,
  ADOPTION_STATUSES,
  CASE_ASSESSMENT_TYPES,
  CASE_RISK_LEVELS,
  PRODUCTION_TYPES,
  PRODUCTION_OUTCOMES,
  HANDOFF_TARGET_SYSTEMS,
  isPendingCitizenIntake,
  generatedFirNo,
  canTransferToJurisdiction,
  canAssignUserToReport,
  assignableUsersForReport,
  bulletinPayload,
  publicSearchPayload,
  publicSightingStatus,
  publicCaseStatus,
  stable,
  signedCaseExport,
  latestRecord,
  safeRecordSummary,
  caseHandoffPayload,
  norm,
  nameOverlap,
  duplicateScore,
  findDuplicateCandidates,
  duplicatePayload,
  isTruthy,
  retentionUntil,
  cleanText,
  parseDateInput,
  parseDateTimeInput,
  optionalDateInput,
  listValues,
  enumValue,
  buildChildProfile,
  buildReportDeclaration,
  buildFoundChildDeclaration,
  digits,
  maskProofNumber,
  publicReporterName,
  optionalNumber,
  validateImageFile,
  validateMissingReport,
  validateFoundReport,
  inferLocationScope,
} from '../case-domain.js';

export default function registerReportRoutes(router, deps) {
  const {
    listReports, addReport, findReport, updateReport,
    listFoundReports, addFoundReport, findFoundReport, updateFoundReport,
    listUsers, addActivity, addAudit, addNotification,
    savePhoto, readPhoto, photoMimeType,
    authRequired, optionalAuth, passwordChangeRequired, requireRole,
    auditPublicRateLimit, clientIp, fixedWindowRateLimit,
    rankMatches,
    detectPerson,
    upload,
    // Injectable so the reverse geocoder can be stubbed in tests rather than
    // reaching OpenStreetMap from a test run.
    fetchImpl = fetch,
    settings = {},
  } = deps;

  const protectedRoute = [authRequired, passwordChangeRequired];

  /**
   * Alerts every authority account that a child has been spotted.
   *
   * Deliberately not scoped to the district the sighting falls in. A citizen
   * reporting a child rarely knows which jurisdiction they are standing in, and
   * a trafficked child is by definition moving between them; an alert that only
   * reaches one district is the alert that arrives too late. So every
   * authority — police, SJPU, AHTU, CWC, DCPU, RPF, CCI, SAA, JJB, DLSA, the
   * state and national desks and registered NGOs — is told, and the message
   * carries only where and when. Parents are not notified: they are told about
   * their own child by an officer, never about every sighting in the country.
   *
   * Opening the sighting behind the alert still goes through the ordinary
   * jurisdiction rules, so knowing that a child was seen does not grant access
   * to that child's record.
   */
  function notifyAuthorities({ kind, title, body, priority = 'normal', scope = {}, roles = null }) {
    const recipients = listUsers().filter(
      (u) => u.role !== 'parent' && (!roles || roles.includes(u.role))
    );
    for (const recipient of recipients) {
      addNotification({
        userId: recipient.id,
        kind,
        title,
        body,
        priority,
        scope,
        // Lets an officer see at a glance whether this one is theirs to action,
        // without hiding the rest from them.
        inJurisdiction:
          !scope.state ||
          !recipient.jurisdiction?.state ||
          recipient.jurisdiction.state === scope.state,
      });
    }
    return recipients.length;
  }

  const foundReportLimit = fixedWindowRateLimit({
    name: 'public_found_report',
    limit: 10,
    envLimit: settings.foundReportLimit,
    key: (req) => `${clientIp(req)}:${String(req.body?.reporterPhone || '').trim()}`,
    onLimit: auditPublicRateLimit,
  });
  const publicCaseStatusLimit = fixedWindowRateLimit({
    name: 'public_case_status',
    limit: 30,
    envLimit: settings.caseStatusLimit,
    key: (req) => `${clientIp(req)}:${norm(req.params.ref)}`,
    onLimit: auditPublicRateLimit,
  });
  const publicSightingStatusLimit = fixedWindowRateLimit({
    name: 'public_sighting_status',
    limit: 30,
    envLimit: settings.sightingStatusLimit,
    key: (req) => `${clientIp(req)}:${norm(req.params.id)}`,
    onLimit: auditPublicRateLimit,
  });
  const publicBulletinLimit = fixedWindowRateLimit({
    name: 'public_bulletins',
    limit: 120,
    envLimit: settings.bulletinLimit,
    key: (req) => clientIp(req),
    onLimit: auditPublicRateLimit,
  });

  async function storePhoto(key, file) {
    if (!file) return { photoUrl: null, photoFile: null };
    const photoFile = await savePhoto(key, file.buffer, file.mimetype);
    return {
      photoUrl: photoFile ? `/api/reports/photo/${key}` : null,
      photoFile,
    };
  }


  router.get('/photo/:key', optionalAuth, async (req, res) => {
    const report = findReport(req.params.key);
    const found = findFoundReport(req.params.key);
    const record = report || found;
    if (!record) return res.status(404).end();

    // Only a photo an officer has deliberately published as a public bulletin is
    // readable without a token. Serving every verified missing case anonymously
    // (which is what "status === missing" did) hands out a browsable gallery of
    // children's faces to anyone who can guess a case id.
    const isPublicBulletin = report?.bulletin?.published === true && !report.anonymizedAt;

    if (!isPublicBulletin) {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (report && !canAccessReport(req.user, report)) {
        return res.status(403).json({ error: 'Photo is outside your jurisdiction' });
      }
      if (found && scopeFoundReports(req.user, [found], listReports()).length !== 1) {
        return res.status(403).json({ error: 'Photo is outside your jurisdiction' });
      }
    }

    const buffer = record.photoFile ? await readPhoto(record.photoFile) : null;
    if (!buffer) return res.status(404).end();
    res.type(photoMimeType(record.photoFile)).send(buffer);
  });

  // ---- Missing-child reports / FIRs -----------------------------------------

  router.get('/public/bulletins', publicBulletinLimit, (req, res) => {
    let rows = listReports().filter((r) =>
      r.status === 'missing' &&
      r.intakeStatus !== 'pending_verification' &&
      r.bulletin?.published === true &&
      !r.anonymizedAt
    );
    const state = String(req.query.state || '').trim().toLowerCase();
    const district = String(req.query.district || '').trim().toLowerCase();
    if (state) rows = rows.filter((r) => String(r.state || '').toLowerCase() === state);
    if (district) rows = rows.filter((r) => String(r.district || '').toLowerCase() === district);
    rows = rows
      .slice()
      .sort((a, b) => new Date(b.bulletin?.publishedAt || b.createdAt || 0) - new Date(a.bulletin?.publishedAt || a.createdAt || 0))
      .slice(0, 100);
    res.json({ bulletins: rows.map(bulletinPayload) });
  });

  /**
   * Aggregate counts for the public landing page.
   *
   * Exists because that page used to display a fixed "10,468 missing / 4,068
   * reunited" under a heading that read "Live national overview". Numbers shown
   * to the public about missing children have to be the real ones, even while
   * they are small.
   *
   * Counts only, never a record: nothing here identifies a child.
   */
  router.get('/public/summary', publicBulletinLimit, (req, res) => {
    const rows = listReports().filter((r) => !r.anonymizedAt);
    const active = rows.filter((r) => r.status === 'missing' || r.status === 'under_review');
    const reunited = rows.filter((r) => r.status === 'found' || r.status === 'closed');
    const published = rows.filter((r) => r.bulletin?.published === true && r.status === 'missing');
    const sightings = listFoundReports();
    const reviewed = sightings.filter((f) => !['pending_review', 'no_match'].includes(f.status));

    res.json({
      summary: {
        activeCases: active.length,
        reunited: reunited.length,
        publicBulletins: published.length,
        sightingsReceived: sightings.length,
        sightingsActioned: reviewed.length,
        statesCovered: new Set(rows.map((r) => r.state).filter(Boolean)).size,
        agenciesOnboard: new Set(listUsers().filter((u) => u.role !== 'parent').map((u) => u.org || u.role)).size,
      },
      generatedAt: new Date().toISOString(),
    });
  });

  router.get('/public/search', publicBulletinLimit, (req, res) => {
    let rows = listReports().filter((r) =>
      !r.anonymizedAt &&
      (
        (r.status === 'missing' && r.intakeStatus !== 'pending_verification' && r.bulletin?.published === true) ||
        ['found', 'closed'].includes(r.status)
      )
    );
    const state = String(req.query.state || '').trim().toLowerCase();
    const district = String(req.query.district || '').trim().toLowerCase();
    const gender = String(req.query.gender || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toLowerCase();
    const ageMin = Number(req.query.ageMin);
    const ageMax = Number(req.query.ageMax);
    if (state) rows = rows.filter((r) => String(r.state || '').toLowerCase() === state);
    if (district) rows = rows.filter((r) => String(r.district || '').toLowerCase() === district);
    if (gender) rows = rows.filter((r) => String(r.gender || '').toLowerCase() === gender);
    if (['missing', 'found', 'closed'].includes(status)) rows = rows.filter((r) => r.status === status);
    if (Number.isFinite(ageMin)) rows = rows.filter((r) => Number(r.age) >= ageMin);
    if (Number.isFinite(ageMax)) rows = rows.filter((r) => Number(r.age) <= ageMax);
    rows = rows
      .slice()
      .sort((a, b) => {
        const aTime = new Date(a.bulletin?.publishedAt || a.closure?.closedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.bulletin?.publishedAt || b.closure?.closedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 100);
    res.json({ results: rows.map(publicSearchPayload) });
  });

  router.get('/public/status/:ref', publicCaseStatusLimit, (req, res) => {
    const ref = cleanText(req.params.ref, 140);
    const report = listReports().find((r) =>
      !r.anonymizedAt &&
      (
        norm(r.id) === norm(ref) ||
        (r.firNo && norm(r.firNo) === norm(ref)) ||
        (Array.isArray(r.externalIds) && r.externalIds.some((row) => norm(row.externalId) === norm(ref)))
      )
    );
    if (!report) return res.status(404).json({ error: 'Case reference not found' });
    res.json({ status: publicCaseStatus(report, ref) });
  });

  // Scoped list for the logged-in stakeholder.
  router.get('/', protectedRoute, (req, res) => {
    let rows = scopeReports(req.user, listReports());
    const { status, q } = req.query;
    if (status) rows = rows.filter((r) => r.status === status);
    if (q) {
      const needle = String(q).toLowerCase();
      rows = rows.filter((r) =>
        [r.childName, r.parentName, r.firNo, r.address, r.state, r.district]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle))
      );
    }
    res.json({ reports: rows });
  });

  // Register a missing child. Parents/NGOs file a report; police file a formal FIR.
  router.post('/', protectedRoute, requireRole(...REPORT_CREATE_ROLES), upload.single('photo'), async (req, res) => {
    const b = req.body || {};
    const validation = validateMissingReport(b, req.file);
    if (validation.errors) return res.status(400).json({ error: validation.errors[0], errors: validation.errors });
    if (req.file && !isTruthy(b.photoConsent)) {
      return res.status(400).json({ error: 'Photo consent is required before uploading a child image' });
    }
    const id = `r_${nanoid(8)}`;
    const isPolice = FORMAL_CASE_ROLES.includes(req.user.role);
    const childProfile = buildChildProfile(b);
    const declaration = buildReportDeclaration(b, req.user);
    const incoming = {
      childName: b.childName,
      childAadhar: b.childAadhar || null,
      gender: b.gender || 'Male',
      age: validation.age,
      parentPhone: b.parentPhone || req.user.phone,
      state: b.state || req.user.jurisdiction?.state || null,
      district: b.district || req.user.jurisdiction?.district || null,
      identificationProfile: childProfile.identificationProfile,
      vulnerabilityProfile: childProfile.vulnerabilityProfile,
    };
    const duplicateCandidates = findDuplicateCandidates(req.user, incoming, listReports(), scopeReports);
    const allowDuplicate = b.allowDuplicate === true || b.allowDuplicate === 'true';
    if (duplicateCandidates.length && !allowDuplicate) {
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'case.duplicate_warning',
        targetType: 'report',
        summary: `Potential duplicate report blocked for ${b.childName}`,
        scope: { state: incoming.state, district: incoming.district },
        metadata: { candidateIds: duplicateCandidates.map((c) => c.report.id), topScore: duplicateCandidates[0].score },
      });
      return res.status(409).json({
        error: 'Possible duplicate case found',
        duplicateCandidates: duplicateCandidates.map((c) => duplicatePayload(req.user, c)),
      });
    }
    const report = {
      id,
      firNo: b.firNo || (isPolice ? generatedFirNo() : null),
      childName: b.childName,
      childAadhar: b.childAadhar || null,
      gender: b.gender || 'Male',
      age: validation.age,
      height: validation.height,
      weight: validation.weight,
      identificationProfile: childProfile.identificationProfile,
      vulnerabilityProfile: childProfile.vulnerabilityProfile,
      declaration,
      hasIdentificationProfile: childProfile.hasIdentificationProfile,
      hasVulnerabilityProfile: childProfile.hasVulnerabilityProfile,
      dateOfMissing: b.dateOfMissing || new Date().toISOString(),
      ...(await storePhoto(id, req.file)),
      photoConsent: req.file ? true : isTruthy(b.photoConsent),
      dataPurpose: b.dataPurpose || 'missing_child_investigation',
      retentionUntil: retentionUntil(REPORT_PHOTO_RETENTION_DAYS),
      status: isPolice ? 'missing' : 'intake_pending',
      intakeStatus: isPolice ? 'verified' : 'pending_verification',
      intakeSource: isPolice ? 'official_fir' : 'citizen_report',
      verifiedAt: isPolice ? Date.now() : null,
      verifiedById: isPolice ? req.user.id : null,
      verifiedByName: isPolice ? req.user.name : null,
      parentName: b.parentName || req.user.name,
      parentPhone: b.parentPhone || req.user.phone,
      parentEmail: b.parentEmail || null,
      address: b.address || null,
      state: b.state || req.user.jurisdiction?.state || null,
      district: b.district || req.user.jurisdiction?.district || null,
      zip: b.zip || null,
      foundLocation: null,
      matchScore: 0,
      smsSent: false,
      registeredByRole: req.user.role,
      registeredById: req.user.id,
      createdAt: Date.now(),
    };
    addReport(report);
    addActivity({ actor: req.user.name, action: isPolice ? 'Registered an FIR' : 'Submitted missing-child intake for verification', target: report.childName, icon: 'plus', actorId: req.user.id, scope: { state: report.state, district: report.district, reportId: report.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: isPolice ? 'case.fir_registered' : 'case.report_registered',
      targetType: 'report',
      targetId: report.id,
      summary: `${isPolice ? 'Registered FIR' : 'Submitted citizen/NGO intake'} for ${report.childName}`,
      scope: { state: report.state, district: report.district },
      metadata: {
        photoConsent: report.photoConsent,
        dataPurpose: report.dataPurpose,
        retentionUntil: report.retentionUntil,
        intakeStatus: report.intakeStatus,
        hasIdentificationProfile: report.hasIdentificationProfile,
        vulnerabilityCategories: report.vulnerabilityProfile.categories,
        producedByType: report.vulnerabilityProfile.producedByType,
        declarationAccepted: true,
        declarationMethod: declaration.method,
        declarationSignerRole: declaration.signerRole,
        relationshipToChild: declaration.relationshipToChild,
      },
    });
    if (duplicateCandidates.length && allowDuplicate) {
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'case.duplicate_override',
        targetType: 'report',
        targetId: report.id,
        summary: `Created ${report.childName} after duplicate warning override`,
        scope: { state: report.state, district: report.district },
      metadata: { candidateIds: duplicateCandidates.map((c) => c.report.id), topScore: duplicateCandidates[0].score, retentionUntil: report.retentionUntil },
    });
    }
    res.status(201).json({ report });
  });

  // ---- Public "I spotted a child" uploads + face match ----------------------

  router.get('/found/status/:id', publicSightingStatusLimit, (req, res) => {
    const found = findFoundReport(req.params.id);
    if (!found) return res.status(404).json({ error: 'Sighting receipt not found' });
    res.json({ status: publicSightingStatus(found) });
  });

  // Public endpoint (no auth): citizen uploads a photo and gets a review-safe receipt.
  router.post('/found', upload.single('photo'), foundReportLimit, async (req, res) => {
    const b = req.body || {};
    const validation = validateFoundReport(b, req.file);
    if (validation.errors) return res.status(400).json({ error: validation.errors[0], errors: validation.errors });
    if (req.file && !isTruthy(b.photoConsent)) {
      return res.status(400).json({ error: 'Photo consent is required before submitting a sighting image' });
    }
    if (!req.file && !String(b.note || '').trim() && !String(b.foundLocation || '').trim()) {
      return res.status(400).json({ error: 'Add a photo or enough sighting details to help CWC/Childline review the report' });
    }
    const id = `f_${nanoid(8)}`;

    // Screening decides who hears about this report: a public upload endpoint
    // receives whatever a phone camera happened to be pointed at, and alerting
    // every authority in the country about a photo of the floor is how officers
    // learn to ignore the alert that matters.
    //
    // It runs alongside the match rather than before it. Both call the same
    // provider, the citizen is waiting on the response, and the ordinary case
    // is a real photograph of a real child that needs both answers anyway.
    const [screening, matchResult] = await Promise.all([
      detectPerson(req.file?.buffer || null),
      rankMatches(req.file?.buffer || null, {
        gender: b.gender,
        ageApprox: validation.ageApprox,
      }),
    ]);
    const { candidates, engine: matchEngine } = matchResult;
    const canRunMatch = !!req.file;
    const best = candidates[0];
    // Calibrated against real Aarakshak output: photographs of the same person
    // score 0.48-0.86, different people score below 0.07. 0.6 sat inside the
    // genuine-match range and routed real matches away from police review.
    // This only decides whether an officer is shown the candidate - a human still
    // confirms - so it is set to catch matches, not to be conservative.
    // Photo quality is recorded for the reviewer but deliberately does NOT gate
    // routing. Gating on it was tried and rejected: the provider raises
    // `low_detector_confidence` on plenty of genuine matches too, so the filter
    // dropped a real one. Surfacing an extra face for a human to reject costs an
    // officer a minute; suppressing a real match costs a child.
    const lowQualityPhoto = Boolean(best?.lowQuality || best?.warnings?.length);
    const hasStrongMatch = canRunMatch && best && best.score >= MATCH_REVIEW_THRESHOLD;
    const matchedScope = hasStrongMatch ? { state: best.report.state || null, district: best.report.district || null } : {};
    // The phone's coordinates fill in the jurisdiction the reporter did not
    // type. What they did type always wins; a failed lookup changes nothing.
    const locationScope = await resolveSightingLocation(b, { fetchImpl });
    const confidentialReporter = isTruthy(b.confidentialReporter);
    const reporterName = cleanText(b.reporterName, 120) || 'Anonymous citizen';
    const idProofType = SIGHTING_ID_PROOF_TYPES[b.idProofType] ? b.idProofType : null;
    const idProofNumberMasked = idProofType ? maskProofNumber(b.idProofNumber) : null;
    const fr = {
      id,
      ...(await storePhoto(id, req.file)),
      foundLocation: b.foundLocation || 'Unknown',
      lat: validation.lat,
      lng: validation.lng,
      reporterName,
      reporterDisplayName: confidentialReporter ? 'Confidential citizen' : reporterName,
      reporterPhone: b.reporterPhone || null,
      reporterPhoneVisible: confidentialReporter ? null : b.reporterPhone || null,
      confidentialReporter,
      identityConfidential: confidentialReporter,
      idProofType,
      idProofLabel: idProofType ? SIGHTING_ID_PROOF_TYPES[idProofType] : null,
      idProofNumberMasked,
      idProofVerified: Boolean(idProofType && idProofNumberMasked),
      note: b.note || null,
      ageApprox: validation.ageApprox,
      gender: ['Male', 'Female', 'Other'].includes(b.gender) ? b.gender : null,
      state: matchedScope.state || locationScope.state,
      district: matchedScope.district || locationScope.district,
      matchedReportId: hasStrongMatch ? best.report.id : null,
      photoQualityWarnings: best?.warnings?.length ? best.warnings : null,
      lowQualityPhoto: lowQualityPhoto || null,
      matchScore: best ? best.score : 0,
      // Kept on the record, not just returned once. A reviewer deciding what a
      // score means has to know whether it came from a face comparison or from
      // the non-biometric fallback, and an auditor has to know months later.
      matchEngine: {
        provider: matchEngine.provider,
        modelVersion: matchEngine.modelVersion || null,
        biometric: Boolean(matchEngine.biometric),
      },
      status: hasStrongMatch ? 'pending_review' : 'no_match',
      photoConsent: req.file ? true : isTruthy(b.photoConsent),
      dataPurpose: req.file ? 'sighting_review_and_child_protection' : 'text_sighting_childline_intake',
      retentionUntil: retentionUntil(SIGHTING_PHOTO_RETENTION_DAYS),
      referredTo1098: true,
      referralStatus: hasStrongMatch ? 'Police review pending' : 'Childline/CWC intake queued',
      // What the screen found, kept on the record so a reviewer can see why the
      // report was routed the way it was rather than guessing.
      screening: {
        ...screening,
        // A text-only report has no photo to screen and is a person's account of
        // seeing a child, so it alerts on its own terms.
        raisesAlert: !req.file || screening.verdict === 'person',
      },
      locationSource: locationScope.source || 'reporter',
      createdAt: Date.now(),
    };
    addFoundReport(fr);
    addActivity({ actor: publicReporterName(fr), action: 'Uploaded a spotted-child photo', target: fr.foundLocation, icon: 'upload', scope: { state: fr.state, district: fr.district, matchedReportId: fr.matchedReportId } });
    addAudit({
      actorName: publicReporterName(fr),
      actorRole: 'public',
      action: 'sighting.submitted',
      targetType: 'foundReport',
      targetId: fr.id,
      summary: `Public sighting submitted at ${fr.foundLocation}`,
      scope: { matchedReportId: fr.matchedReportId, state: fr.state, district: fr.district },
      metadata: { matchScore: fr.matchScore, status: fr.status, matchEngine, matchAttempted: canRunMatch, confidentialReporter, idProofType, idProofCaptured: fr.idProofVerified },
    });
    const where = `${fr.foundLocation}${fr.state ? `, ${[fr.district, fr.state].filter(Boolean).join(', ')}` : ''}`;
    if (fr.screening.raisesAlert) {
      notifyAuthorities({
        kind: 'sighting_reported',
        title: hasStrongMatch ? 'Possible match — child spotted' : 'Child spotted',
        body: `A sighting was reported at ${where}.`,
        priority: hasStrongMatch ? 'high' : 'normal',
        scope: { state: fr.state, district: fr.district, foundReportId: fr.id },
      });
    } else {
      // Screened out, not discarded. One person still looks at it, because the
      // screen can be wrong and the cost of it being wrong is a real sighting
      // that nobody read.
      notifyAuthorities({
        kind: 'sighting_screening',
        title: fr.screening.verdict === 'no_person' ? 'Upload with no person in it' : 'Unscreened upload',
        body:
          fr.screening.verdict === 'no_person'
            ? `An upload at ${where} contained no recognisable person. Queued for your review.`
            : `An upload at ${where} could not be screened — no detection provider answered. Queued for your review.`,
        priority: 'normal',
        roles: ['super_admin'],
        scope: { state: fr.state, district: fr.district, foundReportId: fr.id },
      });
    }
    if (!hasStrongMatch) {
      addActivity({ actor: 'Khozo intake', action: 'Queued report for 1098/CWC follow-up', target: fr.foundLocation, icon: 'referral', scope: { state: fr.state, district: fr.district } });
      addAudit({
        actorName: 'Khozo intake',
        actorRole: 'system',
        action: 'sighting.cwc_queued',
        targetType: 'foundReport',
        targetId: fr.id,
        summary: `Queued unmatched sighting for 1098/CWC follow-up at ${fr.foundLocation}`,
        scope: { state: fr.state, district: fr.district },
      });
    }
    res.status(201).json({
      foundReport: {
        id: fr.id,
        status: fr.status,
        foundLocation: fr.foundLocation,
        state: fr.state,
        district: fr.district,
        matchScore: fr.matchScore,
        referralStatus: fr.referralStatus,
        referredTo1098: fr.referredTo1098,
        retentionUntil: fr.retentionUntil,
        matchEngine: {
          provider: matchEngine.provider,
          modelVersion: matchEngine.modelVersion,
          biometric: matchEngine.biometric,
        },
      },
      review: hasStrongMatch
        ? 'Possible match found. Police will review before any identity or family details are shared.'
        : req.file
          ? 'No strong match yet. The report is saved and queued for Childline/CWC follow-up.'
          : 'Your text sighting is saved and queued for Childline/CWC follow-up. No face-match search was run because no photo was uploaded.',
      candidates: candidates.map((c, index) => ({
        rank: index + 1,
        score: c.score,
        ageBand: c.report.age == null ? 'Unknown' : `${Math.max(0, c.report.age - 1)}-${c.report.age + 1}`,
        gender: c.report.gender,
      })),
    });
  });

  router.get('/found/all', protectedRoute, requireRole(...REVIEW_ROLES), (req, res) => {
    const scopedFound = scopeFoundReports(req.user, listFoundReports(), listReports());
    const reportsById = Object.fromEntries(scopeReports(req.user, listReports()).map((r) => [r.id, r]));
    res.json({
      foundReports: scopedFound.map((f) => {
        const matched = f.matchedReportId ? reportsById[f.matchedReportId] : null;
        return {
          ...f,
          reporterName: publicReporterName(f),
          reporterPhone: f.confidentialReporter ? null : f.reporterPhone || null,
          reporterPhoneVisible: f.confidentialReporter ? null : f.reporterPhone || null,
          matchedReport: matched ? {
            id: matched.id,
            childName: matched.childName,
            age: matched.age,
            gender: matched.gender,
            address: matched.address,
            state: matched.state,
            district: matched.district,
            parentName: matched.parentName,
            parentPhone: matched.parentPhone,
            status: matched.status,
            photoUrl: matched.photoUrl || (matched.photoFile ? `/api/reports/photo/${matched.id}` : null),
            retentionUntil: matched.retentionUntil,
            dataPurpose: matched.dataPurpose,
          } : null,
        };
      }),
    });
  });

  router.post('/found/:id/review', protectedRoute, requireRole(...REVIEW_ROLES), (req, res) => {
    const f = findFoundReport(req.params.id);
    if (!f) return res.status(404).json({ error: 'Found report not found' });
    const visible = scopeFoundReports(req.user, [f], listReports()).length === 1;
    if (!visible) return res.status(403).json({ error: 'Found report is outside your jurisdiction' });

    const { decision } = req.body || {}; // 'matched' | 'rejected' | 'refer_cwc'
    if (!['matched', 'rejected', 'refer_cwc'].includes(decision)) {
      return res.status(400).json({ error: 'Review decision must be matched, rejected or refer_cwc' });
    }
    if (decision === 'matched' && !FORMAL_CASE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Only police or command roles can confirm reunification' });
    }

    if (decision === 'refer_cwc') {
      updateFoundReport(f.id, { status: 'referred_cwc', referredTo1098: true, referralStatus: 'Referred to Childline/CWC' });
      addActivity({ actor: req.user.name, action: 'Referred sighting to 1098/CWC', target: f.foundLocation, icon: 'referral', actorId: req.user.id, scope: { state: f.state, district: f.district, matchedReportId: f.matchedReportId } });
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'sighting.referred_cwc',
        targetType: 'foundReport',
        targetId: f.id,
        summary: `Referred sighting at ${f.foundLocation} to 1098/CWC`,
        scope: { matchedReportId: f.matchedReportId },
      });
      return res.json({ foundReport: findFoundReport(f.id) });
    }

    updateFoundReport(f.id, {
      status: decision === 'matched' ? 'matched' : 'rejected',
      referralStatus: decision === 'matched' ? 'Police match confirmed' : 'Police rejected match',
    });
    if (decision === 'matched' && f.matchedReportId) {
      const r = findReport(f.matchedReportId);
      if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Matched case is outside your jurisdiction' });
      updateReport(f.matchedReportId, { status: 'found', foundLocation: f.foundLocation, matchScore: f.matchScore });
      addActivity({ actor: req.user.name, action: 'Confirmed sighting match', target: r.childName, icon: 'check', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'sighting.match_confirmed',
        targetType: 'foundReport',
        targetId: f.id,
        summary: `Confirmed sighting match for ${r.childName}`,
        scope: { state: r.state, district: r.district, reportId: r.id },
        metadata: { matchScore: f.matchScore },
      });
    } else {
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'sighting.rejected',
        targetType: 'foundReport',
        targetId: f.id,
        summary: `Rejected sighting match at ${f.foundLocation}`,
        scope: { matchedReportId: f.matchedReportId },
      });
    }
    res.json({ foundReport: findFoundReport(f.id) });
  });

  router.post('/found/:id/cwc-followup', protectedRoute, requireRole(...CWC_FOLLOWUP_ROLES), (req, res) => {
    const f = findFoundReport(req.params.id);
    if (!f) return res.status(404).json({ error: 'Found report not found' });
    const visible = scopeFoundReports(req.user, [f], listReports()).length === 1;
    if (!visible) return res.status(403).json({ error: 'Found report is outside your jurisdiction' });
    if (!['no_match', 'referred_cwc'].includes(f.status)) {
      return res.status(409).json({ error: 'Only unmatched or CWC-referred sightings can receive CWC follow-up outcomes' });
    }

    const { outcome, note } = req.body || {};
    if (!CWC_FOLLOWUP_OUTCOMES[outcome]) {
      return res.status(400).json({ error: `Outcome must be one of ${Object.keys(CWC_FOLLOWUP_OUTCOMES).join(', ')}` });
    }
    const cleanedNote = cleanText(note, 500);
    const followup = {
      outcome,
      label: CWC_FOLLOWUP_OUTCOMES[outcome],
      note: cleanedNote || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      completedAt: new Date().toISOString(),
    };
    const patch = {
      status: 'cwc_followup_complete',
      referredTo1098: true,
      referralStatus: `CWC follow-up complete: ${followup.label}`,
      cwcFollowup: followup,
    };
    updateFoundReport(f.id, patch);
    addActivity({
      actor: req.user.name,
      action: `Recorded CWC follow-up: ${followup.label}`,
      target: f.foundLocation,
      icon: 'check',
      actorId: req.user.id,
      scope: { state: f.state, district: f.district, matchedReportId: f.matchedReportId },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'sighting.cwc_followup_completed',
      targetType: 'foundReport',
      targetId: f.id,
      summary: `CWC follow-up recorded for sighting at ${f.foundLocation}: ${followup.label}`,
      scope: { state: f.state, district: f.district, matchedReportId: f.matchedReportId },
      metadata: { outcome, noteLength: cleanedNote.length },
    });
    res.json({ foundReport: findFoundReport(f.id) });
  });

  router.post('/found/:id/formal-intake', protectedRoute, requireRole(...FOUND_INTAKE_ROLES), (req, res) => {
    const f = findFoundReport(req.params.id);
    if (!f) return res.status(404).json({ error: 'Found report not found' });
    const visible = scopeFoundReports(req.user, [f], listReports()).length === 1;
    if (!visible) return res.status(403).json({ error: 'Found report is outside your jurisdiction' });
    if (f.formalReportId) return res.status(409).json({ error: 'This sighting is already linked to a formal found-child intake' });
    if (['matched', 'rejected'].includes(f.status)) {
      return res.status(409).json({ error: 'Matched or rejected sightings cannot be converted to found-child intake' });
    }

    const childName = cleanText(req.body?.childName, 80) || 'Unknown child';
    const guardianName = cleanText(req.body?.guardianName, 120) || 'Unknown guardian';
    const intakeAuthority = cleanText(req.body?.intakeAuthority, 140) || req.user.org || req.user.name;
    const note = cleanText(req.body?.note, 800);
    if (childName.length < 2) return res.status(400).json({ error: 'Child name or temporary identifier must be at least 2 characters' });
    if (intakeAuthority.length < 3) return res.status(400).json({ error: 'Intake authority must be at least 3 characters' });
    if (note.length < 10) return res.status(400).json({ error: 'Intake note must be at least 10 characters' });

    const admissionDate = req.body?.admissionDate
      ? parseDateInput(req.body.admissionDate, 'Admission date')
      : { value: new Date().toISOString().slice(0, 10), time: Date.now() };
    if (admissionDate.error) return res.status(400).json({ error: admissionDate.error });
    if (admissionDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Admission date cannot be in the future' });

    let nextReviewDate = null;
    if (req.body?.nextReviewDate) {
      const parsed = parseDateInput(req.body.nextReviewDate, 'Next review date');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (parsed.time < Date.now() - DAY) return res.status(400).json({ error: 'Next review date cannot be in the past' });
      nextReviewDate = parsed.value;
    }

    const age = optionalNumber(req.body?.ageApprox ?? f.ageApprox, 'Approximate age', { min: 0, max: 18, integer: true });
    if (age.error) return res.status(400).json({ error: age.error });
    const gender = ['Male', 'Female', 'Other'].includes(req.body?.gender) ? req.body.gender : f.gender || 'Other';
    const state = cleanText(req.body?.state, 80) || f.state || req.user.jurisdiction?.state || null;
    const district = cleanText(req.body?.district, 80) || f.district || req.user.jurisdiction?.district || null;
    const reportId = `r_${nanoid(8)}`;
    const now = Date.now();
    const declaration = buildFoundChildDeclaration(f, req.user);
    const childProfile = buildChildProfile({
      ...req.body,
      clothing: req.body?.clothing || f.note || null,
      vulnerabilityCategories: req.body?.vulnerabilityCategories || ['unaccompanied', 'shelter_required'],
      producedByType: req.body?.producedByType || 'cwc',
    });
    const intakeRecord = {
      id: `cci_${now}_${Math.random().toString(36).slice(2, 7)}`,
      admissionType: 'temporary_shelter',
      label: CCI_ADMISSION_TYPES.temporary_shelter,
      cciName: intakeAuthority,
      admissionDate: admissionDate.value,
      nextReviewDate,
      carePlan: note,
      services: ['counselling', 'family_tracing'],
      serviceLabels: ['Counselling', 'Family tracing'],
      progressStatus: 'intake',
      progressLabel: CCI_PROGRESS_STATES.intake,
      serviceProgress: {
        healthStatus: null,
        educationStatus: null,
        counsellingStatus: null,
        familyTracingStatus: 'Family tracing initiated from found-child intake.',
      },
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
      sourceFoundReportId: f.id,
    };
    const workflowEvent = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'found_child_intake_created',
      label: 'Found-child intake formalized',
      note: `${intakeAuthority} / ${f.foundLocation || 'location under review'}`,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const report = {
      id: reportId,
      firNo: null,
      childName,
      childAadhar: null,
      gender,
      age: age.value,
      height: null,
      weight: null,
      identificationProfile: childProfile.identificationProfile,
      vulnerabilityProfile: childProfile.vulnerabilityProfile,
      declaration,
      hasIdentificationProfile: childProfile.hasIdentificationProfile,
      hasVulnerabilityProfile: true,
      dateOfMissing: null,
      photoUrl: f.photoUrl || null,
      photoConsent: Boolean(f.photoConsent),
      dataPurpose: 'found_child_protection_intake',
      retentionUntil: retentionUntil(REPORT_PHOTO_RETENTION_DAYS),
      status: 'under_review',
      intakeStatus: 'verified',
      intakeSource: 'found_child_sighting',
      caseOrigin: 'found_child_intake',
      sourceFoundReportId: f.id,
      sourceFoundReportReceipt: f.id,
      foundChildIntake: {
        foundReportId: f.id,
        intakeAuthority,
        intakeNote: note,
        createdAt: new Date(now).toISOString(),
        createdById: req.user.id,
        createdByName: req.user.name,
        reporterConfidential: Boolean(f.confidentialReporter),
      },
      verifiedAt: now,
      verifiedById: req.user.id,
      verifiedByName: req.user.name,
      parentName: guardianName,
      parentPhone: null,
      parentEmail: null,
      address: f.foundLocation || null,
      state,
      district,
      zip: null,
      foundLocation: f.foundLocation || null,
      matchScore: Number(f.matchScore || 0),
      smsSent: false,
      registeredByRole: req.user.role,
      registeredById: req.user.id,
      cciCareRecords: [intakeRecord],
      lastCciCareAt: intakeRecord.recordedAt,
      workflow: [workflowEvent],
      workflowStatus: workflowEvent.label,
      lastWorkflowAction: workflowEvent.action,
      lastWorkflowAt: intakeRecord.recordedAt,
      createdAt: now,
    };
    addReport(report);
    updateFoundReport(f.id, {
      status: 'formalized_case',
      formalReportId: report.id,
      referralStatus: 'Formal found-child intake opened',
      cwcFollowup: f.cwcFollowup || {
        outcome: 'shelter_intake_required',
        label: CWC_FOLLOWUP_OUTCOMES.shelter_intake_required,
        note: null,
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        completedAt: new Date(now).toISOString(),
      },
    });
    addActivity({
      actor: req.user.name,
      action: 'Opened formal found-child intake',
      target: childName,
      icon: 'care',
      actorId: req.user.id,
      scope: { state, district, reportId: report.id, foundReportId: f.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'sighting.formal_intake_created',
      targetType: 'foundReport',
      targetId: f.id,
      summary: `Opened formal found-child intake for ${childName}`,
      scope: { state, district, reportId: report.id, foundReportId: f.id },
      metadata: {
        formalReportId: report.id,
        intakeAuthority,
        admissionDate: intakeRecord.admissionDate,
        nextReviewDate,
        noteLength: note.length,
        reporterConfidential: Boolean(f.confidentialReporter),
      },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.found_child_intake_created',
      targetType: 'report',
      targetId: report.id,
      summary: `Formal found-child intake created from sighting ${f.id}`,
      scope: { state, district, reportId: report.id, foundReportId: f.id },
      metadata: {
        sourceFoundReportId: f.id,
        intakeAuthority,
        admissionDate: intakeRecord.admissionDate,
        nextReviewDate,
        noteLength: note.length,
        retentionUntil: report.retentionUntil,
      },
    });
    res.status(201).json({ foundReport: findFoundReport(f.id), report: findReport(report.id), careRecord: intakeRecord });
  });

  // Police confirm a match and (optionally) alert the parent by SMS.
  router.post('/:id/confirm-match', protectedRoute, requireRole('police', 'sjpu', 'admin', 'super_admin'), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before match confirmation' });
    const { foundLocation, matchScore, sendSms } = req.body || {};
    updateReport(r.id, {
      status: 'found',
      foundLocation: foundLocation || r.foundLocation || 'Reported location',
      matchScore: matchScore != null ? Number(matchScore) : r.matchScore,
      smsSent: !!sendSms,
    });
    addActivity({ actor: req.user.name, action: sendSms ? 'Confirmed match & alerted parent' : 'Confirmed match', target: r.childName, icon: 'check', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.match_confirmed',
      targetType: 'report',
      targetId: r.id,
      summary: `${sendSms ? 'Confirmed match and alerted parent' : 'Confirmed match'} for ${r.childName}`,
      scope: { state: r.state, district: r.district },
      metadata: { sendSms: !!sendSms },
    });
    res.json({ report: findReport(r.id) });
  });

  router.post('/:id/send-sms', protectedRoute, requireRole('police', 'sjpu', 'admin', 'super_admin'), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before parent SMS alerts' });
    updateReport(r.id, { smsSent: true });
    addActivity({ actor: req.user.name, action: `SMS alert sent to ${r.parentName || 'parent'}`, target: r.childName, icon: 'sms', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.sms_sent',
      targetType: 'report',
      targetId: r.id,
      summary: `SMS alert sent for ${r.childName}`,
      scope: { state: r.state, district: r.district },
    });
    res.json({ ok: true, message: `SMS sent to ${r.parentPhone || 'parent'}`, report: findReport(r.id) });
  });

  router.post('/:id/case-workflow', protectedRoute, requireRole(...CASE_WORKFLOW_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before institutional handoff' });

    const { action, note } = req.body || {};
    const config = CASE_WORKFLOW_ACTIONS[action];
    if (!config) {
      return res.status(400).json({ error: `Action must be one of ${Object.keys(CASE_WORKFLOW_ACTIONS).join(', ')}` });
    }
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found/reunited or closed cases cannot be moved into institutional workflow' });

    const event = {
      id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      action,
      label: config.label,
      note: note || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const patch = {
      status: config.status,
      workflow,
      workflowStatus: config.label,
      lastWorkflowAction: action,
      lastWorkflowAt: new Date(event.ts).toISOString(),
    };
    updateReport(r.id, patch);
    addActivity({ actor: req.user.name, action: config.activity, target: r.childName, icon: 'referral', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: config.audit,
      targetType: 'report',
      targetId: r.id,
      summary: `${config.label} for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { action, note: note || null },
    });
    res.json({ report: findReport(r.id) });
  });

  router.get('/:id/assignable-users', protectedRoute, requireRole(...CASE_ASSIGN_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    res.json({ users: assignableUsersForReport(req.user, r, listUsers()) });
  });

  router.post('/:id/assign-owner', protectedRoute, requireRole(...CASE_ASSIGN_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before owner assignment' });
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found or closed cases cannot receive owner assignments' });

    const assigneeId = cleanText(req.body?.assigneeId, 80);
    const assignee = listUsers().find((user) => user.id === assigneeId);
    if (!assignee) return res.status(404).json({ error: 'Assignee not found' });
    if (!canAssignUserToReport(req.user, assignee, r)) return res.status(403).json({ error: 'Assignee is outside this case jurisdiction or role scope' });

    const assignmentType = cleanText(req.body?.assignmentType, 40) || 'investigation';
    if (!CASE_ASSIGNMENT_TYPES[assignmentType]) {
      return res.status(400).json({ error: `Assignment type must be one of ${Object.keys(CASE_ASSIGNMENT_TYPES).join(', ')}` });
    }
    let dueDate = null;
    if (req.body?.dueDate) {
      const parsed = parseDateInput(req.body.dueDate, 'Due date');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (parsed.time < Date.now() - DAY) return res.status(400).json({ error: 'Due date cannot be in the past' });
      dueDate = parsed.value;
    }

    const now = Date.now();
    const note = cleanText(req.body?.note, 500);
    const assignment = {
      id: `assign_${now}_${Math.random().toString(36).slice(2, 7)}`,
      assignmentType,
      assignmentLabel: CASE_ASSIGNMENT_TYPES[assignmentType],
      assigneeId: assignee.id,
      assigneeName: assignee.name,
      assigneeRole: assignee.role,
      assigneeOrg: assignee.org || null,
      assigneeJurisdiction: assignee.jurisdiction || {},
      dueDate,
      note: note || null,
      assignedById: req.user.id,
      assignedByName: req.user.name,
      assignedByRole: req.user.role,
      assignedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'assign_owner',
      label: `${assignment.assignmentLabel}: ${assignee.name}`,
      note: note || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const assignments = [...(Array.isArray(r.assignments) ? r.assignments : []), assignment];
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    updateReport(r.id, {
      assignments,
      assignedToId: assignee.id,
      assignedToName: assignee.name,
      assignedToRole: assignee.role,
      assignedToOrg: assignee.org || null,
      assignmentStatus: 'assigned',
      currentAssignmentType: assignmentType,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'assign_owner',
      lastWorkflowAt: assignment.assignedAt,
      lastAssignmentAt: assignment.assignedAt,
    });
    addActivity({
      actor: req.user.name,
      action: `Assigned ${CASE_ASSIGNMENT_TYPES[assignmentType].toLowerCase()}`,
      target: r.childName,
      icon: 'assignment',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.assigned_owner',
      targetType: 'report',
      targetId: r.id,
      summary: `Assigned ${CASE_ASSIGNMENT_TYPES[assignmentType].toLowerCase()} for ${r.childName} to ${assignee.name}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        assignmentType,
        assigneeId: assignee.id,
        assigneeRole: assignee.role,
        assigneeOrg: assignee.org || null,
        dueDate,
        noteLength: note.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), assignment });
  });

  router.post('/:id/investigation-checklist', protectedRoute, requireRole(...INVESTIGATION_CHECKLIST_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before investigation checklist updates' });
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found or closed cases cannot receive investigation checklist updates' });

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const selectedItems = [...new Set(items.map((item) => cleanText(item, 60)).filter(Boolean))];
    const invalid = selectedItems.filter((item) => !INVESTIGATION_CHECKLIST_ITEMS[item]);
    if (invalid.length) {
      return res.status(400).json({ error: `Checklist items must be one of ${Object.keys(INVESTIGATION_CHECKLIST_ITEMS).join(', ')}` });
    }
    if (selectedItems.length === 0) return res.status(400).json({ error: 'Select at least one investigation checklist item' });

    const actionDate = req.body?.actionDate ? optionalDateInput(req.body.actionDate, 'Action date', { maxTime: Date.now() + DAY }) : { value: new Date().toISOString().slice(0, 10) };
    if (actionDate.error) return res.status(400).json({ error: actionDate.error });
    const officerName = cleanText(req.body?.officerName || req.user.name, 140);
    const stationDiaryNo = cleanText(req.body?.stationDiaryNo, 120) || null;
    const followupDate = req.body?.followupDate ? optionalDateInput(req.body.followupDate, 'Follow-up date') : { value: null };
    if (followupDate.error) return res.status(400).json({ error: followupDate.error });
    const note = cleanText(req.body?.note, 1000);
    if (officerName.length < 3) return res.status(400).json({ error: 'Officer or desk name is required' });

    const now = Date.now();
    const checklistRecord = {
      id: `inv_${now}_${Math.random().toString(36).slice(2, 7)}`,
      items: selectedItems,
      itemLabels: selectedItems.map((item) => INVESTIGATION_CHECKLIST_ITEMS[item]),
      officerName,
      stationDiaryNo,
      actionDate: actionDate.value,
      followupDate: followupDate.value,
      note: note || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'investigation_checklist_updated',
      label: `Investigation checklist: ${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'}`,
      note: stationDiaryNo ? `Diary ${stationDiaryNo}` : null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const investigationChecklist = [...(Array.isArray(r.investigationChecklist) ? r.investigationChecklist : []), checklistRecord];
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    updateReport(r.id, {
      investigationChecklist,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'investigation_checklist_updated',
      lastWorkflowAt: checklistRecord.recordedAt,
      lastInvestigationChecklistAt: checklistRecord.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: 'Updated investigation checklist',
      target: r.childName,
      icon: 'checklist',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.investigation_checklist_updated',
      targetType: 'report',
      targetId: r.id,
      summary: `Updated investigation checklist for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        items: selectedItems,
        itemCount: selectedItems.length,
        stationDiaryPresent: Boolean(stationDiaryNo),
        actionDate: checklistRecord.actionDate,
        followupDate: checklistRecord.followupDate,
        noteLength: note.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), checklistRecord });
  });

  router.post('/:id/close-case', protectedRoute, requireRole(...CASE_CLOSE_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before case closure' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Case is already closed' });

    const { reason, note, foundLocation } = req.body || {};
    if (!CASE_CLOSE_REASONS[reason]) {
      return res.status(400).json({ error: `Closure reason must be one of ${Object.keys(CASE_CLOSE_REASONS).join(', ')}` });
    }
    if (reason === 'restored_family' && !r.foundLocation && !foundLocation) {
      return res.status(400).json({ error: 'Found/restoration location is required before closing as restored to family' });
    }

    const now = Date.now();
    const closure = {
      reason,
      label: CASE_CLOSE_REASONS[reason],
      note: cleanText(note, 500) || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      closedAt: new Date(now).toISOString(),
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'close_case',
      label: `Closed: ${closure.label}`,
      note: closure.note,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    }];
    const patch = {
      status: 'closed',
      closure,
      workflow,
      workflowStatus: `Closed: ${closure.label}`,
      lastWorkflowAction: 'close_case',
      lastWorkflowAt: closure.closedAt,
      foundLocation: foundLocation || r.foundLocation || null,
    };
    updateReport(r.id, patch);
    addActivity({ actor: req.user.name, action: `Closed case: ${closure.label}`, target: r.childName, icon: 'check', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.closed',
      targetType: 'report',
      targetId: r.id,
      summary: `Closed case for ${r.childName}: ${closure.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: closure,
    });
    res.json({ report: findReport(r.id) });
  });

  router.post('/:id/notes', protectedRoute, requireRole(...CASE_NOTE_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    const noteText = cleanText(req.body?.note, 1000);
    if (noteText.length < 3) return res.status(400).json({ error: 'Case note must be at least 3 characters' });
    const note = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      note: noteText,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const notes = [...(Array.isArray(r.notes) ? r.notes : []), note];
    updateReport(r.id, { notes, lastNoteAt: new Date(note.ts).toISOString() });
    addActivity({ actor: req.user.name, action: 'Added case note', target: r.childName, icon: 'note', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.note_added',
      targetType: 'report',
      targetId: r.id,
      summary: `Added case note for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { noteLength: noteText.length },
    });
    res.status(201).json({ report: findReport(r.id), note });
  });

  router.post('/:id/cci-care', protectedRoute, requireRole(...CCI_CARE_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before CCI care recording' });
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found or closed cases cannot receive new CCI care records' });

    const { admissionType } = req.body || {};
    if (!CCI_ADMISSION_TYPES[admissionType]) {
      return res.status(400).json({ error: `Admission type must be one of ${Object.keys(CCI_ADMISSION_TYPES).join(', ')}` });
    }
    const cciName = cleanText(req.body?.cciName, 140);
    const carePlan = cleanText(req.body?.carePlan, 1200);
    const services = listValues(req.body?.services, CCI_SERVICE_TYPES);
    const progressStatus = cleanText(req.body?.progressStatus, 40) || 'intake';
    if (!CCI_PROGRESS_STATES[progressStatus]) {
      return res.status(400).json({ error: `Progress status must be one of ${Object.keys(CCI_PROGRESS_STATES).join(', ')}` });
    }
    const healthStatus = cleanText(req.body?.healthStatus, 240) || null;
    const educationStatus = cleanText(req.body?.educationStatus, 240) || null;
    const counsellingStatus = cleanText(req.body?.counsellingStatus, 240) || null;
    const familyTracingStatus = cleanText(req.body?.familyTracingStatus, 240) || null;
    const admissionDate = parseDateInput(req.body?.admissionDate, 'Admission date');
    if (admissionDate.error) return res.status(400).json({ error: admissionDate.error });
    if (admissionDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Admission date cannot be in the future' });
    if (cciName.length < 3) return res.status(400).json({ error: 'CCI name must be at least 3 characters' });
    if (carePlan.length < 10) return res.status(400).json({ error: 'Care plan must be at least 10 characters' });

    let nextReviewDate = null;
    if (req.body?.nextReviewDate) {
      const parsed = parseDateInput(req.body.nextReviewDate, 'Next review date');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (parsed.time < Date.now() - DAY) return res.status(400).json({ error: 'Next review date cannot be in the past' });
      nextReviewDate = parsed.value;
    }

    const now = Date.now();
    const careRecord = {
      id: `cci_${now}_${Math.random().toString(36).slice(2, 7)}`,
      admissionType,
      label: CCI_ADMISSION_TYPES[admissionType],
      cciName,
      admissionDate: admissionDate.value,
      nextReviewDate,
      carePlan,
      services,
      serviceLabels: services.map((item) => CCI_SERVICE_TYPES[item]),
      progressStatus,
      progressLabel: CCI_PROGRESS_STATES[progressStatus],
      serviceProgress: {
        healthStatus,
        educationStatus,
        counsellingStatus,
        familyTracingStatus,
      },
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'cci_care_recorded',
      label: `CCI care recorded: ${careRecord.label}`,
      note: `${careRecord.cciName}${nextReviewDate ? ` / review ${nextReviewDate}` : ''}`,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const cciCareRecords = [...(Array.isArray(r.cciCareRecords) ? r.cciCareRecords : []), careRecord];
    updateReport(r.id, {
      status: 'under_review',
      cciCareRecords,
      lastCciCareAt: careRecord.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'cci_care_recorded',
      lastWorkflowAt: careRecord.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'care',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.cci_care_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded CCI care for ${r.childName}: ${careRecord.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        admissionType,
        cciName,
        admissionDate: careRecord.admissionDate,
        nextReviewDate,
        carePlanLength: carePlan.length,
        services,
        progressStatus,
        healthStatusLength: healthStatus ? healthStatus.length : 0,
        educationStatusLength: educationStatus ? educationStatus.length : 0,
        counsellingStatusLength: counsellingStatus ? counsellingStatus.length : 0,
        familyTracingStatusLength: familyTracingStatus ? familyTracingStatus.length : 0,
      },
    });
    res.status(201).json({ report: findReport(r.id), careRecord });
  });

  router.post('/:id/jjb-proceeding', protectedRoute, requireRole(...JJB_PROCEEDING_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before JJB proceeding recording' });
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found or closed cases cannot receive new JJB proceeding records' });

    const { proceedingType } = req.body || {};
    if (!JJB_PROCEEDING_TYPES[proceedingType]) {
      return res.status(400).json({ error: `Proceeding type must be one of ${Object.keys(JJB_PROCEEDING_TYPES).join(', ')}` });
    }
    const boardName = cleanText(req.body?.boardName, 140);
    const caseNo = cleanText(req.body?.caseNo, 80) || null;
    const directions = cleanText(req.body?.directions, 1200);
    const orderDate = parseDateInput(req.body?.orderDate, 'Order date');
    if (orderDate.error) return res.status(400).json({ error: orderDate.error });
    if (orderDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Order date cannot be in the future' });
    if (boardName.length < 3) return res.status(400).json({ error: 'JJB name must be at least 3 characters' });
    if (directions.length < 10) return res.status(400).json({ error: 'Directions must be at least 10 characters' });

    let nextHearingDate = null;
    if (req.body?.nextHearingDate) {
      const parsed = parseDateInput(req.body.nextHearingDate, 'Next hearing date');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (parsed.time < Date.now() - DAY) return res.status(400).json({ error: 'Next hearing date cannot be in the past' });
      nextHearingDate = parsed.value;
    }

    const now = Date.now();
    const proceeding = {
      id: `jjb_${now}_${Math.random().toString(36).slice(2, 7)}`,
      proceedingType,
      label: JJB_PROCEEDING_TYPES[proceedingType],
      boardName,
      caseNo,
      orderDate: orderDate.value,
      nextHearingDate,
      directions,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'jjb_proceeding_recorded',
      label: `JJB proceeding recorded: ${proceeding.label}`,
      note: `${proceeding.boardName}${nextHearingDate ? ` / next hearing ${nextHearingDate}` : ''}`,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const jjbProceedings = [...(Array.isArray(r.jjbProceedings) ? r.jjbProceedings : []), proceeding];
    updateReport(r.id, {
      status: 'under_review',
      jjbProceedings,
      lastJjbProceedingAt: proceeding.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'jjb_proceeding_recorded',
      lastWorkflowAt: proceeding.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'hearing',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.jjb_proceeding_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded JJB proceeding for ${r.childName}: ${proceeding.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        proceedingType,
        boardName,
        caseNo,
        orderDate: proceeding.orderDate,
        nextHearingDate,
        directionsLength: directions.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), proceeding });
  });

  router.post('/:id/state-escalation', protectedRoute, requireRole(...STATE_ESCALATION_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before state escalation recording' });
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found or closed cases cannot receive new state escalation records' });

    const { escalationType, escalationLevel, priority = 'priority' } = req.body || {};
    if (!STATE_ESCALATION_TYPES[escalationType]) {
      return res.status(400).json({ error: `Escalation type must be one of ${Object.keys(STATE_ESCALATION_TYPES).join(', ')}` });
    }
    if (!STATE_ESCALATION_LEVELS[escalationLevel]) {
      return res.status(400).json({ error: `Escalation level must be one of ${Object.keys(STATE_ESCALATION_LEVELS).join(', ')}` });
    }
    if (!BUREAU_PRIORITIES[priority]) {
      return res.status(400).json({ error: `Priority must be one of ${Object.keys(BUREAU_PRIORITIES).join(', ')}` });
    }
    const authorityName = cleanText(req.body?.authorityName, 140);
    const referenceNo = cleanText(req.body?.referenceNo, 100) || null;
    const actionRequired = cleanText(req.body?.actionRequired, 1200);
    const escalatedDate = parseDateInput(req.body?.escalatedDate, 'Escalation date');
    if (escalatedDate.error) return res.status(400).json({ error: escalatedDate.error });
    if (escalatedDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Escalation date cannot be in the future' });
    if (authorityName.length < 3) return res.status(400).json({ error: 'Authority name must be at least 3 characters' });
    if (actionRequired.length < 10) return res.status(400).json({ error: 'Action required must be at least 10 characters' });

    let dueDate = null;
    if (req.body?.dueDate) {
      const parsed = parseDateInput(req.body.dueDate, 'Due date');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (parsed.time < Date.now() - DAY) return res.status(400).json({ error: 'Due date cannot be in the past' });
      dueDate = parsed.value;
    }

    const now = Date.now();
    const stateEscalation = {
      id: `state_${now}_${Math.random().toString(36).slice(2, 7)}`,
      escalationType,
      label: STATE_ESCALATION_TYPES[escalationType],
      escalationLevel,
      levelLabel: STATE_ESCALATION_LEVELS[escalationLevel],
      priority,
      priorityLabel: BUREAU_PRIORITIES[priority],
      authorityName,
      referenceNo,
      escalatedDate: escalatedDate.value,
      dueDate,
      actionRequired,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'state_escalation_recorded',
      label: `State escalation recorded: ${stateEscalation.label}`,
      note: [stateEscalation.levelLabel, stateEscalation.priorityLabel, stateEscalation.referenceNo].filter(Boolean).join(' / '),
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const stateEscalations = [...(Array.isArray(r.stateEscalations) ? r.stateEscalations : []), stateEscalation];
    updateReport(r.id, {
      status: 'under_review',
      stateEscalations,
      lastStateEscalationAt: stateEscalation.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'state_escalation_recorded',
      lastWorkflowAt: stateEscalation.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'escalation',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.state_escalation_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded state escalation for ${r.childName}: ${stateEscalation.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        escalationType,
        escalationLevel,
        priority,
        authorityName,
        referenceNo,
        escalatedDate: stateEscalation.escalatedDate,
        dueDate,
        actionRequiredLength: actionRequired.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), stateEscalation });
  });

  router.post('/:id/bureau-report', protectedRoute, requireRole(...BUREAU_REPORT_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before bureau reporting' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases cannot receive new bureau report records' });

    const { reportType, bureauLevel, priority = 'routine' } = req.body || {};
    if (!BUREAU_REPORT_TYPES[reportType]) {
      return res.status(400).json({ error: `Report type must be one of ${Object.keys(BUREAU_REPORT_TYPES).join(', ')}` });
    }
    if (!BUREAU_LEVELS[bureauLevel]) {
      return res.status(400).json({ error: `Bureau level must be one of ${Object.keys(BUREAU_LEVELS).join(', ')}` });
    }
    if (!BUREAU_PRIORITIES[priority]) {
      return res.status(400).json({ error: `Priority must be one of ${Object.keys(BUREAU_PRIORITIES).join(', ')}` });
    }
    const referenceNo = cleanText(req.body?.referenceNo, 100) || null;
    const summary = cleanText(req.body?.summary, 1200);
    const submittedDate = parseDateInput(req.body?.submittedDate, 'Submission date');
    if (submittedDate.error) return res.status(400).json({ error: submittedDate.error });
    if (submittedDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Submission date cannot be in the future' });
    if (summary.length < 10) return res.status(400).json({ error: 'Bureau summary must be at least 10 characters' });

    let nextReviewDate = null;
    if (req.body?.nextReviewDate) {
      const parsed = parseDateInput(req.body.nextReviewDate, 'Next review date');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (parsed.time < Date.now() - DAY) return res.status(400).json({ error: 'Next review date cannot be in the past' });
      nextReviewDate = parsed.value;
    }

    const now = Date.now();
    const bureauReport = {
      id: `bureau_${now}_${Math.random().toString(36).slice(2, 7)}`,
      reportType,
      label: BUREAU_REPORT_TYPES[reportType],
      bureauLevel,
      bureauLabel: BUREAU_LEVELS[bureauLevel],
      priority,
      priorityLabel: BUREAU_PRIORITIES[priority],
      referenceNo,
      submittedDate: submittedDate.value,
      nextReviewDate,
      summary,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'bureau_report_recorded',
      label: `${bureauReport.bureauLabel} report recorded: ${bureauReport.label}`,
      note: [bureauReport.referenceNo, bureauReport.priorityLabel].filter(Boolean).join(' / ') || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const bureauReports = [...(Array.isArray(r.bureauReports) ? r.bureauReports : []), bureauReport];
    updateReport(r.id, {
      status: r.status === 'found' ? r.status : 'under_review',
      bureauReports,
      lastBureauReportAt: bureauReport.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'bureau_report_recorded',
      lastWorkflowAt: bureauReport.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'bureau',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.bureau_report_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded ${bureauReport.bureauLabel} report for ${r.childName}: ${bureauReport.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        reportType,
        bureauLevel,
        priority,
        referenceNo,
        submittedDate: bureauReport.submittedDate,
        nextReviewDate,
        summaryLength: summary.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), bureauReport });
  });

  router.post('/:id/external-id', protectedRoute, requireRole(...EXTERNAL_ID_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before external ID linking' });

    const idType = cleanText(req.body?.idType, 40);
    if (!EXTERNAL_ID_TYPES[idType]) {
      return res.status(400).json({ error: `External ID type must be one of ${Object.keys(EXTERNAL_ID_TYPES).join(', ')}` });
    }
    const externalId = cleanText(req.body?.externalId, 120);
    const issuingSystem = cleanText(req.body?.issuingSystem, 140) || EXTERNAL_ID_TYPES[idType];
    const remarks = cleanText(req.body?.remarks, 800);
    const issuedDate = req.body?.issuedDate ? optionalDateInput(req.body.issuedDate, 'Issued date', { maxTime: Date.now() + DAY }) : { value: null };
    if (issuedDate.error) return res.status(400).json({ error: issuedDate.error });
    if (externalId.length < 3) return res.status(400).json({ error: 'External ID must be at least 3 characters' });
    const existing = Array.isArray(r.externalIds) ? r.externalIds : [];
    if (existing.some((row) => row.idType === idType && row.externalId.toLowerCase() === externalId.toLowerCase())) {
      return res.status(409).json({ error: 'This external ID is already linked to the case' });
    }

    const now = Date.now();
    const externalRecord = {
      id: `ext_${now}_${Math.random().toString(36).slice(2, 7)}`,
      idType,
      label: EXTERNAL_ID_TYPES[idType],
      externalId,
      issuingSystem,
      issuedDate: issuedDate.value,
      remarks,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'external_id_linked',
      label: `External ID linked: ${externalRecord.label}`,
      note: `${externalRecord.issuingSystem} / ${externalRecord.externalId}`,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const externalIds = [...existing, externalRecord];
    updateReport(r.id, {
      externalIds,
      lastExternalIdAt: externalRecord.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'external_id_linked',
      lastWorkflowAt: externalRecord.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'link',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.external_id_linked',
      targetType: 'report',
      targetId: r.id,
      summary: `Linked ${externalRecord.label} for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        idType,
        externalId,
        issuingSystem,
        issuedDate: externalRecord.issuedDate,
        remarksLength: remarks.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), externalRecord });
  });

  router.post('/:id/restoration-plan', protectedRoute, requireRole(...RESTORATION_PLAN_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before restoration planning' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases cannot receive new restoration plans' });

    const { restorationType, status = 'planned' } = req.body || {};
    if (!RESTORATION_TYPES[restorationType]) {
      return res.status(400).json({ error: `Restoration type must be one of ${Object.keys(RESTORATION_TYPES).join(', ')}` });
    }
    if (!RESTORATION_STATUSES[status]) {
      return res.status(400).json({ error: `Restoration status must be one of ${Object.keys(RESTORATION_STATUSES).join(', ')}` });
    }
    const fromState = cleanText(req.body?.fromState || r.state, 80);
    const fromDistrict = cleanText(req.body?.fromDistrict || r.district, 80);
    const toState = cleanText(req.body?.toState, 80);
    const toDistrict = cleanText(req.body?.toDistrict, 80);
    const guardianName = cleanText(req.body?.guardianName || r.parentName, 120) || null;
    const handoverAuthority = cleanText(req.body?.handoverAuthority, 140);
    const remarks = cleanText(req.body?.remarks, 1200);
    const supports = listValues(req.body?.supports, RESTORATION_SUPPORTS);
    const travelMode = cleanText(req.body?.travelMode, 40) || 'not_required';
    const documentStatus = cleanText(req.body?.documentStatus, 40) || 'pending';
    const fundingSource = cleanText(req.body?.fundingSource, 40) || 'not_required';
    if (!RESTORATION_TRAVEL_MODES[travelMode]) {
      return res.status(400).json({ error: `Travel mode must be one of ${Object.keys(RESTORATION_TRAVEL_MODES).join(', ')}` });
    }
    if (!RESTORATION_DOCUMENT_STATUSES[documentStatus]) {
      return res.status(400).json({ error: `Document status must be one of ${Object.keys(RESTORATION_DOCUMENT_STATUSES).join(', ')}` });
    }
    if (!RESTORATION_FUNDING_SOURCES[fundingSource]) {
      return res.status(400).json({ error: `Funding source must be one of ${Object.keys(RESTORATION_FUNDING_SOURCES).join(', ')}` });
    }
    const plannedDate = optionalDateInput(req.body?.plannedDate, 'Planned date', { minTime: Date.now() - DAY });
    if (plannedDate.error) return res.status(400).json({ error: plannedDate.error });
    const followupDate = optionalDateInput(req.body?.followupDate, 'Follow-up date', { minTime: Date.now() - DAY });
    if (followupDate.error) return res.status(400).json({ error: followupDate.error });
    const travelDate = optionalDateInput(req.body?.travelDate, 'Travel date', { minTime: Date.now() - DAY });
    if (travelDate.error) return res.status(400).json({ error: travelDate.error });
    const escortAuthority = cleanText(req.body?.escortAuthority, 140) || null;
    const escortContact = cleanText(req.body?.escortContact, 40) || null;
    const documentReference = cleanText(req.body?.documentReference, 120) || null;
    const fundingReference = cleanText(req.body?.fundingReference, 120) || null;
    if (escortContact && !/^\d{7,15}$/.test(digits(escortContact))) return res.status(400).json({ error: 'Escort contact must be 7 to 15 digits' });
    if (toState.length < 2 || toDistrict.length < 2) return res.status(400).json({ error: 'Target state and district are required' });
    if (handoverAuthority.length < 3) return res.status(400).json({ error: 'Handover authority must be at least 3 characters' });
    if (remarks.length < 10) return res.status(400).json({ error: 'Restoration remarks must be at least 10 characters' });

    const now = Date.now();
    const restorationPlan = {
      id: `restore_${now}_${Math.random().toString(36).slice(2, 7)}`,
      restorationType,
      label: RESTORATION_TYPES[restorationType],
      status,
      statusLabel: RESTORATION_STATUSES[status],
      from: { state: fromState || null, district: fromDistrict || null },
      to: { state: toState, district: toDistrict },
      guardianName,
      handoverAuthority,
      supports,
      supportLabels: supports.map((item) => RESTORATION_SUPPORTS[item]),
      plannedDate: plannedDate.value,
      followupDate: followupDate.value,
      travel: {
        mode: travelMode,
        modeLabel: RESTORATION_TRAVEL_MODES[travelMode],
        travelDate: travelDate.value,
        escortAuthority,
        escortContact,
      },
      documents: {
        status: documentStatus,
        statusLabel: RESTORATION_DOCUMENT_STATUSES[documentStatus],
        reference: documentReference,
      },
      funding: {
        source: fundingSource,
        sourceLabel: RESTORATION_FUNDING_SOURCES[fundingSource],
        reference: fundingReference,
      },
      remarks,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'restoration_plan_recorded',
      label: `Restoration plan recorded: ${restorationPlan.label}`,
      note: [restorationPlan.statusLabel, toDistrict, toState].filter(Boolean).join(' / '),
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const restorationPlans = [...(Array.isArray(r.restorationPlans) ? r.restorationPlans : []), restorationPlan];
    updateReport(r.id, {
      status: r.status === 'found' ? 'under_review' : r.status,
      restorationPlans,
      lastRestorationPlanAt: restorationPlan.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'restoration_plan_recorded',
      lastWorkflowAt: restorationPlan.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'restore',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.restoration_plan_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded restoration plan for ${r.childName}: ${restorationPlan.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id, targetState: toState, targetDistrict: toDistrict },
      metadata: {
        restorationType,
        status,
        from: restorationPlan.from,
        to: restorationPlan.to,
        handoverAuthority,
        supports,
        plannedDate: restorationPlan.plannedDate,
        followupDate: restorationPlan.followupDate,
        travelMode,
        travelDate: restorationPlan.travel.travelDate,
        escortAuthorityPresent: Boolean(escortAuthority),
        escortContactPresent: Boolean(escortContact),
        documentStatus,
        documentReferencePresent: Boolean(documentReference),
        fundingSource,
        fundingReferencePresent: Boolean(fundingReference),
        guardianNamePresent: Boolean(guardianName),
        remarksLength: remarks.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), restorationPlan });
  });

  router.post('/:id/welfare-referral', protectedRoute, requireRole(...WELFARE_REFERRAL_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before welfare referral' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases cannot receive new welfare referrals' });

    const scheme = cleanText(req.body?.scheme, 50);
    const status = cleanText(req.body?.status, 50) || 'referred';
    if (!WELFARE_SCHEMES[scheme]) {
      return res.status(400).json({ error: `Scheme must be one of ${Object.keys(WELFARE_SCHEMES).join(', ')}` });
    }
    if (!WELFARE_STATUSES[status]) {
      return res.status(400).json({ error: `Status must be one of ${Object.keys(WELFARE_STATUSES).join(', ')}` });
    }
    const agencyName = cleanText(req.body?.agencyName, 140);
    const referralNo = cleanText(req.body?.referralNo, 100) || null;
    const eligibilityNote = cleanText(req.body?.eligibilityNote, 1200);
    const referredDate = parseDateInput(req.body?.referredDate, 'Referral date');
    if (referredDate.error) return res.status(400).json({ error: referredDate.error });
    if (referredDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Referral date cannot be in the future' });
    if (agencyName.length < 3) return res.status(400).json({ error: 'Agency name must be at least 3 characters' });
    if (eligibilityNote.length < 10) return res.status(400).json({ error: 'Eligibility note must be at least 10 characters' });

    const reviewDate = optionalDateInput(req.body?.reviewDate, 'Review date', { minTime: Date.now() - DAY });
    if (reviewDate.error) return res.status(400).json({ error: reviewDate.error });

    const now = Date.now();
    const welfareReferral = {
      id: `welfare_${now}_${Math.random().toString(36).slice(2, 7)}`,
      scheme,
      label: WELFARE_SCHEMES[scheme],
      status,
      statusLabel: WELFARE_STATUSES[status],
      agencyName,
      referralNo,
      referredDate: referredDate.value,
      reviewDate: reviewDate.value,
      eligibilityNote,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'welfare_referral_recorded',
      label: `Welfare referral recorded: ${welfareReferral.label}`,
      note: [welfareReferral.statusLabel, welfareReferral.agencyName, welfareReferral.referralNo].filter(Boolean).join(' / '),
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const welfareReferrals = [...(Array.isArray(r.welfareReferrals) ? r.welfareReferrals : []), welfareReferral];
    updateReport(r.id, {
      status: r.status === 'found' ? 'under_review' : r.status,
      welfareReferrals,
      lastWelfareReferralAt: welfareReferral.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'welfare_referral_recorded',
      lastWorkflowAt: welfareReferral.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'welfare',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.welfare_referral_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded welfare referral for ${r.childName}: ${welfareReferral.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        scheme,
        status,
        agencyName,
        referralNo,
        referredDate: welfareReferral.referredDate,
        reviewDate: welfareReferral.reviewDate,
        eligibilityNoteLength: eligibilityNote.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), welfareReferral });
  });

  router.post('/:id/legal-aid-referral', protectedRoute, requireRole(...LEGAL_AID_REFERRAL_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before legal-aid referral' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases cannot receive new legal-aid referrals' });

    const serviceType = cleanText(req.body?.serviceType, 60);
    const status = cleanText(req.body?.status, 60) || 'referred';
    if (!LEGAL_AID_SERVICE_TYPES[serviceType]) {
      return res.status(400).json({ error: `Service type must be one of ${Object.keys(LEGAL_AID_SERVICE_TYPES).join(', ')}` });
    }
    if (!LEGAL_AID_STATUSES[status]) {
      return res.status(400).json({ error: `Status must be one of ${Object.keys(LEGAL_AID_STATUSES).join(', ')}` });
    }
    const authorityName = cleanText(req.body?.authorityName || req.user.org || req.user.name, 140);
    const applicationNo = cleanText(req.body?.applicationNo, 100) || null;
    const note = cleanText(req.body?.note, 1200);
    const referredDate = parseDateInput(req.body?.referredDate, 'Referral date');
    if (referredDate.error) return res.status(400).json({ error: referredDate.error });
    if (referredDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Referral date cannot be in the future' });
    const hearingDate = optionalDateInput(req.body?.hearingDate, 'Hearing date', { minTime: Date.now() - DAY });
    if (hearingDate.error) return res.status(400).json({ error: hearingDate.error });
    const reviewDate = optionalDateInput(req.body?.reviewDate, 'Review date', { minTime: Date.now() - DAY });
    if (reviewDate.error) return res.status(400).json({ error: reviewDate.error });
    if (authorityName.length < 3) return res.status(400).json({ error: 'Authority name must be at least 3 characters' });
    if (note.length < 10) return res.status(400).json({ error: 'Legal-aid note must be at least 10 characters' });

    const now = Date.now();
    const legalAidReferral = {
      id: `legal_${now}_${Math.random().toString(36).slice(2, 7)}`,
      serviceType,
      label: LEGAL_AID_SERVICE_TYPES[serviceType],
      status,
      statusLabel: LEGAL_AID_STATUSES[status],
      authorityName,
      applicationNo,
      referredDate: referredDate.value,
      hearingDate: hearingDate.value,
      reviewDate: reviewDate.value,
      note,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'legal_aid_referral_recorded',
      label: `Legal-aid referral recorded: ${legalAidReferral.label}`,
      note: [legalAidReferral.statusLabel, legalAidReferral.authorityName, legalAidReferral.applicationNo].filter(Boolean).join(' / '),
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const legalAidReferrals = [...(Array.isArray(r.legalAidReferrals) ? r.legalAidReferrals : []), legalAidReferral];
    updateReport(r.id, {
      status: r.status === 'found' ? 'under_review' : r.status,
      legalAidReferrals,
      lastLegalAidReferralAt: legalAidReferral.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'legal_aid_referral_recorded',
      lastWorkflowAt: legalAidReferral.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'legal',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.legal_aid_referral_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded legal-aid referral for ${r.childName}: ${legalAidReferral.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        serviceType,
        status,
        authorityName,
        applicationNoPresent: Boolean(applicationNo),
        referredDate: legalAidReferral.referredDate,
        hearingDate: legalAidReferral.hearingDate,
        reviewDate: legalAidReferral.reviewDate,
        noteLength: note.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), legalAidReferral });
  });

  router.post('/:id/adoption-record', protectedRoute, requireRole(...ADOPTION_RECORD_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before adoption follow-up' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases cannot receive new adoption records' });

    const recordType = cleanText(req.body?.recordType, 70);
    const status = cleanText(req.body?.status, 70) || 'initiated';
    if (!ADOPTION_RECORD_TYPES[recordType]) {
      return res.status(400).json({ error: `Adoption record type must be one of ${Object.keys(ADOPTION_RECORD_TYPES).join(', ')}` });
    }
    if (!ADOPTION_STATUSES[status]) {
      return res.status(400).json({ error: `Status must be one of ${Object.keys(ADOPTION_STATUSES).join(', ')}` });
    }
    const agencyName = cleanText(req.body?.agencyName || req.user.org || req.user.name, 140);
    const caringsId = cleanText(req.body?.caringsId, 100) || null;
    const orderNo = cleanText(req.body?.orderNo, 100) || null;
    const note = cleanText(req.body?.note, 1200);
    const orderDate = parseDateInput(req.body?.orderDate, 'Order/action date');
    if (orderDate.error) return res.status(400).json({ error: orderDate.error });
    if (orderDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Order/action date cannot be in the future' });
    const nextReviewDate = optionalDateInput(req.body?.nextReviewDate, 'Next review date', { minTime: Date.now() - DAY });
    if (nextReviewDate.error) return res.status(400).json({ error: nextReviewDate.error });
    if (agencyName.length < 3) return res.status(400).json({ error: 'Agency name must be at least 3 characters' });
    if (note.length < 10) return res.status(400).json({ error: 'Adoption follow-up note must be at least 10 characters' });

    const now = Date.now();
    const adoptionRecord = {
      id: `adoption_${now}_${Math.random().toString(36).slice(2, 7)}`,
      recordType,
      label: ADOPTION_RECORD_TYPES[recordType],
      status,
      statusLabel: ADOPTION_STATUSES[status],
      agencyName,
      caringsId,
      orderNo,
      orderDate: orderDate.value,
      nextReviewDate: nextReviewDate.value,
      note,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'adoption_recorded',
      label: `Adoption follow-up recorded: ${adoptionRecord.label}`,
      note: [adoptionRecord.statusLabel, adoptionRecord.agencyName, adoptionRecord.caringsId ? 'CARINGS linked' : null].filter(Boolean).join(' / '),
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const adoptionRecords = [...(Array.isArray(r.adoptionRecords) ? r.adoptionRecords : []), adoptionRecord];
    updateReport(r.id, {
      status: r.status === 'found' ? 'under_review' : r.status,
      adoptionRecords,
      lastAdoptionRecordAt: adoptionRecord.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'adoption_recorded',
      lastWorkflowAt: adoptionRecord.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'adoption',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.adoption_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded adoption follow-up for ${r.childName}: ${adoptionRecord.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        recordType,
        status,
        agencyName,
        caringsIdPresent: Boolean(caringsId),
        orderNoPresent: Boolean(orderNo),
        orderDate: adoptionRecord.orderDate,
        nextReviewDate: adoptionRecord.nextReviewDate,
        noteLength: note.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), adoptionRecord });
  });

  router.post('/:id/case-assessment', protectedRoute, requireRole(...CASE_ASSESSMENT_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before case assessment' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases cannot receive new case assessments' });

    const assessmentType = cleanText(req.body?.assessmentType, 60);
    const riskLevel = cleanText(req.body?.riskLevel, 40) || 'medium';
    if (!CASE_ASSESSMENT_TYPES[assessmentType]) {
      return res.status(400).json({ error: `Assessment type must be one of ${Object.keys(CASE_ASSESSMENT_TYPES).join(', ')}` });
    }
    if (!CASE_RISK_LEVELS[riskLevel]) {
      return res.status(400).json({ error: `Risk level must be one of ${Object.keys(CASE_RISK_LEVELS).join(', ')}` });
    }
    const assessmentDate = parseDateInput(req.body?.assessmentDate, 'Assessment date');
    if (assessmentDate.error) return res.status(400).json({ error: assessmentDate.error });
    if (assessmentDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Assessment date cannot be in the future' });
    const nextReviewDate = optionalDateInput(req.body?.nextReviewDate, 'Next review date', { minTime: Date.now() - DAY });
    if (nextReviewDate.error) return res.status(400).json({ error: nextReviewDate.error });
    const assessorName = cleanText(req.body?.assessorName || req.user.name, 140);
    const findings = cleanText(req.body?.findings, 1600);
    const carePlan = cleanText(req.body?.carePlan, 1600);
    const recommendation = cleanText(req.body?.recommendation, 1200);
    if (assessorName.length < 3) return res.status(400).json({ error: 'Assessor name must be at least 3 characters' });
    if (findings.length < 10) return res.status(400).json({ error: 'Findings must be at least 10 characters' });
    if (carePlan.length < 10) return res.status(400).json({ error: 'Care plan must be at least 10 characters' });

    const now = Date.now();
    const assessment = {
      id: `assessment_${now}_${Math.random().toString(36).slice(2, 7)}`,
      assessmentType,
      label: CASE_ASSESSMENT_TYPES[assessmentType],
      riskLevel,
      riskLabel: CASE_RISK_LEVELS[riskLevel],
      assessorName,
      assessmentDate: assessmentDate.value,
      nextReviewDate: nextReviewDate.value,
      findings,
      carePlan,
      recommendation: recommendation || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'case_assessment_recorded',
      label: `Case assessment recorded: ${assessment.label}`,
      note: [assessment.riskLabel, assessment.nextReviewDate ? `review ${assessment.nextReviewDate}` : null].filter(Boolean).join(' / '),
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const caseAssessments = [...(Array.isArray(r.caseAssessments) ? r.caseAssessments : []), assessment];
    updateReport(r.id, {
      status: r.status === 'found' ? 'under_review' : r.status,
      caseAssessments,
      lastCaseAssessmentAt: assessment.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'case_assessment_recorded',
      lastWorkflowAt: assessment.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'assessment',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.assessment_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded ${assessment.label} for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        assessmentType,
        riskLevel,
        assessorName,
        assessmentDate: assessment.assessmentDate,
        nextReviewDate: assessment.nextReviewDate,
        findingsLength: findings.length,
        carePlanLength: carePlan.length,
        recommendationLength: recommendation.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), assessment });
  });

  router.post('/:id/production-record', protectedRoute, requireRole(...PRODUCTION_RECORD_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before production recording' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases cannot receive new production records' });

    const productionType = cleanText(req.body?.productionType, 50);
    const outcome = cleanText(req.body?.outcome, 60) || 'care_order_pending';
    if (!PRODUCTION_TYPES[productionType]) {
      return res.status(400).json({ error: `Production type must be one of ${Object.keys(PRODUCTION_TYPES).join(', ')}` });
    }
    if (!PRODUCTION_OUTCOMES[outcome]) {
      return res.status(400).json({ error: `Outcome must be one of ${Object.keys(PRODUCTION_OUTCOMES).join(', ')}` });
    }
    const rescueAt = parseDateTimeInput(req.body?.rescueAt, 'Rescue time');
    const producedAt = parseDateTimeInput(req.body?.producedAt, 'Production time');
    if (rescueAt.error) return res.status(400).json({ error: rescueAt.error });
    if (producedAt.error) return res.status(400).json({ error: producedAt.error });
    if (rescueAt.time > Date.now() + DAY) return res.status(400).json({ error: 'Rescue time cannot be in the future' });
    if (producedAt.time > Date.now() + DAY) return res.status(400).json({ error: 'Production time cannot be in the future' });
    if (producedAt.time < rescueAt.time) return res.status(400).json({ error: 'Production time cannot be before rescue time' });
    const authorityName = cleanText(req.body?.authorityName, 140);
    const orderNo = cleanText(req.body?.orderNo, 100) || null;
    const nextAction = cleanText(req.body?.nextAction, 1000);
    if (authorityName.length < 3) return res.status(400).json({ error: 'Authority name must be at least 3 characters' });
    if (nextAction.length < 10) return res.status(400).json({ error: 'Next action must be at least 10 characters' });

    const deadlineAt = rescueAt.time + DAY;
    const hoursToProduce = Number(((producedAt.time - rescueAt.time) / 3600000).toFixed(1));
    const deadlineStatus = producedAt.time <= deadlineAt ? 'within_24h' : 'delayed';
    const now = Date.now();
    const productionRecord = {
      id: `prod_${now}_${Math.random().toString(36).slice(2, 7)}`,
      productionType,
      label: PRODUCTION_TYPES[productionType],
      outcome,
      outcomeLabel: PRODUCTION_OUTCOMES[outcome],
      authorityName,
      orderNo,
      rescueAt: rescueAt.value,
      producedAt: producedAt.value,
      deadlineAt: new Date(deadlineAt).toISOString(),
      hoursToProduce,
      deadlineStatus,
      nextAction,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'production_recorded',
      label: `Production recorded: ${productionRecord.label}`,
      note: [productionRecord.outcomeLabel, deadlineStatus === 'within_24h' ? 'within 24h' : 'delayed'].join(' / '),
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const productionRecords = [...(Array.isArray(r.productionRecords) ? r.productionRecords : []), productionRecord];
    updateReport(r.id, {
      status: r.status === 'found' ? 'under_review' : r.status,
      productionRecords,
      lastProductionRecordAt: productionRecord.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'production_recorded',
      lastWorkflowAt: productionRecord.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'hearing',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.production_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded production before authority for ${r.childName}: ${productionRecord.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        productionType,
        outcome,
        authorityName,
        orderNo,
        rescueAt: productionRecord.rescueAt,
        producedAt: productionRecord.producedAt,
        hoursToProduce,
        deadlineStatus,
        nextActionLength: nextAction.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), productionRecord });
  });

  router.post('/:id/transfer-jurisdiction', protectedRoute, requireRole(...CASE_TRANSFER_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before jurisdiction transfer' });
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found or closed cases cannot be transferred' });

    const target = {
      state: cleanText(req.body?.state, 80),
      district: cleanText(req.body?.district, 80),
      station: cleanText(req.body?.station, 120) || null,
    };
    const reason = cleanText(req.body?.reason, 500);
    if (!canTransferToJurisdiction(req.user, target)) {
      return res.status(403).json({ error: 'Target jurisdiction is outside your transfer authority' });
    }
    if (target.state === r.state && target.district === r.district && target.station === (r.station || null)) {
      return res.status(400).json({ error: 'Target jurisdiction is the same as current jurisdiction' });
    }

    const now = Date.now();
    const transfer = {
      from: { state: r.state || null, district: r.district || null, station: r.station || null },
      to: target,
      reason: reason || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      transferredAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'transfer_jurisdiction',
      label: `Transferred to ${[target.district, target.state].filter(Boolean).join(', ')}`,
      note: reason || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const transfers = [...(Array.isArray(r.transfers) ? r.transfers : []), transfer];
    updateReport(r.id, {
      state: target.state,
      district: target.district,
      station: target.station,
      transfers,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'transfer_jurisdiction',
      lastWorkflowAt: transfer.transferredAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'transfer',
      actorId: req.user.id,
      scope: { state: target.state, district: target.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.jurisdiction_transferred',
      targetType: 'report',
      targetId: r.id,
      summary: `Transferred ${r.childName} from ${[transfer.from.district, transfer.from.state].filter(Boolean).join(', ') || 'unscoped'} to ${[target.district, target.state].filter(Boolean).join(', ')}`,
      scope: { state: target.state, district: target.district, reportId: r.id, previousState: transfer.from.state, previousDistrict: transfer.from.district },
      metadata: { from: transfer.from, to: transfer.to, reasonLength: reason.length },
    });
    res.json({ report: findReport(r.id) });
  });

  router.post('/:id/verify-intake', protectedRoute, requireRole(...INTAKE_VERIFY_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (!isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Report intake is already verified' });

    const { firNo, note } = req.body || {};
    const now = Date.now();
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'verify_intake',
      label: 'Citizen intake verified',
      note: cleanText(note, 500) || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const patch = {
      status: 'missing',
      intakeStatus: 'verified',
      firNo: cleanText(firNo, 80) || r.firNo || generatedFirNo(),
      verifiedAt: now,
      verifiedById: req.user.id,
      verifiedByName: req.user.name,
      workflow,
      workflowStatus: 'Citizen intake verified',
      lastWorkflowAction: 'verify_intake',
      lastWorkflowAt: new Date(now).toISOString(),
    };
    updateReport(r.id, patch);
    addActivity({ actor: req.user.name, action: 'Verified citizen missing-child intake', target: r.childName, icon: 'check', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.intake_verified',
      targetType: 'report',
      targetId: r.id,
      summary: `Verified citizen/NGO intake for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { firNo: patch.firNo, noteLength: event.note ? event.note.length : 0 },
    });
    res.json({ report: findReport(r.id) });
  });

  router.post('/:id/bulletin', protectedRoute, requireRole(...BULLETIN_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before public bulletin publishing' });
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found or closed cases cannot be published as active public bulletins' });

    const publish = req.body?.publish !== false;
    const now = Date.now();
    const bulletin = publish
      ? {
          published: true,
          publishedAt: r.bulletin?.publishedAt || new Date(now).toISOString(),
          publishedById: req.user.id,
          publishedByName: req.user.name,
          agency: req.user.org || req.user.name,
        }
      : {
          ...(r.bulletin || {}),
          published: false,
          unpublishedAt: new Date(now).toISOString(),
          unpublishedById: req.user.id,
          unpublishedByName: req.user.name,
        };
    updateReport(r.id, { bulletin });
    addActivity({
      actor: req.user.name,
      action: publish ? 'Published public bulletin' : 'Unpublished public bulletin',
      target: r.childName,
      icon: publish ? 'broadcast' : 'eye',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: publish ? 'case.bulletin_published' : 'case.bulletin_unpublished',
      targetType: 'report',
      targetId: r.id,
      summary: `${publish ? 'Published' : 'Unpublished'} public bulletin for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { published: publish },
    });
    res.json({ report: findReport(r.id), bulletin: publish ? bulletinPayload(findReport(r.id)) : null });
  });

  router.get('/:id/handoff-export', protectedRoute, requireRole(...CASE_HANDOFF_EXPORT_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before handoff export' });

    const requestedTarget = cleanText(req.query.targetSystem, 40);
    const targetSystem = HANDOFF_TARGET_SYSTEMS[requestedTarget] ? requestedTarget : 'generic';
    const purpose = cleanText(req.query.purpose, 160) || `Case handoff for ${HANDOFF_TARGET_SYSTEMS[targetSystem]}`;
    const includeOperationalHistory = req.query.includeHistory === 'true' || req.query.includeHistory === '1';
    const payload = caseHandoffPayload(r, req.user, { targetSystem, purpose, includeOperationalHistory });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.handoff_exported',
      targetType: 'report',
      targetId: r.id,
      summary: `Exported redacted case handoff for ${r.childName} to ${HANDOFF_TARGET_SYSTEMS[targetSystem]}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        targetSystem,
        includeOperationalHistory,
        externalIdCount: payload.counts.externalIds,
        workflowEventCount: payload.counts.workflowEvents,
      },
    });
    res.json(signedCaseExport(payload, 'case_handoff_export', settings.exportSigning));
  });

  router.get('/:id', protectedRoute, (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    res.json({ report: r });
  });


  return router;
}
