// Jurisdiction scoping — implements the proposal's "drill-down" access pyramid.
// Super Admin sees everything; Admin/state nodal/crime bureau see their state; district
// stakeholders see their district; Parents/NGOs see only what they reported.

const STATE_ROLES = ['admin', 'state_nodal', 'sara', 'crime_bureau'];
const DISTRICT_ROLES = ['police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb'];

// Jurisdiction names arrive from three places that never agree: the seeded
// accounts ("Mumbai"), the registration form (whatever the officer typed), and
// the phone's reverse geocoder ("Navi mumbai", "Navi Mumbai", "Mumbai Suburban
// District" -- three spellings in one evening). An exact string compare turned
// each of those into a row the district officer could not see while
// super_admin could, which is the one officer the row exists for. Compare on a
// normalised name, and fold the two revenue districts of Brihanmumbai into the
// single jurisdiction their one police commissionerate already treats them as.
// Navi Mumbai is deliberately NOT folded in: it has its own commissionerate,
// CWC and DCPU, and sameDistrict() can only ever widen access, never narrow it.
const DISTRICT_ALIASES = {
  'mumbai suburban': 'mumbai',
  'mumbai city': 'mumbai',
  'greater mumbai': 'mumbai',
  // Spellings of one district, not a merge of jurisdictions: OpenStreetMap
  // writes Ahmadabad, Gujarat Police and the census write Ahmedabad, and
  // Amdavad is the Gujarati name. Ahmedabad Rural is a separate police
  // jurisdiction and is deliberately not folded in.
  ahmadabad: 'ahmedabad',
  amdavad: 'ahmedabad',
  'ahmedabad city': 'ahmedabad',
};

function normaliseDistrict(value) {
  const base = String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(district|division)$/, '');
  return DISTRICT_ALIASES[base] || base;
}

export function sameDistrict(a, b) {
  const x = normaliseDistrict(a);
  const y = normaliseDistrict(b);
  return Boolean(x) && x === y;
}

function normaliseState(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function sameState(a, b) {
  const x = normaliseState(a);
  const y = normaliseState(b);
  return Boolean(x) && x === y;
}

// Jurisdiction fails closed. Super admin is the only national role: a state
// desk with no state, or a district desk with no district or no state, sees
// nothing at all - no case, sighting, audit row or activity. It used to see
// everything, because "no state on the account" read as "no state filter", so
// an account provisioned with a blank jurisdiction became a national one.
//
// A district desk matches on the state as well as the district. Two states can
// have a district of the same name (Aurangabad is in Bihar and in
// Maharashtra), and matching the name alone showed one state's police the
// other's cases.
export function hasJurisdiction(user) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const state = normaliseState(user.jurisdiction?.state);
  if (STATE_ROLES.includes(user.role)) return Boolean(state);
  if (DISTRICT_ROLES.includes(user.role)) return Boolean(state) && Boolean(normaliseDistrict(user.jurisdiction?.district));
  // Parents and NGOs are scoped by what they registered, not by place.
  return true;
}

function inUserState(user, row) {
  return sameState(row?.state, user?.jurisdiction?.state);
}

function inUserDistrict(user, row) {
  return inUserState(user, row) && sameDistrict(row?.district, user?.jurisdiction?.district);
}

function canAccessScopedLocation(user, row) {
  if (!row?.state && !row?.district) return user?.role === 'super_admin';
  if (!hasJurisdiction(user)) return false;
  if (user.role === 'super_admin') return true;
  if (STATE_ROLES.includes(user.role)) return inUserState(user, row);
  if (DISTRICT_ROLES.includes(user.role)) return inUserDistrict(user, row);
  return false;
}

// Where a sighting is. The same rule as any other record, with one allowance:
// a sighting whose reporter named a district but no state is shown to the
// desks of that district in any state. An unplaced sighting reaches every
// review desk (scopeFoundReports), so a partly placed one must not reach fewer
// people than that - it would otherwise reach only the super admin.
function canAccessSightingLocation(user, row) {
  if (!row?.state && row?.district && DISTRICT_ROLES.includes(user?.role) && hasJurisdiction(user)) {
    return sameDistrict(row.district, user.jurisdiction?.district);
  }
  return canAccessScopedLocation(user, row);
}

// A department can hand over records on the condition that only police see
// them: Gujarat Police's register of missing children is the first. Such a
// record carries `visibility: 'police'`; every other desk with the same
// jurisdiction (CWC, DCPU, CCI, adoption, legal aid) and every parent or NGO is
// filtered out here, so the list, the case drawer, the photo and any sighting
// matched to the record all follow the one rule. Alerts follow it too: an alert
// that a sighting may match a case, or that a match was confirmed, goes only to
// police officers who can open that case (shared/routes/reports.js).
export const POLICE_ROLES = ['super_admin', 'admin', 'crime_bureau', 'police', 'sjpu', 'ahtu', 'dcrb'];

export function isPoliceOnly(report) {
  return report?.visibility === 'police';
}

export function scopeReports(user, reports = []) {
  if (!user || !hasJurisdiction(user)) return [];
  const rows = POLICE_ROLES.includes(user.role) ? reports : reports.filter((r) => !isPoliceOnly(r));
  return scopeByJurisdiction(user, rows);
}

function scopeByJurisdiction(user, reports) {
  switch (user.role) {
    case 'super_admin':
      return reports;
    case 'admin':
    case 'state_nodal':
    case 'sara':
    case 'crime_bureau':
      return reports.filter((r) => inUserState(user, r));
    case 'police':
    case 'sjpu':
    case 'ahtu':
    case 'dcrb':
    case 'dlsa':
    case 'cwc':
    case 'dcpu':
    case 'rpf':
    case 'cci':
    case 'saa':
    case 'jjb':
      return reports.filter((r) => inUserDistrict(user, r));
    case 'parent':
    case 'ngo':
    default:
      return reports.filter(
        (r) => r.registeredById === user.id
      );
  }
}

export function canAccessReport(user, report) {
  if (!user || !report) return false;
  return scopeReports(user, [report]).length === 1;
}

export function scopeFoundReports(user, foundReports = [], reports = []) {
  if (!user || !hasJurisdiction(user)) return [];
  const visibleReportIds = new Set(scopeReports(user, reports).map((r) => r.id));
  switch (user.role) {
    case 'super_admin':
      return foundReports;
    case 'admin':
    case 'state_nodal':
    case 'sara':
    case 'crime_bureau':
    case 'police':
    case 'sjpu':
    case 'ahtu':
    case 'dcrb':
    case 'dlsa':
    case 'cwc':
    case 'dcpu':
    case 'rpf':
    case 'cci':
    case 'saa':
    case 'jjb':
      return foundReports.filter((f) => {
        if (f.matchedReportId) return visibleReportIds.has(f.matchedReportId);
        // A sighting the reporter gave no location for belongs to no district,
        // and filtering on jurisdiction alone made it visible to the super
        // admin and nobody else — a child reported by a citizen who skipped the
        // location fields simply never reached a review queue. Unplaced
        // sightings go to every review role until an officer assigns one.
        if (!f.state && !f.district) return true;
        return canAccessSightingLocation(user, f);
      });
    default:
      return [];
  }
}

export function scopeAudit(user, auditRows = [], reports = []) {
  if (!user || !hasJurisdiction(user)) return [];
  if (user.role === 'super_admin') return auditRows;
  const visibleReportIds = new Set(scopeReports(user, reports).map((r) => r.id));
  return auditRows.filter((row) => {
    if (row.targetType === 'report') return visibleReportIds.has(row.targetId);
    if (row.scope?.reportId) return visibleReportIds.has(row.scope.reportId);
    if (row.scope?.matchedReportId) return visibleReportIds.has(row.scope.matchedReportId);
    if (row.targetType === 'foundReport') return canAccessSightingLocation(user, row.scope || {});
    if (STATE_ROLES.includes(user.role)) return inUserState(user, row.scope);
    if (DISTRICT_ROLES.includes(user.role)) return inUserDistrict(user, row.scope);
    return row.actorId === user.id;
  });
}

export function scopeActivity(user, activityRows = [], reports = []) {
  if (!user || !hasJurisdiction(user)) return [];
  if (user.role === 'super_admin') return activityRows;
  const visibleReportIds = new Set(scopeReports(user, reports).map((r) => r.id));
  // A parent or NGO sees the activity on the cases they registered, but never a
  // sighting linked to one (rows scoped by `matchedReportId`): an officer
  // confirms every match before any family is told that someone resembling
  // their child was seen. The confirmation itself is a case event (`reportId`)
  // and still shows.
  //
  // Nor a jurisdiction transfer: "Transferred to <district>" for a traced woman
  // tells the relative who registered her where she is now, which is hers to
  // decide (see citizenCaseView in shared/case-domain.js).
  const authority = STATE_ROLES.includes(user.role) || DISTRICT_ROLES.includes(user.role);
  return activityRows.filter((row) => {
    if (row.scope?.reportId) {
      if (!authority && row.icon === 'transfer') return false;
      return visibleReportIds.has(row.scope.reportId);
    }
    if (row.scope?.matchedReportId) return authority && visibleReportIds.has(row.scope.matchedReportId);
    if (row.scope?.state || row.scope?.district) return canAccessScopedLocation(user, row.scope);
    return row.actorId === user.id;
  });
}

export function scopeLabel(user) {
  if (!user) return 'My reports';
  switch (user.role) {
    case 'super_admin':
      return 'National (all states)';
    case 'admin':
    case 'state_nodal':
    case 'sara':
    case 'crime_bureau':
      return user.jurisdiction?.state || 'State';
    case 'police':
    case 'sjpu':
    case 'ahtu':
    case 'dcrb':
    case 'dlsa':
    case 'cwc':
    case 'dcpu':
    case 'rpf':
    case 'cci':
    case 'saa':
    case 'jjb':
      return user.jurisdiction?.station || user.jurisdiction?.district || 'Station';
    default:
      return 'My reports';
  }
}
