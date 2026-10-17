// Reads an .xlsx workbook directly from its zip parts.
//
// Spreadsheet libraries flatten a cell to its text and drop the font of each
// rich-text run. The Gujarat registers need that font: a cell can mix Unicode
// Gujarati (Shruti) with text typed in the legacy Vakil_01 font, and only the
// Vakil runs may be converted. So the sheet XML, shared strings and styles are
// read here run by run, and embedded photos are placed from the drawing
// anchors (see anchors.js).
import { unzipSync, strFromU8 } from 'fflate';
import { parseXml, attr, child, childrenOf, descendants } from './xml.js';
import { anchorBox, rowGeometry, centreRow } from './anchors.js';

// ------------------------------------------------------------------ paths

function dirOf(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

/** Resolves a relationship target against the folder of the part that owns it. */
export function resolvePart(baseDir, target) {
  if (!target) return '';
  if (target.startsWith('/')) return target.slice(1);
  const parts = (baseDir ? `${baseDir}/${target}` : target).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

function relsPathFor(part) {
  const d = dirOf(part);
  const f = part.slice(d.length ? d.length + 1 : 0);
  return `${d ? `${d}/` : ''}_rels/${f}.rels`;
}

/** { rId: { target (resolved), type, external } } for one part. */
function readRels(files, part) {
  const xml = files[relsPathFor(part)];
  if (!xml) return {};
  const out = {};
  for (const r of descendants(parseXml(strFromU8(xml)), 'Relationship')) {
    const external = r.attrs.TargetMode === 'External';
    out[r.attrs.Id] = {
      target: external ? r.attrs.Target : resolvePart(dirOf(part), r.attrs.Target),
      type: String(r.attrs.Type || '').split('/').pop(),
      external,
    };
  }
  return out;
}

// ------------------------------------------------------------------ styles

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** True when an Excel number format shows a date or time. */
export function isDateFormatCode(code) {
  if (!code) return false;
  const s = String(code)
    .split(';')[0]
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, '');
  return /[dmyhs]/i.test(s) && !/^(general|@)$/i.test(s.trim());
}

function readStyles(files, part) {
  const xml = part && files[part];
  if (!xml) return { xfFont: [], xfDate: [] };
  const root = parseXml(strFromU8(xml));
  const sheet = child(root, 'styleSheet');
  const numFmts = {};
  for (const f of childrenOf(child(sheet, 'numFmts'), 'numFmt')) numFmts[Number(f.attrs.numFmtId)] = f.attrs.formatCode;
  const fonts = childrenOf(child(sheet, 'fonts'), 'font').map((f) => attr(child(f, 'name'), 'val') || null);
  const xfs = childrenOf(child(sheet, 'cellXfs'), 'xf');
  return {
    xfFont: xfs.map((x) => fonts[Number(x.attrs.fontId || 0)] || null),
    xfDate: xfs.map((x) => {
      const id = Number(x.attrs.numFmtId || 0);
      return BUILTIN_DATE_FORMATS.has(id) || isDateFormatCode(numFmts[id]);
    }),
  };
}

// ------------------------------------------------------------------ shared strings

/** A string item as runs: [{ font, text }]; font null means "the cell's own font". */
function readRuns(si) {
  const runs = [];
  for (const node of si.children) {
    if (node.name === 't') runs.push({ font: null, text: node.text });
    else if (node.name === 'r') {
      const rPr = child(node, 'rPr');
      const font = attr(child(rPr, 'rFont'), 'val') || null;
      const text = childrenOf(node, 't').map((t) => t.text).join('');
      runs.push({ font, text });
    }
    // rPh (phonetic hints) and phoneticPr are not part of the value.
  }
  return runs;
}

function readSharedStrings(files, part) {
  const xml = part && files[part];
  if (!xml) return [];
  const sst = child(parseXml(strFromU8(xml)), 'sst');
  return childrenOf(sst, 'si').map(readRuns);
}

// ------------------------------------------------------------------ cells

export function colIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function colLetters(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * One cell: { row, col, type, value, runs, font, isDate }.
 * `runs` is set for text; `value` for numbers and booleans.
 */
function readCell(c, rowNumber, nextCol, wb) {
  const ref = c.attrs.r;
  let col = nextCol;
  if (ref) {
    const m = /^([A-Z]+)(\d+)$/i.exec(ref);
    if (m) col = colIndex(m[1]);
  }
  const style = Number(c.attrs.s || 0);
  const font = wb.styles.xfFont[style] || null;
  const isDateStyle = Boolean(wb.styles.xfDate[style]);
  const t = c.attrs.t || 'n';
  const v = child(c, 'v');
  const cell = { row: rowNumber, col, type: t, value: null, runs: null, font, isDate: false };
  if (t === 's') {
    cell.runs = wb.sharedStrings[Number(v?.text)] || [];
    cell.type = 'text';
  } else if (t === 'inlineStr') {
    const is = child(c, 'is');
    cell.runs = is ? readRuns(is) : [];
    cell.type = 'text';
  } else if (t === 'str' || t === 'e') {
    cell.runs = [{ font: null, text: v?.text || '' }];
    cell.type = 'text';
  } else if (t === 'b') {
    cell.value = v?.text === '1';
    cell.type = 'bool';
  } else if (t === 'd') {
    cell.runs = [{ font: null, text: v?.text || '' }];
    cell.type = 'text';
    cell.isDate = true;
  } else {
    if (!v || v.text === '') return null;
    const n = Number(v.text);
    if (!Number.isFinite(n)) return null;
    cell.value = n;
    cell.type = 'number';
    cell.isDate = isDateStyle;
  }
  return cell;
}

// ------------------------------------------------------------------ workbook

const isMedia = (name) => /^xl\/media\//i.test(name) || /\.(png|jpe?g|gif|bmp|emf|wmf|tiff?|webp)$/i.test(name);

/**
 * Opens a workbook. Only the XML parts are inflated here; photos are inflated
 * on demand by loadMedia, so a 40 MB register opens quickly.
 */
export function openWorkbook(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let files;
  try {
    files = unzipSync(data, { filter: (f) => !isMedia(f.name) && !/\.bin$/i.test(f.name) });
  } catch {
    throw new Error('not-a-zip');
  }
  const wbPart = 'xl/workbook.xml';
  if (!files[wbPart]) throw new Error('not-a-workbook');
  const rels = readRels(files, wbPart);
  const relOfType = (type) => Object.values(rels).find((r) => r.type === type)?.target;
  const wb = {
    data,
    files,
    styles: readStyles(files, relOfType('styles')),
    sharedStrings: readSharedStrings(files, relOfType('sharedStrings')),
    sheets: [],
  };
  const root = parseXml(strFromU8(files[wbPart]));
  for (const s of descendants(root, 'sheet')) {
    const rel = rels[attr(s, 'id')];
    if (!rel || rel.type !== 'worksheet') continue;
    wb.sheets.push({ name: s.attrs.name, part: rel.target, hidden: s.attrs.state === 'hidden' || s.attrs.state === 'veryHidden' });
  }
  return wb;
}

/**
 * Reads one worksheet: cells by row, the row geometry, and every embedded
 * picture with the sheet row its anchor centre falls in.
 */
export function readSheet(wb, index = 0) {
  const sheet = wb.sheets[index];
  if (!sheet) throw new Error('no-sheet');
  const xml = wb.files[sheet.part];
  if (!xml) throw new Error('no-sheet');
  const root = parseXml(strFromU8(xml));
  const ws = child(root, 'worksheet');
  const fmt = child(ws, 'sheetFormatPr');
  const defaultHeight = Number(fmt?.attrs.defaultRowHeight) || 15;
  const heights = new Map();
  const rows = new Map();
  let maxRow = 0;
  let maxCol = -1;
  let nextRow = 1;
  for (const r of childrenOf(child(ws, 'sheetData'), 'row')) {
    const rowNumber = Number(r.attrs.r) || nextRow;
    nextRow = rowNumber + 1;
    if (r.attrs.hidden === '1' || r.attrs.hidden === 'true') heights.set(rowNumber, 0);
    else if (r.attrs.ht) heights.set(rowNumber, Number(r.attrs.ht));
    const cells = new Map();
    let nextCol = 0;
    for (const c of childrenOf(r, 'c')) {
      const cell = readCell(c, rowNumber, nextCol, wb);
      if (!cell) {
        const m = /^([A-Z]+)/i.exec(c.attrs.r || '');
        nextCol = (m ? colIndex(m[1]) : nextCol) + 1;
        continue;
      }
      nextCol = cell.col + 1;
      cells.set(cell.col, cell);
      if (cell.col > maxCol) maxCol = cell.col;
    }
    if (cells.size) {
      rows.set(rowNumber, cells);
      if (rowNumber > maxRow) maxRow = rowNumber;
    }
  }
  const geometry = rowGeometry(heights, defaultHeight);
  const images = readSheetImages(wb, sheet.part, root, geometry);
  return { name: sheet.name, rows, maxRow, maxCol, geometry, images };
}

function readSheetImages(wb, sheetPart, sheetRoot, geometry) {
  const rels = readRels(wb.files, sheetPart);
  const images = [];
  let order = 0;
  for (const d of descendants(sheetRoot, 'drawing')) {
    const rel = rels[attr(d, 'id')];
    if (!rel || rel.external || !wb.files[rel.target]) continue;
    const drawingRels = readRels(wb.files, rel.target);
    const drawing = parseXml(strFromU8(wb.files[rel.target]));
    for (const anchor of findAnchors(drawing)) {
      const box = anchorBox(anchor, geometry);
      if (!box) continue;
      const seen = new Set();
      for (const blip of descendants(anchor, 'blip')) {
        const id = attr(blip, 'embed');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const media = drawingRels[id];
        if (!media || media.external) continue;
        // The picture's own size (spPr/xfrm/ext) ranks several photos in one row.
        const pic = findPicFor(anchor, blip);
        const ext = pic ? descendants(child(pic, 'spPr'), 'ext')[0] : null;
        const area = ext ? Number(ext.attrs.cx || 0) * Number(ext.attrs.cy || 0) : box.height;
        images.push({
          media: media.target,
          ext: media.target.split('.').pop().toLowerCase(),
          top: box.top,
          bottom: box.bottom,
          fromRow: box.fromRow,
          sheetRow: centreRow(box, geometry),
          area,
          order: order++,
        });
      }
    }
  }
  return images;
}

function findAnchors(node, out = []) {
  for (const c of node.children) {
    if (c.name === 'twoCellAnchor' || c.name === 'oneCellAnchor' || c.name === 'absoluteAnchor') out.push(c);
    else findAnchors(c, out);
  }
  return out;
}

function findPicFor(anchor, blip) {
  for (const pic of descendants(anchor, 'pic')) if (descendants(pic, 'blip').includes(blip)) return pic;
  return null;
}

/** Inflates the named media parts: { path: Uint8Array }. */
export function loadMedia(wb, paths) {
  const want = new Set(paths);
  if (!want.size) return {};
  return unzipSync(wb.data, { filter: (f) => want.has(f.name) });
}
