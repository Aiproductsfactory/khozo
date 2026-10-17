// CSV in and out. Exports from portals arrive comma-, semicolon- or
// tab-separated, sometimes with a byte-order mark; the results file goes back
// out with a BOM so Excel shows Gujarati, Hindi and Marathi correctly.

/** Picks the delimiter that splits the first lines most consistently. */
export function sniffDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => splitLine(l, d).length);
    if (!counts.length || counts[0] < 2) continue;
    const same = counts.filter((c) => c === counts[0]).length;
    const score = same * 100 + counts[0];
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function splitLine(line, d) {
  return parseCsv(line, d)[0] || [];
}

/** RFC 4180 parsing: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text, delimiter) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const d = delimiter || sniffDelimiter(s);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') inQuotes = true;
    else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const needsQuotes = /[",\r\n;]/;
export function toCsv(rows) {
  const body = rows
    .map((r) => r.map((v) => {
      const s = v == null ? '' : String(v);
      return needsQuotes.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\r\n');
  return `﻿${body}\r\n`;
}

/** CSV rows as the same sheet shape readSheet returns, so one pipeline reads both. */
export function csvToSheet(rows, name = 'CSV') {
  const map = new Map();
  let maxCol = -1;
  rows.forEach((r, i) => {
    const cells = new Map();
    r.forEach((text, col) => {
      if (String(text).trim() === '') return;
      cells.set(col, { row: i + 1, col, type: 'text', value: null, runs: [{ font: null, text }], font: null, isDate: false });
      if (col > maxCol) maxCol = col;
    });
    if (cells.size) map.set(i + 1, cells);
  });
  return { name, rows: map, maxRow: rows.length, maxCol, geometry: null, images: [] };
}
