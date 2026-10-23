// Marks labels for translation (see i18n.jsx). Defined locally so this module
// stays importable from plain Node scripts that cannot load i18n.jsx.
const msg = (text) => text;

export const OPERATIONAL_ROLES = [
  'super_admin',
  'admin',
  'police',
  'sjpu',
  'ahtu',
  'dcrb',
  'dlsa',
  'cwc',
  'dcpu',
  'rpf',
  'cci',
  'saa',
  'jjb',
  'state_nodal',
  'sara',
  'crime_bureau',
];

export const CASE_CREATE_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'parent', 'ngo'];
// A spreadsheet of other people's missing relatives is an official hand-over,
// not something a parent or NGO account files: bulk import is for the desks
// that register cases on the record.
export const BULK_IMPORT_ROLES = ['super_admin', 'admin', 'police', 'sjpu'];
export const NETWORK_ROLES = ['super_admin', 'admin', 'state_nodal', 'sara', 'crime_bureau'];
export const CCI_REGISTER_ROLES = ['super_admin', 'admin', 'cwc', 'dcpu', 'cci', 'saa', 'state_nodal', 'sara'];
export const ABUSE_REVIEW_ROLES = ['super_admin', 'admin', 'state_nodal', 'crime_bureau'];
// The desks that investigate trafficking (GET /api/dashboard/patterns).
export const PATTERN_ROLES = ['super_admin', 'admin', 'crime_bureau', 'state_nodal', 'police', 'sjpu', 'ahtu', 'dcrb', 'rpf'];
// The desks that see the CCTV checks made on police laptops (GET /api/dashboard/video-checks).
export const VIDEO_CHECK_ROLES = ['super_admin', 'admin', 'state_nodal', 'crime_bureau', 'police', 'sjpu', 'ahtu', 'dcrb'];

/**
 * Sidebar entries, grouped so a long list reads as a few short ones.
 *
 * Every item carries its own icon, named here and drawn by NavIcon.jsx.
 * Previously only five names were mapped and
 * the rest fell through to a generic blue diamond, so eight of thirteen entries
 * were visually identical and the sidebar could only be read by its text.
 */
export const DASHBOARD_NAV = [
  { to: '/app', end: true, label: msg('Overview'), short: msg('Overview'), icon: 'overview', group: 'Casework', roles: [...OPERATIONAL_ROLES, 'parent', 'ngo'] },
  { to: '/app/cases', label: msg('Cases & FIRs'), short: msg('Cases'), icon: 'cases', group: 'Casework', roles: [...OPERATIONAL_ROLES, 'parent', 'ngo'] },
  { to: '/app/register', label: msg('Register child / FIR'), short: msg('New case'), icon: 'register', group: 'Casework', roles: CASE_CREATE_ROLES },
  { to: '/app/bulk-import', label: msg('Bulk import'), icon: 'import', group: 'Casework', roles: BULK_IMPORT_ROLES },
  { to: '/app/matches', label: msg('Matches'), short: msg('Matches'), icon: 'matches', group: 'Review', roles: OPERATIONAL_ROLES },
  { to: '/app/sightings', label: msg('Sightings'), short: msg('Sightings'), icon: 'sightings', group: 'Review', roles: OPERATIONAL_ROLES },
  { to: '/app/cci-register', label: msg('CCI register'), icon: 'cci', group: 'Review', roles: CCI_REGISTER_ROLES },
  { to: '/app/grievances', label: msg('Grievances'), icon: 'grievances', group: 'Review', roles: OPERATIONAL_ROLES },
  { to: '/app/patterns', label: msg('Trafficking patterns'), icon: 'patterns', group: 'Oversight', roles: PATTERN_ROLES },
  { to: '/app/cctv-checks', label: msg('CCTV checks'), icon: 'cctv', group: 'Oversight', roles: VIDEO_CHECK_ROLES },
  { to: '/app/mis', label: msg('MIS report'), icon: 'mis', group: 'Oversight', roles: OPERATIONAL_ROLES },
  { to: '/app/audit', label: msg('Record of actions'), icon: 'audit', group: 'Oversight', roles: OPERATIONAL_ROLES },
  { to: '/app/privacy', label: msg('Privacy review'), icon: 'privacy', group: 'Oversight', roles: OPERATIONAL_ROLES },
  { to: '/app/fraud', label: msg('Public abuse'), icon: 'fraud', group: 'Oversight', roles: ABUSE_REVIEW_ROLES },
  { to: '/app/network', label: msg('Network'), icon: 'network', group: 'Administration', roles: NETWORK_ROLES },
  { to: '/app/simulations', label: msg('Simulations & tests'), icon: 'simulations', group: 'Administration', roles: ['super_admin', 'admin'] },
];

/**
 * The phone's bottom bar: the first four of these the signed-in role can
 * open, then "Menu" for everything else. An officer gets the queue they work
 * from (overview, cases, sightings, matches); a parent gets their case and the
 * form to register one.
 */
export const DASHBOARD_BOTTOM_NAV = ['/app', '/app/cases', '/app/sightings', '/app/matches', '/app/register'];

/** Sidebar group order. */
export const DASHBOARD_NAV_GROUPS = [msg('Casework'), msg('Review'), msg('Oversight'), msg('Administration')];

export const DASHBOARD_ROUTE_ROLES = {
  cases: [...OPERATIONAL_ROLES, 'parent', 'ngo'],
  register: CASE_CREATE_ROLES,
  'bulk-import': BULK_IMPORT_ROLES,
  matches: OPERATIONAL_ROLES,
  sightings: OPERATIONAL_ROLES,
  'cci-register': CCI_REGISTER_ROLES,
  privacy: OPERATIONAL_ROLES,
  audit: OPERATIONAL_ROLES,
  fraud: ABUSE_REVIEW_ROLES,
  mis: OPERATIONAL_ROLES,
  patterns: PATTERN_ROLES,
  'cctv-checks': VIDEO_CHECK_ROLES,
  grievances: OPERATIONAL_ROLES,
  network: NETWORK_ROLES,
};
