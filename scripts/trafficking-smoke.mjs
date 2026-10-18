/**
 * Checks shared/trafficking.js: the risk prompt on a case, and the patterns
 * across cases (district surges, repeat disappearances, shared contacts,
 * movement between places, sighting hotspots), against in-memory records.
 *
 *   node scripts/trafficking-smoke.mjs
 */
import process from 'node:process';

import { assessTraffickingRisk, detectPatterns, samePerson } from '../shared/trafficking.js';
import { aadhaarFields } from '../shared/privacy.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const DAY = 86400000;
const NOW = Date.parse('2026-10-18T06:00:00Z');
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();
const ahmedabad = { state: 'Gujarat', district: 'Ahmedabad' };
const surat = { state: 'Gujarat', district: 'Surat' };
const mumbai = { state: 'Maharashtra', district: 'Mumbai' };
const codes = (risk) => risk.reasons.map((r) => r.code);

let n = 0;
const kase = (fields = {}) => ({
  id: `r_${++n}`,
  personCategory: 'child',
  childName: `Child ${n}`,
  gender: 'Male',
  age: 8,
  status: 'missing',
  ...ahmedabad,
  dateOfMissing: daysAgo(5),
  createdAt: NOW - 5 * DAY,
  parentPhone: `98${String(10000000 + n)}`,
  vulnerabilityProfile: { categories: [], circumstances: null },
  ...fields,
});

// ---- The risk prompt
{
  const flaggedGirl = kase({ gender: 'Female', age: 15, vulnerabilityProfile: { categories: ['trafficking_risk'], circumstances: null } });
  const r1 = assessTraffickingRisk(flaggedGirl, { now: NOW });
  check('a flagged girl of 15 is high risk', r1.level === 'high' && r1.score === 5, `${r1.level} ${r1.score}`);
  check('the reasons are given in words', r1.reasons.every((r) => r.code && r.label) && codes(r1).includes('adolescent_girl'));

  const lured = kase({ gender: 'Female', age: 16, vulnerabilityProfile: { categories: [], circumstances: 'Left home after an agent promised her a job in Mumbai; took the train from Kalupur.' } });
  const r2 = assessTraffickingRisk(lured, { now: NOW });
  check('an agent and a promised job are read as a lure', codes(r2).includes('lure_described') && codes(r2).includes('left_by_transport'), codes(r2).join(','));
  check('a lured girl who left by train is high risk', r2.level === 'high', `${r2.level} ${r2.score}`);

  const hindi = kase({ gender: 'Female', age: 14, vulnerabilityProfile: { categories: [], circumstances: 'नौकरी का लालच देकर दलाल ले गया' } });
  check('a lure described in Hindi is read', codes(assessTraffickingRisk(hindi, { now: NOW })).includes('lure_described'));
  const gujarati = kase({ gender: 'Female', age: 14, vulnerabilityProfile: { categories: [], circumstances: 'લગ્નની લાલચ આપીને લઈ ગયો' } });
  check('a lure described in Gujarati is read', codes(assessTraffickingRisk(gujarati, { now: NOW })).includes('lure_described'));
  const network = kase({ age: 13, vulnerabilityProfile: { categories: [], circumstances: 'Network issues at the station' } });
  check('"network" is not read as "work"', !codes(assessTraffickingRisk(network, { now: NOW })).includes('work_mentioned'));

  const small = kase({ age: 6 });
  const r3 = assessTraffickingRisk(small, { now: NOW });
  check('a six-year-old with nothing recorded is standard', r3.level === 'standard' && r3.score === 0);

  const woman = kase({ personCategory: 'woman', gender: 'Female', age: 21, vulnerabilityProfile: { categories: ['abuse_risk'], circumstances: 'Met a man on Instagram' } });
  const r4 = assessTraffickingRisk(woman, { now: NOW });
  check('a young woman met online with an abuse flag is high', r4.level === 'high' && codes(r4).includes('young_woman'), `${r4.level} ${codes(r4)}`);

  const key = 'k';
  const before = kase({ childName: 'Pooja Rathod', status: 'found', ...aadhaarFields('123412341234', key), dateOfMissing: daysAgo(400) });
  const again = kase({ childName: 'Pooja Rathod', gender: 'Female', age: 14, ...aadhaarFields('123412341234', key) });
  const r5 = assessTraffickingRisk(again, { reports: [before], now: NOW, aadhaarKey: key });
  check('a child missing before is raised', codes(r5).includes('previously_missing'));
  const byPhone = kase({ childName: 'Pooja Rathod', parentPhone: before.parentPhone, childAadhar: null, childAadharHash: null });
  check('the same name and family phone are the same person', samePerson({ ...before, childAadharHash: null }, byPhone));
  check('a sibling on the same phone is not the same person', !samePerson(before, kase({ childName: 'Ravi Rathod', parentPhone: before.parentPhone, childAadharHash: null })));

  const cluster = [kase({ age: 14 }), kase({ age: 15, dateOfMissing: daysAgo(12) }), kase({ age: 16, dateOfMissing: daysAgo(20) })];
  const r6 = assessTraffickingRisk(cluster[0], { reports: cluster, now: NOW });
  check('three adolescents missing from one district in 30 days are a cluster', codes(r6).includes('district_cluster'));
  const elsewhere = [kase({ age: 14 }), kase({ age: 15, ...surat }), kase({ age: 16, ...mumbai })];
  check('the same in three districts is not', !codes(assessTraffickingRisk(elsewhere[0], { reports: elsewhere, now: NOW })).includes('district_cluster'));
}

// ---- Patterns
{
  n = 100;
  const surge = [
    kase({ gender: 'Female', age: 14, dateOfMissing: daysAgo(3), traffickingRisk: { level: 'high', score: 6, reasons: [] } }),
    kase({ gender: 'Female', age: 15, dateOfMissing: daysAgo(9), traffickingRisk: { level: 'elevated', score: 3, reasons: [] } }),
    kase({ gender: 'Female', age: 16, dateOfMissing: daysAgo(15) }),
    kase({ gender: 'Male', age: 13, dateOfMissing: daysAgo(22) }),
  ];
  const quiet = [kase({ ...surat, age: 7, dateOfMissing: daysAgo(4) }), kase({ ...surat, age: 9, dateOfMissing: daysAgo(80) }), kase({ ...surat, age: 6, dateOfMissing: daysAgo(120) })];
  const sharedPhone = '9822200001';
  const siblings = [kase({ ...mumbai, childName: 'Asha Pawar', parentPhone: sharedPhone, dateOfMissing: daysAgo(60) }), kase({ ...mumbai, childName: 'Ravi Pawar', parentPhone: sharedPhone, dateOfMissing: daysAgo(60) })];
  const repeatA = kase({ ...mumbai, childName: 'Sunita Kale', parentPhone: '9822200009', status: 'found', dateOfMissing: daysAgo(300) });
  const repeatB = kase({ ...mumbai, childName: 'Sunita Kale', parentPhone: '9822200009', dateOfMissing: daysAgo(70) });
  const reports = [...surge, ...quiet, ...siblings, repeatA, repeatB];

  const foundReports = [
    // Ahmedabad children seen in Mumbai: an interstate corridor.
    { id: 'f1', status: 'pending_review', matchedReportId: surge[0].id, ...ahmedabad, reportedLocation: mumbai, createdAt: NOW - DAY, personCategory: 'child' },
    { id: 'f2', status: 'matched', matchedReportId: surge[1].id, ...ahmedabad, reportedLocation: mumbai, createdAt: NOW - 2 * DAY, personCategory: 'child' },
    // Three unmatched sightings within a kilometre of each other: a hotspot.
    { id: 'f3', status: 'no_match', ...mumbai, lat: 18.9401, lng: 72.8351, foundLocation: 'CSMT platform 7', createdAt: NOW - DAY, personCategory: 'child' },
    { id: 'f4', status: 'no_match', ...mumbai, lat: 18.9412, lng: 72.8349, foundLocation: 'CSMT concourse', createdAt: NOW - 3 * DAY, personCategory: 'child' },
    { id: 'f5', status: 'referred_cwc', ...mumbai, lat: 18.9398, lng: 72.8355, foundLocation: 'Outside CSMT', createdAt: NOW - 6 * DAY, personCategory: 'child' },
    // An adult's sighting is not counted as a child hotspot.
    { id: 'f6', status: 'no_match', ...mumbai, lat: 18.9401, lng: 72.8351, createdAt: NOW - DAY, personCategory: 'woman' },
  ];

  const p = detectPatterns({ reports, foundReports, now: NOW });
  const ahmedabadSurge = p.surges.find((s) => s.district === 'Ahmedabad');
  check('a district losing four adolescents in a month is a surge', Boolean(ahmedabadSurge) && ahmedabadSurge.adolescents === 4 && ahmedabadSurge.girls === 3, JSON.stringify(ahmedabadSurge?.why));
  check('the surge says why', ahmedabadSurge?.why.some((w) => /aged 12 to 17/.test(w)) && ahmedabadSurge?.why.some((w) => /trafficking risk/.test(w)));
  check('a district with its usual young children missing is not', !p.surges.some((s) => s.district === 'Surat'));
  check('a repeat disappearance is listed', p.repeatMissing.some((g) => g.episodes === 2 && g.cases.every((c) => c.childName === 'Sunita Kale')));
  check('siblings on one phone are a shared contact', p.sharedContacts.some((g) => g.cases.length === 2 && g.phoneSuffix === '0001'));
  check('the shared number is shown only by its last four digits', !JSON.stringify(p.sharedContacts).includes(sharedPhone));
  const corridor = p.corridors[0];
  check('children traced from Ahmedabad to Mumbai form a corridor', corridor?.from === 'Ahmedabad, Gujarat' && corridor?.to === 'Mumbai, Maharashtra' && corridor.interstate && corridor.cases === 2 && corridor.confirmed === 1, JSON.stringify(corridor));
  const spot = p.hotspots[0];
  check('three sightings within a kilometre are a hotspot', spot?.sightings === 3 && spot.unmatched === 3, JSON.stringify(spot));
  check('high-risk open cases are listed with their reasons', p.highRisk.some((c) => c.id === surge[0].id));
  check('the counts add up', p.counts.surges === p.surges.length && p.counts.corridors === p.corridors.length);

  const anonymised = detectPatterns({ reports: reports.map((r) => ({ ...r, anonymizedAt: daysAgo(1) })), foundReports, now: NOW });
  check('anonymised cases are never in a pattern', anonymised.surges.length === 0 && anonymised.repeatMissing.length === 0 && anonymised.highRisk.length === 0 && anonymised.corridors.length === 0);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) process.exit(1);
console.log('Trafficking signal checks passed.');
