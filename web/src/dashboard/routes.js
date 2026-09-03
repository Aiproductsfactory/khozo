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

export const DASHBOARD_NAV = [
  { to: '/app', end: true, label: 'Overview', icon: 'Chart', roles: [...OPERATIONAL_ROLES, 'parent', 'ngo'] },
  { to: '/app/cases', label: 'Cases & FIRs', icon: 'Cases', roles: [...OPERATIONAL_ROLES, 'parent', 'ngo'] },
  { to: '/app/register', label: 'Register child / FIR', icon: 'Add', roles: CASE_CREATE_ROLES },
  { to: '/app/matches', label: 'Matches', icon: 'Search', roles: OPERATIONAL_ROLES },
  { to: '/app/sightings', label: 'Sightings', icon: 'Search', roles: OPERATIONAL_ROLES },
  { to: '/app/cci-register', label: 'CCI register', icon: 'CCI', roles: CCI_REGISTER_ROLES },
  { to: '/app/privacy', label: 'Privacy review', icon: 'Privacy', roles: OPERATIONAL_ROLES },
  { to: '/app/audit', label: 'Audit log', icon: 'Audit', roles: OPERATIONAL_ROLES },
  { to: '/app/fraud', label: 'Public abuse', icon: 'Audit', roles: ABUSE_REVIEW_ROLES },
  { to: '/app/mis', label: 'MIS report', icon: 'MIS', roles: OPERATIONAL_ROLES },
  { to: '/app/grievances', label: 'Grievances', icon: 'Help', roles: OPERATIONAL_ROLES },
  { to: '/app/network', label: 'Network', icon: 'Network', roles: NETWORK_ROLES },
  { to: '/app/simulations', label: 'Simulations & Tests', icon: 'Test', roles: ['super_admin', 'admin'] },
];

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
