// Jurisdiction scoping — implements the proposal's "drill-down" access pyramid.
// Super Admin sees everything; Admin/state nodal/crime bureau see their state; district
// stakeholders see their district; Parents/NGOs see only what they reported.

const STATE_ROLES = ['admin', 'state_nodal', 'sara', 'crime_bureau'];
const DISTRICT_ROLES = ['police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb'];

function canAccessScopedLocation(user, row) {
  if (!row?.state && !row?.district) return user?.role === 'super_admin';
  if (STATE_ROLES.includes(user?.role)) return !user?.jurisdiction?.state || row.state === user?.jurisdiction?.state;
  if (DISTRICT_ROLES.includes(user?.role)) return !user?.jurisdiction?.district || row.district === user?.jurisdiction?.district;
  return false;
}

export function scopeReports(user, reports = []) {
  if (!user) return [];
  switch (user.role) {
    case 'super_admin':
      return reports;
    case 'admin':
    case 'state_nodal':
    case 'sara':
    case 'crime_bureau':
      return reports.filter(
        (r) => !user.jurisdiction?.state || r.state === user.jurisdiction?.state
      );
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
      return reports.filter(
        (r) => !user.jurisdiction?.district || r.district === user.jurisdiction?.district
      );
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
  if (!user) return [];
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
        return canAccessScopedLocation(user, f);
      });
    default:
      return [];
  }
}

export function scopeAudit(user, auditRows = [], reports = []) {
  if (!user) return [];
  if (user.role === 'super_admin') return auditRows;
  const visibleReportIds = new Set(scopeReports(user, reports).map((r) => r.id));
  return auditRows.filter((row) => {
    if (row.targetType === 'report') return visibleReportIds.has(row.targetId);
    if (row.scope?.reportId) return visibleReportIds.has(row.scope.reportId);
    if (row.scope?.matchedReportId) return visibleReportIds.has(row.scope.matchedReportId);
    if (row.targetType === 'foundReport') return canAccessScopedLocation(user, row.scope || {});
    if (STATE_ROLES.includes(user.role)) return !user.jurisdiction?.state || row.scope?.state === user.jurisdiction?.state;
    if (DISTRICT_ROLES.includes(user.role)) return !user.jurisdiction?.district || row.scope?.district === user.jurisdiction?.district;
    return row.actorId === user.id;
  });
}

export function scopeActivity(user, activityRows = [], reports = []) {
  if (!user) return [];
  if (user.role === 'super_admin') return activityRows;
  const visibleReportIds = new Set(scopeReports(user, reports).map((r) => r.id));
  return activityRows.filter((row) => {
    if (row.scope?.reportId) return visibleReportIds.has(row.scope.reportId);
    if (row.scope?.matchedReportId) return visibleReportIds.has(row.scope.matchedReportId);
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
