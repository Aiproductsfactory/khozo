/**
 * The gazetteer: India's states and districts, with stable codes and names in
 * English, Gujarati, Hindi and Marathi, and the resolvers that turn whatever a
 * citizen, an officer, a spreadsheet or OpenStreetMap wrote into one of them.
 *
 * Why it exists. A district used to be free text everywhere. A citizen typing
 * "અમદાવાદ" or "Ahmdabad" never reached the Ahmedabad desks, the face search
 * spent its budget on the wrong district's cases, and an imported row whose
 * state read "ગુજરાત" or "GUJARAT" was invisible to the Gujarat state desk.
 * Every write that stores a place now stores the canonical names and the codes
 * (canonicalPlace below); the jurisdiction rules compare codes
 * (shared/scope.js).
 *
 *   states     LGD state codes ("24" Gujarat, "27" Maharashtra): states.js.
 *   districts  LGD district codes ("438" Ahmedabad), generated from LGD and
 *              Wikidata by scripts/build-gazetteer.mjs: districts-data.js. A
 *              handful of police jurisdictions that are not revenue districts
 *              but that Khozo routes to on their own (Navi Mumbai, Ahmedabad
 *              Rural) carry a "<state>-<slug>" code instead.
 *
 * The district table is large next to the rest of the shared code, so the web
 * app does not bundle it: the pickers read GET /api/geo/districts. The state
 * list (states.js) is small and is bundled.
 */

import { DISTRICTS, DISTRICT_SOURCES } from './districts-data.js';
import { listStates, resolveState, stateByCode, stateName, STATES, LANGUAGES } from './states.js';
import { editDistance, fuzzyAllowance, geoKey, isLatinKey, skeletonKey } from './normalise.js';

export { listStates, resolveState, stateByCode, stateName, STATES, LANGUAGES, geoKey };

export const GAZETTEER_SOURCES = {
  states: {
    name: 'LGD state list (ramSeraph/opendata LGD archive, states.15Oct2026.csv) and Wikidata labels (P12747)',
    fetched: '2026-10-17',
  },
  ...DISTRICT_SOURCES,
};

// Row layout in districts-data.js.
const CODE = 0;
const EN = 1;
const GU = 2;
const HI = 3;
const MR = 4;
const ALIASES = 5;
const KIND = 6;

let byCodeTable = null;
const stateTables = new Map();
let nationalTable = null;

/** code -> { stateCode, row }. */
function byCodeMap() {
  if (byCodeTable) return byCodeTable;
  byCodeTable = new Map();
  for (const [stateCode, rows] of Object.entries(DISTRICTS)) {
    for (const row of rows) byCodeTable.set(row[CODE], { stateCode, row });
  }
  return byCodeTable;
}

/** Every name and alias of a district row. */
function rowTexts(row) {
  return [row[EN], row[GU], row[HI], row[MR], ...(row[ALIASES] || [])];
}

/** Puts a key in once; a key two districts share resolves to neither. */
function putOnce(map, key, code) {
  if (!key) return;
  if (!map.has(key)) map.set(key, code);
  else if (map.get(key) !== code) map.set(key, null);
}

/**
 * One state's lookup tables, built the first time that state is asked about
 * and kept for the life of the process (or Worker isolate). A deployment that
 * serves Gujarat never pays for indexing Kerala.
 */
function stateTable(stateCode) {
  if (stateTables.has(stateCode)) return stateTables.get(stateCode);
  const rows = DISTRICTS[stateCode];
  if (!rows) return null;
  const exact = new Map();
  const skeleton = new Map();
  for (const row of rows) {
    for (const text of rowTexts(row)) {
      const key = geoKey(text);
      putOnce(exact, key, row[CODE]);
      putOnce(skeleton, skeletonKey(key), row[CODE]);
    }
  }
  const table = { exact, skeleton, keys: [...exact.entries()].filter(([, code]) => code) };
  stateTables.set(stateCode, table);
  return table;
}

/** Exact names across India: key -> code, or null where two districts share it. */
function nationalMap() {
  if (nationalTable) return nationalTable;
  nationalTable = new Map();
  for (const rows of Object.values(DISTRICTS)) {
    for (const row of rows) {
      for (const text of rowTexts(row)) putOnce(nationalTable, geoKey(text), row[CODE]);
    }
  }
  return nationalTable;
}

function districtView(entry) {
  if (!entry) return null;
  const { stateCode, row } = entry;
  return {
    code: row[CODE],
    name: row[EN],
    stateCode,
    stateName: stateName(stateCode),
    ...(row[KIND] ? { kind: row[KIND] } : {}),
  };
}

/** The district for a code ("438", "27-navi-mumbai"), or null. */
export function districtByCode(code) {
  return districtView(byCodeMap().get(String(code ?? '').trim()));
}

/** A state code from a code or from any name for the state. */
function stateCodeFrom(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (DISTRICTS[text]) return text;
  return resolveState(text)?.code || null;
}

/**
 * Resolves what someone wrote for a district of `stateCode` (an LGD state
 * code, or anything resolveState understands). Accepts any script, case,
 * spacing or punctuation, old names ("Poona", "Baroda", "Aurangabad"), the
 * forms OpenStreetMap returns ("Ahmadabad District", "Mumbai Suburban
 * District"), a district code, and a near spelling ("Ahmdabad"). Returns
 * `{ code, name, stateCode, stateName, kind? }` or null.
 *
 * With no state, only an exact name that belongs to one district in all of
 * India resolves ("Ahmedabad" does; "Aurangabad", in Bihar and Maharashtra,
 * does not), and the answer carries the state it found.
 *
 * `{ fuzzy: false }` turns off the near-spelling match.
 */
export function resolveDistrict(stateCode, text, { fuzzy = true } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const byCode = byCodeMap();
  const state = stateCodeFrom(stateCode);

  // A code, as a client that already holds one may send it.
  const byCodeEntry = byCode.get(raw);
  if (byCodeEntry && (!state || byCodeEntry.stateCode === state)) return districtView(byCodeEntry);

  const key = geoKey(raw);
  if (!key) return null;

  if (!state) {
    if (stateCode != null && stateCode !== '') return null;
    const code = nationalMap().get(key);
    return code ? districtView(byCode.get(code)) : null;
  }

  const index = stateTable(state);
  if (!index) return null;
  if (index.exact.has(key)) {
    const code = index.exact.get(key);
    return code ? districtView(byCode.get(code)) : null;
  }
  if (!fuzzy) return null;

  const skeleton = skeletonKey(key);
  if (skeleton.length >= 3 && index.skeleton.get(skeleton)) {
    return districtView(byCode.get(index.skeleton.get(skeleton)));
  }

  const allowance = fuzzyAllowance(key);
  if (!allowance) return null;
  const latin = isLatinKey(key);
  let best = null;
  let bestDistance = allowance + 1;
  let tied = false;
  for (const [candidate, code] of index.keys) {
    // A misspelling keeps its first letter; and Latin is never compared
    // with Indic script.
    if (candidate[0] !== key[0] || isLatinKey(candidate) !== latin) continue;
    const distance = editDistance(key, candidate, allowance);
    if (distance < bestDistance) {
      best = code;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance && code !== best) {
      tied = true;
    }
  }
  return best && !tied && bestDistance <= allowance ? districtView(byCode.get(best)) : null;
}

/**
 * Every district of a state with its names in all four languages, in English
 * alphabetical order, for a picker. Null for a state Khozo does not know.
 */
export function listDistricts(stateCode) {
  const state = stateCodeFrom(stateCode);
  const rows = state ? DISTRICTS[state] : null;
  if (!rows) return null;
  return rows.map((row) => ({
    code: row[CODE],
    name: row[EN],
    names: { en: row[EN], gu: row[GU], hi: row[HI], mr: row[MR] },
    ...(row[KIND] ? { kind: row[KIND] } : {}),
  }));
}

function cleanPlaceText(value) {
  const text = String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 80) : '';
}

/**
 * The canonical form of a place, for storing on a record.
 *
 *   { state, stateCode, district, districtCode, districtText, resolved }
 *
 * - A state that resolves is stored by its English name and LGD code; one that
 *   does not keeps the text it was given and no code.
 * - A district that resolves within the state is stored by its name and code.
 *   One that does not is kept as `districtText`, with `district` empty: the
 *   record is "state known, district unknown" and reaches every district desk
 *   of the state (shared/scope.js) rather than none of them.
 * - With no state at all, a district that names one place in India supplies
 *   the state. One that does not keeps its text as `district`, so the desks
 *   of a district by that name can still see it (scope.js).
 *
 * Codes the caller already holds (`stateCode`, `districtCode`) are trusted
 * only when they are real codes and agree with each other.
 */
export function canonicalPlace({ state, district, stateCode, districtCode } = {}) {
  const stateText = cleanPlaceText(state);
  const districtRaw = cleanPlaceText(district);
  let st = stateCode ? stateByCode(stateCode) : null;
  if (!st && stateText) st = resolveState(stateText);
  let d = null;
  if (st) {
    const byCode = districtCode ? districtByCode(districtCode) : null;
    if (byCode && byCode.stateCode === st.code) d = byCode;
    if (!d && districtRaw) d = resolveDistrict(st.code, districtRaw);
  } else if (!stateText) {
    d = districtCode ? districtByCode(districtCode) : null;
    if (!d && districtRaw) d = resolveDistrict(null, districtRaw);
    if (d) st = stateByCode(d.stateCode);
  }
  return {
    state: st ? st.name : stateText || null,
    stateCode: st ? st.code : null,
    district: d ? d.name : st ? null : districtRaw || null,
    districtCode: d ? d.code : null,
    districtText: d ? null : districtRaw || null,
    resolved: { state: Boolean(st), district: Boolean(d) },
  };
}

/** The fields canonicalPlace adds to a stored record (no `resolved`). */
export function placeFields(input) {
  const { resolved, ...fields } = canonicalPlace(input);
  return fields;
}

// ---- Cached resolution for the jurisdiction rules ---------------------------
//
// shared/scope.js compares every record's place with the officer's on every
// request. Records written before codes existed carry only names, so their
// codes are worked out on the fly; the same handful of strings recur
// thousands of times, so each answer is remembered.

const CACHE_LIMIT = 20000;
const stateCache = new Map();
const districtCache = new Map();

function remember(cache, key, value) {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

/** The LGD state code for a stored state name, or null. Cached. */
export function stateCodeFor(text) {
  if (text == null || text === '') return null;
  const key = String(text);
  if (stateCache.has(key)) return stateCache.get(key);
  return remember(stateCache, key, resolveState(key)?.code || null);
}

/**
 * The district code for a stored district name within a state (or, with no
 * state, the one district in India by that exact name), or null. Cached.
 */
export function districtCodeFor(stateCode, text) {
  if (text == null || text === '') return null;
  const key = `${stateCode || ''}\u0000${text}`;
  if (districtCache.has(key)) return districtCache.get(key);
  return remember(districtCache, key, resolveDistrict(stateCode || null, String(text))?.code || null);
}
