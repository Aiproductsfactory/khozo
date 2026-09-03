/**
 * Turns the coordinates a phone attaches to a sighting into a jurisdiction.
 *
 * The state decides which officers a report reaches. Asking a citizen who has
 * just seen a frightened child to pick a state and type a district is asking
 * them to do the routing themselves, and the field they skip is the field that
 * decides whether anyone sees the report. Their phone already knows where they
 * are, so this converts that into a jurisdiction and only falls back to what
 * they typed.
 *
 * Nominatim is OpenStreetMap's geocoder: no key, no account, and a usage policy
 * requiring an identifying User-Agent and modest volume — which a sighting
 * stream is. Everything here fails open: if the lookup is slow, rate-limited or
 * wrong-shaped, the sighting keeps whatever the reporter gave it, which for an
 * empty location means every review desk sees it. A geocoder outage must never
 * be the reason a report goes nowhere.
 */

import { INDIAN_STATES } from './india.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const TIMEOUT_MS = 4000;

/** Identifies the caller to Nominatim, as its usage policy requires. */
const USER_AGENT = 'Khozo/1.0 (child-protection platform; https://github.com/swastikkumar-alt/khozo)';

/** Matches a returned name to a state we recognise, so routing stays exact. */
function canonicalState(name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  const exact = INDIAN_STATES.find((state) => state.toLowerCase() === target);
  if (exact) return exact;
  // OpenStreetMap uses some older or alternative spellings.
  const aliases = {
    orissa: 'Odisha',
    pondicherry: 'Puducherry',
    uttaranchal: 'Uttarakhand',
    'nct of delhi': 'Delhi',
    'national capital territory of delhi': 'Delhi',
    'jammu and kashmir union territory': 'Jammu and Kashmir',
    'andaman and nicobar': 'Andaman and Nicobar Islands',
    'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
    'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  };
  return aliases[target] || null;
}

function parseCoordinate(value, limit) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > limit) return null;
  return number;
}

/**
 * Resolves coordinates to `{ state, district, place, source }`, or null.
 *
 * `fetchImpl` is injectable so the tests do not reach the network.
 */
export async function reverseGeocode(lat, lng, { fetchImpl = fetch, signal } = {}) {
  const latitude = parseCoordinate(lat, 90);
  const longitude = parseCoordinate(lng, 180);
  if (latitude === null || longitude === null) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener?.('abort', () => controller.abort());

  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&zoom=10&addressdetails=1&lat=${latitude}&lon=${longitude}`;
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const data = await res.json();
    const address = data?.address;
    if (!address) return null;

    const state = canonicalState(address.state) || canonicalState(address['ISO3166-2-lvl4']?.split('-')[1]);

    // Nominatim names the district differently by region; take the first that
    // reads like a district rather than a neighbourhood or a village.
    const district =
      address.state_district ||
      address.district ||
      address.county ||
      address.city ||
      address.town ||
      address.municipality ||
      null;

    if (!state && !district) return null;

    return {
      state: state || null,
      district: district ? String(district).trim() : null,
      place: data.display_name || null,
      source: 'nominatim',
    };
  } catch {
    // Timeout, rate limit, network fault, unexpected shape — all the same
    // answer: nothing was learned, and the sighting keeps what it had.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fills in a sighting's jurisdiction from its coordinates.
 *
 * What the reporter typed always wins: they were standing there, and a phone
 * fix can be several kilometres out indoors.
 */
export async function resolveSightingLocation(body = {}, options = {}) {
  const given = {
    state: String(body.state || '').trim() || null,
    district: String(body.district || '').trim() || null,
  };
  if (given.state && given.district) return { ...given, source: 'reporter' };
  if (body.lat == null || body.lng == null) return { ...given, source: 'reporter' };

  const resolved = await reverseGeocode(body.lat, body.lng, options);
  if (!resolved) return { ...given, source: 'reporter' };

  return {
    state: given.state || resolved.state,
    district: given.district || resolved.district,
    place: resolved.place,
    source: given.state || given.district ? 'reporter+coordinates' : 'coordinates',
  };
}
