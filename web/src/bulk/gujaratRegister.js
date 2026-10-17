// Reading the cells of a Gujarat Police missing-persons register.
//
// The register is typed by hand at each police station, so one cell holds
// several things: "નામ" is the name, then "રહે." and the address; the
// reference column holds the station, a diary (જા.જોગ) or FIR (ગુ.ર.નં)
// number and a date. These helpers take such cells apart the way the
// validated build of the Ahmedabad City register did; they are harmless on
// cleaner exports (an English name with no Gujarati markers passes through).

/** Ahmedabad City police-station keys as they appear in column A of the register. */
export const GUJARAT_STATIONS = {
  vatva: { en: 'Vatva', gu: 'વટવા' },
  odhav: { en: 'Odhav', gu: 'ઓઢવ' },
  naroda: { en: 'Naroda', gu: 'નરોડા' },
  sola: { en: 'Sola High Court', gu: 'સોલા હાઈકોર્ટ' },
  kagadapith: { en: 'Kagdapith', gu: 'કાગડાપીઠ' },
  kagdapith: { en: 'Kagdapith', gu: 'કાગડાપીઠ' },
  narol: { en: 'Narol', gu: 'નારોલ' },
  amaraivadi: { en: 'Amraiwadi', gu: 'અમરાઈવાડી' },
  amraivadi: { en: 'Amraiwadi', gu: 'અમરાઈવાડી' },
  vejalpur: { en: 'Vejalpur', gu: 'વેજલપુર' },
  gidc: { en: 'GIDC Vatva', gu: 'જીઆઈડીસી વટવા' },
  bapunagar: { en: 'Bapunagar', gu: 'બાપુનગર' },
  elisbridge: { en: 'Ellisbridge', gu: 'એલિસબ્રિજ' },
  danilimada: { en: 'Danilimda', gu: 'દાણીલીમડા' },
  danilimda: { en: 'Danilimda', gu: 'દાણીલીમડા' },
  madhavpura: { en: 'Madhavpura', gu: 'માધવપુરા' },
  madhupura: { en: 'Madhavpura', gu: 'માધવપુરા' },
  ramol: { en: 'Ramol', gu: 'રામોલ' },
  sarkhej: { en: 'Sarkhej', gu: 'સરખેજ' },
  vastrapur: { en: 'Vastrapur', gu: 'વસ્ત્રાપુર' },
  krushnanagar: { en: 'Krishnanagar', gu: 'કૃષ્ણનગર' },
  'g.haveli': { en: 'Gaekwad Haveli', gu: 'ગાયકવાડ હવેલી' },
  rakhiyal: { en: 'Rakhial', gu: 'રખિયાલ' },
  ishanpur: { en: 'Isanpur', gu: 'ઈસનપુર' },
  shahibag: { en: 'Shahibaug', gu: 'શાહીબાગ' },
  sabarmati: { en: 'Sabarmati', gu: 'સાબરમતી' },
  gomtipu: { en: 'Gomtipur', gu: 'ગોમતીપુર' },
  gomatipur: { en: 'Gomtipur', gu: 'ગોમતીપુર' },
  anandnagar: { en: 'Anandnagar', gu: 'આનંદનગર' },
  shaherkotda: { en: 'Shaherkotda', gu: 'શહેરકોટડા' },
  chandkheda: { en: 'Chandkheda', gu: 'ચાંદખેડા' },
  nikol: { en: 'Nikol', gu: 'નિકોલ' },
  navarangpura: { en: 'Navrangpura', gu: 'નવરંગપુરા' },
  meghaninagar: { en: 'Meghaninagar', gu: 'મેઘાણીનગર' },
  khokhara: { en: 'Khokhra', gu: 'ખોખરા' },
  khokhra: { en: 'Khokhra', gu: 'ખોખરા' },
  paldi: { en: 'Paldi', gu: 'પાલડી' },
  shahpur: { en: 'Shahpur', gu: 'શાહપુર' },
  ghatlodiya: { en: 'Ghatlodiya', gu: 'ઘાટલોડિયા' },
  vasana: { en: 'Vasna', gu: 'વાસણા' },
  'guj.uni.': { en: 'Gujarat University', gu: 'ગુજરાત યુનિવર્સિટી' },
  khadiya: { en: 'Khadia', gu: 'ખાડિયા' },
  karanj: { en: 'Karanj', gu: 'કારંજ' },
  sardarnagar: { en: 'Sardarnagar', gu: 'સરદારનગર' },
  'sa.ri.east': { en: 'Sabarmati Riverfront East', gu: 'સાબરમતી રિવરફ્રન્ટ ઈસ્ટ' },
};

/** Station from a register key or a typed name: { en, gu, key } or { en: text, gu: null }. */
export function stationFor(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const known = GUJARAT_STATIONS[raw.toLowerCase()];
  if (known) return { ...known, key: raw };
  const byName = Object.values(GUJARAT_STATIONS).find((s) => s.gu === raw || s.en.toLowerCase() === raw.toLowerCase());
  if (byName) return { ...byName, key: raw };
  const gujarati = /[઀-૿]/.test(raw);
  return { en: gujarati ? null : raw, gu: gujarati ? raw : null, key: raw };
}

/** What the register says about why a child went missing, in English for the case notes. */
const REASONS = [
  [/અપહર/, 'Kidnapping / abduction (case registered)'],
  [/કેનાલ/, 'Fell into the canal while playing'],
  [/માતા સાથે/, 'Went with the mother'],
  [/અસ્થ[િી]ર|મંદ\s?બુ|માનસિક|મગજ/, 'Mental illness / intellectual disability'],
  [/ભીખ/, 'Went out to beg'],
  [/ભુલો પડી/, 'Got lost near the railway station'],
  [/રમતા|રમવા/, 'Went out to play and did not return'],
  [/સ્કુલ|સ્કુલે|શાળા/, 'Left for school and did not return'],
  [/મજુરી|નોકરી/, 'Left saying she/he was going for work'],
  [/સંસ્થા/, "Ran away from a children's institution"],
  [/ભાગી/, 'Ran away from home'],
  [/દુકાને|લેવા ગયેલ|લગ્ન|મંદીરે|ગરબા|બહાર જવુ|કપડા|દાદાના ઘરે/, 'Went out (errand / outing) and did not return'],
  [/કહ્યા|કહયા|જાણ ક|કહી|જતો રહેલ|જતી રહેલ|ચાલ્યો|ચાલી ગયેલ/, 'Left without telling anyone'],
  [/અગમ્ય|જણાવેલ નથી|અન્ય/, 'Reason not known'],
];

export function reasonInEnglish(reason) {
  const r = String(reason || '');
  for (const [re, en] of REASONS) if (re.test(r)) return en;
  if (!r) return 'Not stated';
  return /[઀-૿ऀ-ॿ]/.test(r) ? 'Other (see the original text)' : r;
}

/** Collapses whitespace and trims the separators registers pad cells with. */
export function cleanCell(value) {
  return String(value ?? '')
    .replace(/‍/g, ' ')
    .replace(/‌/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[ ,.\-–:;]+|[ ,.\-–:;]+$/g, '');
}

export function asciiDigitsGu(s) {
  return String(s ?? '').replace(/[૦-૯]/g, (d) => String('૦૧૨૩૪૫૬૭૮૯'.indexOf(d)));
}

// Python's \b around Gujarati letters: a boundary is anything that is not a letter or digit.
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}_])';
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}_])';

// Where the name ends and the address, age or caste begins.
const STOP = /(રહે(વાસી)?(?=[\s.,:;\-–/0-9૦-૯]|$)|રહી(?=[\s.,:;\-–]|$)|રે\.|સરનામું|ઉ\.?\s?વ\.?|ઉવ|ઉ,વ|ઉ\s?વ\s|ઉમર|\(?\s*જન્મ|\(\s*જ\.તા|ધંધો|મ\.\s?નં|મ\.ન\.|મન\.|ઠે\.|ના આશરાનો)/;
// "daughter of" / "son of" in every way it gets typed.
const RELATION = new RegExp(
  `\\s*(ડૉ\\s?/\\s?ઓફ?|ડો\\s?/\\s?ઓફ?|ડો\\.\\s?/\\s?ઓફ?|ડૉ\\.?\\s?ઓફ?|ડો\\.\\s?ઓફ?\\.?|ડો\\.?\\s?ઓ${NOT_WORD_AFTER}|ડોઓ|ડી\\.ઓ|ડા/ઓ|D/o|સ\\.ઓ|સ/ઓફ?|સન/ઓફ?|સન\\.\\s?ઓફ|શ\\.ઓ\\.|S/o)\\s*`,
  'gu',
);
const PREFIX = /^(ફરીયાદીની દીકરી|ફરીયાદીશ્રીનો ભાણીયો નામે|સગીરવયની દિકરી|દીકરી)\s*/;

// Address cues in name cells typed without "રહે": a house number, an
// institution, or a locality word ("…નગર", "સોસાયટી", "ચાલી").
const INSTITUTION_WORD = /ગૃહ|ચિલ્ડ્રન|સંસ્થા|આશ્રમ|મકાન/;
const LOCALITY = '(નગર|નગરની|નગરમાં|સોસાયટી|સોસાયટીમાં|સોસા\\.?|ચાલી|ચાલીમાં|ફ્લેટ|એપાર્ટમેન્ટ|છાપરા|છાપરામાં|કોલોની|પોળ|રોડ)';
const LOCALITY_SUFFIX = new RegExp(`^\\S+${LOCALITY}$`);
const LOCALITY_WORD = new RegExp(`^${LOCALITY}$`);

/** Character index where an address seems to start in a name cell without "રહે", or -1. */
function addressCue(t) {
  const tokens = t.split(' ');
  let at = 0;
  const starts = tokens.map((tok) => {
    const s = at;
    at += tok.length + 1;
    return s;
  });
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/[0-9૦-૯]/.test(tok) || INSTITUTION_WORD.test(tok) || LOCALITY_SUFFIX.test(tok)) return starts[i];
    if (LOCALITY_WORD.test(tok) && i >= 3) return starts[i - 1]; // "અંબિકા નગરની"
  }
  return -1;
}

/**
 * Splits a name cell into the name and the rest (address, age, caste...).
 * Returns { name, rest }.
 */
export function splitName(text) {
  const t = cleanCell(text);
  const m = STOP.exec(t);
  let cut = m ? m.index : t.length;
  let rest = m ? t.slice(m.index) : '';
  // "જાતે <caste>" closes a name the way police write it; what follows is the address.
  const caste = /જાતે\s*[-.]?\s*[^\s(]+/.exec(t);
  const cue = addressCue(t);
  // A cue only counts before the word the stop marker sits in ("પટણીઉ.વ.૧૭" keeps "પટણી").
  const stopWord = m ? t.lastIndexOf(' ', m.index - 1) + 1 : t.length;
  const early = [caste ? caste.index + caste[0].length : -1, cue].filter((i) => i > 0 && i < cut && i < stopWord);
  if (early.length) {
    cut = Math.min(...early);
    const tail = cleanCell(t.slice(cut));
    rest = tail && !STOP.test(tail.slice(0, 6)) ? `રહે ${tail}` : tail;
  }
  let name = t.slice(0, cut);
  name = name.trim().replace(/\s+નુ$/, '');
  name = name.replace(PREFIX, '');
  name = name.replace(/\(.*?\)|\(.*$/g, ' ');
  name = name.replace(RELATION, ' ');
  name = name.replace(/જાતે\s*[-.]?\s*/g, ' ');
  name = name.replace(/\s+ની\s+દીકરી.*$/, '');
  name = name.replace(/\s+તે\s+/g, ' ');
  name = name.replace(/[0-9૦-૯]/g, '');
  // "વિઠલ ભાઈ" is one name, typed with a space.
  name = name.replace(/(\S)\s+(ભાઈ|ભાઇ|બેન)(?=\s|$)/g, '$1$2');
  return { name: cleanCell(name), rest };
}

const MOBILE_IN_TEXT = /(?<![0-9૦-૯])[6-9૬-૯][0-9૦-૯]{9}(?![0-9૦-૯])/g;
const SADAR = new RegExp(`^(સદર|શદર|સ્દાર|સર)${NOT_WORD_AFTER}`, 'u');

/** The address that follows "રહે" (or a house number) in a cell, or null. */
export function addressFrom(rest) {
  const r = String(rest || '');
  const m = /(રહે(વાસી)?|રહી|રે\.|સરનામું)\s*[.,:;\-–]*\s*[:-]*/.exec(r);
  let a;
  if (m) a = cleanCell(r.slice(m.index + m[0].length));
  else if (/^(મ\.?\s?નં|મ\.ન|મકાન|મન\.)/.test(r.trim())) a = cleanCell(r);
  else return null;
  a = a.replace(/^[\-–.,: ]+/, '');
  a = a.replace(/^રહે\s*[-.]\s*/, '');
  a = a.replace(MOBILE_IN_TEXT, '');
  if (!a || SADAR.test(a)) return null;
  a = a.split(/\s?(?:મો\.?\s?નં|મો\.?\s?ન\.|મો-)/)[0];
  return cleanCell(a) || null;
}

const SADAR_ANYWHERE = new RegExp(`${NOT_WORD_BEFORE}(સદર|શદર)${NOT_WORD_AFTER}`, 'u');
/** "સદર" means "the above" — an address that only says that is no address. */
export function isPlaceholderAddress(a) {
  return Boolean(a) && SADAR_ANYWHERE.test(a) && a.length < 8;
}

/** A short FIR / diary / CCTNS reference for the case's FIR field, or null. */
export function referenceShort(ref, stationGu) {
  const st = stationGu || '';
  const t = asciiDigitsGu(ref);
  const t2 = t.replace(/(?<=\d)\s+(?=\d)/g, '');
  let m = /1119\d{8,11}/.exec(t2);
  if (m) return `${st} પો.સ્ટે. ગુ.ર.નં. ${m[0]}`.trim();
  m = /(ફ\.?\s?ગુ[.,]?\s?ર[.,]?\s?ન\.?ં?\.?|ફ(સ્ટ|્સ્ટ|ર્સ્ટ)\.?\s?ગુ[.,]?\s?ર[.,]?\s?ન\.?ં?\.?|ગુ[.,]?\s?ર[.,]?\s?નં\.?|ફ\.)\s*[:\-–]*\s*(\d+)\s*[./]\s*(\d{2,4})/.exec(t);
  if (m) return `${st} પો.સ્ટે. ફ.ગુ.ર.નં. ${m[3]}/${m[4]}`.trim();
  m = /ફ\.\s*(\d+)(?![\d./])/.exec(t);
  if (m) return `${st} પો.સ્ટે. ફ.ગુ.ર.નં. ${m[1]}`.trim();
  m = /(જા\.?\s?જો(ગ)?\.?|જાજો\.|જોગ|જા\.\s?જા\.)(\s?(એ|એન્ટ્રી|રજી)\.?)?\s*(નં|ન)?\.?\s*[:\-–]*\s*(\d+)\s*[./]\s*(\d{2,4})/.exec(t);
  if (m) return `${st} પો.સ્ટે. જા.જોગ નં. ${m[6]}/${m[7]}`.trim();
  m = /(\d+)\s*\/\s*(\d{2})(?!\d)/.exec(t);
  if (m) return `${st} પો.સ્ટે. ${m[1]}/${m[2]}`.trim();
  return null;
}

/** The complainant's name from a "name, address, phone" cell. */
export function complainantName(text) {
  const t = cleanCell(text);
  if (!t) return null;
  const m = STOP.exec(t);
  let name = cleanCell(m ? t.slice(0, m.index) : t);
  name = name.replace(/^(પિતા|માતા)\s*[-–]?\s*/, '');
  name = name.replace(MOBILE_IN_TEXT, '');
  return cleanCell(name).slice(0, 120) || null;
}

/** Ten-digit Indian mobile numbers found in any of the texts, in order, once each. */
export function phonesIn(...texts) {
  const out = [];
  for (const t of texts) {
    for (const m of asciiDigitsGu(t || '').replace(/[०-९]/g, (d) => String('०१२३४५६७८९'.indexOf(d))).matchAll(/(?<!\d)(?:\+?91[\s-]?)?([6-9]\d{9})(?!\d)/g)) {
      if (!out.includes(m[1])) out.push(m[1]);
    }
  }
  return out;
}
