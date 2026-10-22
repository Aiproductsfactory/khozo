/**
 * Presentation for sightings sent to an officer's station
 * (GET /api/reports/found/station-alerts, shared/station-alerts.js).
 *
 * A station sees the sighting only: who, where, when, the photo and the
 * reporter's note. Never the case it may match.
 */

/** What a station can answer, as the server names it (STATION_OUTCOMES). */
export const OUTCOME_LABELS = {
  on_it: 'On it',
  found: 'Found the person',
  not_found: 'Went to the place; the person was not there',
  update: 'Update',
};

/** Why the reporter thought a woman or an adult needs help (shared/sighting-misuse.js). */
export const CONCERN_LABELS = {
  asked_for_help: 'Asked for help',
  lost_or_confused: 'Seems lost or confused',
  hurt_or_unwell: 'Seems hurt or unwell',
  held_against_will: 'Seems to be held against their will',
  other: 'Something else (see the note)',
};

/** What to do on finding the person. An adult decides whether their family is told. */
export function careInstruction(alert) {
  return alert?.stationAlert?.adult
    ? 'If you find the person, ask whether they are safe and need help. They decide whether their family is told where they are.'
    : 'If you find the child, keep them safe and take them to the Child Welfare Committee.';
}

export function whoWasSeen(alert) {
  const category = alert?.personCategory;
  return category === 'woman' ? 'A woman' : category === 'adult' ? 'A person' : 'A child';
}

function isCoordinates(value) {
  return /^Lat\s-?\d/i.test(String(value || '').trim());
}

/** Where, in words: the street address, else what the reporter typed. */
export function placeOf(alert) {
  const typed = String(alert?.foundLocation || '').trim();
  const address = String(alert?.geoAddress || '').trim();
  if (address && (!typed || isCoordinates(typed))) return address;
  if (typed && typed !== 'Unknown' && !isCoordinates(typed)) return typed;
  return address || typed || 'Place not given';
}

/** Directions from where the officer is, or a search for the place when there are no coordinates. */
export function mapsUrl(alert) {
  if (alert?.lat != null && alert?.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${alert.lat},${alert.lng}`;
  }
  const place = placeOf(alert);
  return place && place !== 'Place not given'
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`
    : null;
}

/** Why it came to this desk: nearest station, its poster, or nobody answered. */
export function reasonLine(alert) {
  const sa = alert?.stationAlert || {};
  const away = sa.distanceKm != null ? `, ${sa.distanceKm} km from ${sa.station || 'your station'}` : '';
  if (sa.reason === 'nearest') return `Nearest station${away}`;
  if (sa.reason === 'poster') return `Reported through your poster code "${sa.posterCode}"${away}`;
  if (sa.reason === 'escalated') return 'No station answered in time, so it came to you';
  return 'Sent to the command centre';
}

/** Whether this officer has already answered. */
export function answeredBy(alert, user) {
  const replies = alert?.stationAlert?.replies || [];
  return replies.some((r) => (r.byId ? r.byId === user?.id : r.byName === user?.name));
}

/** Open and nobody has said "On it" yet: the one that needs someone now. */
export function needsAnswer(alert) {
  return alert?.status === 'open' && !alert?.stationAlert?.ack;
}
