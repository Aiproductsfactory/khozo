/**
 * Station alerts: every real sighting reaches the police station that can get
 * there first, on the in-charge's phone.
 *
 * A sighting already alerts every official desk in the country
 * (shared/routes/reports.js alertSighting). Told to forty desks at once, it
 * was no one desk's job. So one station owns it:
 *
 *   - the nearest station desk to where it was seen (within STATION_RADIUS_KM),
 *     and every desk account of that same station (the in-charge and the PSO);
 *   - any station whose poster code the reporter scanned (campaignSource), as
 *     the police who put the poster up.
 *
 * Each desk is told three ways at once, so one failing does not lose it: the
 * console's alert inbox, a push to the officer app on an urgent channel that
 * rings like an alarm, and an SMS to the station's alert number (the post's
 * CUG mobile, which stays with the post across transfers). What is sent is
 * what was seen, where and when: never a photo, a name, or whether it may
 * match a case. A message on a lock screen, or a phone left on a desk, must
 * not tell a stranger who the child is.
 *
 * A station desk is a police account with `stationDesk` set by an admin
 * (POST /api/dashboard/network/users/:id/alerts): where the station is and
 * its poster codes. Any account may also be given an `alertPhone`, the number
 * its SMS go to (a station's falls back to the account's phone; a control
 * room's must be set to be texted). If no desk answers "On it" within
 * ESCALATE_AFTER_MS, or there was no station desk to tell, the district's
 * control room, the state desk and the command centre are told
 * (escalateStationAlert, run by the 15-minute cron in worker/src/ops.js).
 */

import { campaignSourceOf } from './campaign-source.js';
import { sameDistrictPlace, sameStatePlace } from './scope.js';
import { sendSms } from './sms.js';

/** Accounts that can be a station desk: a police station login. */
export const STATION_ROLES = ['police', 'sjpu'];
/** A sighting further than this from every station desk is told to no station: the control room gets it. */
export const STATION_RADIUS_KM = 25;
/** How long a station has to answer "On it" before the control room is told. */
export const ESCALATE_AFTER_MS = 15 * 60 * 1000;
/** The officer app's urgent channel and its alarm sound (mobile/src/services/alerts.js). */
export const URGENT_CHANNEL = 'khozo-urgent';
export const URGENT_SOUND = 'khozo_alarm.wav';
/** Devices an account keeps push tokens for; the oldest is dropped. */
export const MAX_PUSH_DEVICES = 5;
/** What a station can answer. */
export const STATION_OUTCOMES = {
  on_it: 'On it',
  found: 'Found the person',
  not_found: 'Went to the place; the person was not there',
  update: 'Update',
};
/** Sightings still open, which a station alert stays live for. */
const OPEN_STATUSES = new Set(['pending_review', 'no_match', 'referred_cwc']);

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PUSH_TIMEOUT_MS = 6000;
const SITE = 'https://khozo.org';

function finite(value) {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) ? n : null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Great-circle distance in kilometres. */
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** An account's station desk settings, cleaned; null when it is not one. */
export function stationDeskOf(user) {
  const desk = user?.stationDesk;
  if (!desk || typeof desk !== 'object' || !STATION_ROLES.includes(user.role)) return null;
  const lat = finite(desk.lat);
  const lng = finite(desk.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    lat,
    lng,
    alertPhone: text(user.alertPhone) || text(user.phone) || null,
    posterCodes: (Array.isArray(desk.posterCodes) ? desk.posterCodes : []).map(campaignSourceOf).filter(Boolean),
    on: desk.on !== false,
  };
}

/** The station an account is the desk of, for grouping its in-charge and PSO logins. */
function stationKey(user) {
  const place = user.jurisdiction || {};
  const station = text(place.station).toLowerCase();
  return station ? `${text(place.districtCode || place.district).toLowerCase()}|${station}` : `user:${user.id}`;
}

export function stationName(user) {
  return text(user?.jurisdiction?.station) || text(user?.name) || 'Police station';
}

function coordsOf(sighting) {
  const lat = finite(sighting?.lat);
  const lng = finite(sighting?.lng);
  return lat === null || lng === null ? null : { lat, lng };
}

/**
 * The station desks a sighting goes to: `[{ user, reason, distanceKm }]`,
 * nearest station first, then poster stations. Empty when there is no desk
 * near enough and no poster code: the control room is told instead.
 */
export function stationDesksFor(sighting, users = [], { radiusKm = STATION_RADIUS_KM } = {}) {
  const desks = users
    .map((user) => ({ user, desk: stationDeskOf(user) }))
    .filter((d) => d.desk && d.desk.on);
  const picked = new Map();
  const at = coordsOf(sighting);
  if (at && desks.length) {
    const measured = desks.map((d) => ({ ...d, km: distanceKm(at, d.desk) })).sort((a, b) => a.km - b.km);
    if (measured[0].km <= radiusKm) {
      const key = stationKey(measured[0].user);
      for (const d of measured.filter((m) => stationKey(m.user) === key)) {
        picked.set(d.user.id, { user: d.user, reason: 'nearest', distanceKm: Math.round(d.km * 10) / 10 });
      }
    }
  }
  const code = campaignSourceOf(sighting?.campaignSource);
  if (code) {
    // A code set on one login of a station is the whole station's poster.
    const stations = new Set(desks.filter((x) => x.desk.posterCodes.includes(code)).map((x) => stationKey(x.user)));
    for (const d of desks.filter((x) => stations.has(stationKey(x.user)))) {
      if (!picked.has(d.user.id)) {
        picked.set(d.user.id, { user: d.user, reason: 'poster', distanceKm: at ? Math.round(distanceKm(at, d.desk) * 10) / 10 : null });
      }
    }
  }
  return [...picked.values()];
}

/**
 * Who is told when no station answers: the police control room of the
 * district it was seen in (a police login with no station), the state's
 * admin and crime bureau desks, and the command centre (super admin).
 */
export function escalationRecipients(sighting, users = [], exclude = new Set()) {
  const seen = sighting?.reportedLocation && typeof sighting.reportedLocation === 'object'
    ? sighting.reportedLocation
    : { state: sighting?.state, district: sighting?.district };
  const hasDistrict = Boolean(seen.district || seen.districtCode);
  const hasState = Boolean(seen.state || seen.stateCode);
  return users.filter((u) => {
    if (exclude.has(u.id)) return false;
    if (u.role === 'super_admin') return true;
    const place = u.jurisdiction || {};
    if (['admin', 'crime_bureau'].includes(u.role)) return hasState && sameStatePlace(place, seen);
    if (u.role === 'police' && !text(place.station)) return hasDistrict && sameDistrictPlace(place, seen);
    return false;
  });
}

/** "10:42 pm, 22 Oct", in India's time. */
export function istTime(ms) {
  try {
    const parts = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true, day: 'numeric', month: 'short',
    }).formatToParts(new Date(ms));
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return `${get('hour')}:${get('minute')} ${get('dayPeriod').toLowerCase()}, ${get('day')} ${get('month')}`;
  } catch {
    return new Date(ms).toISOString();
  }
}

function whoWasSeen(sighting) {
  const category = sighting?.personCategory;
  return category === 'woman' ? 'A woman' : category === 'adult' ? 'A person' : 'A child';
}

/** Where, in words an officer can drive to: the street address, else what the reporter typed. */
export function placeWords(sighting) {
  const typed = text(sighting?.foundLocation);
  const address = text(sighting?.geoAddress);
  const coordinates = /^Lat\s-?\d/i.test(typed);
  if (address && (coordinates || !typed)) return address;
  if (typed && typed !== 'Unknown' && !coordinates) return address ? `${typed} (${address})` : typed;
  if (coordinates) return typed;
  return 'a place the reporter did not give';
}

/**
 * The station's link to the sighting in the console: the Sightings page,
 * whose name says nothing about whether it may match a case.
 */
export function sightingLink(sighting) {
  return `${SITE}/app/sightings?id=${encodeURIComponent(sighting.id)}`;
}

/**
 * The words of a station alert, for the inbox, the push and the SMS. Where
 * and when only. `kind`: 'nearest' | 'poster' | 'escalated' | 'test'.
 */
export function stationAlertWords(sighting, { kind = 'nearest', posterCode = null, minutes = null } = {}) {
  const who = whoWasSeen(sighting);
  const when = istTime(sighting?.createdAt || Date.now());
  const where = placeWords(sighting);
  if (kind === 'test') {
    return {
      title: 'Khozo test alert',
      body: 'This is a test. Alerts for sightings near your station will arrive like this.',
      sms: 'KHOZO: This is a test alert. Sightings near your station will reach this number like this.',
    };
  }
  if (kind === 'escalated') {
    const waited = minutes ? `for ${minutes} minutes` : 'yet';
    return {
      title: `No station has answered: ${who.toLowerCase()} seen`,
      body: `${who} was reported seen near ${where} at ${when}. No police station has said it is on it ${waited}. Open Khozo to see the place and send someone.`,
      sms: `KHOZO URGENT: ${who} seen near ${where} at ${when}. No station has answered ${waited}. Open ${sightingLink(sighting)}`,
    };
  }
  const why = kind === 'poster' ? ` It came from your poster code "${posterCode}".` : '';
  return {
    title: `${who} seen near your station`,
    body: `${who} was reported seen near ${where} at ${when}.${why} Open Khozo, go to the place, and tap "On it".`,
    sms: `KHOZO: ${who} seen near ${where} at ${when}.${why} Open ${sightingLink(sighting)} and tap On it.`,
  };
}

/** An account's registered devices, newest first. */
export function pushTokensOf(user) {
  return (Array.isArray(user?.pushTokens) ? user.pushTokens : [])
    .filter((t) => t && typeof t.token === 'string' && t.token)
    .slice(0, MAX_PUSH_DEVICES);
}

/** Whether a string looks like an Expo push token. */
export function isPushToken(value) {
  return typeof value === 'string' && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/.test(value.trim());
}

/**
 * Sends pushes through Expo's push service. Returns one result per message:
 * `{ ok: true }` or `{ ok: false, reason, dead }`, where `dead` says the
 * device is gone and its token should be dropped. Never throws.
 */
export async function sendPushes(messages, { fetchImpl = fetch, accessToken = null } = {}) {
  if (!messages.length) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: controller.signal,
    });
    if (!res?.ok) return messages.map(() => ({ ok: false, reason: 'push_failed', status: res?.status ?? null }));
    const data = await res.json().catch(() => null);
    const tickets = Array.isArray(data?.data) ? data.data : [];
    return messages.map((_, i) => {
      const ticket = tickets[i];
      if (ticket?.status === 'ok') return { ok: true };
      const code = ticket?.details?.error || null;
      return { ok: false, reason: code || 'push_failed', dead: code === 'DeviceNotRegistered' };
    });
  } catch {
    return messages.map(() => ({ ok: false, reason: 'push_failed' }));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tells accounts on their phones: a push to every device each has registered,
 * and an SMS to each one's alert number. `phoneOf(user)` picks the number;
 * `sms: false` sends pushes only. Returns, per account,
 * `{ userId, push: { sent, devices, reason }, sms: { sent, reason } }` and the
 * tokens to drop, `{ userId, token }[]`.
 */
export async function alertPhones(users, words, { data = {}, settings = {}, fetchImpl = fetch, phoneOf = (u) => stationDeskOf(u)?.alertPhone || text(u.phone) || null, sms = true } = {}) {
  const messages = [];
  const owners = [];
  for (const user of users) {
    for (const device of pushTokensOf(user)) {
      messages.push({
        to: device.token,
        title: words.title,
        body: words.body,
        data,
        sound: URGENT_SOUND,
        channelId: URGENT_CHANNEL,
        priority: 'high',
        ttl: 3600,
      });
      owners.push({ userId: user.id, token: device.token });
    }
  }
  const [pushResults, smsResults] = await Promise.all([
    sendPushes(messages, { fetchImpl, accessToken: settings.expoAccessToken || null }),
    Promise.all(users.map((user) => {
      const to = sms ? phoneOf(user) : null;
      if (!sms) return Promise.resolve({ sent: false, reason: 'not_sent' });
      if (!to) return Promise.resolve({ sent: false, reason: 'no_phone' });
      return sendSms({ to, message: words.sms }, { settings, fetchImpl });
    })),
  ]);
  const dead = [];
  const results = users.map((user, i) => {
    const mine = owners.map((o, j) => ({ ...o, result: pushResults[j] })).filter((o) => o.userId === user.id);
    for (const o of mine) if (o.result?.dead) dead.push({ userId: user.id, token: o.token });
    const delivered = mine.filter((o) => o.result?.ok).length;
    return {
      userId: user.id,
      push: {
        sent: delivered > 0,
        devices: delivered,
        reason: delivered ? null : mine.length ? mine[0].result?.reason || 'push_failed' : 'no_device',
      },
      sms: { sent: Boolean(smsResults[i]?.sent), reason: smsResults[i]?.sent ? null : smsResults[i]?.reason || 'sms_failed' },
    };
  });
  return { results, dead };
}

/** Whether a station alert is still waiting for someone to act. */
export function stationAlertOpen(sighting) {
  return Boolean(sighting?.stationAlert) && !sighting.anonymizedAt && OPEN_STATUSES.has(sighting.status);
}

/** Whether this sighting was sent to the account, as its station or as the control room. */
export function stationAlertSentTo(user, sighting) {
  const alert = sighting?.stationAlert;
  if (!user || !alert || sighting.anonymizedAt) return false;
  return (Array.isArray(alert.desks) && alert.desks.some((d) => d.userId === user.id))
    || (Array.isArray(alert.escalation?.userIds) && alert.escalation.userIds.includes(user.id));
}

/** Whether an account may open the sighting and answer for a station: those it was sent to, and the command centre. */
export function canSeeStationAlert(user, sighting) {
  if (!user || !sighting?.stationAlert || sighting.anonymizedAt) return false;
  return user.role === 'super_admin' || stationAlertSentTo(user, sighting);
}

/** Whether escalation is due: no "On it", past the wait, and not yet escalated. */
export function escalationDue(sighting, now = Date.now()) {
  const alert = sighting?.stationAlert;
  if (!stationAlertOpen(sighting) || alert.ack || alert.escalation) return false;
  if (!(Array.isArray(alert.desks) && alert.desks.length)) return true;
  return now - Number(alert.sentAt || 0) >= ESCALATE_AFTER_MS;
}

/**
 * Tells the control room, the state desk and the command centre that no
 * station has answered (or there was none to tell). In the inbox for all of
 * them; on the phone for those with an app or an alert number. Returns the
 * patch to store on the sighting.
 */
export async function escalateStationAlert(sighting, { users = [], now = Date.now(), addNotification, settings = {}, fetchImpl = fetch }) {
  const alert = sighting.stationAlert || {};
  const desks = new Set((alert.desks || []).map((d) => d.userId));
  const recipients = escalationRecipients(sighting, users, desks);
  const minutes = alert.desks?.length ? Math.round((now - Number(alert.sentAt || now)) / 60000) : null;
  const words = alert.desks?.length
    ? stationAlertWords(sighting, { kind: 'escalated', minutes })
    : { ...stationAlertWords(sighting, { kind: 'escalated' }), title: `No police station on Khozo near this sighting` };
  for (const user of recipients) {
    addNotification({
      userId: user.id,
      kind: 'station_alert_escalated',
      title: words.title,
      body: words.body,
      priority: 'high',
      scope: { foundReportId: sighting.id, stationAlert: true },
      inJurisdiction: true,
    });
  }
  // SMS only to those who gave an alert number for it: a super admin's own
  // phone is not a control room.
  const { results, dead } = await alertPhones(recipients, words, {
    data: { scope: { foundReportId: sighting.id, stationAlert: true } },
    settings,
    fetchImpl,
    phoneOf: (u) => text(u.alertPhone) || null,
  });
  const escalation = {
    at: now,
    reason: alert.desks?.length ? 'no_answer' : 'no_station',
    userIds: recipients.map((u) => u.id),
    phones: results,
  };
  return { escalation, patch: { stationAlert: { ...alert, escalation } }, dead, told: recipients.length };
}
