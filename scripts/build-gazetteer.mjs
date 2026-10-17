/**
 * Builds shared/geo/districts-data.js: every district of India with its LGD
 * code and its names in English, Gujarati, Hindi and Marathi.
 *
 *   node scripts/build-gazetteer.mjs <dir> [--date 2026-10-17]
 *
 * <dir> holds the downloaded public reference data (nothing here reaches the
 * network; fetch the files yourself and keep them outside the repository):
 *
 *   districts.<DDMonYYYY>.csv   LGD district list. The Local Government
 *       Directory's own download needs a captcha, so the copy archived daily
 *       by the ramSeraph/opendata project is used ("lgd-latest-extra1"
 *       release on GitHub), unmodified.
 *   wd-district-labels.json     Wikidata SPARQL result: every item with an LGD
 *       district code (P12746) and its en/gu/hi/mr labels:
 *         SELECT ?item ?lgd ?en ?gu ?hi ?mr WHERE {
 *           ?item wdt:P12746 ?lgd .
 *           OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en)="en") } ... }
 *   wd-district-aliases.json    The same items' en/gu/hi/mr alternative labels
 *       (skos:altLabel).
 *
 * The LGD code and English name come from LGD. Wikidata supplies the names in
 * the other three languages and the common spellings; where it has no label
 * in a language the name is transliterated from the other Indic script (the
 * Gujarati and Devanagari Unicode blocks mirror each other). Gujarat and
 * Maharashtra, the pilot states, are checked by hand: the overrides below
 * correct Wikidata labels that still carry a district's old name, and add the
 * spellings officers and OpenStreetMap actually use.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { geoKey } from '../shared/geo/normalise.js';
import { STATES } from '../shared/geo/states.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node scripts/build-gazetteer.mjs <dir with the downloaded files> [--date YYYY-MM-DD]');
  process.exit(1);
}
const dateFlag = process.argv.indexOf('--date');
const fetchedOn = dateFlag === -1 ? new Date().toISOString().slice(0, 10) : process.argv[dateFlag + 1];

const lgdFile = fs.readdirSync(dir).filter((f) => /^districts\.\d{2}[A-Za-z]{3}\d{4}\.csv$/.test(f)).sort().pop();
if (!lgdFile) throw new Error(`No districts.<date>.csv in ${dir}`);
const lgdSnapshot = lgdFile.match(/(\d{2}[A-Za-z]{3}\d{4})/)[1];

// ---------------------------------------------------------------- curation

/** English names LGD writes in a form nobody else does. */
const EN_OVERRIDES = {
  // LGD abbreviates it; the district and the existing records do not.
  618: 'Kamrup Metropolitan',
  749: 'NTR',
  766: 'Mauganj',
  553: 'Lakshadweep',
};

/**
 * Names in Gujarati/Hindi/Marathi, set by hand. Gujarat and Maharashtra are
 * the pilot states: every renamed district gets its current name, and the
 * Wikidata labels that still read the old one become aliases instead.
 */
const NAME_OVERRIDES = {
  // Gujarat
  438: { hi: 'अहमदाबाद', mr: 'अहमदाबाद' },
  454: { hi: 'पंचमहाल' },
  456: { hi: 'पोरबंदर' },
  458: { hi: 'साबरकांठा' },
  459: { mr: 'सूरत' },
  673: { mr: 'मोरबी' },
  676: { mr: 'बोटाद' },
  // Maharashtra
  466: { gu: 'અહિલ્યાનગર', hi: 'अहिल्यानगर', mr: 'अहिल्यानगर' },
  469: { gu: 'છત્રપતિ સંભાજીનગર', hi: 'छत्रपति संभाजीनगर', mr: 'छत्रपती संभाजीनगर' },
  488: { gu: 'ધારાશિવ', hi: 'धाराशिव', mr: 'धाराशिव' },
  474: { gu: 'ધુળે', hi: 'धुले', mr: 'धुळे' },
  478: { hi: 'जलगांव' },
  482: { gu: 'મુંબઈ', hi: 'मुंबई', mr: 'मुंबई' },
  483: { gu: 'મુંબઈ ઉપનગર', hi: 'मुंबई उपनगर', mr: 'मुंबई उपनगर' },
  484: { gu: 'નાગપુર' },
  486: { gu: 'નંદુરબાર' },
  490: { gu: 'પુણે' },
  497: { gu: 'થાણે' },
  // Wikidata labels that name a neighbouring district.
  174: { mr: 'प्रतापगड' },
  686: { gu: 'હનમકોંડા', hi: 'हनमकोंडा' },
};

/** Spellings, old names and city names that mean the district. */
const EXTRA_ALIASES = {
  // Gujarat
  438: ['Ahmadabad', 'Amdavad', 'Ahmedabad City', 'Amdavad City', 'Ahemdabad', 'અમદાવાદ શહેર', 'अमदावाद'],
  439: ['Amreli City'],
  441: ['Banaskantha', 'Banas Kantha', 'Palanpur'],
  444: ['Dang', 'The Dangs', 'Dangs'],
  449: ['Kutch', 'Kachh', 'Cutch', 'Kachchh'],
  451: ['Mehsana', 'Mahesana'],
  454: ['Panchmahal', 'Panchmahals', 'Panch Mahal'],
  458: ['Sabarkantha', 'Sabar Kantha', 'Himmatnagar'],
  461: ['Baroda', 'Vadodara City', 'Baroda City'],
  457: ['Rajkot City'],
  459: ['Surat City'],
  668: ['Chhota Udaipur', 'Chhota Udepur', 'Chhotaudepur'],
  672: ['Aravalli', 'Aravali', 'Modasa'],
  673: ['Morvi'],
  674: ['Dwarka', 'Devbhoomi Dwarka', 'Devbhumi Dwarka'],
  675: ['Somnath', 'Veraval'],
  789: ['Vav Tharad', 'Tharad'],
  448: ['Junagarh'],
  // Maharashtra
  466: ['Ahmednagar', 'Ahmadnagar', 'अहमदनगर', 'અહમદનગર'],
  469: ['Aurangabad', 'Sambhajinagar', 'Chh. Sambhajinagar', 'Chhatrapati Sambhaji Nagar', 'औरंगाबाद', 'ઔરંગાબાદ', 'संभाजीनगर'],
  488: ['Osmanabad', 'उस्मानाबाद', 'ઉસ્માનાબાદ'],
  474: ['Dhulia', 'ધુલિયા', 'धुलिया'],
  470: ['Bid', 'Bhir'],
  472: ['Buldana'],
  473: ['Chanda'],
  476: ['Gondiya'],
  482: ['Mumbai City', 'Bombay', 'Greater Mumbai', 'Brihanmumbai', 'Bombay City', 'बृहन्मुंबई', 'मुंबई शहर', 'મુંબઈ શહેર'],
  483: ['Bombay Suburban', 'Mumbai Suburb', 'मुंबई उपनगरीय', 'મુંબઈ ઉપનગરી'],
  485: ['Nander'],
  487: ['Nasik'],
  490: ['Poona', 'Pune City', 'पूना', 'પુના'],
  491: ['Kolaba', 'Raigarh'],
  496: ['Sholapur'],
  497: ['Thana', 'થાણા'],
  499: ['Vashim'],
  500: ['Yeotmal'],
  // Elsewhere: the spellings people and OpenStreetMap use.
  525: ['Bangalore', 'Bangalore Urban', 'Bengaluru', 'Bengaluru City', 'Bangalore City'],
  526: ['Bangalore Rural', 'Bengaluru North'],
  631: ['Ramanagara', 'Ramanagaram'],
  62: ['Gurgaon'],
  545: ['Mysore'],
  527: ['Belgaum'],
  538: ['Gulbarga'],
  528: ['Bellary'],
  530: ['Bijapur Karnataka'],
  547: ['Shimoga'],
  548: ['Tumkur'],
  120: ['Allahabad'],
  140: ['Faizabad'],
  315: ['Calcutta', 'Kolkata City'],
  568: ['Madras', 'Chennai City'],
  565: ['Trivandrum'],
  561: ['Calicut'],
  555: ['Cochin', 'Kochi'],
  350: ['Cuttack'],
  346: ['Balasore'],
  608: ['Mohali', 'SAS Nagar', 'Sahibzada Ajit Singh Nagar'],
  40: ['Nawanshahr', 'Shaheed Bhagat Singh Nagar'],
  409: ['Hoshangabad'],
  144: ['Noida', 'Gautam Buddh Nagar'],
  157: ['Kanpur'],
  600: ['Pondicherry'],
  618: ['Kamrup Metropolitan', 'Guwahati', 'Gauhati'],
  520: ['Vizag', 'Vishakhapatnam'],
  515: ['Nellore'],
  504: ['Kadapa', 'Cuddapah', 'YSR Kadapa', 'YSR'],
  502: ['Anantapur', 'Anantapuramu'],
  507: ['Hyderabad City', 'Secunderabad'],
  9: ['Leh'],
  102: ['Jaipur City'],
  162: ['Lucknow City'],
  396: ['Bhopal City'],
  410: ['Indore City'],
  212: ['Patna City'],
};

/** Wikidata alternative labels that point at the wrong place or several. */
const BLOCKED_ALIASES = {
  449: ['Kutch Region'],
};

/**
 * Police jurisdictions that are not revenue districts but that Khozo already
 * treats as their own (shared/scope.js): each has its own commissionerate or
 * SP, desks are provisioned for it, and folding it into a revenue district
 * would show one police force's cases to another. Codes are
 * `<state code>-<slug>`, never an LGD number.
 */
const POLICE_UNITS = [
  { state: '27', code: '27-navi-mumbai', en: 'Navi Mumbai', gu: 'નવી મુંબઈ', hi: 'नवी मुंबई', mr: 'नवी मुंबई', aliases: ['New Bombay', 'Navi Mumbai Commissionerate'] },
  { state: '24', code: '24-ahmedabad-rural', en: 'Ahmedabad Rural', gu: 'અમદાવાદ ગ્રામ્ય', hi: 'अहमदाबाद ग्रामीण', mr: 'अहमदाबाद ग्रामीण', aliases: ['Ahmedabad Gramya', 'Amdavad Rural', 'Ahmadabad Rural'] },
];

// ------------------------------------------------------------------ helpers

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const csvRows = (file) =>
  fs.readFileSync(path.join(dir, file), 'utf8').trim().split(/\r?\n/).slice(1).map((line) => line.split(','));

const SUFFIX = {
  en: /\s+(?:district|District|DISTRICT)$/,
  gu: /\s+(?:જિલ્લો|જીલ્લો|જિલ્લા|જીલ્લા)$/,
  hi: /\s+(?:जिला|ज़िला|जिले|ज़िले|जनपद|जिल्हा)$/,
  mr: /\s+(?:जिल्हा|ज़िल्हा|जिल्ह्या|जिला|ज़िला)$/,
};
const PREFIX = { hi: /^(?:जिला|ज़िला|जिल्हा)\s+/, mr: /^(?:जिल्हा|जिला)\s+/, gu: /^(?:જિલ્લો)\s+/ };

function cleanLabel(value, lang) {
  if (!value) return '';
  let s = String(value)
    .normalize('NFC')
    // "Bilaspur district, Himachal Pradesh": Wikidata's disambiguation.
    .split(',')[0]
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (SUFFIX[lang]) s = s.replace(SUFFIX[lang], '');
  if (PREFIX[lang]) s = s.replace(PREFIX[lang], '');
  // "रत् नागिरी": a space inside a conjunct (after the suffix is gone, so a
  // name that ends in a virama keeps its own word break).
  return s.trim().replace(/([्્])\s+(?=\S)/g, '$1');
}

/** Gujarati code points that exist, for checking a transliteration. */
const GUJARATI_ASSIGNED = new Set();
for (let c = 0x0a81; c <= 0x0aff; c++) {
  const ch = String.fromCharCode(c);
  if (/\p{L}|\p{M}|\p{N}/u.test(ch)) GUJARATI_ASSIGNED.add(c);
}

function devanagariToGujarati(text) {
  let out = '';
  for (const ch of String(text).normalize('NFD')) {
    const code = ch.codePointAt(0);
    if (code >= 0x0900 && code <= 0x097f) {
      const target = code + 0x180;
      if (!GUJARATI_ASSIGNED.has(target)) return null;
      out += String.fromCharCode(target);
    } else {
      out += ch;
    }
  }
  return out.normalize('NFC');
}

function gujaratiToDevanagari(text) {
  let out = '';
  for (const ch of String(text).normalize('NFD')) {
    const code = ch.codePointAt(0);
    out += code >= 0x0a81 && code <= 0x0aff ? String.fromCharCode(code - 0x180) : ch;
  }
  return out.normalize('NFC');
}

function englishName(code, lgdName) {
  if (EN_OVERRIDES[code]) return EN_OVERRIDES[code];
  let name = lgdName.trim().replace(/\s+District$/i, '').replace(/\(\s*/g, ' (').replace(/\s+/g, ' ');
  if (name === name.toUpperCase()) name = name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return name.trim();
}

// ------------------------------------------------------------------- build

const labels = new Map();
for (const row of readJson('wd-district-labels.json').results.bindings) {
  if (!labels.has(row.lgd.value)) labels.set(row.lgd.value, row);
}
const altLabels = new Map();
for (const row of readJson('wd-district-aliases.json').results.bindings) {
  const code = row.lgd.value;
  if (!altLabels.has(code)) altLabels.set(code, []);
  altLabels.get(code).push({ text: row.alias.value, lang: row.alias['xml:lang'] });
}

const stateCodes = new Set(STATES.map((s) => s.code));
const byState = new Map();
const report = { districts: 0, transliterated: [], droppedAliases: [], unknownStates: new Set() };

for (const [, stateCode, , code, lgdName] of csvRows(lgdFile)) {
  if (!stateCodes.has(stateCode)) {
    report.unknownStates.add(stateCode);
    continue;
  }
  const wd = labels.get(code) || {};
  const en = englishName(code, lgdName);
  const names = {
    gu: cleanLabel(wd.gu?.value, 'gu'),
    hi: cleanLabel(wd.hi?.value, 'hi'),
    mr: cleanLabel(wd.mr?.value, 'mr'),
  };
  const aliases = [lgdName, cleanLabel(wd.en?.value, 'en')];
  // A hand-set name replaces Wikidata's, which stays on as an alias.
  for (const lang of ['gu', 'hi', 'mr']) {
    const override = NAME_OVERRIDES[code]?.[lang];
    if (override && override !== names[lang]) {
      if (names[lang]) aliases.push(names[lang]);
      names[lang] = override;
    }
  }
  // Fill a missing language from the other script.
  if (!names.hi && names.mr) names.hi = names.mr;
  if (!names.mr && names.hi) names.mr = names.hi;
  if (!names.hi && !names.mr && names.gu) {
    names.hi = gujaratiToDevanagari(names.gu);
    names.mr = names.hi;
    report.transliterated.push(`${code} ${en}: hi/mr from gu`);
  }
  if (!names.gu && (names.mr || names.hi)) {
    const source = stateCode === '27' ? names.mr || names.hi : names.hi || names.mr;
    const gu = devanagariToGujarati(source);
    if (gu) {
      names.gu = gu;
      report.transliterated.push(`${code} ${en}: gu from Devanagari`);
    }
  }
  for (const alt of altLabels.get(code) || []) aliases.push(cleanLabel(alt.text, alt.lang));
  aliases.push(...(EXTRA_ALIASES[code] || []));

  const blocked = new Set((BLOCKED_ALIASES[code] || []).map(geoKey));
  if (!byState.has(stateCode)) byState.set(stateCode, []);
  byState.get(stateCode).push({ code, en, gu: names.gu || en, hi: names.hi || en, mr: names.mr || en, aliases, blocked });
  report.districts++;
}

for (const unit of POLICE_UNITS) {
  byState.get(unit.state).push({ ...unit, kind: 'police', blocked: new Set() });
}

// Aliases are kept only when they add a key the district's own names do not
// already give, and never when they would collide with another district of
// the same state: an alias must point at one place.
const rows = {};
for (const [stateCode, districts] of [...byState.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const primary = new Map();
  for (const d of districts) {
    for (const name of [d.en, d.gu, d.hi, d.mr]) {
      const key = geoKey(name);
      if (!key) continue;
      if (primary.has(key) && primary.get(key) !== d.code) {
        report.droppedAliases.push(`state ${stateCode}: names of ${primary.get(key)} and ${d.code} share "${key}"`);
      }
      primary.set(key, d.code);
    }
  }
  const aliasOwners = new Map();
  for (const d of districts) {
    for (const alias of d.aliases) {
      const key = geoKey(alias);
      if (!key || d.blocked.has(key)) continue;
      if (!aliasOwners.has(key)) aliasOwners.set(key, new Set());
      aliasOwners.get(key).add(d.code);
    }
  }
  rows[stateCode] = districts
    .map((d) => {
      const own = new Set([d.en, d.gu, d.hi, d.mr].map(geoKey));
      const kept = [];
      const seen = new Set(own);
      for (const alias of d.aliases) {
        const text = String(alias || '').normalize('NFC').trim();
        const key = geoKey(text);
        if (!key || seen.has(key) || d.blocked.has(key)) continue;
        if (primary.has(key) && primary.get(key) !== d.code) {
          report.droppedAliases.push(`${d.code} ${d.en}: "${text}" is ${primary.get(key)}'s name`);
          continue;
        }
        if (aliasOwners.get(key)?.size > 1) {
          report.droppedAliases.push(`${d.code} ${d.en}: "${text}" also names ${[...aliasOwners.get(key)].filter((c) => c !== d.code).join(', ')}`);
          continue;
        }
        seen.add(key);
        kept.push(text);
      }
      const row = [d.code, d.en, d.gu, d.hi, d.mr, kept];
      if (d.kind) row.push(d.kind);
      return row;
    })
    .sort((a, b) => a[1].localeCompare(b[1], 'en'));
}

const header = `/**
 * Every district of India, with its LGD code and its name in English,
 * Gujarati, Hindi and Marathi, plus the other spellings it is known by.
 *
 * GENERATED by scripts/build-gazetteer.mjs. Do not edit by hand: change the
 * curation in that script and run it again.
 *
 * Row: [code, English, Gujarati, Hindi, Marathi, [aliases], kind?]
 *   code  LGD district code (a string), or "<state>-<slug>" for the few police
 *         jurisdictions with no LGD code that Khozo routes to (kind "police").
 *
 * Sources:
 *   - Local Government Directory (lgdirectory.gov.in), district list as
 *     archived by the ramSeraph/opendata project, snapshot ${lgdSnapshot},
 *     fetched ${fetchedOn}: codes and English names.
 *   - Wikidata (wikidata.org, CC0), items with an LGD district code (P12746),
 *     en/gu/hi/mr labels and alternative labels, queried ${fetchedOn}.
 *   - Hand curation for Gujarat and Maharashtra (current names of renamed
 *     districts, common spellings): see scripts/build-gazetteer.mjs.
 */
`;

const body = Object.entries(rows)
  .map(([stateCode, list]) => `  ${JSON.stringify(stateCode)}: [\n${list.map((row) => `    ${JSON.stringify(row)},`).join('\n')}\n  ],`)
  .join('\n');

const out = `${header}
export const DISTRICT_SOURCES = ${JSON.stringify({
  lgd: { name: 'Local Government Directory district list (ramSeraph/opendata LGD archive)', snapshot: lgdSnapshot, fetched: fetchedOn },
  wikidata: { name: 'Wikidata labels for items with an LGD district code (P12746)', fetched: fetchedOn, licence: 'CC0' },
}, null, 2)};

export const DISTRICTS = {
${body}
};
`;

const target = path.join(root, 'shared', 'geo', 'districts-data.js');
fs.writeFileSync(target, out);
console.log(`wrote ${path.relative(root, target)}: ${report.districts} LGD districts + ${POLICE_UNITS.length} police units in ${Object.keys(rows).length} states/UTs`);
if (report.unknownStates.size) console.log(`skipped districts of unknown state codes: ${[...report.unknownStates].join(', ')}`);
console.log(`${report.transliterated.length} names transliterated between scripts`);
if (process.argv.includes('--verbose')) {
  for (const line of report.transliterated) console.log(`  translit  ${line}`);
  for (const line of report.droppedAliases) console.log(`  dropped   ${line}`);
} else {
  console.log(`${report.droppedAliases.length} aliases dropped as ambiguous (--verbose lists them)`);
}
