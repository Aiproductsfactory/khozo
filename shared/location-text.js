/**
 * Latitude and longitude from what a person pastes or a sheet holds:
 * "23.0300, 72.6010", or a Google Maps link ("…/@23.0300,72.6010,17z",
 * "…?q=23.0300,72.6010"). Null when there is no such pair. Shared by the
 * console's station form and the accounts sheet (shared/bulk-accounts.js).
 */
export function parseLocation(value) {
  const m = /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/.exec(String(value ?? ''));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
