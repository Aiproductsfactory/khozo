/**
 * Folds a place name, in any script, to the key the gazetteer compares.
 *
 * The same district reaches Khozo as "Ahmedabad", "AHMEDABAD DISTRICT",
 * "Ahmadabad", "અમદાવાદ", "अहमदाबाद" and "अमदावाद". A key is what is left once
 * everything that does not tell two places apart is gone:
 *
 *   - case, spacing, punctuation and Latin diacritics ("Bharūch");
 *   - the word for "district" in English, Gujarati, Hindi and Marathi, before
 *     or after the name ("Pune District", "जिल्हा कोल्हापूर", "રાજકોટ જિલ્લો");
 *   - the script: Gujarati is written in the Devanagari code points it mirrors
 *     (the two Unicode blocks share one layout, U+0A80 = U+0900 + 0x180), so a
 *     Gujarati spelling of a Maharashtra district meets its Marathi name;
 *   - the spellings Hindi, Marathi and Gujarati disagree on: nukta, virama,
 *     chandrabindu, long and short i and u, and ळ (Marathi/Gujarati) for ल.
 *
 * Pure and dependency-free: the web app bundles it (shared/geo/states.js).
 */

const GUJARATI_TO_DEVANAGARI = 0x180;

/**
 * The character-level folding, shared by keys and by the noise-word list (so
 * a noise word is removed in exactly the form a key would hold it).
 */
function foldCharacters(value) {
  return String(value ?? '')
    .normalize('NFD')
    .toLowerCase()
    // Latin combining diacritics.
    .replace(/[̀-ͯ]/g, '')
    // Gujarati written in Devanagari code points.
    .replace(/[઀-૿]/g, (c) => String.fromCharCode(c.charCodeAt(0) - GUJARATI_TO_DEVANAGARI))
    // Nukta, virama, zero-width joiners: spelt with and without.
    .replace(/[़्‌‍]/g, '')
    // Chandrabindu as anusvara; candra e/o as e/o.
    .replace(/ँ/g, 'ं')
    .replace(/ॅ/g, 'े')
    .replace(/ॉ/g, 'ो')
    .replace(/ऍ/g, 'ए')
    .replace(/ऑ/g, 'ओ')
    // Long ii/uu as short (vowel signs and independent vowels).
    .replace(/ी/g, 'ि')
    .replace(/ू/g, 'ु')
    .replace(/ई/g, 'इ')
    .replace(/ऊ/g, 'उ')
    // ळ (Marathi, Gujarati) as ल (Hindi).
    .replace(/ळ/g, 'ल')
    .replace(/&/g, ' and ');
}

/** Words that name the kind of place, not the place. Removed wherever they stand. */
const NOISE_WORDS = new Set(
  [
    'district', 'districts', 'dist', 'distt', 'dt', 'jilla', 'jillo', 'zilla', 'zila', 'jila', 'zillah',
    'जिला', 'ज़िला', 'जिले', 'ज़िले', 'जिल्हा', 'ज़िल्हा', 'जिल्ह्या', 'जिल्ला', 'जनपद',
    'જિલ્લો', 'જીલ્લો', 'જિલ્લા', 'જીલ્લા',
  ].map((word) => foldCharacters(word))
);

/** Splits on anything that is not a letter, a combining mark or a digit. */
const NOT_A_WORD = /[^\p{L}\p{M}\p{N}]+/u;

/**
 * The comparison key for a place name: '' for nothing usable.
 * A leading "the" goes too ("The Nilgiris", "The Dangs").
 */
export function geoKey(value) {
  const words = foldCharacters(value).split(NOT_A_WORD).filter(Boolean);
  const kept = words.filter((word) => !NOISE_WORDS.has(word));
  if (kept[0] === 'the' && kept.length > 1) kept.shift();
  return kept.join('');
}

/** True for a key written in Latin letters and digits only. */
export function isLatinKey(key) {
  return /^[a-z0-9]+$/.test(key);
}

/**
 * A looser key for Latin spellings: the transliteration choices that differ
 * between writers are folded (aspirates, doubled letters, w/v, z/j, ph/f,
 * sh/s, and every run of vowels to one "a"), but the shape of the word stays.
 * "Bharooch" and "Bharuch" share one, as do "Kolhapoor" and "Kolhapur";
 * "Nadiad" and "Anand" do not. Only ever consulted after an exact key has
 * failed, and only when it picks out a single place.
 */
export function skeletonKey(key) {
  if (!isLatinKey(key)) return '';
  return key
    .replace(/ph/g, 'f')
    .replace(/sh/g, 's')
    .replace(/([kgcjtdpb])h/g, '$1')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/[aeiouy]+/g, 'a')
    .replace(/(.)\1+/g, '$1');
}

/**
 * Edit distance between two keys, giving up once it exceeds `max` (returns
 * max + 1). Adjacent transpositions count as one edit ("Ahemdabad").
 */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prevPrev = null;
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  let prevMin = 0;
  for (let i = 1; i <= la; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prevPrev && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2] + 1);
      }
      row.push(value);
      if (value < rowMin) rowMin = value;
    }
    // A transposition reaches back two rows, so both bound what is left.
    if (Math.min(rowMin, prevMin) > max) return max + 1;
    prevPrev = prev;
    prev = row;
    prevMin = rowMin;
  }
  return prev[lb] > max ? max + 1 : prev[lb];
}

/**
 * How many edits a misspelling of a key this long may carry and still match.
 * Short names get none: "Patna" is one transposition from Gujarat's "Patan",
 * and a wrong district is worse than an unplaced one (the record still
 * reaches every district desk of its state; shared/scope.js).
 */
export function fuzzyAllowance(key) {
  const length = [...key].length;
  if (length >= 12) return 2;
  if (length >= 6) return 1;
  return 0;
}
