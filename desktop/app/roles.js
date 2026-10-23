// The roles that may check CCTV video on Khozo: the same list as POLICE_ROLES
// in shared/scope.js, which guards POST /reports/:id/video-search. Copied, not
// imported, because shared/scope.js brings the whole map of districts with it;
// the desktop's tests check that the two lists are the same.
export const VIDEO_ROLES = ['super_admin', 'admin', 'crime_bureau', 'police', 'sjpu', 'ahtu', 'dcrb'];

/** Cases a video can be checked for: not found, closed or still waiting for a desk to check a family's report. */
export function canSearchCase(report) {
  if (!report) return false;
  if (['found', 'closed'].includes(report.status)) return false;
  if (report.anonymizedAt) return false;
  if (report.intakeStatus === 'pending_verification') return false;
  return true;
}
