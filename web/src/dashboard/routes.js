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
export const NETWORK_ROLES = ['super_admin', 'admin', 'state_nodal', 'sara', 'crime_bureau'];
export const CCI_REGISTER_ROLES = ['super_admin', 'admin', 'cwc', 'dcpu', 'cci', 'saa', 'state_nodal', 'sara'];
export const ABUSE_REVIEW_ROLES = ['super_admin', 'admin', 'state_nodal', 'crime_bureau'];

/**
 * Sidebar entries, grouped so a long list reads as a few short ones.
 *
 * Every item carries its own icon. Previously only five names were mapped and
 * the rest fell through to a generic blue diamond, so eight of thirteen entries
 * were visually identical and the sidebar could only be read by its text.
 */
export const DASHBOARD_NAV = [
  { to: '/app', end: true, label: 'Overview', icon: '📊', group: 'Casework', roles: [...OPERATIONAL_ROLES, 'parent', 'ngo'] },
  { to: '/app/cases', label: 'Cases & FIRs', icon: '📁', group: 'Casework', roles: [...OPERATIONAL_ROLES, 'parent', 'ngo'] },
  { to: '/app/register', label: 'Register child / FIR', icon: '➕', group: 'Casework', roles: CASE_CREATE_ROLES },
  { to: '/app/matches', label: 'Matches', icon: '🧬', group: 'Review', roles: OPERATIONAL_ROLES },
  { to: '/app/sightings', label: 'Sightings', icon: '📷', group: 'Review', roles: OPERATIONAL_ROLES },
  { to: '/app/cci-register', label: 'CCI register', icon: '🏠', group: 'Review', roles: CCI_REGISTER_ROLES },
  { to: '/app/grievances', label: 'Grievances', icon: '💬', group: 'Review', roles: OPERATIONAL_ROLES },
  { to: '/app/mis', label: 'MIS report', icon: '📈', group: 'Oversight', roles: OPERATIONAL_ROLES },
  { to: '/app/audit', label: 'Audit log', icon: '🔒', group: 'Oversight', roles: OPERATIONAL_ROLES },
  { to: '/app/privacy', label: 'Privacy review', icon: '🛡️', group: 'Oversight', roles: OPERATIONAL_ROLES },
  { to: '/app/fraud', label: 'Public abuse', icon: '🚩', group: 'Oversight', roles: ABUSE_REVIEW_ROLES },
  { to: '/app/network', label: 'Network', icon: '🌐', group: 'Administration', roles: NETWORK_ROLES },
  { to: '/app/simulations', label: 'Simulations & tests', icon: '🧪', group: 'Administration', roles: ['super_admin', 'admin'] },
];

/** Sidebar group order. */
export const DASHBOARD_NAV_GROUPS = ['Casework', 'Review', 'Oversight', 'Administration'];

export const DASHBOARD_ROUTE_ROLES = {
  cases: [...OPERATIONAL_ROLES, 'parent', 'ngo'],
  register: CASE_CREATE_ROLES,
  matches: OPERATIONAL_ROLES,
  sightings: OPERATIONAL_ROLES,
  'cci-register': CCI_REGISTER_ROLES,
  privacy: OPERATIONAL_ROLES,
  audit: OPERATIONAL_ROLES,
  fraud: ABUSE_REVIEW_ROLES,
  mis: OPERATIONAL_ROLES,
  grievances: OPERATIONAL_ROLES,
  network: NETWORK_ROLES,
};
