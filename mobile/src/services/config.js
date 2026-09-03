/**
 * Where the app talks to, and the helplines it surfaces.
 *
 * The API address is fixed at build time rather than editable in the app. A
 * field build that can be pointed at an arbitrary host is a phishing surface:
 * anyone who can persuade an officer to change it collects sighting photos of
 * children and their sign-in credentials. Pilot builds that need a LAN backend
 * set KHOZO_API_URL at build time instead — see app.config.js.
 */
export const DEFAULT_API_URL = 'https://khozo.swastik-kumar.workers.dev';

export function getApiBaseUrl() {
  return DEFAULT_API_URL;
}

/** Helplines surfaced throughout the app. */
export const HELPLINES = [
  { id: 'childline', label: 'Childline', number: '1098', description: 'Child in distress — 24x7' },
  { id: 'emergency', label: 'Emergency', number: '112', description: 'Police / ambulance / fire' },
  { id: 'women', label: 'Women helpline', number: '181', description: 'Women in distress' },
];
