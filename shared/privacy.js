/**
 * Personal-data rules that more than one route, and both runtimes, apply.
 *
 *   anonymisedReportPatch / anonymisedSightingPatch
 *       What anonymising a record leaves on it. An allow-list: a field is kept
 *       only if it is named here as non-identifying, so a field added to cases
 *       next year is cleared by default rather than left behind. The DPIA
 *       (docs/governance/dpia.md, G1) found the old deny-list had left the
 *       profile, notes, FIR number, declaration signer, care records and the
 *       place a person was seen on every "anonymised" record.
 *
 *   Aadhaar
 *       Khozo never keeps an Aadhaar number. It keeps the last four digits, for
 *       an officer to read back to a family, and a keyed fingerprint, so a
 *       second registration of the same child is still caught as a duplicate
 *       (DPIA G2). The fingerprint is an HMAC under a server secret: without
 *       the secret, the 10^12 possible numbers cannot be tried against it.
 *
 *   deskCaseView
 *       What a desk sees of a case. Welfare institutions that do not contact
 *       families (CCI, SAA, JJB, DLSA) see the case without the guardian's
 *       phone, e-mail and address (DPIA G23), and without its trafficking-risk
 *       prompt; they reach the family through the police or the CWC. Every desk sees an Aadhaar number masked, which
 *       also covers records written before numbers stopped being stored.
 *
 *   derivedSecret
 *       A purpose-specific key derived from the deployment's JWT secret, for a
 *       secret an operator has not set separately. It replaces fallbacks to
 *       keys written in this public repository (DPIA G18, G19).
 *
 * Pure apart from node:crypto, which both runtimes provide.
 */
import crypto from 'node:crypto';

// ---------------------------------------------------------------- secrets ---

/** The JWT secret both runtimes fall back to in development. */
export const DEV_ROOT_SECRET = 'khozo-dev-secret-change-me';

/**
 * A key for `purpose`, derived from `root` (the JWT secret). Two purposes never
 * share a key, and a key cannot be turned back into the root.
 */
export function derivedSecret(root, purpose) {
  return crypto.createHmac('sha256', String(root || DEV_ROOT_SECRET)).update(`khozo:${purpose}:v1`).digest('hex');
}

/**
 * The secrets the shared routes need, from a runtime's environment: each one
 * explicit where the operator set it, derived from the JWT secret otherwise.
 * Never a constant from this repository.
 */
export function privacySecrets(env = {}) {
  const root = env.KHOZO_JWT_SECRET || DEV_ROOT_SECRET;
  return {
    fieldHashKey: env.KHOZO_FIELD_HASH_KEY || derivedSecret(root, 'field-hash'),
    // A derived key changes when the JWT secret is rotated, which orphans
    // every stored fingerprint; the readiness report says so.
    fieldHashKeyDerived: !env.KHOZO_FIELD_HASH_KEY,
    rateLimitAuditSalt: env.KHOZO_RATE_LIMIT_AUDIT_SALT || derivedSecret(root, 'rate-limit-audit'),
    exportSigning: {
      keyId: env.KHOZO_EXPORT_SIGNING_KEY
        ? env.KHOZO_EXPORT_SIGNING_KEY_ID || 'export-key'
        : 'derived-from-jwt-secret',
      key: env.KHOZO_EXPORT_SIGNING_KEY || derivedSecret(root, 'export-signing'),
    },
  };
}

/** A throttled caller's identity as the audit log records it: salted, one-way. */
export function identityHashWith(salt, identity) {
  return crypto.createHmac('sha256', String(salt)).update(String(identity || 'unknown')).digest('hex');
}

// ---------------------------------------------------------------- Aadhaar ---

const digitsOf = (value) => String(value ?? '').replace(/\D/g, '');

/** Whether a stored value is a whole Aadhaar number rather than a masked one. */
export function isFullAadhaar(value) {
  return /^\d{12}$/.test(digitsOf(value)) && !/x/i.test(String(value ?? ''));
}

/** "XXXX XXXX 1234", or the value unchanged when it is already masked or empty. */
export function maskAadhaar(value) {
  if (value == null || value === '') return value ?? null;
  if (!isFullAadhaar(value)) return String(value);
  return `XXXX XXXX ${digitsOf(value).slice(-4)}`;
}

const keyIds = new Map();

/**
 * A short public label for a fingerprint key, stored with each fingerprint,
 * so fingerprints made under a different key (after the key or the JWT secret
 * it was derived from changed) can be found instead of silently never
 * matching. Reveals nothing about the key.
 */
export function fieldKeyId(key) {
  if (!key) return null;
  if (!keyIds.has(key)) keyIds.set(key, crypto.createHmac('sha256', String(key)).update('khozo:key-id').digest('hex').slice(0, 8));
  return keyIds.get(key);
}

/** The keyed fingerprint of a whole number, or null. */
export function aadhaarFingerprint(value, key) {
  if (!isFullAadhaar(value) || !key) return null;
  return crypto.createHmac('sha256', String(key)).update(`aadhaar:${digitsOf(value)}`).digest('hex');
}

/** The fields a case stores for an Aadhaar number someone typed. */
export function aadhaarFields(value, key) {
  if (!isFullAadhaar(value)) return { childAadhar: null, childAadharHash: null, childAadharKeyId: null };
  return { childAadhar: maskAadhaar(value), childAadharHash: aadhaarFingerprint(value, key), childAadharKeyId: fieldKeyId(key) };
}

/**
 * The fingerprint of a stored case: its own, or one computed from a number
 * stored whole before this rule existed.
 */
export function storedAadhaarFingerprint(record, key) {
  if (!record) return null;
  if (record.childAadharHash) {
    // Made under another key: it can never match one made under this key.
    if (record.childAadharKeyId && key && record.childAadharKeyId !== fieldKeyId(key)) return null;
    return record.childAadharHash;
  }
  return aadhaarFingerprint(record.childAadhar, key);
}

// ------------------------------------------------------------- desk views ---

/** Desks that do not contact a missing person's family themselves. */
export const NO_FAMILY_CONTACT_ROLES = ['cci', 'saa', 'jjb', 'dlsa'];

const WITHHELD = 'Withheld: contact the family through the police or CWC';

/** A case as `user`'s desk may see it. Parents and NGOs use citizenCaseView. */
export function deskCaseView(user, report) {
  if (!report || typeof report !== 'object') return report;
  const view = { ...report };
  if ('childAadhar' in view) view.childAadhar = maskAadhaar(view.childAadhar);
  delete view.childAadharHash;
  delete view.childAadharKeyId;
  if (NO_FAMILY_CONTACT_ROLES.includes(user?.role)) {
    view.parentPhone = null;
    view.parentEmail = null;
    view.address = null;
    view.familyContactWithheld = WITHHELD;
    // A trafficking-risk prompt is for the desks that investigate
    // (shared/trafficking.js), not for care, adoption, court or legal aid.
    delete view.traffickingRisk;
  }
  return view;
}

// ---------------------------------------------------------- anonymisation ---

/** Case fields that say nothing about who the person is. */
const REPORT_KEEP = new Set([
  'id', 'personCategory', 'visibility', 'gender', 'age',
  'state', 'district', 'stateCode', 'districtCode',
  'status', 'intakeStatus', 'intakeSource', 'caseOrigin', 'dataPurpose',
  'retentionUntil', 'createdAt', 'verifiedAt', 'closedAt', 'closureReason', 'closureLabel',
  'registeredByRole', 'smsSent', 'matchScore', 'photoConsent', 'photoBasis',
  'hasIdentificationProfile', 'hasVulnerabilityProfile',
  'privacyReviewStatus', 'anonymizedAt', 'anonymizationApproval', 'faceIndex',
  'workflowStatus', 'traffickingRisk',
  // When the person was found: the MIS recovery measures (shared/outcomes.js)
  // still count an anonymised case.
  'foundAt', 'lastWorkflowAt',
]);

/** Sighting fields that say nothing about who was seen or who reported it. */
const SIGHTING_KEEP = new Set([
  'id', 'personCategory', 'gender', 'ageApprox', 'ageBand',
  'state', 'district', 'stateCode', 'districtCode', 'locationSource',
  'status', 'createdAt', 'retentionUntil', 'dataPurpose', 'photoConsent',
  'matchedReportId', 'matchScore', 'matchCorroborated', 'matchNotChecked',
  'referralStatus', 'confidentialReporter', 'formalReportId',
  'privacyReviewStatus', 'anonymizedAt', 'anonymizationApproval',
]);

/** Inside a history entry (workflow step, care record, candidate), the keys kept. */
const ENTRY_KEEP = new Set([
  'id', 'ts', 'at', 'recordedAt', 'createdAt', 'proposedAt',
  'action', 'label', 'type', 'status', 'actorRole',
  'reportId', 'rank', 'score', 'corroborated', 'notChecked', 'source',
]);

const shortCode = (value) => typeof value === 'string' && value.length <= 80;

/** A history entry reduced to when, what kind, and by which role. */
function strippedEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const out = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!ENTRY_KEEP.has(key)) continue;
    if (typeof value === 'number' || typeof value === 'boolean' || shortCode(value)) out[key] = value;
  }
  return out;
}

/**
 * The patch that clears every field of `record` not in `keep`. Arrays become
 * their stripped entries (counts and dates survive for the MIS report, text
 * does not), numbers and flags survive unless named in `dropNumbers`, and
 * everything else is set to null.
 */
function clearingPatch(record, keep, dropNumbers = []) {
  const patch = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (keep.has(key)) continue;
    if (Array.isArray(value)) patch[key] = value.map(strippedEntry).filter(Boolean);
    else if ((typeof value === 'number' || typeof value === 'boolean') && !dropNumbers.includes(key)) continue;
    else patch[key] = null;
  }
  return patch;
}

/** How a record was verified, without who verified it or what they wrote. */
function strippedVerification(verification) {
  if (!verification || typeof verification !== 'object') return null;
  return {
    method: verification.method || null,
    methodLabel: verification.methodLabel || null,
    recordedAt: verification.recordedAt || null,
    anonymized: true,
  };
}

/** The month a date falls in, as "YYYY-MM-01", so statistics keep the period. */
function monthOf(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? `${new Date(t).toISOString().slice(0, 7)}-01` : null;
}

/** Everything to write over an anonymised case. */
export function anonymisedReportPatch(report, { now = Date.now(), approval = null } = {}) {
  const vulnerability = report?.vulnerabilityProfile;
  return {
    ...clearingPatch(report, REPORT_KEEP, ['height', 'weight', 'verifiedById', 'registeredById', 'assignedToId']),
    childName: `Anonymized ${report.id}`,
    parentName: 'Anonymized',
    dateOfMissing: monthOf(report.dateOfMissing),
    // The categories alone are statistics; the circumstances text is not.
    vulnerabilityProfile: vulnerability
      ? { categories: vulnerability.categories || [], categoryLabels: vulnerability.categoryLabels || [] }
      : null,
    verification: strippedVerification(report.verification),
    // Why the case closed is a statistic; the officer's closing note is not.
    closure: report.closure
      ? { reason: report.closure.reason || null, label: report.closure.label || null, closedAt: report.closure.closedAt || null }
      : null,
    publicBulletin: null,
    // Every photo goes, not only the main one (shared/photo-set.js).
    extraPhotos: [],
    privacyReviewStatus: 'anonymized',
    anonymizedAt: new Date(now).toISOString(),
    anonymizationApproval: approval,
  };
}

/** Everything to write over an anonymised sighting. */
export function anonymisedSightingPatch(sighting, { now = Date.now(), approval = null } = {}) {
  return {
    ...clearingPatch(sighting, SIGHTING_KEEP, ['lat', 'lng']),
    reporterName: 'Anonymised citizen',
    reporterDisplayName: 'Anonymised citizen',
    // A string, as every sighting's place is: screens and searches read it as text.
    foundLocation: 'Location removed',
    verification: strippedVerification(sighting.verification),
    extraPhotos: [],
    privacyReviewStatus: 'anonymized',
    anonymizedAt: new Date(now).toISOString(),
    anonymizationApproval: approval,
  };
}

/** The label an activity row about an anonymised record is rewritten to. */
export function anonymisedLabel(type, id) {
  return type === 'foundReport' ? `Anonymised sighting ${id}` : `Anonymised case ${id}`;
}
