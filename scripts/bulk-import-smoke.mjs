/**
 * Checks the pure helpers behind the officer console's Bulk import page
 * (web/src/bulk/*): the legacy Gujarati font converter, header detection,
 * date parsing, the photo-anchor centre rule, the .xlsx reader on a workbook
 * built here in memory, CSV parsing, row records, duplicate handling and the
 * import loop against a fake API.
 *
 *   node scripts/bulk-import-smoke.mjs
 *
 * Every name and value below is made up. Real registers hold real children's
 * details and never belong in this repository.
 */
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { convertLegacyGujarati, looksLegacy, runsToText, isLegacyGujaratiFont } from '../web/src/bulk/legacyGujarati.js';
import { asciiDigits, findDate, fromExcelSerial, makeDate, parseMissingDate } from '../web/src/bulk/dates.js';
import { boxFromAnchor, centreRow, rowGeometry, EMU_PER_PT } from '../web/src/bulk/anchors.js';
import { detectByContent, detectColumns, findHeaderRow, normHeader } from '../web/src/bulk/columns.js';
import { openWorkbook, readSheet, loadMedia, isDateFormatCode, colIndex, colLetters } from '../web/src/bulk/xlsx.js';
import { parseCsv, toCsv, csvToSheet, sniffDelimiter } from '../web/src/bulk/csv.js';
import { detectLayout, usesLegacyFont } from '../web/src/bulk/prepare.js';
import { complainantName, phonesIn, referenceShort, splitName, stationFor, reasonInEnglish } from '../web/src/bulk/gujaratRegister.js';
import {
  assignPhotos, buildRecords, checkRecord, clearlyDifferent, matchesExisting, parseAge, parseGender, payloadFor, personCategoryFor, readCellValue,
} from '../web/src/bulk/records.js';
import { dibFromEmf, fitSize, isShadowStats, pixelStats } from '../web/src/bulk/photos.js';
import { buildForm, createControl, makeRequest, runImport } from '../web/src/bulk/importer.js';
import { transliterateGujarati } from '../web/src/bulk/translit.js';

let checks = 0;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const ok = (value, label) => {
  assert.ok(value, label);
  checks++;
};

// ------------------------------------------------------------------ legacy font

const LEGACY = [
  ['gaItabaona', 'ગીતાબેન'],
  ['maaohnaBaa[', 'મોહનભાઈ'],
  ['pTola', 'પટેલ'],
  ['Baa[', 'ભાઈ'],
  ['AolaIsaiba`j', 'એલીસબ્રિજ'],
  ['Samaa^', 'શર્મા'],
  ['kao[nao khyaa vagar', 'કોઈને કહ્યા વગર'],
  ['GaroqaI kao[nao khyaa vagar kyaaMk caalaI gayaola.', 'ઘરેથી કોઈને કહ્યા વગર કયાંક ચાલી ગયેલ.'],
  ['maaohna pTola rho. naraoDa', 'મોહન પટેલ રહે. નરોડા'],
  ['AaEama', 'આશ્રમ'],
  ['maM~I', 'મંત્રી'],
  ['AopaT^maonT', 'એપાર્ટમેન્ટ'],
  ['saaosaa.[sanapur', 'સોસા.ઈસનપુર'],
  ['baIÀ42Ê', 'બી/42,'],
  ['ivajya', 'વિજય'],
  ['saÀAao', 'સ/ઓ'],
  ['DaoÀAao', 'ડો/ઓ'],
  ['Warka', 'દ્વારકા'],
  ['p`saad', 'પ્રસાદ'],
  ['jyakuRYNa', 'જયકૃષ્ણ'],
  ['pdmaa', 'પદમા'],
];
for (const [src, want] of LEGACY) eq(convertLegacyGujarati(src), want, `legacy: ${src}`);
eq(convertLegacyGujarati('naama D/o maaohna'), 'નામ D/o મોહન', 'legacy: English D/o kept');
eq(convertLegacyGujarati('42/10'), '42/10', 'legacy: slash after a digit stays a slash');
eq(convertLegacyGujarati('જયોતી'), 'જયોતી', 'legacy: Unicode Gujarati passes through');
ok(isLegacyGujaratiFont('Vakil_01') && !isLegacyGujaratiFont('Shruti'), 'legacy: font names');
ok(looksLegacy('GaroqaI kao[nao khyaa vagar'), 'legacy heuristic: legacy text');
ok(!looksLegacy('Went out to play'), 'legacy heuristic: English');
ok(!looksLegacy('ઘરેથી'), 'legacy heuristic: Unicode');

// Font runs: only the Vakil run is converted; the Unicode run beside it is left alone.
{
  const r = runsToText([{ font: 'Shruti', text: 'નામ: ' }, { font: null, text: 'maaohna' }], 'Vakil_01');
  eq(r.text, 'નામ: મોહન', 'runs: mixed cell');
  ok(r.converted, 'runs: converted flag');
  const plain = runsToText([{ font: null, text: 'Aakash Patel' }], 'Calibri', { heuristic: false });
  eq(plain.text, 'Aakash Patel', 'runs: English untouched without the heuristic');
  ok(!plain.converted, 'runs: English not flagged');
  const off = runsToText([{ font: 'Vakil_01', text: 'maaohna' }], null, { convert: false });
  eq(off.text, 'maaohna', 'runs: conversion can be switched off');
}

eq(transliterateGujarati('ગીતાબેન મોહનભાઈ પટેલ'), 'Gitaben Mohanbhai Patel', 'transliteration');

// ------------------------------------------------------------------ dates

const NOW = { now: new Date('2026-10-16T00:00:00Z') };
eq(asciiDigits('૨૬/૦૧/૨૦૦૭'), '26/01/2007', 'dates: Gujarati digits');
eq(findDate('૨૬/૧/૨૦૦૭', NOW)?.date, '2007-01-26', 'dates: Gujarati dd/mm/yyyy');
eq(findDate('26.1.07', NOW)?.date, '2007-01-26', 'dates: dd.mm.yy');
eq(findDate('5-3-2010', NOW)?.date, '2010-03-05', 'dates: dd-mm-yyyy');
eq(findDate('2024-03-05', NOW)?.date, '2024-03-05', 'dates: ISO is not read as 24-03-05');
eq(findDate('05 Mar 2024', NOW)?.date, '2024-03-05', 'dates: day month-name year');
eq(findDate('March 5, 2024', NOW)?.date, '2024-03-05', 'dates: month-name day, year');
eq(findDate('૨૨૨/૫/૨૦૦૮', NOW)?.date, '2008-05-22', 'dates: stray extra digit');
eq(findDate('31/2/2010', NOW), null, 'dates: impossible date');
eq(makeDate(1, 1, '017', NOW), '2017-01-01', 'dates: three-digit year');
eq(makeDate(1, 1, '98', NOW), '1998-01-01', 'dates: two-digit year in the past century');
{
  const r = parseMissingDate({ text: 'તા.૫/૩/૨૦૧૦ ના રોજ સાંજના ૬ વાગે' }, NOW);
  eq(r.date, '2010-03-05', 'dates: તા. prefix');
  eq(r.time, 'સાંજના 6 વાગે', 'dates: time wording kept');
}
eq(parseMissingDate({ text: '2024-03-05T14:30:00' }, NOW), { date: '2024-03-05', time: '14:30', note: null }, 'dates: ISO datetime');
eq(parseMissingDate({ value: 39108, isDate: true }), { date: '2007-01-26', time: null, note: null }, 'dates: Excel date cell');
eq(parseMissingDate({ value: 39108.75, isDate: true }), { date: '2007-01-26', time: '18:00', note: null }, 'dates: Excel datetime cell');
eq(parseMissingDate({ value: 39108, isDate: false }), { date: '2007-01-26', time: null, note: 'serial' }, 'dates: serial stored as a plain number');
eq(parseMissingDate({ value: 17, isDate: false }).date, null, 'dates: a small number is not a date');
eq(fromExcelSerial(45658).date, '2025-01-01', 'dates: serial 45658');
eq(parseMissingDate({ text: '###########' }).date, null, 'dates: overflowed cell');

// ------------------------------------------------------------------ anchors

{
  const g = rowGeometry(new Map(), 62.25);
  const H = 62.25 * EMU_PER_PT;
  // Photo whose top edge rests at the bottom of sheet row 16 and that fills row 17.
  const box = boxFromAnchor({ kind: 'twoCell', from: { row: 15, rowOff: Math.round(H * 0.97) }, to: { row: 16, rowOff: Math.round(H * 0.9) } }, g);
  eq(box.fromRow, 16, 'anchor: top-left says row 16');
  eq(centreRow(box, g), 17, 'anchor: centre says row 17');
  const inside = boxFromAnchor({ kind: 'twoCell', from: { row: 4, rowOff: 10000 }, to: { row: 4, rowOff: 700000 } }, g);
  eq(centreRow(inside, g), 5, 'anchor: photo inside one row');
  const one = boxFromAnchor({ kind: 'oneCell', from: { row: 9, rowOff: 0 }, ext: { cy: Math.round(H * 0.8) } }, g);
  eq(centreRow(one, g), 10, 'anchor: one-cell anchor');
  const abs = boxFromAnchor({ kind: 'absolute', pos: { y: Math.round(H * 2.2) }, ext: { cy: Math.round(H * 0.5) } }, g);
  eq(centreRow(abs, g), 3, 'anchor: absolute anchor');
  // Uneven rows: row 2 is tall, row 3 hidden.
  const g2 = rowGeometry(new Map([[2, 100], [3, 0]]), 15);
  eq(g2.topOf(3), (15 + 100) * EMU_PER_PT, 'anchor: custom row heights');
  eq(g2.rowAt((15 + 100 + 5) * EMU_PER_PT), 4, 'anchor: hidden row skipped');
  const tall = boxFromAnchor({ kind: 'twoCell', from: { row: 1, rowOff: 0 }, to: { row: 1, rowOff: 90 * EMU_PER_PT } }, g2);
  eq(centreRow(tall, g2), 2, 'anchor: tall row');
}

// ------------------------------------------------------------------ headers

{
  const gujarat = ['a', 'અ..નં', 'નામ', 'જાતી', 'ઉ.વ', 'ગુમ થયા તારીખ ', 'ગુમ થવાનુ કારણ ', 'પોલીસ સ્ટેશન નુ નામ દાખલ થયેલ ગુ.ર.નં/જા.જોગ નં તારીખ ', 'જાહેર કરનારનુ નામ સરનામુ ', '0', 'પરત મળ્યા તારીખ '];
  const m = detectColumns(gujarat);
  eq(
    { serial: m.serial, name: m.name, gender: m.gender, age: m.age, dateMissing: m.dateMissing, reason: m.reason, reference: m.reference, complainant: m.complainant, returnedDate: m.returnedDate },
    { serial: 1, name: 2, gender: 3, age: 4, dateMissing: 5, reason: 6, reference: 7, complainant: 8, returnedDate: 10 },
    'headers: Gujarat Police register',
  );
  const content = detectByContent(
    [
      { col: 0, header: 'a', values: ['vatva', 'naroda', 'paldi', 'odhav'] },
      { col: 9, header: '0', values: ['2007', '2011', 2019, '2026'] },
    ],
    m,
  );
  eq([content.station, content.year], [0, 9], 'headers: station keys and year found by content');

  const english = detectColumns(['Sr. No.', 'Name of Child', 'Sex', 'Age (years)', 'Date of Missing', 'Police Station', 'FIR No.', 'Father Name', 'Mobile No', 'Address', 'District', 'State', 'Remarks']);
  eq(english, { serial: 0, name: 1, gender: 2, age: 3, dateMissing: 4, station: 5, reference: 6, complainant: 7, phone: 8, address: 9, district: 10, state: 11, notes: 12 }, 'headers: English portal export');

  const hindi = detectColumns(['क्रमांक', 'नाम', 'लिंग', 'उम्र', 'लापता होने की तारीख', 'थाना', 'एफआईआर सं.']);
  eq([hindi.serial, hindi.name, hindi.gender, hindi.age, hindi.dateMissing, hindi.station, hindi.reference], [0, 1, 2, 3, 4, 5, 6], 'headers: Hindi');
  const marathi = detectColumns(['अ.क्र.', 'नाव', 'लिंग', 'वय', 'हरवल्याची तारीख', 'पोलीस ठाणे', 'तक्रारदार']);
  eq([marathi.serial, marathi.name, marathi.gender, marathi.age, marathi.dateMissing, marathi.station, marathi.complainant], [0, 1, 2, 3, 4, 5, 6], 'headers: Marathi');
  const template = detectColumns(['Serial', 'Name', 'Gender', 'Age', 'Date missing', 'Police station', 'FIR / reference no.', 'Reason / circumstances', 'Guardian / complainant', 'Guardian mobile']);
  eq(Object.keys(template).length, 10, 'headers: Khozo template maps every column');
  eq(normHeader('અ..નં'), 'અનં', 'headers: normalisation');
  eq(findHeaderRow([['Missing children list'], [], ['S.No', 'Name', 'Age', 'Date missing']]), 2, 'headers: title rows above the header');
}

// ------------------------------------------------------------------ register cells

{
  eq(splitName('રમેશ સ/ઓ સુરેશભાઈ પટેલ રહે. 12, ગાંધી નગર'), { name: 'રમેશ સુરેશભાઈ પટેલ', rest: 'રહે. 12, ગાંધી નગર' }, 'split: રહે');
  eq(splitName('સીમા ડો/ઓ કાનજી ભાઈ મકવાણા ઉ.વ.૧૨').name, 'સીમા કાનજીભાઈ મકવાણા', 'split: age marker and "ભાઈ" joined');
  eq(splitName('રાજુ ભીખાભાઈ સોલંકી બી.13 શાંતિનગર સોસા').name, 'રાજુ ભીખાભાઈ સોલંકી', 'split: house number starts the address');
  eq(splitName('ગીતા મનુભાઈ જાતે.રાવળ મકાન નં-5').name, 'ગીતા મનુભાઈ રાવળ', 'split: જાતે closes the name');
  eq(splitName('Priya D/o Ramesh').name, 'Priya Ramesh', 'split: English relation marker');
  eq(splitName('Rahul Kumar').name, 'Rahul Kumar', 'split: plain English name');
  eq(referenceShort('વટવા જા.જોગ નં. ૧૨/૧૯ તા.૩/૪/૧૯', 'વટવા'), 'વટવા પો.સ્ટે. જા.જોગ નં. 12/19', 'reference: diary entry');
  eq(referenceShort('ગુ.ર.નં. ૫૮૨/૧૭', 'નરોડા'), 'નરોડા પો.સ્ટે. ફ.ગુ.ર.નં. 582/17', 'reference: FIR');
  eq(referenceShort('1119 1234 5678 90', 'પાલડી'), 'પાલડી પો.સ્ટે. ગુ.ર.નં. 11191234567890', 'reference: CCTNS number');
  eq(complainantName('મનુભાઈ પટેલ રહે. ગામ મો.નં. 9876543210'), 'મનુભાઈ પટેલ', 'complainant name');
  eq(phonesIn('મો. ૯૮૭૬૫૪૩૨૧૦', 'call +91 9123456780', 'x 9876543210'), ['9876543210', '9123456780'], 'phones');
  eq(stationFor('vatva'), { en: 'Vatva', gu: 'વટવા', key: 'vatva' }, 'station key');
  eq(stationFor('Andheri').en, 'Andheri', 'station: other names kept');
  eq(reasonInEnglish('ઘરેથી કોઈને કહ્યા વગર ચાલી ગયેલ'), 'Left without telling anyone', 'reason');
  eq([parseGender('છોકરી'), parseGender('છોકરો'), parseGender('F'), parseGender('Male'), parseGender('Female'), parseGender('मुलगी'), parseGender('?')], ['Female', 'Male', 'Female', 'Male', 'Female', 'Female', null], 'gender words');
  eq(parseAge({ value: 17.6, text: '17.6' }), { age: 17, fraction: true, raw: '17.6' }, 'age: years.months');
  eq(parseAge({ value: null, text: '૧૨ વર્ષ' }).age, 12, 'age: Gujarati digits with a unit');
  eq([personCategoryFor(12, 'Female'), personCategoryFor(19, 'Female'), personCategoryFor(30, 'Male'), personCategoryFor(null, 'Male')], ['child', 'woman', 'adult', 'child'], 'person category');
}

// ------------------------------------------------------------------ xlsx in memory

function buildWorkbook() {
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const xdr = 'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const strings = [
    '<si><t>a</t></si>',
    '<si><r><t>અ</t></r><r><rPr><rFont val="Calibri"/></rPr><t>..</t></r><r><rPr><rFont val="Shruti"/></rPr><t>નં</t></r></si>',
    '<si><t>નામ</t></si>', '<si><t>જાતી</t></si>', '<si><t>ઉ.વ</t></si>', '<si><t>ગુમ થયા તારીખ</t></si>',
    '<si><t>vatva</t></si>',
    // Name cell: a Unicode run, then a Vakil run.
    '<si><r><rPr><rFont val="Shruti"/></rPr><t xml:space="preserve">નામ: </t></r><r><rPr><rFont val="Vakil_01"/></rPr><t>maaohna pTola rho. naraoDa</t></r></si>',
    '<si><t>છોકરો</t></si>',
    '<si><t>naroda</t></si>',
    '<si><t>pTola</t></si>',
    '<si><t>તા.૫/૩/૨૦૧૦ ના રોજ</t></si>',
    '<si><t>છોકરી</t></si>',
  ];
  const sst = `<?xml version="1.0" encoding="UTF-8"?><sst ${ns} count="${strings.length}" uniqueCount="${strings.length}">${strings.join('')}</sst>`;
  const styles = `<?xml version="1.0"?><styleSheet ${ns}><numFmts count="1"><numFmt numFmtId="165" formatCode="[$-7000000]dd/mm/yyyy"/></numFmts>`
    + '<fonts count="3"><font><name val="Calibri"/></font><font><name val="Shruti"/></font><font><name val="Vakil_01"/></font></fonts>'
    + '<cellXfs count="3"><xf numFmtId="0" fontId="1"/><xf numFmtId="165" fontId="0"/><xf numFmtId="0" fontId="2"/></cellXfs></styleSheet>';
  const row = (r, cells) => `<row r="${r}" ht="62.25" customHeight="1">${cells}</row>`;
  const sheet = `<?xml version="1.0"?><worksheet ${ns}><sheetFormatPr defaultRowHeight="62.25"/><sheetData>`
    + row(1, '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c>')
    + row(2, '<c r="A2" t="s"><v>6</v></c><c r="B2"><v>1</v></c><c r="C2" t="s"><v>7</v></c><c r="D2" t="s"><v>8</v></c><c r="E2"><v>12</v></c><c r="F2" s="1"><v>39108</v></c>')
    // Row 3: the whole name cell is in the Vakil font (cell style), the date is text.
    + row(3, '<c r="A3" t="s"><v>9</v></c><c r="B3"><v>2</v></c><c r="C3" s="2" t="s"><v>10</v></c><c r="D3" t="s"><v>12</v></c><c r="E3"><v>9</v></c><c r="F3" t="s"><v>11</v></c>')
    + '</sheetData><drawing r:id="rId1"/></worksheet>';
  const H = Math.round(62.25 * EMU_PER_PT);
  const pic = (id, rid, cy) => `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="Picture ${id}"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${rid}"/></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="500000" cy="${cy}"/></a:xfrm></xdr:spPr></xdr:pic>`;
  // The photo for row 3 starts at the very bottom of row 2.
  const drawing = `<?xml version="1.0"?><xdr:wsDr ${xdr}>`
    + `<xdr:twoCellAnchor><xdr:from><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>${H - 9000}</xdr:rowOff></xdr:from><xdr:to><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>${H - 20000}</xdr:rowOff></xdr:to>${pic(2, 'rId1', H)}<xdr:clientData/></xdr:twoCellAnchor>`
    + '</xdr:wsDr>';
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook ${ns}><sheets><sheet name="Register" sheetId="1" r:id="rId1"/><sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
      + '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/sharedStrings.xml': sst,
    'xl/styles.xml': styles,
    'xl/worksheets/sheet1.xml': sheet,
    'xl/worksheets/sheet2.xml': `<?xml version="1.0"?><worksheet ${ns}><sheetData/></worksheet>`,
    'xl/worksheets/_rels/sheet1.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    'xl/drawings/drawing1.xml': drawing,
    'xl/drawings/_rels/drawing1.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',
  };
  const zipped = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]));
  zipped['xl/media/image1.png'] = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  return zipSync(zipped);
}

{
  const wb = openWorkbook(buildWorkbook());
  eq(wb.sheets.map((s) => [s.name, s.hidden]), [['Register', false], ['Hidden', true]], 'xlsx: sheets');
  ok(usesLegacyFont(wb), 'xlsx: legacy font noticed');
  const sheet = readSheet(wb, 0);
  eq([sheet.maxRow, sheet.maxCol, sheet.images.length], [3, 5, 1], 'xlsx: size and pictures');
  eq([sheet.images[0].fromRow, sheet.images[0].sheetRow], [2, 3], 'xlsx: photo placed by its centre, not its corner');
  ok(sheet.rows.get(2).get(5).isDate, 'xlsx: date-formatted cell recognised');
  eq(readCellValue(sheet.rows.get(2).get(5)).text, '2007-01-26', 'xlsx: a date cell reads as its date, not the serial');
  eq(Object.keys(loadMedia(wb, [sheet.images[0].media])), ['xl/media/image1.png'], 'xlsx: media inflated on demand');

  const legacy = { convert: true, heuristic: true };
  const layout = detectLayout(sheet, legacy);
  eq(layout.headerRow, 1, 'xlsx: header row');
  eq(layout.mapping, { serial: 1, name: 2, gender: 3, age: 4, dateMissing: 5, station: 0 }, 'xlsx: mapping');
  const recs = assignPhotos(buildRecords(sheet, { headerRow: 1, mapping: layout.mapping, preset: 'gujarat', legacy }), sheet.images);
  eq(recs.length, 2, 'records: two rows');
  eq([recs[0].name, recs[0].gender, recs[0].age, recs[0].dateOfMissing, recs[0].station.en], ['નામ: મોહન પટેલ', 'Male', 12, '2007-01-26', 'Vatva'], 'records: row 2');
  eq(recs[0].address, 'નરોડા', 'records: address after રહે');
  ok(recs[0].converted.name, 'records: converted marker on the name');
  eq([recs[1].name, recs[1].gender, recs[1].dateOfMissing], ['પટેલ', 'Female', '2010-03-05'], 'records: row 3 (cell-styled Vakil, text date)');
  eq([recs[0].photo, recs[1].photo?.media], [null, 'xl/media/image1.png'], 'records: photo goes to row 3');
  eq(checkRecord(recs[1]).status, 'ready', 'records: complete row is ready');
  eq(checkRecord(recs[0]).warnings.map((w) => w.code), ['no_photo'], 'records: missing photo is a warning');
  const noDate = { ...recs[1], dateOfMissing: null };
  eq(checkRecord(noDate).errors.map((e) => e.code), ['no_date'], 'records: missing date is an error');
}

// ------------------------------------------------------------------ CSV

{
  eq(sniffDelimiter('a;b;c\n1;2;3'), ';', 'csv: semicolon');
  const rows = parseCsv('﻿Serial,Name,Notes\r\n1,"Patel, Asha","said ""bye""\nthen left"\r\n2,Ravi,\r\n');
  eq(rows, [['Serial', 'Name', 'Notes'], ['1', 'Patel, Asha', 'said "bye"\nthen left'], ['2', 'Ravi', '']], 'csv: quotes, commas, newlines');
  eq(parseCsv(toCsv([['a,b', 'c"d', 'ગુજરાતી']])), [['a,b', 'c"d', 'ગુજરાતી']], 'csv: round trip');
  const sheet = csvToSheet(parseCsv('Serial,Name,Gender,Age,Date missing,Police station,FIR / reference no.\n7,Asha Patel,F,9,05/03/2024,Andheri,45/2024\n8,,M,10,,,\n'));
  const layout = detectLayout(sheet, {});
  const recs = assignPhotos(buildRecords(sheet, { headerRow: layout.headerRow, mapping: layout.mapping, preset: 'other' }), [], { files: [{ name: '007.JPG' }, { name: '8-2.jpg' }] });
  eq([recs[0].name, recs[0].gender, recs[0].dateOfMissing, recs[0].firNo, recs[0].photo?.file.name], ['Asha Patel', 'Female', '2024-03-05', '45/2024', '007.JPG'], 'csv: portal row with a loose photo');
  eq(checkRecord(recs[1]).errors.map((e) => e.code), ['no_name', 'no_date'], 'csv: incomplete row');
  eq(recs[1].photo?.file.name, '8-2.jpg', 'csv: loose photo with a suffix');
}

// ------------------------------------------------------------------ payload and duplicates

const officer = { id: 'u1', name: 'Test Officer', role: 'police', jurisdiction: { state: 'Gujarat', district: 'Ahmedabad' } };
const baseRec = {
  key: 'row-2', sheetRow: 2, serial: '5', nameCell: 'આશા રમેશભાઈ પટેલ', name: 'આશા રમેશભાઈ પટેલ', nameEn: 'Asha Rameshbhai Patel', gender: 'Female', age: 19,
  dateOfMissing: '2019-04-03', dateApproximate: false, dateRaw: '3/4/2019', time: null, station: { en: 'Vatva', gu: 'વટવા', key: 'vatva' },
  reference: 'જા.જોગ ૧૨/૧૯', firNo: 'વટવા પો.સ્ટે. જા.જોગ નં. 12/19', reason: 'કહ્યા વગર', reasonEn: 'Left without telling anyone', complainant: '', complainantName: null,
  phones: ['9876543210'], address: null, rowState: null, rowDistrict: null, identificationMark: null, clothing: null, height: null, returnedDate: null,
  extraNotes: null, converted: {}, notes: [], photo: null, photoAlternatives: [],
};
const batch = { state: 'Gujarat', district: 'Ahmedabad', restrictToPolice: true, sourceLabel: 'Bulk import (test) "test.xlsx"', user: officer };
const { fields, categories } = payloadFor(baseRec, batch);
eq([fields.visibility, fields.personCategory, fields.producedByType, fields.relationshipToChild, fields.state], ['police', 'woman', 'police', 'official', 'Gujarat'], 'payload: police-only, adult woman');
ok(fields.circumstances.includes('Police station: Vatva (વટવા).') && fields.circumstances.length <= 600, 'payload: circumstances');
eq(categories, ['unaccompanied'], 'payload: categories');
eq(payloadFor(baseRec, { ...batch, restrictToPolice: false }).fields.visibility, undefined, 'payload: restriction can be off');
ok(!('publish' in fields), 'payload: nothing is published');

const sameCase = { id: 'r_1', childName: 'આશા રમેશભાઈ પટેલ', dateOfMissing: '2019-04-03', firNo: 'વટવા પો.સ્ટે. જા.જોગ નં. 12/19', gender: 'Female' };
ok(matchesExisting(sameCase, baseRec, fields), 'idempotency: same name, date and reference');
ok(matchesExisting({ ...sameCase, firNo: 'X', vulnerabilityProfile: { circumstances: 'Police station: Vatva (વટવા).' } }, baseRec, fields), 'idempotency: same station in the notes');
ok(!matchesExisting({ ...sameCase, dateOfMissing: '2019-05-03' }, baseRec, fields), 'idempotency: other date');
const sibling = { id: 'r_2', childName: 'રવિ રમેશભાઈ પટેલ', dateOfMissing: '2018-01-01', gender: 'Male', parentPhone: '9000000000' };
ok(clearlyDifferent({ reportId: 'r_2' }, sibling, baseRec, fields), 'duplicates: a sibling is someone else');
ok(!clearlyDifferent({ reportId: 'r_3' }, { id: 'r_3', childName: 'આશા પટેલ', dateOfMissing: '2017-01-01', gender: 'Female' }, baseRec, fields), 'duplicates: same given name needs review');
ok(!clearlyDifferent({ reportId: 'r_4' }, { ...sibling, id: 'r_4', parentPhone: '9876543210' }, baseRec, fields), 'duplicates: shared phone needs review');
ok(!clearlyDifferent({ reportId: 'r_5' }, undefined, baseRec, fields), 'duplicates: a case we cannot see needs review');

// ------------------------------------------------------------------ import loop

{
  const fd = buildForm({ fields: { childName: 'A', age: '', gender: 'Male' }, categories: ['unaccompanied'] }, new Blob(['x'], { type: 'image/jpeg' }), { allowDuplicate: true, photoName: '1.jpg' });
  eq([fd.get('childName'), fd.has('age'), fd.get('allowDuplicate'), fd.get('photoConsent'), fd.getAll('vulnerabilityCategories')], ['A', false, 'true', 'true', ['unaccompanied']], 'form: fields as the CLI sends them');

  const existing = [{ ...sameCase }, { ...sibling }];
  const calls = [];
  let busy = 1;
  const fakeFetch = async (url, init) => {
    const path = url.replace('/api', '');
    const method = init.method || 'GET';
    const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
    if (method === 'GET' && path === '/reports') return json(200, { reports: existing });
    const form = init.body;
    const name = form.get('childName');
    calls.push({ name, allow: form.get('allowDuplicate') === 'true', visibility: form.get('visibility') });
    if (name === 'બીજલ રમેશભાઈ પટેલ' && busy-- > 0) return json(503, { error: 'busy' });
    if (form.get('allowDuplicate') !== 'true' && /પટેલ/.test(name)) {
      const dup = name.startsWith('આશા') ? { reportId: 'r_3', childName: 'આશા પટેલ', score: 0.7 } : { reportId: 'r_2', childName: sibling.childName, score: 0.66, gender: 'Male' };
      return json(409, { error: 'Possible duplicate case found', duplicateCandidates: [dup] });
    }
    const report = { id: `r_new${calls.length}`, childName: name, dateOfMissing: form.get('dateOfMissing'), firNo: form.get('firNo') };
    existing.push(report);
    return json(201, { report });
  };
  existing.push({ id: 'r_3', childName: 'આશા પટેલ', dateOfMissing: '2017-01-01', gender: 'Female' });
  const control = createControl();
  const fastSleep = () => Promise.resolve();
  const request = makeRequest({ fetchImpl: fakeFetch, sleep: fastSleep });
  const mk = (key, name, extra = {}) => {
    const rec = { ...baseRec, key, name, nameEn: null, ...extra };
    return { key, rec, ...payloadFor(rec, batch), photo: null, photoName: `${key}.jpg` };
  };
  const items = [
    mk('a', 'આશા રમેશભાઈ પટેલ'), // already in Khozo
    mk('b', 'બીજલ રમેશભાઈ પટેલ', { firNo: 'other-1', station: null }), // 503 once, then a sibling flagged: created with allowDuplicate
    mk('c', 'આશા રમેશભાઈ પટેલ', { dateOfMissing: '2020-01-01', firNo: 'other-2', station: null }), // same given name flagged: review
    mk('d', 'કિરણ મહેશભાઈ શાહ', { firNo: 'other-3', station: null }), // plain create
  ];
  const events = [];
  const results = await runImport({ items, request, control: { ...control, sleep: fastSleep, whilePaused: control.whilePaused, get cancelled() { return control.cancelled; } }, getPhoto: async () => null, delayMs: 0, onEvent: (e) => events.push(e.type) });
  eq(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.status])), { a: 'skipped', b: 'created', c: 'review', d: 'created' }, 'import: outcomes');
  ok(results.b.afterDuplicateWarning, 'import: sibling resubmitted with allowDuplicate');
  eq(results.c.candidates[0].reportId, 'r_3', 'import: review keeps the candidates');
  ok(calls.every((c) => c.visibility === 'police'), 'import: every row restricted to police');
  eq(calls.filter((c) => c.name === 'બીજલ રમેશભાઈ પટેલ').length, 3, 'import: 503 retried, 409 resolved');
  eq(events[events.length - 1], 'stopped', 'import: finishes');
  // A re-run skips everything already done.
  const again = await runImport({ items, request, control: { ...control, sleep: fastSleep, whilePaused: control.whilePaused, get cancelled() { return false; } }, getPhoto: async () => null, delayMs: 0, results: { ...results } });
  eq([again.a.status, again.b.status, again.d.status], ['skipped', 'created', 'created'], 'import: re-run keeps earlier results');

  // Cancel stops before the next row.
  const c2 = createControl();
  c2.cancel();
  const none = await runImport({ items: [mk('z', 'નવું નામ')], request, control: c2, getPhoto: async () => null, delayMs: 0 });
  eq(Object.keys(none), [], 'import: cancelled before the first row');
}

// ------------------------------------------------------------------ photos

{
  ok(isShadowStats({ byteLength: 900, maxRgb: 0, maxAlpha: 200 }), 'photos: black mask is a shadow');
  ok(isShadowStats({ byteLength: 900, maxRgb: 250, maxAlpha: 60 }), 'photos: faint mask is a shadow');
  ok(!isShadowStats({ byteLength: 900, maxRgb: 250, maxAlpha: 255 }), 'photos: small real picture kept');
  ok(!isShadowStats({ byteLength: 50000, maxRgb: 0, maxAlpha: 0 }), 'photos: large files are never shadows');
  eq(pixelStats(new Uint8ClampedArray([1, 2, 3, 4, 9, 8, 7, 6])), { maxRgb: 9, maxAlpha: 6 }, 'photos: pixel stats');
  eq(fitSize(1718, 2240), { width: 920, height: 1200 }, 'photos: fit to 1200');
  eq(fitSize(300, 200), { width: 300, height: 200 }, 'photos: small photos kept');

  // A minimal EMF: header record, one STRETCHDIBITS with a 2x2 32-bit bitmap, EOF.
  const bmi = 40;
  const bits = 16;
  const recSize = 80 + bmi + bits;
  const buf = new ArrayBuffer(88 + recSize + 20);
  const dv = new DataView(buf);
  dv.setUint32(0, 1, true);
  dv.setUint32(4, 88, true);
  let o = 88;
  dv.setUint32(o, 81, true);
  dv.setUint32(o + 4, recSize, true);
  dv.setUint32(o + 48, 80, true);
  dv.setUint32(o + 52, bmi, true);
  dv.setUint32(o + 56, 80 + bmi, true);
  dv.setUint32(o + 60, bits, true);
  const b = o + 80;
  dv.setUint32(b, 40, true);
  dv.setInt32(b + 4, 2, true);
  dv.setInt32(b + 8, 2, true);
  dv.setUint16(b + 12, 1, true);
  dv.setUint16(b + 14, 32, true);
  const px = b + bmi;
  // bottom-up: first stored row is the bottom row. BGRA.
  [[0, 0, 255, 0], [0, 255, 0, 0], [255, 0, 0, 0], [255, 255, 255, 0]].forEach((p, i) => p.forEach((v, k) => dv.setUint8(px + i * 4 + k, v)));
  o += recSize;
  dv.setUint32(o, 14, true);
  dv.setUint32(o + 4, 20, true);
  const dib = dibFromEmf(new Uint8Array(buf));
  eq([dib.width, dib.height, dib.bpp], [2, 2, 32], 'photos: EMF bitmap found');
  eq(Array.from(dib.rgba()), [0, 0, 255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255], 'photos: EMF pixels top-down RGBA');
  eq(dibFromEmf(new Uint8Array([1, 2, 3])), null, 'photos: not an EMF');
}

eq([colIndex('A'), colIndex('Z'), colIndex('AA'), colLetters(27)], [0, 25, 26, 'AB'], 'xlsx: column letters');
ok(isDateFormatCode('[$-7000000]dd/mm/yyyy') && !isDateFormatCode('[$-7000447]0.#') && !isDateFormatCode('0.00'), 'xlsx: date formats');

console.log(`Bulk import smoke checks passed (${checks} checks).`);
