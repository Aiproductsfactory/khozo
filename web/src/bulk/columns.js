// Which spreadsheet column holds which case field.
//
// Registers arrive with headers in English, Gujarati, Hindi or Marathi, typed
// by hand ("અ..નં", "ઉ.વ", "Sr. No.", "उम्र") — so headers are compared after
// dropping spaces, dots and case, first exactly, then by containment. A few
// columns are recognised by their contents when the header says nothing (the
// Gujarat register's police-station key column is headed "a").
import { GUJARAT_STATIONS } from './gujaratRegister.js';

const msg = (text) => text; // marks a label for translation (see i18n.jsx)

/** Case fields a column can be mapped to, in the order the mapping row shows them. */
export const FIELDS = [
  { id: 'serial', label: msg('Serial / ID') },
  { id: 'name', label: msg('Name'), required: true },
  { id: 'gender', label: msg('Gender') },
  { id: 'age', label: msg('Age') },
  { id: 'dateMissing', label: msg('Date missing'), required: true },
  { id: 'station', label: msg('Police station') },
  { id: 'reference', label: msg('FIR / diary reference') },
  { id: 'reason', label: msg('Reason / circumstances') },
  { id: 'complainant', label: msg('Complainant / guardian') },
  { id: 'phone', label: msg('Mobile no.') },
  { id: 'address', label: msg('Address') },
  { id: 'year', label: msg('Year') },
  { id: 'state', label: msg('State') },
  { id: 'district', label: msg('District') },
  { id: 'identificationMark', label: msg('Identification mark') },
  { id: 'clothing', label: msg('Clothing when last seen') },
  { id: 'height', label: msg('Height (cm)') },
  { id: 'returnedDate', label: msg('Date traced / returned') },
  { id: 'notes', label: msg('Notes') },
];

/** The Khozo template's own headers (and the blank CSV the page offers). */
export const TEMPLATE_HEADERS = {
  serial: 'Serial',
  name: 'Name',
  gender: 'Gender',
  age: 'Age',
  dateMissing: 'Date missing',
  station: 'Police station',
  reference: 'FIR / reference no.',
  reason: 'Reason / circumstances',
  complainant: 'Guardian / complainant',
  phone: 'Guardian mobile',
  address: 'Address',
  state: 'State',
  district: 'District',
  identificationMark: 'Identification mark',
  clothing: 'Clothing when last seen',
  height: 'Height (cm)',
  notes: 'Notes',
};

const SYNONYMS = {
  serial: [
    'serial', 'serialno', 'sr', 'srno', 'sno', 'slno', 'no', 'id', 'caseid', 'recordid', 'rowid', 'sn',
    'અનં', 'અનુનં', 'ક્રમ', 'ક્રમાંક', 'અનુક્રમ', 'અનુક્રમાંક', 'ક્રમનં',
    'क्रमांक', 'क्र', 'क्रसं', 'क्रमसंख्या', 'अनुक्रमांक', 'अक्र', 'अनुक्र', 'क्रमांकनं',
  ],
  name: [
    'name', 'childname', 'nameofchild', 'nameofthechild', 'missingpersonname', 'nameofmissingperson', 'fullname', 'personname',
    'નામ', 'બાળકનુંનામ', 'બાળકનુનામ', 'ગુમથનારનુંનામ', 'ગુમથનારનુનામ', 'ગુમથયેલનુંનામ',
    'नाम', 'बच्चेकानाम', 'लापताकानाम', 'लापताव्यक्तिकानाम', 'नाव', 'मुलाचेनाव', 'हरवलेल्याव्यक्तीचेनाव', 'हरवलेल्याचेनाव',
  ],
  gender: [
    'gender', 'sex', 'જાતી', 'જાતિ', 'લિંગ', 'जेंडर', 'लिंग',
  ],
  age: [
    'age', 'ageyears', 'ageinyears', 'ageatmissing', 'ageyrs',
    'ઉવ', 'ઉંમર', 'ઉમર', 'વય', 'ઉંમરવર્ષ',
    'आयु', 'उम्र', 'उम्रवर्ष', 'वय', 'वयवर्ष',
  ],
  dateMissing: [
    'datemissing', 'dateofmissing', 'missingdate', 'missingsince', 'dateoflastseen', 'lastseendate', 'lastseen', 'datemissingfrom', 'date',
    'ગુમથયાતારીખ', 'ગુમથયાનીતારીખ', 'ગુમતારીખ', 'ગુમથયાતા', 'ગુમથયાતારીખસમય', 'તારીખ',
    'गुमशुदगीकीतारीख', 'लापताहोनेकीतारीख', 'लापतातिथि', 'गुमहोनेकीतारीख', 'हरवल्याचीतारीख', 'हरवल्याचादिनांक', 'दिनांक', 'तारीख',
  ],
  station: [
    'policestation', 'ps', 'station', 'thana', 'policestationname', 'psname',
    'પોલીસસ્ટેશન', 'પોસ્ટે', 'પોલીસસ્ટેશનનુંનામ', 'પોલીસસ્ટેશનનુનામ',
    'पुलिसथाना', 'थाना', 'पुलिसस्टेशन', 'पोलीसठाणे', 'पोलीसस्टेशन', 'ठाणे',
  ],
  reference: [
    'fir', 'firno', 'firnumber', 'firreference', 'firreferenceno', 'gdno', 'ddno', 'caseno', 'casenumber', 'crimeno', 'referenceno', 'reference', 'firdate',
    'પોલીસસ્ટેશનનુનામદાખલથયેલગુરનંજાજોગનંતારીખ', 'ગુરનં', 'જાજોગ', 'જાજોગનં', 'ગુરનંજાજોગનં', 'ફગુરનં', 'ગુનોરજીનં',
    'एफआईआर', 'एफआईआरसं', 'प्राथमिकीसं', 'प्राथमिकी', 'गुरनं', 'गुन्हारजिस्टरनंबर', 'एफआयआर', 'गुन्हाक्र',
  ],
  reason: [
    'reason', 'reasonformissing', 'reasonofmissing', 'circumstances', 'reasoncircumstances', 'cause',
    'ગુમથવાનુકારણ', 'ગુમથવાનુંકારણ', 'કારણ',
    'कारण', 'गुमहोनेकाकारण', 'लापताहोनेकाकारण', 'हरवण्याचेकारण',
  ],
  complainant: [
    'complainant', 'informant', 'reportedby', 'parentname', 'guardianname', 'guardian', 'guardiancomplainant', 'fathername', 'fathersname', 'parent',
    'જાહેરકરનારનુનામસરનામુ', 'જાહેરકરનારનુંનામ', 'જાહેરકરનાર', 'ફરિયાદી', 'ફરીયાદી', 'વાલી', 'પિતાનુંનામ',
    'शिकायतकर्ता', 'सूचक', 'पिताकानाम', 'अभिभावक', 'तक्रारदार', 'वडिलांचेनाव', 'पालक', 'पालकाचेनाव',
  ],
  phone: [
    'mobile', 'mobileno', 'phone', 'phoneno', 'contact', 'contactno', 'guardianmobile', 'contactnumber', 'mobilenumber',
    'મોબાઇલ', 'મોબાઈલ', 'મોબાઇલનં', 'ફોન', 'ફોનનં', 'સંપર્ક',
    'मोबाइल', 'मोबाइलनं', 'फ़ोन', 'फोन', 'संपर्क', 'मोबाईल', 'मोबाईलक्र',
  ],
  address: [
    'address', 'residence', 'residentialaddress', 'permanentaddress',
    'સરનામું', 'સરનામુ', 'રહેઠાણ',
    'पता', 'निवास', 'पत्ता',
  ],
  year: ['year', 'વર્ષ', 'वर्ष', 'साल'],
  state: ['state', 'રાજ્ય', 'राज्य'],
  district: ['district', 'જિલ્લો', 'જીલ્લો', 'जिला', 'जिल्हा'],
  identificationMark: ['identificationmark', 'identificationmarks', 'identification', 'mark', 'ઓળખચિહ્ન', 'ઓળખ', 'पहचानचिह्न', 'पहचान', 'ओळखखूण'],
  clothing: ['clothing', 'clothes', 'dress', 'clothingwhenlastseen', 'કપડાં', 'પહેરવેશ', 'कपड़े', 'कपडे', 'पोशाख'],
  height: ['height', 'heightcm', 'ઊંચાઈ', 'ઉંચાઈ', 'ऊंचाई', 'लंबाई', 'उंची'],
  returnedDate: ['returneddate', 'datereturned', 'traceddate', 'datetraced', 'founddate', 'datefound', 'પરતમળ્યાતારીખ', 'પરતમળ્યા', 'बरामदगीकीतारीख', 'मिळाल्याचीतारीख'],
  notes: ['notes', 'note', 'remarks', 'remark', 'description', 'નોંધ', 'રીમાર્ક', 'રિમાર્ક', 'टिप्पणी', 'विवरण', 'शेरा'],
};

/** A header with spaces, dots and punctuation removed, lower-cased. */
export function normHeader(text) {
  return String(text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s.,:;'"`’()[\]{}\-–_/\\|#*?]+/g, '');
}

const NORMALISED = Object.fromEntries(Object.entries(SYNONYMS).map(([f, list]) => [f, [...new Set(list.map(normHeader))]]));
for (const [f, h] of Object.entries(TEMPLATE_HEADERS)) NORMALISED[f].push(normHeader(h));

/** How well a header names a field: 100 exact, 10 + length for containment, 0 none. */
export function headerScore(header, field) {
  const h = normHeader(header);
  if (!h) return 0;
  let best = 0;
  for (const s of NORMALISED[field] || []) {
    if (h === s) return 100;
    // Short synonyms ("no", "ps", "sr") only count as whole headers.
    if (s.length >= 3 && h.includes(s)) best = Math.max(best, 10 + s.length);
  }
  return best;
}

/**
 * Maps header texts (index = column) to fields: { field: columnIndex }.
 * Highest-scoring pairs win; each column and each field is used once.
 */
export function detectColumns(headers) {
  const pairs = [];
  headers.forEach((h, col) => {
    for (const f of Object.keys(SYNONYMS)) {
      const score = headerScore(h, f);
      if (score) pairs.push({ col, field: f, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score || a.col - b.col);
  const mapping = {};
  const usedCols = new Set();
  for (const p of pairs) {
    if (mapping[p.field] != null || usedCols.has(p.col)) continue;
    mapping[p.field] = p.col;
    usedCols.add(p.col);
  }
  return mapping;
}

/** Index of the row (within the first rows given) that looks most like a header row. */
export function findHeaderRow(rowsOfText) {
  let best = { index: 0, matches: 0 };
  rowsOfText.forEach((cells, index) => {
    const matched = new Set();
    for (const h of cells) {
      for (const f of Object.keys(SYNONYMS)) if (headerScore(h, f) >= 13) matched.add(f);
    }
    if (matched.size > best.matches) best = { index, matches: matched.size };
  });
  return best.matches >= 2 ? best.index : 0;
}

const GENDER_WORD = /^(છોકરી|છોકરો|girl|boy|male|female|m|f|પુરુષ|સ્ત્રી|लड़की|लड़का|लडकी|लडका|पुरुष|महिला|स्त्री|मुलगी|मुलगा)(?![A-Za-z])/i;

/**
 * Fills fields the headers did not name, from what the columns contain:
 * the Gujarat police-station keys, a year column, a gender column.
 * `columns` is [{ col, header, values: [text...] }].
 */
export function detectByContent(columns, mapping) {
  const out = { ...mapping };
  const used = new Set(Object.values(out));
  const free = columns.filter((c) => !used.has(c.col));
  const share = (values, test) => {
    const filled = values.filter((v) => String(v ?? '').trim() !== '');
    return filled.length ? filled.filter(test).length / filled.length : 0;
  };
  const take = (field, test, threshold) => {
    if (out[field] != null) return;
    const hit = free.find((c) => !used.has(c.col) && share(c.values, test) >= threshold);
    if (hit) {
      out[field] = hit.col;
      used.add(hit.col);
    }
  };
  take('station', (v) => Boolean(GUJARAT_STATIONS[String(v).trim().toLowerCase()]), 0.5);
  take('year', (v) => /^\s*(19[5-9]\d|20\d\d)(\.0+)?\s*$/.test(String(v)), 0.8);
  take('gender', (v) => GENDER_WORD.test(String(v).trim()), 0.6);
  return out;
}
