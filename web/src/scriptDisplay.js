// Shows case data in the reader's script.
//
// Records keep the text exactly as the source wrote it: Gujarat Police's
// register is in Gujarati, and that original is the evidence. But an officer
// reading the console in English cannot read Gujarati script, and a Hindi or
// Marathi reader reads Devanagari. So free text from a record is converted at
// display time only, never when it is edited or sent back:
//   gu      the original text
//   hi, mr  the same text in Devanagari (Gujarati and Devanagari map letter for
//           letter, so this is exact)
//   en      a Latin transliteration, with common police abbreviations
//           (પો.સ્ટે., જા.જોગ, ગુ.ર.નં.) rendered as their English equivalents
// Text that is not in Gujarati script is shown unchanged.
import { transliterateGujarati } from './bulk/translit.js';

const GUJARATI = /[઀-૿]/;
const GUJARATI_DIGIT = /[૦-૯]/g;

// Ahmedabad City police stations and areas, in their usual English spelling.
// Generic transliteration gets most names right but not all ("Sabramti").
const PLACE_NAMES_EN = [
  ["સાબરમતી રિવરફ્રન્ટ ઈસ્ટ","Sabarmati Riverfront East"],
  ["ગુજરાત યુનિવર્સિટી","Gujarat University"],
  ["ગાયકવાડ હવેલી","Gaekwad Haveli"],
  ["સોલા હાઈકોર્ટ","Sola High Court"],
  ["જીઆઈડીસી વટવા","GIDC Vatva"],
  ["વસ્ત્રાપુર","Vastrapur"],
  ["અમરાઈવાડી","Amraiwadi"],
  ["અમરાઇવાડી","Amraiwadi"],
  ["એલિસબ્રિજ","Ellisbridge"],
  ["એલીસબ્રિજ","Ellisbridge"],
  ["નવરંગપુરા","Navrangpura"],
  ["દાણીલીમડા","Danilimda"],
  ["ઘાટલોડિયા","Ghatlodiya"],
  ["શહેરકોટડા","Shaherkotda"],
  ["મેઘાણીનગર","Meghaninagar"],
  ["કાગડાપીઠ","Kagdapith"],
  ["માધવપુરા","Madhavpura"],
  ["ગોમતીપુર","Gomtipur"],
  ["કૃષ્ણનગર","Krishnanagar"],
  ["ચાંદખેડા","Chandkheda"],
  ["સરદારનગર","Sardarnagar"],
  ["બાપુનગર","Bapunagar"],
  ["વેજલપુર","Vejalpur"],
  ["સાબરમતી","Sabarmati"],
  ["શાહીબાગ","Shahibaug"],
  ["આનંદનગર","Anandnagar"],
  ["રખિયાલ","Rakhial"],
  ["રખીયાલ","Rakhial"],
  ["ઈસનપુર","Isanpur"],
  ["ઇસનપુર","Isanpur"],
  ["ખાડિયા","Khadia"],
  ["શાહપુર","Shahpur"],
  ["નરોડા","Naroda"],
  ["રામોલ","Ramol"],
  ["સરખેજ","Sarkhej"],
  ["ખોખરા","Khokhra"],
  ["પાલડી","Paldi"],
  ["કારંજ","Karanj"],
  ["નારોલ","Narol"],
  ["નિકોલ","Nikol"],
  ["વાસણા","Vasna"],
  ["વટવા","Vatva"],
  ["ઓઢવ","Odhav"],
  ["જુહાપુરા","Juhapura"],
  ["ગાંધીનગર","Gandhinagar"],
  ["અમદાવાદ","Ahmedabad"],
];

// Longest first, so "ફ.ગુ.ર.નં." wins over "ગુ.ર.નં.".
const PHRASES_EN = [
  ['પોલીસ સ્ટેશન', 'Police Station'],
  ['પો.સ્ટે.', 'P.S.'], ['પો.સ્ટે', 'P.S.'], ['પો. સ્ટે.', 'P.S.'],
  ['ફ.ગુ.ર.નં.', 'FIR No.'], ['ફ.ગુ.ર.નં', 'FIR No.'], ['ફ.ગુ.ર.ન.', 'FIR No.'],
  ['ગુ.ર.નં.', 'Cr. No.'], ['ગુ.ર.નં', 'Cr. No.'],
  ['ગુમ.જા.જોગ', 'Missing diary'], ['જા.જોગ', 'Diary'], ['જા.જો.', 'Diary'], ['જાહેર જોગ', 'Diary'],
  ['સ્ટે.ડા.નં', 'Station diary No.'], ['સ્ટે.ડા', 'Station diary'],
  ['રજી.નં.', 'Reg. No.'], ['નં.', 'No.'], ['નં', 'No.'],
  ['ઇપીકો', 'IPC'], ['ઈપીકો', 'IPC'], ['ઇ.પી.કો.', 'IPC'], ['ઈ.પી.કો', 'IPC'], ['ઇ.પી.કો', 'IPC'],
  ['બી.એન.એસ', 'BNS'], ['ભારતીય ન્યાય સંહિતા', 'Bharatiya Nyaya Sanhita'],
  ['કલમ', 'Section'], ['મુજબ', ''], ['પાર્ટ-એ', 'Part A'], ['પાર્ટ એ', 'Part A'],
  ['અમદાવાદ શહેર', 'Ahmedabad City'], ['અ.વાદ', 'Ahmedabad'], ['અ’વાદ', 'Ahmedabad'], ["અ'વાદ", 'Ahmedabad'],
  ['ડો/ઓ', 'D/o'], ['ડો.ઓ', 'D/o'], ['સ/ઓ', 'S/o'], ['વા/ઓ', 'W/o'],
  ['રહે.', 'R/o'], ['રહે-', 'R/o '], ['રહે :', 'R/o'], ['તા.', 'dt.'],
  ['ઉ.વ.', 'age'], ['ઉ.વ', 'age'],
  ['ફ. ', 'FIR '], ['ફ.', 'FIR '],
];

// Places that recur in records, so a Gujarati reader sees them in Gujarati and
// a Hindi/Marathi reader in Devanagari. Anything else is shown as stored.
const PLACES = {
  Gujarat: { gu: 'ગુજરાત', hi: 'गुजरात', mr: 'गुजरात' },
  Maharashtra: { gu: 'મહારાષ્ટ્ર', hi: 'महाराष्ट्र', mr: 'महाराष्ट्र' },
  Rajasthan: { gu: 'રાજસ્થાન', hi: 'राजस्थान', mr: 'राजस्थान' },
  'Madhya Pradesh': { gu: 'મધ્ય પ્રદેશ', hi: 'मध्य प्रदेश', mr: 'मध्य प्रदेश' },
  Delhi: { gu: 'દિલ્હી', hi: 'दिल्ली', mr: 'दिल्ली' },
  'Uttar Pradesh': { gu: 'ઉત્તર પ્રદેશ', hi: 'उत्तर प्रदेश', mr: 'उत्तर प्रदेश' },
  Bihar: { gu: 'બિહાર', hi: 'बिहार', mr: 'बिहार' },
  Assam: { gu: 'આસામ', hi: 'असम', mr: 'आसाम' },
  Goa: { gu: 'ગોવા', hi: 'गोवा', mr: 'गोवा' },
  Karnataka: { gu: 'કર્ણાટક', hi: 'कर्नाटक', mr: 'कर्नाटक' },
  Ahmedabad: { gu: 'અમદાવાદ', hi: 'अहमदाबाद', mr: 'अहमदाबाद' },
  Gandhinagar: { gu: 'ગાંધીનગર', hi: 'गांधीनगर', mr: 'गांधीनगर' },
  Surat: { gu: 'સુરત', hi: 'सूरत', mr: 'सुरत' },
  Vadodara: { gu: 'વડોદરા', hi: 'वडोदरा', mr: 'वडोदरा' },
  Rajkot: { gu: 'રાજકોટ', hi: 'राजकोट', mr: 'राजकोट' },
  Mumbai: { gu: 'મુંબઈ', hi: 'मुंबई', mr: 'मुंबई' },
  'Navi Mumbai': { gu: 'નવી મુંબઈ', hi: 'नवी मुंबई', mr: 'नवी मुंबई' },
  Thane: { gu: 'થાણે', hi: 'ठाणे', mr: 'ठाणे' },
  Pune: { gu: 'પુણે', hi: 'पुणे', mr: 'पुणे' },
  Nagpur: { gu: 'નાગપુર', hi: 'नागपुर', mr: 'नागपूर' },
  'North Goa': { gu: 'ઉત્તર ગોવા', hi: 'उत्तर गोवा', mr: 'उत्तर गोवा' },
};

function toLatinDigits(text) {
  return text.replace(GUJARATI_DIGIT, (d) => String(d.charCodeAt(0) - 0x0ae6));
}

// Gujarati U+0A81..U+0AEF sits exactly 0x180 above its Devanagari counterpart.
function toDevanagari(text) {
  let out = '';
  for (const ch of toLatinDigits(text)) {
    const code = ch.charCodeAt(0);
    out += code >= 0x0a81 && code <= 0x0aff ? String.fromCharCode(code - 0x180) : ch;
  }
  return out;
}

function toEnglish(text) {
  let s = toLatinDigits(text);
  for (const [gu, en] of [...PLACE_NAMES_EN, ...PHRASES_EN]) s = s.split(gu).join(en ? ` ${en} ` : ' ');
  return transliterateGujarati(s).replace(/\s+([,.)/])/g, '$1').replace(/\(\s+/g, '(').replace(/\s{2,}/g, ' ').trim();
}

const cache = new Map();

export function displayText(value, lang) {
  if (value == null || value === '' || typeof value !== 'string') return value;
  if (lang === 'gu' || !GUJARATI.test(value)) return value;
  const key = `${lang}\u0000${value}`;
  if (cache.has(key)) return cache.get(key);
  const out = lang === 'hi' || lang === 'mr' ? toDevanagari(value) : toEnglish(value);
  if (cache.size > 5000) cache.clear();
  cache.set(key, out);
  return out;
}

export function displayPlace(value, lang) {
  if (!value || lang === 'en') return value;
  return PLACES[value]?.[lang] || displayText(value, lang);
}
