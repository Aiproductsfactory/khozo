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
 *
 * Whatever comes back is put through the gazetteer (shared/geo/index.js), so
 * the sighting stores LGD codes and canonical names: OpenStreetMap writes
 * "Ahmadabad District" and "Mumbai Suburban District", and the jurisdiction
 * rules compare codes.
 */

import { canonicalPlace, resolveDistrict, resolveState } from './geo/index.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const TIMEOUT_MS = 4000;

/** Identifies the caller to Nominatim, as its usage policy requires. */
const USER_AGENT = 'Khozo/1.0 (child-protection platform; https://github.com/swastikkumar-alt/khozo)';

function parseCoordinate(value, limit) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > limit) return null;
  return number;
}

/** The place fields a sighting stores, without canonicalPlace's bookkeeping. */
function stored({ resolved, ...fields }) {
  return fields;
}

/**
 * Resolves coordinates to
 * `{ state, stateCode, district, districtCode, districtText, place, source }`,
 * or null.
 *
 * Nominatim names the district differently by region (state_district,
 * district, county, or only a city), so each is tried against the state's
 * districts and the first that is one wins; if none is, the most district-like
 * is kept as `districtText` for an officer to place.
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
    // English names: they are what LGD and most of the gazetteer's spellings
    // are written in (it resolves Gujarati and Devanagari too).
    const url = `${NOMINATIM_URL}?format=jsonv2&zoom=10&addressdetails=1&accept-language=en&lat=${latitude}&lon=${longitude}`;
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const data = await res.json();
    const address = data?.address;
    if (!address) return null;

    const state = resolveState(address.state) || resolveState(address['ISO3166-2-lvl4']);
    const candidates = [
      address.state_district,
      address.district,
      address.county,
      address.city,
      address.town,
      address.municipality,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    let district = null;
    if (state) {
      for (const candidate of candidates) {
        district = resolveDistrict(state.code, candidate);
        if (district) break;
      }
    }
    if (!state && !candidates.length) return null;

    const place = canonicalPlace({
      state: state?.name || address.state || null,
      stateCode: state?.code || null,
      district: district?.name || candidates[0] || null,
      districtCode: district?.code || null,
    });
    return {
      ...stored(place),
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
 * What the reporter chose always wins: they were standing there, and a phone
 * fix can be several kilometres out indoors. The phone fills in only what the
 * reporter left out or wrote in a form the gazetteer does not recognise, and
 * its district is used only when it lies in the reporter's state. A reporter
 * who picked "Not sure" sends no place at all, and the phone decides.
 *
 * Returns `{ state, stateCode, district, districtCode, districtText, source }`
 * (plus `place` when the coordinates were looked up).
 */
export async function resolveSightingLocation(body = {}, options = {}) {
  const given = canonicalPlace({
    state: body.state,
    district: body.district,
    stateCode: body.stateCode,
    districtCode: body.districtCode,
  });
  if (given.stateCode && given.districtCode) return { ...stored(given), source: 'reporter' };
  if (body.lat == null || body.lng == null) return { ...stored(given), source: 'reporter' };

  const resolved = await reverseGeocode(body.lat, body.lng, options);
  if (!resolved) return { ...stored(given), source: 'reporter' };

  const reporterGaveAny = Boolean(given.state || given.district || given.districtText);
  // A state the reporter chose stands; one that is not a state does not.
  const stateFromReporter = Boolean(given.stateCode);
  const sameState = !stateFromReporter || given.stateCode === resolved.stateCode;

  const out = stateFromReporter
    ? { state: given.state, stateCode: given.stateCode }
    : resolved.stateCode
      ? { state: resolved.state, stateCode: resolved.stateCode }
      : { state: given.state || resolved.state || null, stateCode: null };

  if (given.districtCode && (!out.stateCode || out.stateCode === given.stateCode)) {
    out.district = given.district;
    out.districtCode = given.districtCode;
    out.districtText = null;
  } else if (given.districtText && out.stateCode && !stateFromReporter) {
    // The reporter named a district but no state; try it in the phone's state.
    const theirs = resolveDistrict(out.stateCode, given.districtText);
    const pick = theirs || (resolved.districtCode ? { name: resolved.district, code: resolved.districtCode } : null);
    out.district = pick?.name || null;
    out.districtCode = pick?.code || null;
    out.districtText = theirs ? null : given.districtText;
  } else if (sameState && resolved.districtCode) {
    out.district = resolved.district;
    out.districtCode = resolved.districtCode;
    // What the reporter typed, if it was not a district, may still be a
    // locality an officer can use.
    out.districtText = given.districtText || null;
  } else {
    out.district = out.stateCode ? null : given.district || (sameState ? resolved.district : null) || null;
    out.districtCode = null;
    out.districtText = given.districtText || (sameState ? resolved.districtText : null) || null;
  }

  return {
    ...out,
    place: resolved.place,
    source: reporterGaveAny ? 'reporter+coordinates' : 'coordinates',
  };
}
