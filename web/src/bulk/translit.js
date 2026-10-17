// Best-effort Gujarati to Latin transliteration of names (with schwa deletion),
// stored with an imported case as a search aid ("Gitaben Mohanbhai Patel"),
// never as an official spelling.

const CONS = {
  'ક': 'k', 'ખ': 'kh', 'ગ': 'g', 'ઘ': 'gh', 'ઙ': 'n', 'ચ': 'ch', 'છ': 'chh', 'જ': 'j', 'ઝ': 'z',
  'ઞ': 'n', 'ટ': 't', 'ઠ': 'th', 'ડ': 'd', 'ઢ': 'dh', 'ણ': 'n', 'ત': 't', 'થ': 'th', 'દ': 'd',
  'ધ': 'dh', 'ન': 'n', 'પ': 'p', 'ફ': 'f', 'બ': 'b', 'ભ': 'bh', 'મ': 'm', 'ય': 'y', 'ર': 'r',
  'લ': 'l', 'વ': 'v', 'શ': 'sh', 'ષ': 'sh', 'સ': 's', 'હ': 'h', 'ળ': 'l',
};
const INDEP = {
  'અ': 'a', 'આ': 'a', 'ઇ': 'i', 'ઈ': 'i', 'ઉ': 'u', 'ઊ': 'u', 'ઋ': 'ru', 'એ': 'e', 'ઐ': 'ai',
  'ઓ': 'o', 'ઔ': 'au', 'ઍ': 'e', 'ઑ': 'o',
};
const MATRA = {
  'ા': 'a', 'િ': 'i', 'ી': 'i', 'ુ': 'u', 'ૂ': 'u', 'ૃ': 'ru', 'ે': 'e', 'ૈ': 'ai', 'ો': 'o',
  'ૌ': 'au', 'ૅ': 'e', 'ૉ': 'o',
};
const VIRAMA = '્';
const NASAL = new Set(['ં', 'ઁ']);

function word(w) {
  // syllables: [consonant, vowel, inherent, nasal?]
  const syl = [];
  let i = 0;
  while (i < w.length) {
    const ch = w[i];
    if (CONS[ch]) {
      const c = CONS[ch];
      if (w[i + 1] === VIRAMA) {
        syl.push([c, '', false]);
        i += 2;
        continue;
      }
      if (MATRA[w[i + 1]] !== undefined) {
        syl.push([c, MATRA[w[i + 1]], false]);
        i += 2;
        continue;
      }
      syl.push([c, 'a', true]);
      i += 1;
      continue;
    }
    if (INDEP[ch]) {
      syl.push(['', INDEP[ch], false]);
      i += 1;
      continue;
    }
    if (NASAL.has(ch)) {
      if (syl.length) syl[syl.length - 1].push('n');
      i += 1;
      continue;
    }
    if (ch === 'ઃ') {
      i += 1;
      continue;
    }
    syl.push([ch, '', false]);
    i += 1;
  }
  // Schwa deletion: word-final, then V C a C V (right to left).
  const n = syl.length;
  if (n > 1 && syl[n - 1][2] && syl[n - 2][1] !== '') {
    syl[n - 1][1] = '';
    syl[n - 1][2] = false;
  }
  for (let k = n - 2; k > 0; k--) {
    const s = syl[k];
    if (!s[2] || s.length > 3) continue;
    const prevHasVowel = syl[k - 1][1] !== '';
    const next = syl[k + 1];
    if (prevHasVowel && next[0] && next[1] !== '') {
      s[1] = '';
      s[2] = false;
    }
  }
  const out = syl.map((s) => s[0] + s[1] + (s.length > 3 ? s[3] : '')).join('');
  return out.split('aa').join('a').split('ii').join('i');
}

export function transliterateGujarati(text) {
  const parts = String(text || '').split(/(\s+|[-/(),.])/);
  const res = [];
  for (const w of parts) {
    if (!w || /^(\s+|[-/(),.])$/.test(w)) {
      res.push(w);
      continue;
    }
    if (!/[઀-૿]/.test(w)) {
      res.push(w);
      continue;
    }
    let lat = word(w);
    if (w.startsWith('જયો')) lat = `jyo${lat.slice(4)}`; // the common spelling of Jyoti
    res.push(lat.slice(0, 1).toUpperCase() + lat.slice(1));
  }
  return res.join('').replace(/\s+/g, ' ').trim();
}
