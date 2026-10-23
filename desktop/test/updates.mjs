/**
 * Checks Khozo Desktop's updates (app/updates.js) against a stand-in for
 * Khozo and a local file server: a newer version is offered, an older one
 * is not; the installer is fetched and checked against its SHA-256; a file
 * that does not match is deleted and never run; without a fingerprint
 * nothing is fetched.
 *
 *   cd desktop && node test/updates.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createUpdates, isNewer } from '../app/updates.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`);
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khozo-desktop-updates-'));

// The "installer": 3 MB of bytes, served whole or with one byte changed.
const installer = crypto.randomBytes(3 * 1024 * 1024);
const sha256 = crypto.createHash('sha256').update(installer).digest('hex');
const server = http.createServer((req, res) => {
  const body = req.url.includes('tampered') ? Buffer.concat([installer.subarray(0, 10), Buffer.from([installer[10] ^ 1]), installer.subarray(11)]) : installer;
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

console.log('Versions');
check('a newer version is newer', isNewer('0.2.3', '0.2.2') && isNewer('0.10.0', '0.9.9') && isNewer('1.0.0', '0.99.99'));
check('the same or an older one is not', !isNewer('0.2.2', '0.2.2') && !isNewer('0.2.1', '0.2.2') && !isNewer('', '0.2.2'));

const client = (latest) => ({ desktopVersion: async () => latest });
const launched = [];
const make = (latest) => createUpdates({ getClient: () => client(latest), currentVersion: '0.2.2', downloadsDir: tmp, launch: (file) => { launched.push(file); return { started: true }; } });

console.log('Offered, fetched, checked');
const none = make({ version: '0.2.2' });
check('the version this app already is, is not offered', (await none.check()) === null && none.view() === null);
const good = make({ version: '0.3.0', notes: 'Clearer wording', sha256, downloadUrl: `${base}/Khozo-Desktop-Setup-0.3.0.exe` });
await good.check();
check('a newer version is offered, with what changed', good.view()?.version === '0.3.0' && good.view().notes === 'Clearer wording' && good.view().stage === 'available' && good.view().canDownload === true);
await good.download();
const fetched = path.join(tmp, 'Khozo-Desktop-Setup-0.3.0.exe');
check('it is fetched and checked against its fingerprint', good.view().stage === 'ready' && fs.existsSync(fetched) && crypto.createHash('sha256').update(fs.readFileSync(fetched)).digest('hex') === sha256, JSON.stringify(good.view()));
good.install();
check('installing runs the checked file', launched.length === 1 && launched[0] === fetched);

console.log('Refused');
const bad = make({ version: '0.3.1', sha256, downloadUrl: `${base}/tampered/Khozo-Desktop-Setup-0.3.1.exe` });
await bad.check();
await bad.download();
check('a file that does not match its fingerprint is deleted and never run', bad.view().stage === 'failed' && /fingerprint does not match/.test(bad.view().error) && !fs.existsSync(path.join(tmp, 'Khozo-Desktop-Setup-0.3.1.exe')) && !fs.existsSync(path.join(tmp, 'Khozo-Desktop-Setup-0.3.1.exe.part')));
let refused = false;
try { bad.install(); } catch { refused = true; }
check('… and cannot be installed', refused && launched.length === 1);
const unchecked = make({ version: '0.3.2', downloadUrl: `${base}/Khozo-Desktop-Setup-0.3.2.exe` });
await unchecked.check();
let noFingerprint = null;
try { await unchecked.download(); } catch (err) { noFingerprint = err.message; }
check('without a fingerprint, nothing is fetched', unchecked.view().canDownload === false && /fingerprint/.test(noFingerprint || '') && !fs.existsSync(path.join(tmp, 'Khozo-Desktop-Setup-0.3.2.exe')));
const linkless = make({ version: '0.3.3', sha256 });
await linkless.check();
check('without a link, the officer is told to ask their nodal officer', linkless.view().canDownload === false);
const offline = createUpdates({ getClient: () => ({ desktopVersion: async () => { throw new Error('No connection'); } }), currentVersion: '0.2.2', downloadsDir: tmp, launch: () => {} });
check('with no connection, nothing is offered and nothing fails', (await offline.check()) === null);

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
