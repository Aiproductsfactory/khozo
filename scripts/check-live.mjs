/**
 * Read-only checks of a deployed Khozo, run after every deploy:
 *
 *   node scripts/check-live.mjs                 # https://khozo.org
 *   node scripts/check-live.mjs https://<worker>.workers.dev
 *
 * It only reads public pages and asks protected routes without a token, so it
 * changes nothing and needs no account. Each check says what it proves:
 *
 *   - the API answers (/api/health);
 *   - the bot check's state (/api/reports/public/human-check): on or off;
 *   - routes added in recent releases exist (a 401 means "here, but sign in";
 *     a 404 means the old code is still live);
 *   - the home page and the privacy page are served;
 *   - the home page's "How Khozo works" section is the current one (its
 *     words are in the page's script);
 *   - no photo is served without a token, and the public cannot list cases.
 */
import process from 'node:process';

const base = (process.argv[2] || 'https://khozo.org').replace(/\/+$/, '');
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push(ok);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function get(path, { json = false } = {}) {
  try {
    const res = await fetch(base + path, { redirect: 'follow', headers: { 'user-agent': 'khozo-check-live' } });
    const body = json ? await res.json().catch(() => null) : await res.text();
    return { status: res.status, body };
  } catch (error) {
    return { status: 0, body: null, error: String(error?.message || error) };
  }
}

console.log(`Khozo live checks: ${base}\n`);

const health = await get('/api/health', { json: true });
check('the API answers', health.status === 200 && health.body?.ok === true, `HTTP ${health.status}${health.error ? ` ${health.error}` : ''}`);

const human = await get('/api/reports/public/human-check', { json: true });
check('the bot check reports its state', human.status === 200, human.body ? (human.body.siteKey ? 'ON' : 'OFF (TURNSTILE_* not set)') : `HTTP ${human.status}`);

for (const [path, release] of [
  ['/api/reports/found/local-police', 'asking the police where a person was seen (out-of-area-sightings)'],
  ['/api/reports/found/all', 'the review queue'],
  ['/api/reports/found/station-alerts', 'sightings sent to the nearest station (station-alerts)'],
]) {
  const res = await get(path);
  check(`${release} is deployed`, res.status === 401 || res.status === 403, `GET ${path} → HTTP ${res.status}${res.status === 404 ? ' (old code is live)' : ''}`);
}

// Account activation (accounts from a sheet) is public, so it is asked with
// no code: the route answers "not a valid link", where old code answers that
// there is no such route. Nothing is changed either way.
try {
  const res = await fetch(`${base}/api/auth/activate/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'khozo-check-live' },
    body: JSON.stringify({ email: '', code: '' }),
  });
  const body = await res.json().catch(() => null);
  check('activation links for accounts from a sheet are deployed', body?.code === 'activation_invalid', `POST /api/auth/activate/check → HTTP ${res.status}${body?.code ? ` ${body.code}` : ' (old code is live)'}`);
} catch (error) {
  check('activation links for accounts from a sheet are deployed', false, String(error?.message || error));
}

const photo = await get('/api/reports/photo/does-not-exist');
check('no photo is served without a token', [401, 404].includes(photo.status), `HTTP ${photo.status}`);

const reports = await get('/api/reports');
check('the public cannot list cases', [401, 403].includes(reports.status), `GET /api/reports → HTTP ${reports.status}`);

const home = await get('/');
check('the home page is served', home.status === 200 && /<div id="root"/.test(home.body || ''), `HTTP ${home.status}`);
const privacy = await get('/privacy');
check('the privacy page is served', privacy.status === 200, `HTTP ${privacy.status}`);

// The home page is drawn by script: find the Landing chunk and read its words.
let landingText = '';
const entry = (home.body || '').match(/<script[^>]+src="([^"]+\/index-[^"]+\.js)"/)?.[1];
if (entry) {
  const main = await get(entry);
  const chunk = (main.body || '').match(/assets\/Landing-[A-Za-z0-9_-]+\.js/)?.[0];
  if (chunk) landingText = (await get(`/${chunk}`)).body || '';
}
check('the home page shows where a photo goes (current "How Khozo works")',
  landingText.includes('Only authorised officials see it from here') && landingText.includes('Your photo stays private'),
  landingText ? '' : 'could not find the home page script');

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
