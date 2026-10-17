// Vakil_01 (a legacy 8-bit Gujarati font) to Unicode Gujarati.
//
// Police registers typed before Unicode keyboards became common were typed in
// fonts that draw Gujarati letters over Latin key codes. Opened anywhere
// without the font, a name reads "gaItabaona" instead of ગીતાબેન; a search
// for the child finds nothing, and a person cannot read it either.
//
// The font follows the Marathi "Shivaji" layout adapted to Gujarati: letters
// whose glyph has a vertical stem are typed as <letter>+"a" (the bare letter
// is the half form); stemless letters are a single key and already full. "i"
// is the pre-base vowel sign (typed before its consonant) and "^" is the reph
// (typed after the syllable it sits on).
//
// Ported from the converter validated on the Ahmedabad City register (280
// legacy cells, none left with stray Latin). Keep the two in step.

const PRE_I = ''; // placeholder for the pre-base vowel sign i
const REPH = ''; // placeholder for the reph (r + virama on the next syllable)
const VIRAMA = '્';

// Stem letters: "Xa" is the full consonant, bare "X" the half form.
const STEM = {
  g: 'ગ', G: 'ઘ', c: 'ચ', N: 'ણ', q: 'થ', Q: 'ધ', n: 'ન',
  b: 'બ', B: 'ભ', m: 'મ', y: 'ય', l: 'લ', v: 'વ', S: 'શ',
  Y: 'ષ', s: 'સ', x: 'ક્ષ', E: 'શ્ર', '<': 'ત', P: 'પ',
};
// Stemless letters: one key is already the full consonant.
const FULL = {
  k: 'ક', K: 'ખ', C: 'છ', j: 'જ', J: 'ઝ', T: 'ટ', z: 'ઠ',
  D: 'ડ', Z: 'ઢ', t: 'ત', d: 'દ', p: 'પ', f: 'ફ', r: 'ર',
  h: 'હ', L: 'ળ', W: 'દ્વ', V: 'દ્ય', '(': 'હ્ય', '~': 'ત્ર',
};
const SIGNS = {
  a: 'ા', I: 'ી', u: 'ુ', U: 'ૂ', o: 'ે', O: 'ૈ', M: 'ં',
  R: 'ૃ', '`': '્ર',
};
const INDEP = { A: 'અ', '[': 'ઈ', ']': 'ઉ', e: 'એ' };
const PUNCT = { 'À': '/', 'Ê': ',', '³': '(', '´': ')', '¹': '-', '–': '-', ' ': ' ' };

const TOKENS = {};
for (const [k, v] of Object.entries(STEM)) {
  TOKENS[`${k}a`] = v;
  TOKENS[k] = v + VIRAMA;
}
Object.assign(TOKENS, FULL, SIGNS, INDEP, PUNCT);
TOKENS.i = PRE_I;
// Bare "E" is a half sha (ઈશ્વર); "Ea" is the shra conjunct (આશ્રમ, શ્રી).
TOKENS.E = `શ${VIRAMA}`;
TOKENS['^'] = REPH;
TOKENS['-'] = '-';
const MAXLEN = Math.max(...Object.keys(TOKENS).map((k) => k.length));

const CONS = '[ક-હ]';
const CLUSTER = `(?:${CONS}${VIRAMA})*${CONS}(?:${VIRAMA}ર)?`;
const MATRA_CLASS = '[ા-ૌઁ-ઃ]';
const IS_MATRA = new RegExp(`^${MATRA_CLASS}$`);
const IS_CONS = new RegExp(`^${CONS}$`);
const PRE_I_RE = new RegExp(`${PRE_I}(${CLUSTER})`, 'g');
const MATRA_THEN_SUB_R = new RegExp(`(${MATRA_CLASS}+)(${VIRAMA}ર)`, 'g');
const ANU_BEFORE_VOWEL = /(ં)([ા-ૌ])/g;
const STRAY_E_SIGN = /([ા-૆ૈ-ૌ])ે/g;
// English typed while the cell font happened to be Vakil_01 ("D/o", "S/o").
const KEEP_ENGLISH = /(?<![A-Za-z0-9_])[DSW]\/[oO](?![A-Za-z0-9_])/g;

const NORMALIZE = [
  ['અા', 'આ'], ['આે', 'ઓ'], ['આૈ', 'ઔ'], ['અે', 'એ'], ['અૈ', 'ઐ'], ['એા', 'ઓ'],
  ['ાે', 'ો'], ['ેા', 'ો'], ['ાૈ', 'ૌ'], ['ઓે', 'ઓ'],
];

const isGujarati = (ch) => ch >= '઀' && ch <= '૿';
const isAsciiLetter = (ch) => /^[A-Za-z]$/.test(ch);

function convertPlain(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (isGujarati(ch)) {
      out.push(ch);
      i++;
      continue;
    }
    // "/" is the subscript-r key only right after a letter; after a digit it is a slash.
    if (ch === '/') {
      out.push(i > 0 && isAsciiLetter(text[i - 1]) ? `${VIRAMA}ર` : '/');
      i++;
      continue;
    }
    let matched = false;
    for (let len = MAXLEN; len > 0; len--) {
      const tok = text.slice(i, i + len);
      if (tok.length === len && Object.prototype.hasOwnProperty.call(TOKENS, tok)) {
        out.push(TOKENS[tok]);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out.push(ch);
      i++;
    }
  }
  let s = out.join('');
  // Pre-base i: move it after the consonant cluster that follows.
  s = s.replace(PRE_I_RE, (_m, cluster) => `${cluster}િ`);
  s = s.split(PRE_I).join('િ');
  // A subscript r typed after a vowel sign belongs before it (ગુ્ર -> ગ્રુ).
  s = s.replace(MATRA_THEN_SUB_R, (_m, matras, subR) => subR + matras);
  // Reph: move it to the start of the syllable it was typed after.
  while (s.includes(REPH)) {
    const k = s.indexOf(REPH);
    let j = k;
    while (j > 0 && IS_MATRA.test(s[j - 1])) j--;
    if (j >= 3 && s[j - 1] === 'ર' && s[j - 2] === VIRAMA) j -= 2; // subscript r
    if (j > 0 && IS_CONS.test(s[j - 1])) {
      j--;
      while (j >= 2 && s[j - 1] === VIRAMA && IS_CONS.test(s[j - 2])) j -= 2;
      s = `${s.slice(0, j)}ર${VIRAMA}${s.slice(j, k)}${s.slice(k + 1)}`;
    } else {
      s = s.slice(0, k) + s.slice(k + 1);
    }
  }
  for (const [a, b] of NORMALIZE) s = s.split(a).join(b);
  s = s.replace(ANU_BEFORE_VOWEL, (_m, anu, vowel) => vowel + anu); // anusvara typed before the vowel sign
  s = s.split('ુૃ').join('ૃ').split('ાા').join('ા');
  s = s.replace(STRAY_E_SIGN, (_m, sign) => sign); // stray e-sign after another vowel sign
  s = s.split('હયા').join('હ્યા'); // the font has no half-ha key
  s = s.split('બિજ્ર').join('બ્રિજ');
  return s;
}

/** Converts text typed in the Vakil_01 font to Unicode Gujarati. */
export function convertLegacyGujarati(text) {
  const src = String(text ?? '');
  const parts = [];
  let last = 0;
  for (const m of src.matchAll(KEEP_ENGLISH)) {
    parts.push(convertPlain(src.slice(last, m.index)));
    parts.push(m[0]);
    last = m.index + m[0].length;
  }
  parts.push(convertPlain(src.slice(last)));
  let s = parts.join('');
  // Typist-level fixes that the font itself cannot explain.
  s = s.split('ઝા.જોગ').join('જા.જોગ').split('ઝ.જોગ').join('જા.જોગ');
  s = s.split('અ"વાદ').join('અ’વાદ').split("અ'વાદ").join('અ’વાદ');
  s = s.split('|/0').join('સ/ઓ').split('ઉફે-').join('ઉર્ફે');
  return s;
}

/** Font names that use this keyboard mapping. */
export function isLegacyGujaratiFont(fontName) {
  return /^vakil/i.test(String(fontName || '').trim());
}

/** Characters that only mean something in the legacy font. */
export const LEGACY_CHARS = /[A-Za-z[\]^`ÀÊ³´¹]/;

/**
 * A run in a Unicode font that is nonetheless legacy-typed text. Tuned on
 * Gujarati registers: plain English with "aa" in it (Aakash) can trip it, so
 * the importer only applies it when the file is known to contain legacy text.
 */
export function looksLegacy(text) {
  const s = String(text ?? '');
  if (/[઀-૿]/.test(s)) return false;
  const letters = s.match(/[A-Za-z[\]^`]/g) || [];
  if (letters.length < 5) return false;
  const a = (s.match(/a/g) || []).length;
  return a / letters.length > 0.2 && /(aa|Baa\[|rho|Cao|naM|\[)/.test(s);
}

/**
 * Text of a cell from its runs. Each run is converted only when its font is a
 * legacy font (or, with `heuristic`, when it reads like legacy text); Unicode
 * runs in the same cell are left alone.
 * Returns { text, raw, converted }.
 */
export function runsToText(runs, cellFont, { convert = true, heuristic = false } = {}) {
  let text = '';
  let raw = '';
  let converted = false;
  for (const run of runs || []) {
    const t = String(run.text ?? '');
    raw += t;
    const font = run.font || cellFont;
    if (convert && ((isLegacyGujaratiFont(font) && LEGACY_CHARS.test(t)) || (heuristic && looksLegacy(t)))) {
      text += convertLegacyGujarati(t);
      converted = converted || /[A-Za-z[\]^`]/.test(t);
    } else {
      text += t;
    }
  }
  return { text, raw, converted };
}
