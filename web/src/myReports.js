// The receipt numbers of sightings sent from this device, so a reporter can
// come back and check on them without having written the number down. Only
// the number, when it was sent and who was seen (child / woman / person) are
// kept — never the photo, the place or the reporter's details — and only in
// this browser. Every storage access is guarded: private mode, a full disk or
// blocked storage leaves the list empty rather than breaking the page.

const KEY = 'khozo.myReports';
const LIMIT = 20;

function read() {
  try {
    const rows = JSON.parse(window.localStorage.getItem(KEY) || '[]');
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r.id === 'string' && r.id) : [];
  } catch {
    return [];
  }
}

function write(rows) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, LIMIT)));
  } catch {
    // Storage unavailable: the receipt is still on screen to copy or share.
  }
}

/** Newest first. */
export function listReceipts() {
  return read().sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
}

export function saveReceipt({ id, at, personCategory } = {}) {
  if (!id || typeof id !== 'string') return listReceipts();
  const rows = read().filter((r) => r.id !== id);
  rows.unshift({ id, at: Number(at) || Date.now(), personCategory: personCategory || 'child' });
  write(rows);
  return listReceipts();
}

export function forgetReceipt(id) {
  write(read().filter((r) => r.id !== id));
  return listReceipts();
}

/** The page where a receipt is checked, with the number filled in. */
export function trackUrl(id) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/track-sighting?receipt=${encodeURIComponent(id)}`;
}

/** Copies text; falls back to a hidden field where the Clipboard API is missing. */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the older way
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}
