// From a parsed sheet to a proposed column mapping: where the header row is,
// what each header means, and which columns are recognised by their contents.
import { detectByContent, detectColumns, findHeaderRow } from './columns.js';
import { readCellValue } from './records.js';
import { isLegacyGujaratiFont } from './legacyGujarati.js';

/** The text of every cell in one row, indexed by column. */
export function rowTexts(sheet, rowNumber, legacy) {
  const out = [];
  const cells = sheet.rows.get(rowNumber);
  for (let col = 0; col <= sheet.maxCol; col++) out.push(cells ? readCellValue(cells.get(col), legacy).text.trim() : '');
  return out;
}

/** Header row, header texts and the proposed mapping for a sheet. */
export function detectLayout(sheet, legacy = {}) {
  const scan = [];
  for (let r = 1; r <= Math.min(15, sheet.maxRow); r++) scan.push(rowTexts(sheet, r, legacy));
  const headerRow = findHeaderRow(scan) + 1;
  const headers = rowTexts(sheet, headerRow, legacy);
  const columns = [];
  for (let col = 0; col <= sheet.maxCol; col++) {
    const values = [];
    for (let r = headerRow + 1; r <= Math.min(sheet.maxRow, headerRow + 300); r++) {
      const cell = sheet.rows.get(r)?.get(col);
      if (cell) values.push(readCellValue(cell, legacy).text);
    }
    columns.push({ col, header: headers[col], values });
  }
  const mapping = detectByContent(columns, detectColumns(headers));
  return { headerRow, headers, mapping };
}

/** True when any cell or run in the workbook is set in a legacy Gujarati font. */
export function usesLegacyFont(wb) {
  if (!wb) return false;
  if (wb.styles?.xfFont?.some(isLegacyGujaratiFont)) return true;
  return (wb.sharedStrings || []).some((runs) => runs.some((r) => isLegacyGujaratiFont(r.font)));
}
