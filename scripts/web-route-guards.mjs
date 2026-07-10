import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DASHBOARD_NAV, DASHBOARD_ROUTE_ROLES } from '../web/src/dashboard/routes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainFile = path.join(root, 'web', 'src', 'main.jsx');
const mainSource = fs.readFileSync(mainFile, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const expected = {
  cases: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau', 'parent', 'ngo'],
  register: ['super_admin', 'admin', 'police', 'sjpu', 'parent', 'ngo'],
  matches: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'],
  'cci-register': ['super_admin', 'admin', 'cwc', 'dcpu', 'cci', 'saa', 'state_nodal', 'sara'],
  privacy: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'],
  audit: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'],
  fraud: ['super_admin', 'admin', 'state_nodal', 'crime_bureau'],
  mis: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'],
  grievances: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'],
  network: ['super_admin', 'admin', 'state_nodal', 'sara', 'crime_bureau'],
};

for (const [route, roles] of Object.entries(expected)) {
  assert(
    JSON.stringify(DASHBOARD_ROUTE_ROLES[route]) === JSON.stringify(roles),
    `${route} roles drifted from expected access model`
  );
  assert(
    mainSource.includes(`path: '${route}', element: gated('${route}'`),
    `${route} route is not wrapped by RequireRole`
  );

  const nav = DASHBOARD_NAV.find((item) => item.to === `/app/${route}`);
  assert(nav, `${route} is missing from dashboard navigation`);
  assert(JSON.stringify(nav.roles) === JSON.stringify(roles), `${route} navigation roles differ from route guard roles`);
}

assert(!expected.register.includes('cwc'), 'CWC must not deep-link into case/FIR registration');
assert(!expected.network.includes('parent'), 'Parent must not deep-link into stakeholder provisioning');
assert(!expected.matches.includes('parent'), 'Parent must not deep-link into sighting review');
assert(!expected.grievances.includes('parent'), 'Parent must not deep-link into grievance review');
assert(!expected.fraud.includes('parent'), 'Parent must not deep-link into public abuse review');
assert(!expected['cci-register'].includes('police'), 'Police must not deep-link into the CCI care register');

console.log('Web route guard checks passed.');
