/**
 * One way to compare mobile numbers, however people type them.
 *
 * The same Indian number arrives as "98765 43210", "+91 98765 43210",
 * "0098765 43210" or "919876543210": from the sign-up form, from a bulk sheet
 * that keeps the +91 (shared/bulk-accounts.js sheetPhone), from a phone's
 * contact list. Stripping non-digits alone leaves 919876543210 and 9876543210
 * as two different numbers, so an account could not be found by its own
 * number.
 *
 * Rule: digits only; then a 12-digit number starting 91, or an 11-digit
 * number starting 0, is its last ten digits. Any other length is kept as it
 * is, so a number from another country still compares with itself.
 */
export function normalisePhone(value) {
  const d = String(value || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return d;
}

/** Whether two stored or typed numbers are the same phone. */
export function samePhone(a, b) {
  const x = normalisePhone(a);
  const y = normalisePhone(b);
  return Boolean(x) && x === y;
}
