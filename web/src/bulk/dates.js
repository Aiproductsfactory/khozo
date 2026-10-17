// Dates as registers actually hold them: real Excel dates and datetimes, Excel
// serial numbers stored as plain numbers, and text typed every possible way —
// "26/01/2007", "26.1.07", "તા.૨૬/૧/૨૦૦૭ ના રોજ", "2007-01-26", "26 Jan 2007".

const GU_DIGITS = '૦૧૨૩૪૫૬૭૮૯';
const DEVANAGARI_DIGITS = '०१२३४५६७८९';

/** Gujarati and Devanagari digits to ASCII. */
export function asciiDigits(value) {
  return String(value ?? '').replace(/[૦-૯०-९]/g, (d) => {
    const g = GU_DIGITS.indexOf(d);
    return String(g !== -1 ? g : DEVANAGARI_DIGITS.indexOf(d));
  });
}

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** A calendar date, or null when the parts do not make one ("31/2/2010"). */
export function makeDate(d, m, y, { now = new Date() } = {}) {
  let year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1000) {
    // "07" and the odd "017" are this century; a two-digit year that would be
    // in the future ("98") is the last one.
    const yy = year % 100;
    year = 2000 + yy <= now.getFullYear() ? 2000 + yy : 1900 + yy;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const t = new Date(Date.UTC(year, month - 1, day));
  if (t.getUTCFullYear() !== year || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) return null;
  return isoDate(year, month, day);
}

/** Excel serial day number (1900 date system) to { date, time }. */
export function fromExcelSerial(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const ms = Math.round((n - 25569) * 86400000); // 25569 = 1970-01-01
  const t = new Date(ms);
  if (!Number.isFinite(t.getTime())) return null;
  const date = isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  const h = t.getUTCHours();
  const min = t.getUTCMinutes();
  return { date, time: h || min ? `${pad(h)}:${pad(min)}` : null };
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_WORD = '(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?';

const ISO_RE = /(?<!\d)(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)/g;
const DMY_RE = /(\d{1,2})\s*[./\-]\s*(\d{1,2})\s*[./\-]\s*(\d{4}|\d{3}|\d{2})(?!\d)/g;
const D_MON_Y_RE = new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-./]*${MONTH_WORD}[\\s\\-./,]*(\\d{4}|\\d{2})(?!\\d)`, 'gi');
const MON_D_Y_RE = new RegExp(`\\b${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?!\\d)`, 'gi');

/**
 * The first real date in a piece of text: { date, index, length } or null.
 * Day-first, as Indian registers write it.
 */
export function findDate(text, opts) {
  const t = asciiDigits(text);
  const found = [];
  for (const m of t.matchAll(ISO_RE)) {
    const d = makeDate(m[3], m[2], m[1], opts);
    if (d) {
      found.push({ date: d, index: m.index, length: m[0].length });
      break;
    }
  }
  for (const m of t.matchAll(DMY_RE)) {
    // Skip a match that is really the tail of an ISO date ("2024-03-05" holds "24-03-05").
    if (found.some((f) => m.index >= f.index && m.index < f.index + f.length)) continue;
    const d = makeDate(m[1], m[2], m[3], opts);
    if (d) {
      found.push({ date: d, index: m.index, length: m[0].length });
      break;
    }
  }
  for (const m of t.matchAll(D_MON_Y_RE)) {
    const d = makeDate(m[1], MONTHS[m[2].toLowerCase()], m[3], opts);
    if (d) {
      found.push({ date: d, index: m.index, length: m[0].length });
      break;
    }
  }
  for (const m of t.matchAll(MON_D_Y_RE)) {
    const d = makeDate(m[2], MONTHS[m[1].toLowerCase()], m[3], opts);
    if (d) {
      found.push({ date: d, index: m.index, length: m[0].length });
      break;
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => a.index - b.index);
  return found[0];
}

const clean = (s) => String(s ?? '').replace(/‍/g, ' ').replace(/‌/g, '').replace(/\s+/g, ' ').replace(/^[\s,.\-–:;]+|[\s,.\-–:;]+$/g, '');

const TIME_HINT = /[0-9]|વાગ|કલાક|ક્લાક|સુમાર|આસપાસ|બપોર|સવાર|સાંજ|રાત|દરમ|am\b|pm\b|बजे|वाजता/i;

/**
 * Reads a missing date from a cell.
 *   value  : the cell's number (Excel date or serial), or null for text
 *   text   : the cell's text (already converted from any legacy font)
 *   isDate : the cell is formatted as a date
 * Returns { date, time, note } — date is YYYY-MM-DD or null; time is any
 * remaining "when" wording ("સાંજના ૬ વાગે"); note says how it was read.
 */
export function parseMissingDate({ value = null, text = '', isDate = false } = {}, opts) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (isDate) {
      const r = fromExcelSerial(value);
      return r ? { date: r.date, time: r.time, note: null } : { date: null, time: null, note: null };
    }
    if (value > 20000 && value < 60000) {
      const r = fromExcelSerial(Math.floor(value));
      return { date: r?.date || null, time: null, note: 'serial' };
    }
    return { date: null, time: null, note: null };
  }
  const found = findDate(text, opts);
  if (!found) return { date: null, time: null, note: null };
  const t = asciiDigits(text);
  let rest = `${t.slice(0, found.index)} ${t.slice(found.index + found.length)}`;
  rest = rest.replace(/(ગઈ|ગઇ|તારીખ|તા)\s*[.:\-–]*\s*/g, ' ');
  rest = rest.replace(/ના\s+રોજ/g, ' ');
  rest = rest.replace(/^\s*ના(?=[\s.]|$)/, ' ');
  rest = clean(rest);
  if (/^[0-9./ ]*$/.test(rest)) rest = '';
  // ISO datetimes from exports ("2024-03-05T14:30:00", "2024-03-05 14:30").
  const hm = /^T?(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i.exec(rest);
  if (hm) rest = Number(hm[1]) || Number(hm[2]) ? `${pad(hm[1])}:${hm[2]}` : '';
  return { date: found.date, time: rest && TIME_HINT.test(rest) ? rest : rest || null, note: null };
}

/** True when a YYYY-MM-DD date is after today (plus a day of clock slack). */
export function isFutureDate(iso, now = Date.now()) {
  const t = new Date(`${iso}T00:00:00Z`).getTime();
  return Number.isFinite(t) && t > now + 86400000;
}
