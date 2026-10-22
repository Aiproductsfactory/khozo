/**
 * Checks that a sighting reaches the police station that can get there first,
 * on its phones (shared/station-alerts.js):
 *
 *   - the nearest station desk is told, with every login of that station (the
 *     in-charge and the PSO), and so is the station whose poster code the
 *     reporter scanned; a desk switched off, too far away, or not a police
 *     station login is not;
 *   - each is told in the inbox, by a push on the alarm channel and by SMS,
 *     and what is sent says what, where and when, never who;
 *   - the station sees the sighting and never the case, and answers "On it",
 *     found, not there, or an update; others told about it hear the answer;
 *   - with no station to tell, or no "On it" in 15 minutes, the district
 *     control room, the state desk and the command centre are told, and the
 *     15-minute job never escalates a sighting a station answered meanwhile;
 *   - push tokens are kept on the account, moved when a phone changes hands,
 *     and never returned by the API.
 *
 * Handlers are called directly with stubbed dependencies: no server, no
 * database, no network.
 *
 *   node scripts/station-alerts-smoke.mjs
 */

import process from 'node:process';

import registerReportRoutes from '../shared/routes/reports.js';
import registerDashboardRoutes from '../shared/routes/dashboard.js';
import {
  ESCALATE_AFTER_MS, URGENT_CHANNEL, URGENT_SOUND,
  alertPhones, canSeeStationAlert, escalateStationAlert, escalationDue, escalationRecipients, stationAlertWords, stationDesksFor,
} from '../shared/station-alerts.js';
import { publicUser as workerPublicUser } from '../worker/src/http/express-compat.js';
import { runStationEscalations } from '../worker/src/ops.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('Khozo station alerts\n');

const AHMEDABAD = { state: 'Gujarat', district: 'Ahmedabad' };
const KALUPUR_AT = { lat: 23.03, lng: 72.601 };
const NEAR_KALUPUR = { lat: 23.027, lng: 72.6 };

const station = (id, name, at, extra = {}) => ({
  id, role: 'police', name: `${name} PS`, phone: null,
  jurisdiction: { level: 'station', ...AHMEDABAD, station: name },
  stationDesk: { ...at, posterCodes: [], on: true },
  ...extra,
});

const KALUPUR_PI = station('u_kal_pi', 'Kalupur', KALUPUR_AT, {
  name: 'PI Kalupur', alertPhone: '9000000101', stationDesk: { ...KALUPUR_AT, posterCodes: ['kalupur'], on: true },
  pushTokens: [{ token: 'ExponentPushToken[pi-phone-0001]', platform: 'android', at: 1 }],
});
const KALUPUR_PSO = station('u_kal_pso', 'Kalupur', KALUPUR_AT, { name: 'PSO Kalupur', phone: '9000000102' });
const SHAHIBAUG = station('u_shb', 'Shahibaug', { lat: 23.056, lng: 72.6 }, {
  stationDesk: { lat: 23.056, lng: 72.6, posterCodes: ['civil-hospital'], on: true },
  alertPhone: '9000000201',
});
const SWITCHED_OFF = station('u_off', 'Gomtipur', { lat: 23.0272, lng: 72.6002 }, { stationDesk: { lat: 23.0272, lng: 72.6002, on: false } });
const CONTROL_ROOM = { id: 'u_ahd_cr', role: 'police', name: 'Ahmedabad City Control Room', alertPhone: '9000000100', jurisdiction: { level: 'station', ...AHMEDABAD, station: null } };
const GUJ_ADMIN = { id: 'u_guj', role: 'admin', name: 'Gujarat State Desk', jurisdiction: { level: 'state', state: 'Gujarat' } };
const SUPER = { id: 'u_super', role: 'super_admin', name: 'Command Centre', jurisdiction: { level: 'national' } };
const CWC_WITH_DESK = { id: 'u_cwc', role: 'cwc', name: 'Ahmedabad CWC', jurisdiction: { level: 'district', ...AHMEDABAD }, stationDesk: { ...NEAR_KALUPUR, on: true } };
const MUMBAI_STATION = {
  id: 'u_colaba', role: 'police', name: 'Colaba PS', jurisdiction: { level: 'station', state: 'Maharashtra', district: 'Mumbai', station: 'Colaba' },
  stationDesk: { lat: 18.907, lng: 72.814, on: true },
};

const USERS = [KALUPUR_PI, KALUPUR_PSO, SHAHIBAUG, SWITCHED_OFF, CONTROL_ROOM, GUJ_ADMIN, SUPER, CWC_WITH_DESK, MUMBAI_STATION];

// --- Who a sighting goes to ---------------------------------------------------------
{
  const picks = stationDesksFor({ ...NEAR_KALUPUR }, USERS);
  const ids = picks.map((p) => p.user.id).sort().join(',');
  check('the nearest station is told, with all its logins', ids === 'u_kal_pi,u_kal_pso' && picks.every((p) => p.reason === 'nearest'), ids);
  check('a switched-off desk nearer still is passed over', !ids.includes('u_off'));
  check('a CWC account is never a station desk', !ids.includes('u_cwc'));
  check('the distance is kept', picks[0]?.distanceKm != null && picks[0].distanceKm < 1, String(picks[0]?.distanceKm));

  const poster = stationDesksFor({ ...NEAR_KALUPUR, campaignSource: 'Civil-Hospital' }, USERS);
  check('the station whose poster code was scanned is told too', poster.some((p) => p.user.id === 'u_shb' && p.reason === 'poster'), poster.map((p) => `${p.user.id}:${p.reason}`).join(','));

  const far = stationDesksFor({ lat: 25.6, lng: 85.1 }, USERS);
  check('no station further than 25 km is told', far.length === 0);
  const farPoster = stationDesksFor({ lat: 25.6, lng: 85.1, campaignSource: 'kalupur' }, USERS);
  check('but a poster station is, wherever the sighting', farPoster.length === 2 && farPoster.every((p) => p.reason === 'poster'));
  check('no coordinates, no poster: no station', stationDesksFor({ state: 'Gujarat' }, USERS).length === 0);
}

// --- What is said -------------------------------------------------------------------------
const SIGHTING_TEXT = {
  id: 'f_word', personCategory: 'child', foundLocation: 'Lat 23.0270, Lng 72.6000', geoAddress: 'Kalupur Gate, Ahmedabad 380002',
  createdAt: Date.UTC(2026, 9, 22, 17, 12), reporterName: 'Ramesh Reporter', note: 'Crying near the gate',
};
{
  const words = stationAlertWords(SIGHTING_TEXT, { kind: 'nearest' });
  const all = `${words.title} ${words.body} ${words.sms}`;
  check('it says what, where and when', /A child/.test(words.body) && /Kalupur Gate/.test(words.body) && /10:42 pm, 22 Oct/.test(words.body), words.body);
  check('the SMS links to the sighting and asks for "On it"', /khozo\.org\/app\/sightings\?id=f_word/.test(words.sms) && /On it/.test(words.sms), words.sms);
  check('it never names the reporter, quotes the note or mentions a match', !/Ramesh|Crying|match/i.test(all), all);
  const posterWords = stationAlertWords(SIGHTING_TEXT, { kind: 'poster', posterCode: 'kalupur' });
  check('a poster station is told why', /poster code "kalupur"/.test(posterWords.body));
  const escalated = stationAlertWords(SIGHTING_TEXT, { kind: 'escalated', minutes: 15 });
  check('an escalation says how long no station has answered', /15 minutes/.test(escalated.body) && /URGENT/.test(escalated.sms));
}

// --- Phones -----------------------------------------------------------------------------------
function phoneNetwork({ deadTokens = [], smsDown = false } = {}) {
  const pushes = [];
  const sms = [];
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes('exp.host')) {
      const messages = JSON.parse(options.body);
      pushes.push(...messages);
      return {
        ok: true,
        json: async () => ({
          data: messages.map((m) => (deadTokens.includes(m.to)
            ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok', id: `t_${pushes.length}` })),
        }),
      };
    }
    if (String(url).startsWith('https://sms.test')) {
      sms.push(JSON.parse(options.body));
      return { ok: !smsDown, status: smsDown ? 503 : 200, json: async () => ({}) };
    }
    throw new Error(`no network in this test: ${url}`);
  };
  return { pushes, sms, fetchImpl };
}
const SMS_SETTINGS = { smsGatewayUrl: 'https://sms.test/send', smsApiKey: 'test-key' };

{
  const net = phoneNetwork({ deadTokens: ['ExponentPushToken[pi-phone-0001]'] });
  const words = stationAlertWords(SIGHTING_TEXT);
  const { results, dead } = await alertPhones([KALUPUR_PI, KALUPUR_PSO], words, { data: { scope: { foundReportId: 'f_word', stationAlert: true } }, settings: SMS_SETTINGS, fetchImpl: net.fetchImpl });
  const push = net.pushes[0] || {};
  check('the push rings on the alarm channel with the alarm sound', push.channelId === URGENT_CHANNEL && push.sound === URGENT_SOUND && push.priority === 'high', JSON.stringify({ channelId: push.channelId, sound: push.sound }));
  check('a phone that no longer answers is marked for removal', dead.length === 1 && dead[0].userId === 'u_kal_pi');
  check('an SMS goes to the station’s alert number, or the login’s phone', net.sms.map((m) => m.to).sort().join(',') === '9000000101,9000000102', net.sms.map((m) => m.to).join(','));
  check('a login with no app is reported as such', results.find((r) => r.userId === 'u_kal_pso')?.push.reason === 'no_device');
  const down = phoneNetwork({ smsDown: true });
  const failed = await alertPhones([KALUPUR_PSO], words, { settings: SMS_SETTINGS, fetchImpl: down.fetchImpl });
  check('a failed SMS is recorded, not thrown', failed.results[0].sms.sent === false && failed.results[0].sms.reason === 'gateway_failed');
  const noGateway = await alertPhones([KALUPUR_PSO], words, { settings: {}, fetchImpl: down.fetchImpl });
  check('with no SMS gateway configured, it says so', noGateway.results[0].sms.reason === 'no_gateway');
}

// --- The routes ----------------------------------------------------------------------------
function harness({ users = USERS.map((u) => structuredClone(u)), sightings = [], reports = [], net = phoneNetwork() } = {}) {
  const db = { users, sightings, reports, notes: [], audit: [] };
  const routes = [];
  const router = {
    use: () => router,
    ...Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map((method) => [
      method,
      (path, ...handlers) => {
        routes.push({ method: method.toUpperCase(), path, handler: handlers.flat().at(-1) });
        return router;
      },
    ])),
  };
  const pass = (_req, _res, next) => next?.();
  const update = (list) => (id, patch) => {
    const row = list.find((r) => r.id === id);
    if (row) Object.assign(row, patch);
    return row || null;
  };
  const deps = {
    listReports: () => db.reports,
    findReport: (id) => db.reports.find((r) => r.id === id) || null,
    addReport: (r) => db.reports.unshift(r),
    updateReport: update(db.reports),
    listFoundReports: () => db.sightings,
    findFoundReport: (id) => db.sightings.find((s) => s.id === id) || null,
    addFoundReport: (row) => db.sightings.unshift(row),
    updateFoundReport: update(db.sightings),
    listUsers: () => db.users,
    updateUser: update(db.users),
    findUserByEmail: (email) => db.users.find((u) => u.email === email) || null,
    addUser: (u) => { db.users.push(u); return u; },
    addActivity: () => {},
    addAudit: (row) => db.audit.push(row),
    addNotification: (row) => db.notes.push(row),
    listNotifications: async (userId) => db.notes.filter((n) => n.userId === userId),
    markNotificationsRead: async () => [],
    listActivity: () => [],
    listAudit: () => db.audit,
    savePhoto: async (key) => `${key}.jpg`,
    readPhoto: async () => null,
    photoMimeType: () => 'image/jpeg',
    authRequired: pass,
    optionalAuth: pass,
    passwordChangeRequired: pass,
    requireRole: () => pass,
    publicUser: workerPublicUser,
    auditPublicRateLimit: () => {},
    clientIp: () => 'test',
    fixedWindowRateLimit: () => pass,
    rankMatches: async () => ({ candidates: [], engine: { provider: 'stub', modelVersion: null, biometric: false } }),
    detectPerson: async () => ({ verdict: 'person', faces: 1, provider: 'stub', checkedAt: Date.now() }),
    upload: { single: () => pass },
    fetchImpl: net.fetchImpl,
    settings: SMS_SETTINGS,
  };
  registerReportRoutes(router, deps);
  registerDashboardRoutes(router, deps);
  const call = async (method, path, { params = {}, body = {}, user = null } = {}) => {
    const route = routes.find((r) => r.method === method && r.path === path);
    if (!route) throw new Error(`no route ${method} ${path}`);
    let status = 200;
    let payload = null;
    const res = {
      status(code) { status = code; return res; },
      json(data) { payload = data; return res; },
      type() { return res; },
      set() { return res; },
      setHeader() { return res; },
      send(data) { payload = data; return res; },
      end() { return res; },
    };
    await route.handler({ body, params, query: {}, headers: {}, user }, res);
    return { status, payload };
  };
  return { db, call, net };
}

const user = (h, id) => h.db.users.find((u) => u.id === id);

// A text report from near Kalupur Gate, from the public form.
{
  const h = harness();
  const sent = await h.call('POST', '/found', {
    body: { foundLocation: 'Near Kalupur Gate', note: 'A boy alone, crying', lat: String(NEAR_KALUPUR.lat), lng: String(NEAR_KALUPUR.lng), personCategory: 'child', reporterName: 'Passer-by', reporterPhone: '9111111111' },
  });
  check('the public report goes through', sent.status === 201, `HTTP ${sent.status} ${sent.payload?.error || ''}`);
  const f = h.db.sightings[0];
  const desks = (f?.stationAlert?.desks || []).map((d) => d.userId).sort().join(',');
  check('the sighting records the station it was sent to', desks === 'u_kal_pi,u_kal_pso', desks);
  check('the receipt says nothing about a station', !JSON.stringify(sent.payload).includes('stationAlert'));
  const inbox = h.db.notes.filter((n) => n.kind === 'station_alert');
  check('both Kalupur logins get an urgent inbox alert', inbox.length === 2 && inbox.every((n) => n.priority === 'high' && n.scope?.stationAlert));
  check('the in-charge’s phone gets a push', h.net.pushes.some((p) => p.to === 'ExponentPushToken[pi-phone-0001]'));
  check('and both numbers an SMS', h.net.sms.map((m) => m.to).sort().join(',') === '9000000101,9000000102', h.net.sms.map((m) => m.to).join(','));
  check('the SMS and push name no one', ![...h.net.sms.map((m) => m.message), ...h.net.pushes.map((p) => p.body)].some((t) => /Passer-by|9111111111|crying/i.test(t)));
  check('the record says what reached each phone', f.stationAlert.desks.find((d) => d.userId === 'u_kal_pi')?.push?.sent === true && f.stationAlert.desks.find((d) => d.userId === 'u_kal_pso')?.sms?.sent === true);
  check('nobody escalates a sighting a station was told about', !f.stationAlert.escalation);

  // What the station sees.
  const list = await h.call('GET', '/found/station-alerts', { user: user(h, 'u_kal_pi') });
  const view = list.payload?.alerts?.[0];
  check('the in-charge sees it in their station list', list.payload?.alerts?.length === 1 && view?.id === f.id && view?.stationAlert?.reason === 'nearest');
  check('the view holds no case and no score', !['matchedReportId', 'matchScore', 'matchCandidates', 'matchedReport', 'state', 'district'].some((k) => k in (view || {})), Object.keys(view || {}).join(','));
  const other = await h.call('GET', '/found/station-alerts', { user: user(h, 'u_colaba') });
  check('a station it was not sent to does not see it', other.payload?.alerts?.length === 0);
  check('the station may open its photo', canSeeStationAlert(user(h, 'u_kal_pso'), f) && !canSeeStationAlert(user(h, 'u_colaba'), f));

  // Answering.
  const stranger = await h.call('POST', '/found/:id/station-alert/reply', { params: { id: f.id }, body: { outcome: 'on_it' }, user: user(h, 'u_colaba') });
  check('another station cannot answer for it', stranger.status === 403, `HTTP ${stranger.status}`);
  const empty = await h.call('POST', '/found/:id/station-alert/reply', { params: { id: f.id }, body: { outcome: 'update' }, user: user(h, 'u_kal_pi') });
  check('an update needs words', empty.status === 400);
  const onIt = await h.call('POST', '/found/:id/station-alert/reply', { params: { id: f.id }, body: { outcome: 'on_it' }, user: user(h, 'u_kal_pso') });
  check('the PSO says "On it"', onIt.status === 200 && onIt.payload?.alert?.stationAlert?.ack?.byId === 'u_kal_pso', `HTTP ${onIt.status} ${onIt.payload?.error || ''}`);
  check('the in-charge hears it', h.db.notes.some((n) => n.kind === 'station_alert_reply' && n.userId === 'u_kal_pi' && /On it/.test(n.title)));
  check('an answered sighting is not escalated', !escalationDue(h.db.sightings[0], Date.now() + 2 * ESCALATE_AFTER_MS));
  const found = await h.call('POST', '/found/:id/station-alert/reply', { params: { id: f.id }, body: { outcome: 'found', note: 'With us at the station' }, user: user(h, 'u_kal_pi') });
  check('the in-charge reports the boy found', found.status === 200 && found.payload?.alert?.stationAlert?.replies?.length === 2 && found.payload.alert.stationAlert.ack.byId === 'u_kal_pso');
  check('the answers are audited', h.db.audit.filter((a) => a.action === 'sighting.station_replied').length === 2);
}

// A photo the screen found no person in rings no station.
{
  const users = USERS.map((u) => structuredClone(u));
  const noPerson = async () => ({ verdict: 'no_person', faces: 0, provider: 'stub', checkedAt: Date.now() });
  const routes = [];
  const router = { use: () => router, ...Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map((m) => [m, (path, ...hs) => { routes.push({ method: m.toUpperCase(), path, handler: hs.flat().at(-1) }); return router; }])) };
  const pass = (_q, _s, next) => next?.();
  const sightings = [];
  const net = phoneNetwork();
  registerReportRoutes(router, {
    listReports: () => [], findReport: () => null, addReport: () => {}, updateReport: () => null,
    listFoundReports: () => sightings, findFoundReport: (id) => sightings.find((s) => s.id === id) || null,
    addFoundReport: (row) => sightings.unshift(row),
    updateFoundReport: (id, patch) => Object.assign(sightings.find((s) => s.id === id) || {}, patch),
    listUsers: () => users, addActivity: () => {}, addAudit: () => {}, addNotification: () => {},
    savePhoto: async (key) => `${key}.jpg`, readPhoto: async () => null, photoMimeType: () => 'image/jpeg',
    authRequired: pass, optionalAuth: pass, passwordChangeRequired: pass, requireRole: () => pass,
    auditPublicRateLimit: () => {}, clientIp: () => 'test', fixedWindowRateLimit: () => pass,
    rankMatches: async () => ({ candidates: [], engine: { provider: 'stub', biometric: false } }),
    detectPerson: noPerson, upload: { single: () => pass }, fetchImpl: net.fetchImpl, settings: SMS_SETTINGS,
  });
  const post = routes.find((r) => r.method === 'POST' && r.path === '/found').handler;
  let status = 0;
  const res = { status(c) { status = c; return res; }, json() { return res; }, set() { return res; }, setHeader() { return res; } };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  await post({ body: { foundLocation: 'Kalupur', lat: String(NEAR_KALUPUR.lat), lng: String(NEAR_KALUPUR.lng), photoConsent: 'true' }, file: { buffer: jpeg, mimetype: 'image/jpeg', size: jpeg.length, originalname: 'x.jpg' }, params: {}, query: {}, headers: {} }, res);
  check('a photo with no person in it rings no station', status === 201 && !sightings[0]?.stationAlert && net.pushes.length === 0 && net.sms.length === 0, `HTTP ${status} ${JSON.stringify(sightings[0]?.stationAlert || null)}`);
}

// No station near: where stations are set up, the control room is told at once.
{
  const h = harness();
  const sent = await h.call('POST', '/found', {
    body: { foundLocation: 'Bhuj bus stand', note: 'Girl alone', lat: '23.25', lng: '69.67', state: 'Gujarat', personCategory: 'child' },
  });
  const f = h.db.sightings[0];
  check('with no Gujarat station near, it is escalated at once', sent.status === 201 && f?.stationAlert?.desks?.length === 0 && f.stationAlert.escalation?.reason === 'no_station', JSON.stringify(f?.stationAlert?.escalation || null));
  const told = h.db.notes.filter((n) => n.kind === 'station_alert_escalated').map((n) => n.userId).sort().join(',');
  check('the state desk and the command centre are told, not Ahmedabad’s control room', told === 'u_guj,u_super', told);

  const bihar = harness();
  const quiet = await bihar.call('POST', '/found', {
    body: { foundLocation: 'Patna Junction', note: 'Girl alone', lat: '25.603', lng: '85.137', state: 'Bihar', personCategory: 'child' },
  });
  const b = bihar.db.sightings[0];
  check('where no station is set up yet, nothing new is raised', quiet.status === 201 && !b?.stationAlert && !bihar.db.notes.some((n) => /^station_alert/.test(n.kind)) && bihar.net.sms.length === 0);
  check('the alert every desk gets still goes', bihar.db.notes.some((n) => n.kind === 'sighting_reported'));
}

// No answer in 15 minutes.
{
  const now = Date.now();
  const sighting = {
    id: 'f_wait', status: 'no_match', personCategory: 'child', ...NEAR_KALUPUR, foundLocation: 'Kalupur Gate', createdAt: now - 20 * 60000,
    reportedLocation: { ...AHMEDABAD }, state: 'Gujarat', district: 'Ahmedabad',
    stationAlert: { sentAt: now - 20 * 60000, desks: [{ userId: 'u_kal_pi', station: 'Kalupur' }, { userId: 'u_kal_pso', station: 'Kalupur' }], ack: null, replies: [], escalation: null },
  };
  check('after 15 minutes with no answer, escalation is due', escalationDue(sighting, now));
  check('not before', !escalationDue({ ...sighting, stationAlert: { ...sighting.stationAlert, sentAt: now - 10 * 60000 } }, now));
  check('not for a closed sighting', !escalationDue({ ...sighting, status: 'rejected' }, now));
  const to = escalationRecipients(sighting, USERS, new Set(['u_kal_pi', 'u_kal_pso'])).map((u) => u.id).sort().join(',');
  check('the district control room, the state desk and the command centre are told', to === 'u_ahd_cr,u_guj,u_super', to);
  const notes = [];
  const net = phoneNetwork();
  const result = await escalateStationAlert(sighting, { users: USERS, now, addNotification: (n) => notes.push(n), settings: SMS_SETTINGS, fetchImpl: net.fetchImpl });
  check('they are told in the inbox', notes.length === 3 && notes.every((n) => n.priority === 'high'));
  check('the SMS goes only to an account with an alert number for it', net.sms.map((m) => m.to).join(',') === '9000000100', net.sms.map((m) => m.to).join(','));
  check('the record says who was told and why', result.escalation.reason === 'no_answer' && result.escalation.userIds.length === 3);

  // The 15-minute job, with a station that answers while it runs.
  const makeStore = (rows, { answerBeforeClaim = false } = {}) => {
    const dbRows = rows.map((r) => structuredClone(r));
    const replica = rows.map((r) => structuredClone(r));
    const added = [];
    let flushed = false;
    return {
      added,
      dbRows,
      get flushed() { return flushed; },
      createStore: async () => ({
        store: {
          listFoundReports: () => replica,
          listUsers: () => USERS,
          addNotification: (n) => added.push(n),
          updateUser: () => {},
          async claimFoundReport(id, makePatch, isEligible) {
            const current = dbRows.find((r) => r.id === id);
            if (answerBeforeClaim) current.stationAlert = { ...current.stationAlert, ack: { byId: 'u_kal_pi', at: now } };
            if (!current || !isEligible(current)) return null;
            Object.assign(current, makePatch(current));
            return current;
          },
        },
        flush: async () => { flushed = true; },
      }),
    };
  };
  const job = makeStore([sighting]);
  const run = await runStationEscalations({}, {}, { now, createStore: job.createStore, fetchImpl: phoneNetwork().fetchImpl });
  check('the 15-minute job escalates it', run.escalated === 1 && job.dbRows[0].stationAlert.escalation?.userIds?.length === 3 && job.flushed, JSON.stringify(run));
  const again = await runStationEscalations({}, {}, { now: now + 15 * 60000, createStore: makeStore([job.dbRows[0]]).createStore, fetchImpl: phoneNetwork().fetchImpl });
  check('and only once', again.escalated === 0);
  const raced = makeStore([sighting], { answerBeforeClaim: true });
  const racedRun = await runStationEscalations({}, {}, { now, createStore: raced.createStore, fetchImpl: phoneNetwork().fetchImpl });
  check('a station that answers while the job runs is not escalated over', racedRun.escalated === 0 && raced.added.length === 0 && raced.dbRows[0].stationAlert.ack?.byId === 'u_kal_pi');
}

// Phones and settings on the account.
{
  const h = harness();
  const bad = await h.call('POST', '/push-token', { body: { token: 'not-a-token' }, user: user(h, 'u_kal_pso') });
  check('only an app push token is accepted', bad.status === 400);
  const ok = await h.call('POST', '/push-token', { body: { token: 'ExponentPushToken[pso-phone-0002]', platform: 'android', deviceName: 'Redmi 12' }, user: user(h, 'u_kal_pso') });
  check('the PSO’s phone is registered', ok.status === 200 && user(h, 'u_kal_pso').pushTokens?.[0]?.token === 'ExponentPushToken[pso-phone-0002]');
  const moved = await h.call('POST', '/push-token', { body: { token: 'ExponentPushToken[pi-phone-0001]', platform: 'android' }, user: user(h, 'u_kal_pso') });
  check('a phone signed in to another login rings only for the newest', moved.status === 200 && (user(h, 'u_kal_pi').pushTokens || []).length === 0 && user(h, 'u_kal_pso').pushTokens.length === 2);
  const shown = workerPublicUser(user(h, 'u_kal_pso'));
  check('the API never returns a push token, only how many phones', !('pushTokens' in shown) && shown.alertDevices === 2 && !JSON.stringify(shown).includes('ExponentPushToken'));
  const removed = await h.call('POST', '/push-token/remove', { body: { token: 'ExponentPushToken[pso-phone-0002]' }, user: user(h, 'u_kal_pso') });
  check('signing out of the app removes its phone', removed.payload?.devices === 1);
  const test = await h.call('POST', '/push-test', { user: user(h, 'u_kal_pso') });
  check('a test alert reports what reached the phone and the number', test.status === 200 && test.payload?.push?.sent === true && test.payload?.sms?.sent === true && h.net.sms.at(-1)?.to === '9000000102', JSON.stringify(test.payload));

  const admin = user(h, 'u_guj');
  const set = await h.call('POST', '/network/users/:id/alerts', {
    params: { id: 'u_shb' }, user: admin,
    body: { alertPhone: '+91 90000 00299', stationDesk: { lat: '23.0561', lng: '72.6001', posterCodes: 'civil-hospital, Shahibaug Bus Stand!, shahibaug' } },
  });
  check('a state admin sets a station’s alerts', set.status === 200 && user(h, 'u_shb').alertPhone === '+919000000299' && user(h, 'u_shb').stationDesk.posterCodes.join(',') === 'civil-hospital,shahibaug' && set.payload?.ignoredCodes?.join() === 'Shahibaug Bus Stand!', `HTTP ${set.status} ${set.payload?.error || JSON.stringify(user(h, 'u_shb').stationDesk?.posterCodes)}`);
  const cwc = await h.call('POST', '/network/users/:id/alerts', { params: { id: 'u_cwc' }, user: admin, body: { stationDesk: { lat: 23, lng: 72 } } });
  check('a CWC login cannot be made a station desk', cwc.status === 400);
  const badPhone = await h.call('POST', '/network/users/:id/alerts', { params: { id: 'u_shb' }, user: admin, body: { alertPhone: '12345' } });
  check('a short alert number is refused', badPhone.status === 400);
  const noPlace = await h.call('POST', '/network/users/:id/alerts', { params: { id: 'u_shb' }, user: admin, body: { stationDesk: { lat: '', lng: '72.6' } } });
  check('a station desk needs its location', noPlace.status === 400);
  const outside = await h.call('POST', '/network/users/:id/alerts', { params: { id: 'u_colaba' }, user: admin, body: { alertPhone: '9000000300' } });
  check('a Gujarat admin cannot change a Mumbai station', outside.status === 404);
  check('the change is audited without the full number', h.db.audit.some((a) => a.action === 'auth.alert_settings_changed' && a.metadata?.alertPhone === '…0299'));
  const roster = await h.call('GET', '/network', { user: admin });
  const row = roster.payload?.users?.find((u) => u.id === 'u_kal_pso');
  check('the roster shows how many phones get a login’s alerts, never the tokens', row?.alertDevices === 1 && !JSON.stringify(roster.payload).includes('ExponentPushToken'), JSON.stringify(row));
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
