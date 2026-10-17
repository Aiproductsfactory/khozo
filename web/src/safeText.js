// Record fields rendered as text, whatever the database holds.
//
// React renders a string or a number, and throws on a plain object. Rows
// written by older imports and hand-edited records carry the odd object or
// array where a string belongs (a location saved as { lat, lng }, a note saved
// as { text }), and one such field used to blank the whole console. Every raw
// record field on screen goes through txt(): a string or a finite number comes
// back as text, anything else as ''.

export function txt(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** An array field, or [] when the record holds something else there. */
export function asList(value) {
  return Array.isArray(value) ? value : [];
}

/** A list of labels joined for display, skipping anything that is not text. */
export function txtList(value, separator = ', ') {
  return asList(value).map(txt).filter(Boolean).join(separator);
}
