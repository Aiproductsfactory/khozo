// Turns spreadsheet rows into case records ready for POST /api/reports, and
// decides each row's status before anything is sent. Mirrors
// scripts/import-gujarat-cases.mjs (field mapping, idempotency, duplicate
// handling) so a register imported from the console and one imported from the
// command line land the same way and recognise each other on a re-run.
import { runsToText } from './legacyGujarati.js';
import { parseMissingDate, findDate, fromExcelSerial, isFutureDate } from './dates.js';
import { transliterateGujarati } from './translit.js';
import { resolveState } from '../../../shared/geo/states.js';
import {
  addressFrom,
  cleanCell,
  complainantName,
  isPlaceholderAddress,
  phonesIn,
  reasonInEnglish,
  referenceShort,
  splitName,
  stationFor,
} from './gujaratRegister.js';

const msg = (text) => text; // marks a string for translation (see i18n.jsx)

export const PRESETS = {
  khozo: { id: 'khozo', label: msg('Khozo template'), gujaratRules: false, restrictLocked: false },
  gujarat: { id: 'gujarat', label: msg('Gujarat Police missing-persons register'), gujaratRules: true, restrictLocked: true },
  other: { id: 'other', label: msg('Other portal export (TrackChild, Khoya-Paya, NGO registers) — map the columns'), gujaratRules: false, restrictLocked: false },
};

const EMPTY = { text: '', raw: '', converted: false, value: null, isDate: false, present: false };

/** A cell's text after any legacy-font conversion, plus its raw number. */
export function readCellValue(cell, legacy = {}) {
  if (!cell) return EMPTY;
  if (cell.runs) {
    const r = runsToText(cell.runs, cell.font, legacy);
    return { ...r, value: null, isDate: cell.isDate, present: true };
  }
  if (cell.type === 'bool') return { text: cell.value ? 'TRUE' : 'FALSE', raw: '', converted: false, value: null, isDate: false, present: true };
  const n = cell.value;
  // A date-formatted number reads as the date it shows in Excel, not 39108.
  const asDate = cell.isDate ? fromExcelSerial(n) : null;
  const text = asDate ? `${asDate.date}${asDate.time ? ` ${asDate.time}` : ''}` : String(n);
  return { text, raw: String(n), converted: false, value: n, isDate: cell.isDate, present: true };
}

const GENDER_FEMALE = /છોકરી|સ્ત્રી|મહિલા|દીકરી|દિકરી|(^|[^a-z])(girl|female|woman|f)([^a-z]|$)|लड़की|लडकी|महिला|स्त्री|बालिका|मुलगी/i;
const GENDER_MALE = /છોકરો|પુરુષ|દીકરો|દિકરો|(^|[^a-z])(boy|male|man|m)([^a-z]|$)|लड़का|लडका|पुरुष|बालक|मुलगा/i;
const GENDER_OTHER = /(^|[^a-z])(other|transgender|third gender|tg)([^a-z]|$)|અન્ય|ટ્રાન્સજેન્ડર|अन्य|ट्रांसजेंडर|तृतीयपंथी/i;

/** Male / Female / Other from what the register wrote, or null. */
export function parseGender(text) {
  const g = cleanCell(text);
  if (!g) return null;
  if (GENDER_FEMALE.test(g)) return 'Female';
  if (GENDER_MALE.test(g)) return 'Male';
  if (GENDER_OTHER.test(g)) return 'Other';
  return null;
}

/** Whole years from "17", 17.6, "૧૨", "12 વર્ષ". { age, fraction }. */
export function parseAge(v) {
  if (typeof v.value === 'number' && Number.isFinite(v.value)) return { age: Math.trunc(v.value), fraction: !Number.isInteger(v.value), raw: String(v.value) };
  const t = cleanCell(v.text).replace(/[૦-૯०-९]/g, (d) => String(('૦૧૨૩૪૫૬૭૮૯'.includes(d) ? '૦૧૨૩૪૫૬૭૮૯' : '०१२३४५६७८९').indexOf(d)));
  const m = /(\d+(?:\.\d+)?)/.exec(t);
  if (!m) return { age: null, fraction: false, raw: t };
  const f = Number(m[1]);
  return { age: Math.trunc(f), fraction: !Number.isInteger(f), raw: t };
}

export function personCategoryFor(age, gender) {
  if (age == null || age < 18) return 'child';
  return gender === 'Female' ? 'woman' : 'adult';
}

const clip = (text, max) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
};

const issue = (code, text, vars) => ({ code, text, vars });

/**
 * Builds one record per data row.
 *   sheet     : { rows: Map(rowNumber -> Map(col -> cell)), maxRow }
 *   headerRow : 1-based row number of the header
 *   mapping   : { field: columnIndex }
 *   preset    : 'khozo' | 'gujarat' | 'other'
 *   legacy    : { convert, heuristic } for runsToText
 */
export function buildRecords(sheet, { headerRow = 1, mapping = {}, preset = 'khozo', legacy = {}, now = new Date() } = {}) {
  const gujaratRules = Boolean(PRESETS[preset]?.gujaratRules);
  const records = [];
  for (let r = headerRow + 1; r <= sheet.maxRow; r++) {
    const cells = sheet.rows.get(r);
    if (!cells) continue;
    const get = (f) => (mapping[f] != null && mapping[f] !== '' ? readCellValue(cells.get(Number(mapping[f])), legacy) : EMPTY);
    const c = {};
    for (const f of ['serial', 'name', 'gender', 'age', 'dateMissing', 'station', 'reference', 'reason', 'complainant', 'phone', 'address', 'year', 'state', 'district', 'identificationMark', 'clothing', 'height', 'returnedDate', 'notes']) c[f] = get(f);
    const serial = c.serial.value != null ? String(Math.trunc(c.serial.value)) : cleanCell(c.serial.text);
    const nameCell = cleanCell(c.name.text);
    if (!serial && !nameCell) continue;
    records.push(buildRecord(r, c, { serial, nameCell, gujaratRules, now }));
  }
  return records;
}

function buildRecord(sheetRow, c, { serial, nameCell, gujaratRules, now }) {
  const notes = [];
  const converted = Object.fromEntries(Object.entries(c).filter(([, v]) => v.converted).map(([k]) => [k, true]));

  const { name, rest } = splitName(nameCell);

  const genderText = cleanCell(c.gender.text);
  const gender = parseGender(genderText);

  const ageInfo = parseAge(c.age);
  if (ageInfo.fraction) notes.push(issue('age_fraction', msg('Age recorded as {raw}, read as {age}'), { raw: ageInfo.raw, age: ageInfo.age }));

  const reference = cleanCell(c.reference.text);
  const station = stationFor(cleanCell(c.station.text));

  // Missing date, then the fall-backs the validated build used.
  const dateText = cleanCell(c.dateMissing.text);
  const parsed = c.dateMissing.value != null
    ? parseMissingDate({ value: c.dateMissing.value, isDate: c.dateMissing.isDate }, { now })
    : parseMissingDate({ text: dateText }, { now });
  if (parsed.note === 'serial') notes.push(issue('date_serial', msg('Date was stored as an Excel serial number')));
  let year = null;
  if (c.year.present) {
    const y = Number(String(c.year.value ?? cleanCell(c.year.text)).replace(/[૦-૯]/g, (d) => String('૦૧૨૩૪૫૬૭૮૯'.indexOf(d))));
    if (Number.isFinite(y) && y >= 1950 && y <= 2100) year = Math.trunc(y);
  }
  let dateOfMissing = parsed.date;
  let dateApproximate = false;
  let dateSource = parsed.date ? 'sheet' : null;
  if (!dateOfMissing) {
    const fromRef = findDate(reference, { now });
    if (fromRef) {
      dateOfMissing = fromRef.date;
      dateApproximate = true;
      dateSource = 'reference';
    } else if (year) {
      dateOfMissing = `${year}-01-01`;
      dateApproximate = true;
      dateSource = 'year';
    }
  }
  if (parsed.date && year && Math.abs(Number(parsed.date.slice(0, 4)) - year) > 1) {
    notes.push(issue('year_mismatch', msg('Missing date {date} does not match the year column ({year})'), { date: parsed.date, year }));
  }

  const reason = cleanCell(c.reason.text);
  const complainant = cleanCell(c.complainant.text);

  // Address: its own column, else what follows "રહે" in the name cell, else the complainant's.
  let address = cleanCell(c.address.text) || addressFrom(rest);
  if (!address && complainant) {
    const crest = splitName(complainant).rest;
    address = addressFrom(crest) || addressFrom(complainant);
  }
  if (isPlaceholderAddress(address)) address = null;

  const phones = phonesIn(c.phone.text, nameCell, complainant);
  const phoneTyped = cleanCell(c.phone.text);
  if (phoneTyped && !phones.length) notes.push(issue('phone_dropped', msg('Mobile number "{phone}" is not a 10-digit number; left out'), { phone: phoneTyped }));

  const returned = cleanCell(c.returnedDate.text);
  const returnedDate = c.returnedDate.value != null
    ? parseMissingDate({ value: c.returnedDate.value, isDate: c.returnedDate.isDate }).date
    : returned ? findDate(returned)?.date || null : null;

  const heightNum = Number(cleanCell(c.height.text).replace(/[^\d.]/g, ''));

  const nameEn = name && /[઀-૿]/.test(name) ? transliterateGujarati(name) : null;
  const firNo = gujaratRules
    ? referenceShort(reference, station?.gu) || (station ? `${station.gu || station.en} પો.સ્ટે. (list serial ${serial})` : clip(reference, 80) || null)
    : clip(reference, 80) || null;

  return {
    key: `row-${sheetRow}`,
    sheetRow,
    serial,
    nameCell,
    name,
    nameEn,
    gender,
    genderText,
    age: ageInfo.age,
    ageText: ageInfo.raw,
    dateOfMissing,
    dateApproximate,
    dateSource,
    dateRaw: dateText || (c.dateMissing.value != null ? String(c.dateMissing.value) : ''),
    time: parsed.time || null,
    year,
    station,
    reference,
    firNo,
    reason,
    reasonEn: reasonInEnglish(reason),
    complainant,
    complainantName: complainantName(complainant),
    phones,
    address: address || null,
    rowState: cleanCell(c.state.text) || null,
    rowDistrict: cleanCell(c.district.text) || null,
    identificationMark: cleanCell(c.identificationMark.text) || null,
    clothing: cleanCell(c.clothing.text) || null,
    height: Number.isFinite(heightNum) && heightNum >= 20 && heightNum <= 220 ? heightNum : null,
    returnedDate,
    extraNotes: cleanCell(c.notes.text) || null,
    converted,
    notes,
    photo: null,
    photoAlternatives: [],
  };
}

/**
 * Gives each record its photo: a loose file named after the serial wins;
 * otherwise the largest picture anchored in the row. Shadow masks (see
 * photos.js) are skipped. `files` is [{ name, ... }].
 */
export function assignPhotos(records, images = [], { shadows = new Set(), files = [] } = {}) {
  const byRow = new Map();
  for (const im of images) {
    if (shadows.has(im.media)) continue;
    if (!byRow.has(im.sheetRow)) byRow.set(im.sheetRow, []);
    byRow.get(im.sheetRow).push(im);
  }
  const bySerial = new Map();
  for (const f of files) {
    const stem = String(f.name || '').replace(/\.[^.]+$/, '').trim();
    const m = /^0*(\d+)(?:\s*[-_ (]\s*\d+\)?)?$/.exec(stem);
    const key = (m ? m[1] : stem).toLowerCase();
    if (!bySerial.has(key)) bySerial.set(key, []);
    bySerial.get(key).push(f);
  }
  for (const rec of records) {
    const serialKey = String(rec.serial || '').replace(/^0+(?=\d)/, '').toLowerCase();
    const loose = serialKey ? bySerial.get(serialKey) || [] : [];
    // Several pictures in one row: the one drawn last sits on top in Excel, the one the officer sees.
    const embedded = (byRow.get(rec.sheetRow) || []).slice().sort((a, b) => b.order - a.order);
    const all = [
      ...loose.map((f) => ({ kind: 'file', id: `file:${f.name}`, file: f })),
      ...embedded.map((im) => ({ kind: 'embedded', id: `media:${im.media}`, media: im.media, ext: im.ext })),
    ];
    rec.photo = all[0] || null;
    rec.photoAlternatives = all.slice(1);
  }
  return records;
}

/** Errors stop a row; warnings let it through. Gender and photo choices made on the page are applied first. */
export function checkRecord(rec, { now = Date.now() } = {}) {
  const errors = [];
  const warnings = [...rec.notes];
  if (!rec.name) errors.push(issue('no_name', msg('No name')));
  if (!rec.dateOfMissing) errors.push(issue('no_date', msg('No missing date')));
  else if (isFutureDate(rec.dateOfMissing, now)) errors.push(issue('future_date', msg('Missing date {date} is in the future'), { date: rec.dateOfMissing }));
  if (!rec.gender) errors.push(issue('no_gender', msg('Gender not recognised: choose boy or girl')));
  if (rec.age != null && (rec.age < 0 || rec.age > 110)) errors.push(issue('bad_age', msg('Age {age} is not possible'), { age: rec.age }));
  if (!rec.photo) warnings.push(issue('no_photo', msg('No photo: face matching cannot run for this case')));
  if (rec.photo && rec.photoAlternatives?.length) warnings.push(issue('several_photos', msg('{n} pictures in this row: the one on top is the main photo, and up to 4 more are added beside it'), { n: rec.photoAlternatives.length + 1 }));
  if (rec.photoError) warnings.push(issue('photo_unreadable', msg('The photo could not be read; the case will be imported without it')));
  if (rec.dateApproximate) {
    warnings.push(rec.dateSource === 'reference'
      ? issue('date_from_reference', msg('Missing date not readable; the FIR / diary date {date} is used (approximate)'), { date: rec.dateOfMissing })
      : issue('date_from_year', msg('Missing date not readable; only the year {year} is known (approximate)'), { year: rec.year }));
  }
  if (rec.age == null) warnings.push(issue('no_age', msg('Age not recorded')));
  else if (rec.age >= 18) {
    warnings.push(rec.gender === 'Female'
      ? issue('adult_woman', msg('Age {age}: will be registered as a missing woman, not a child'), { age: rec.age })
      : issue('adult', msg('Age {age}: will be registered as a missing adult, not a child'), { age: rec.age }));
  }
  if (rec.returnedDate) warnings.push(issue('returned', msg('The sheet records a return date ({date}); check before importing'), { date: rec.returnedDate }));
  const status = errors.length ? 'error' : warnings.length ? 'warning' : 'ready';
  return { errors, warnings, status };
}

/** Everything the officer and the matcher should see, within the server's 600-character limit. */
export function circumstancesFor(rec, { sourceLabel }) {
  const st = rec.station;
  const stationText = st ? (st.en && st.gu ? `${st.en} (${st.gu})` : st.en || st.gu) : null;
  const parts = [
    `${sourceLabel}${rec.serial ? `, serial ${rec.serial}` : ''}.`,
    stationText ? `Police station: ${stationText}.` : null,
    rec.nameEn ? `Name in English: ${rec.nameEn}.` : null,
    rec.reason ? `Reason: ${rec.reasonEn}${rec.reasonEn !== rec.reason ? ` (${rec.reason})` : ''}.` : null,
    rec.dateApproximate ? `Missing date is approximate (sheet: ${rec.dateRaw || 'not recorded'}).` : null,
    rec.time ? `When: ${rec.time}.` : null,
    rec.extraNotes ? `Notes: ${rec.extraNotes}.` : null,
  ].filter(Boolean);
  const head = parts.join(' ');
  const room = 600 - head.length - ' Reference: .'.length;
  return room > 40 && rec.reference ? `${head} Reference: ${clip(rec.reference, room)}.` : clip(head, 600);
}

function categoriesFor(rec) {
  const out = [];
  const text = `${rec.reason} ${rec.nameCell}`;
  if (/kidnap/i.test(rec.reasonEn)) out.push('trafficking_risk');
  if (/mental/i.test(rec.reasonEn)) out.push('mental_health_support');
  if (/institution/i.test(rec.reasonEn)) out.push('shelter_required');
  if (/મૂંગ|મુંગ|mute/i.test(text)) out.push('disability_support');
  if (!out.length) out.push('unaccompanied');
  return out;
}

const FORMAL_ROLES = ['police', 'sjpu', 'admin', 'super_admin'];

/**
 * Where a row's case belongs. A State or District column wins for its row; the
 * batch's choice (from the district picker, with LGD codes) fills the rest.
 * The batch's district is only lent to a row in the batch's own state: a row
 * from Maharashtra in a Gujarat register must not be filed in Ahmedabad. The
 * server resolves whatever text a row carries ("ગુજરાત", "GUJARAT",
 * "Ahmadabad") to canonical names and codes (shared/geo/index.js).
 */
function placeFor(rec, batch) {
  const rowState = rec.rowState || '';
  const rowStateCode = rowState ? resolveState(rowState)?.code || '' : '';
  const inBatchState = !rowState || (rowStateCode && rowStateCode === batch.stateCode);
  const place = {
    state: rowState || batch.state || '',
    district: rec.rowDistrict || (inBatchState ? batch.district || '' : ''),
  };
  // The batch's codes travel only with the batch's own names.
  if (!rowState && batch.stateCode) place.stateCode = batch.stateCode;
  if (!rec.rowDistrict && inBatchState && batch.districtCode) place.districtCode = batch.districtCode;
  return place;
}

/**
 * The multipart fields POST /api/reports takes, the same ones the CLI sends.
 * `batch` = { state, district, restrictToPolice, sourceLabel, user }.
 */
export function payloadFor(rec, batch) {
  const user = batch.user || {};
  const formal = FORMAL_ROLES.includes(user.role);
  const st = rec.station;
  const fields = {
    childName: rec.name,
    age: rec.age ?? '',
    gender: rec.gender || '',
    dateOfMissing: rec.dateOfMissing || '',
    firNo: formal ? rec.firNo || '' : '',
    parentName: rec.complainantName || (st ? `${st.en || st.gu} Police Station` : ''),
    parentPhone: rec.phones[0] || '',
    address: rec.address || '',
    ...placeFor(rec, batch),
    circumstances: circumstancesFor(rec, batch),
    identificationMark: rec.identificationMark || '',
    clothing: rec.clothing || '',
    height: rec.height ?? '',
    producedByType: formal ? 'police' : user.role === 'ngo' ? 'ngo' : 'citizen',
    mentalHealthConcern: /mental/i.test(rec.reasonEn) ? 'yes' : 'unknown',
    disabilityStatus: /મૂંગ|મુંગ|mute/i.test(`${rec.reason} ${rec.nameCell}`) ? 'yes' : 'unknown',
    educationLevel: 'unknown',
    declarationAccepted: 'true',
    declarationMethod: 'digital',
    declarationSignerName: user.name || '(importing officer)',
    declarationSignerRole: user.role || 'police',
    relationshipToChild: formal ? 'official' : user.role === 'ngo' ? 'reporting organisation' : 'reporter',
    personCategory: personCategoryFor(rec.age, rec.gender),
  };
  // Police-provided records are shared with police roles only (shared/scope.js).
  if (batch.restrictToPolice) fields.visibility = 'police';
  return { fields, categories: categoriesFor(rec) };
}

// ------------------------------------------------------------------ idempotency

const norm = (v) => String(v || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const dayOf = (v) => {
  if (!v) return '';
  const t = new Date(v);
  return Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : String(v).slice(0, 10);
};

/** Names a case from this row may have been stored under (the CLI's gu and gu+en formats). */
function namesFor(rec, fields) {
  return [fields.childName, rec.name, rec.nameEn ? `${rec.name} (${rec.nameEn})` : null].filter(Boolean).map(norm);
}

/** Same person = same name + same missing date + same FIR / station (as the CLI decides). */
export function matchesExisting(report, rec, fields) {
  if (!report) return false;
  const station = norm(rec.station?.en || rec.station?.gu);
  const notes = norm(report.vulnerabilityProfile?.circumstances || report.circumstances);
  const sameRef = fields.firNo && norm(report.firNo) === norm(fields.firNo);
  const sameStation = station && notes.includes(`police station: ${station}`);
  const noPlace = !fields.firNo && !station;
  return (
    namesFor(rec, fields).includes(norm(report.childName)) &&
    dayOf(report.dateOfMissing) === dayOf(fields.dateOfMissing) &&
    Boolean(sameRef || sameStation || noPlace)
  );
}

const firstWord = (s) => norm(s).split(' ')[0] || '';

/**
 * Is a case the server flagged as a possible duplicate clearly someone else?
 * Only when it is a case we can see, its name is not this name, the given
 * name or the gender differs, and no phone number is shared. Anything less
 * certain goes to a person for review.
 */
export function clearlyDifferent(candidate, report, rec, fields) {
  if (!report) return false;
  if (matchesExisting(report, rec, fields)) return false;
  const names = namesFor(rec, fields);
  const theirName = norm(report.childName || candidate?.childName);
  if (names.includes(theirName)) return false;
  const theirPhone = String(report.parentPhone || candidate?.parentPhone || '').replace(/\D/g, '');
  if (fields.parentPhone && theirPhone && theirPhone === String(fields.parentPhone).replace(/\D/g, '')) return false;
  const theirGender = report.gender || candidate?.gender;
  if (theirGender && fields.gender && theirGender !== fields.gender) return true;
  return firstWord(theirName) !== firstWord(fields.childName);
}
