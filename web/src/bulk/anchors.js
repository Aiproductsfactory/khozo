// Which sheet row an embedded picture belongs to.
//
// A picture's drawing anchor records the cell its top-left corner sits in.
// Registers are typed by hand, and a photo is often dragged so its top edge
// rests on the bottom border of the row above: the anchor then says "row 16"
// for a photo that visibly fills row 17. Using the centre of the anchor box
// puts every such photo in the row it covers. Measured in EMU (English Metric
// Units, 12700 per point) so rows of different heights are handled exactly.
import { child } from './xml.js';

export const EMU_PER_PT = 12700;

/**
 * Row geometry from the sheet's custom row heights (points, keyed by 1-based
 * row number; 0 for a hidden row) and its default row height.
 */
export function rowGeometry(heights = new Map(), defaultHeight = 15) {
  const def = defaultHeight * EMU_PER_PT;
  const custom = [...heights.entries()].sort((a, b) => a[0] - b[0]);
  const heightOf = (row) => (heights.has(row) ? heights.get(row) * EMU_PER_PT : def);
  /** EMU from the top of the sheet to the top of a 1-based row. */
  const topOf = (row) => {
    let t = (row - 1) * def;
    for (const [r, h] of custom) {
      if (r >= row) break;
      t += h * EMU_PER_PT - def;
    }
    return t;
  };
  /** The 1-based row that contains the vertical position y (EMU). */
  const rowAt = (y) => {
    if (y <= 0) return 1;
    let lo = 1;
    let hi = 1048576;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (topOf(mid) <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  return { heightOf, topOf, rowAt };
}

/**
 * The vertical extent of an anchor given as plain data:
 *   { kind: 'twoCell', from: { row, rowOff }, to: { row, rowOff } }
 *   { kind: 'oneCell', from: { row, rowOff }, ext: { cy } }
 *   { kind: 'absolute', pos: { y }, ext: { cy } }
 * Rows are 0-based, as in the drawing XML. Returns { top, bottom, fromRow }
 * in EMU, with fromRow 1-based.
 */
export function boxFromAnchor(a, geometry) {
  if (a.kind === 'absolute') {
    const top = Number(a.pos?.y) || 0;
    const bottom = top + (Number(a.ext?.cy) || 0);
    return { top, bottom, fromRow: geometry.rowAt(top) };
  }
  if (!a.from) return null;
  const top = geometry.topOf(a.from.row + 1) + (a.from.rowOff || 0);
  let bottom;
  if (a.kind === 'twoCell' && a.to) bottom = geometry.topOf(a.to.row + 1) + (a.to.rowOff || 0);
  else bottom = top + (Number(a.ext?.cy) || 0);
  return { top, bottom: Math.max(top, bottom), fromRow: a.from.row + 1 };
}

/** The 1-based sheet row that holds the vertical centre of the box. */
export function centreRow(box, geometry) {
  return geometry.rowAt((box.top + box.bottom) / 2);
}

const num = (node, name) => Number(child(node, name)?.text || 0);
const marker = (node) => (node ? { row: num(node, 'row'), rowOff: num(node, 'rowOff') } : null);

/** anchorBox for a parsed <xdr:*Anchor> element. */
export function anchorBox(anchor, geometry) {
  const ext = child(anchor, 'ext');
  const pos = child(anchor, 'pos');
  const plain = {
    kind: anchor.name === 'twoCellAnchor' ? 'twoCell' : anchor.name === 'oneCellAnchor' ? 'oneCell' : 'absolute',
    from: marker(child(anchor, 'from')),
    to: marker(child(anchor, 'to')),
    ext: ext ? { cy: Number(ext.attrs.cy || 0) } : null,
    pos: pos ? { y: Number(pos.attrs.y || 0) } : null,
  };
  return boxFromAnchor(plain, geometry);
}
