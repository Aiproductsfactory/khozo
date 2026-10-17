/**
 * Checks who can see a record a department restricted to police.
 *
 *   node scripts/scope-smoke.mjs
 */
import process from 'node:process';

import { canAccessReport, scopeActivity, scopeAudit, scopeFoundReports, scopeReports } from '../shared/scope.js';
import { citizenCaseView } from '../shared/case-domain.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const ahmedabad = { state: 'Gujarat', district: 'Ahmedabad' };
const user = (role, jurisdiction = ahmedabad, id = `u_${role}`) => ({ id, role, jurisdiction });
const restricted = { id: 'r_police', ...ahmedabad, status: 'missing', visibility: 'police', registeredById: 'u_police' };
const open = { id: 'r_open', ...ahmedabad, status: 'missing', registeredById: 'u_police' };
const reports = [restricted, open];

for (const role of ['police', 'sjpu', 'ahtu', 'dcrb']) {
  check(`${role} in the district sees a police-only record`, canAccessReport(user(role), restricted));
}
for (const role of ['admin', 'crime_bureau']) {
  check(`${role} for the state sees a police-only record`, canAccessReport(user(role, { state: 'Gujarat' }), restricted));
}
check('super admin sees a police-only record', canAccessReport(user('super_admin', {}), restricted));

for (const role of ['cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'dlsa']) {
  check(`${role} in the district does not see a police-only record`, !canAccessReport(user(role), restricted));
  check(`${role} still sees an ordinary record`, canAccessReport(user(role), open));
}
for (const role of ['state_nodal', 'sara']) {
  check(`${role} does not see a police-only record`, !canAccessReport(user(role, { state: 'Gujarat' }), restricted));
}
check('a parent never sees a police-only record, even one filed under their id',
  scopeReports(user('parent', {}, 'u_police'), reports).every((r) => r.id !== 'r_police'));

const matched = { id: 'f1', ...ahmedabad, matchedReportId: 'r_police' };
const unmatched = { id: 'f2', ...ahmedabad };
const cwcSightings = scopeFoundReports(user('cwc'), [matched, unmatched], reports).map((f) => f.id);
check('a sighting matched to a police-only record is hidden from CWC', cwcSightings.join() === 'f2', cwcSightings.join());
const policeSightings = scopeFoundReports(user('police'), [matched, unmatched], reports).map((f) => f.id);
check('and shown to police', policeSightings.join() === 'f1,f2', policeSightings.join());

check('a police officer elsewhere does not see it', !canAccessReport(user('police', { state: 'Maharashtra', district: 'Mumbai' }), restricted));

// A family is not told about a sighting linked to their case before an officer
// confirms it: activity scoped to a sighting's match is for authorities only.
const familyCase = { id: 'r_family', ...ahmedabad, status: 'intake_pending', registeredById: 'u_parent' };
const activity = [
  { id: 'a_registered', scope: { ...ahmedabad, reportId: 'r_family' } },
  { id: 'a_sighting', scope: { ...ahmedabad, matchedReportId: 'r_family' } },
];
const familyRows = scopeActivity(user('parent', {}, 'u_parent'), activity, [familyCase]).map((row) => row.id);
check('a parent sees activity on the case they registered', familyRows.includes('a_registered'), familyRows.join());
check('but not a sighting linked to it', !familyRows.includes('a_sighting'), familyRows.join());
const ngoRows = scopeActivity(user('ngo', {}, 'u_parent'), activity, [familyCase]).map((row) => row.id);
check('nor does an NGO that registered it', !ngoRows.includes('a_sighting'), ngoRows.join());
const policeRows = scopeActivity(user('police'), activity, [familyCase]).map((row) => row.id);
check('the district police see both', policeRows.join() === 'a_registered,a_sighting', policeRows.join());

// A traced woman decides whether the relative who registered her learns where
// she is. The family's view of the case carries what they told Khozo and its
// status, never what the agencies added to it.
const tracedWoman = {
  id: 'r_woman', personCategory: 'woman', childName: 'Sunita', status: 'found', registeredById: 'u_parent',
  state: 'Gujarat', district: 'Rajkot', foundLocation: 'One Stop Centre, Rajkot', matchScore: 0.9,
  notes: [{ note: 'She fears her husband' }], cciCareRecords: [{ cciName: 'Shelter X' }], restorationPlans: [{}],
  productionRecords: [{}], closure: { note: 'Restored' }, workflow: [{ note: 'moved' }],
  transfers: [{ from: { state: 'Gujarat', district: 'Ahmedabad' }, to: { state: 'Gujarat', district: 'Rajkot' } }],
};
const familyView = citizenCaseView(tracedWoman);
check('the family sees the case is traced', familyView.status === 'found' && familyView.childName === 'Sunita');
for (const field of ['foundLocation', 'matchScore', 'notes', 'cciCareRecords', 'restorationPlans', 'productionRecords', 'closure', 'workflow', 'transfers']) {
  check(`the family does not see ${field}`, !(field in familyView));
}
check('the family sees the district the case was registered in, not where it was moved', familyView.district === 'Ahmedabad', familyView.district);
const moved = [{ id: 'a_moved', icon: 'transfer', scope: { state: 'Gujarat', district: 'Rajkot', reportId: 'r_woman' } }];
check('a jurisdiction transfer does not reach the family activity feed',
  !scopeActivity(user('parent', {}, 'u_parent'), moved, [tracedWoman]).length);
check('it does reach the police', scopeActivity(user('police', { state: 'Gujarat', district: 'Rajkot' }), moved, [tracedWoman]).length === 1);

// --- Jurisdiction fails closed ----------------------------------------------
// Super admin is the only national role. A district desk with no district (or
// no state), or a state desk with no state, sees nothing at all: no case,
// sighting, audit row or activity. It used to see everything.
const aurangabadMh = { id: 'r_aur_mh', state: 'Maharashtra', district: 'Aurangabad', status: 'missing', registeredById: 'u_x' };
const aurangabadBr = { id: 'r_aur_br', state: 'Bihar', district: 'Aurangabad', status: 'missing', registeredById: 'u_x' };
const placedCases = [aurangabadMh, aurangabadBr];
const placedSightings = [
  { id: 'f_unplaced' },
  { id: 'f_mh', state: 'Maharashtra', district: 'Aurangabad' },
  { id: 'f_br', state: 'Bihar', district: 'Aurangabad' },
  { id: 'f_district_only', district: 'Aurangabad' },
];
const auditRows = [
  { id: 'au_case', targetType: 'report', targetId: 'r_aur_mh' },
  { id: 'au_place', scope: { state: 'Maharashtra', district: 'Aurangabad' } },
  { id: 'au_other_state', scope: { state: 'Bihar', district: 'Aurangabad' } },
];
const activityRows = [
  { id: 'ac_case', scope: { reportId: 'r_aur_mh' } },
  { id: 'ac_place', scope: { state: 'Maharashtra', district: 'Aurangabad' } },
  { id: 'ac_other_state', scope: { state: 'Bihar', district: 'Aurangabad' } },
];
const sees = (u) => ({
  reports: scopeReports(u, placedCases).map((r) => r.id).join(),
  sightings: scopeFoundReports(u, placedSightings, placedCases).map((f) => f.id).join(),
  audit: scopeAudit(u, auditRows, placedCases).map((r) => r.id).join(),
  activity: scopeActivity(u, activityRows, placedCases).map((r) => r.id).join(),
});
const seesNothing = (u) => Object.values(sees(u)).every((ids) => ids === '');
for (const role of ['police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb']) {
  const noDistrict = user(role, { state: 'Maharashtra' });
  check(`${role} with no district sees nothing`, seesNothing(noDistrict), JSON.stringify(sees(noDistrict)));
  check(`${role} with a district but no state sees nothing`, seesNothing(user(role, { district: 'Aurangabad' })));
  check(`${role} with an empty jurisdiction sees nothing`, seesNothing(user(role, {})));
}
for (const role of ['admin', 'state_nodal', 'sara', 'crime_bureau']) {
  check(`${role} with no state sees nothing`, seesNothing(user(role, {})), JSON.stringify(sees(user(role, {}))));
  check(`${role} with only a district sees nothing`, seesNothing(user(role, { district: 'Aurangabad' })));
}
check('an account with no jurisdiction at all sees nothing', seesNothing({ id: 'u_bare', role: 'police' }));
check('the super admin, with no jurisdiction, is national',
  sees(user('super_admin', {})).reports === 'r_aur_mh,r_aur_br' && sees(user('super_admin', {})).sightings.split(',').length === 4);

// A district desk matches on the state as well as the district's name: two
// states can have a district of the same name.
const mhView = sees(user('police', { state: 'Maharashtra', district: 'Aurangabad' }));
check('Aurangabad police in Maharashtra see only the Maharashtra case', mhView.reports === 'r_aur_mh', mhView.reports);
check('and the sightings in their state, the unplaced one, and one naming their district with no state',
  mhView.sightings === 'f_unplaced,f_mh,f_district_only', mhView.sightings);
check('and the audit of their state only', mhView.audit === 'au_case,au_place', mhView.audit);
check('and the activity of their state only', mhView.activity === 'ac_case,ac_place', mhView.activity);
const brView = sees(user('police', { state: 'Bihar', district: 'Aurangabad' }));
check('Aurangabad police in Bihar see only the Bihar case', brView.reports === 'r_aur_br', brView.reports);
check('a CWC desk follows the same rule', sees(user('cwc', { state: 'Bihar', district: 'Aurangabad' })).reports === 'r_aur_br');
check('a case naming a district but no state is not shown by the name alone',
  !canAccessReport(user('police', { state: 'Maharashtra', district: 'Aurangabad' }), { id: 'r_nostate', district: 'Aurangabad', status: 'missing' }));
check('a state desk sees only its state', sees(user('admin', { state: 'Maharashtra' })).reports === 'r_aur_mh');
check('state names compare without regard to case', canAccessReport(user('admin', { state: 'maharashtra' }), aurangabadMh));
const mumbaiSuburban = { id: 'r_msub', state: 'Maharashtra', district: 'Mumbai Suburban District', status: 'missing' };
check('district aliases still apply', canAccessReport(user('police', { state: 'Maharashtra', district: 'Mumbai' }), mumbaiSuburban));
check('but not across states', !canAccessReport(user('police', { state: 'Gujarat', district: 'Mumbai' }), mumbaiSuburban));
check('a parent still sees what they registered', scopeReports(user('parent', {}, 'u_x'), placedCases).length === 2);

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('Scope checks passed.');
