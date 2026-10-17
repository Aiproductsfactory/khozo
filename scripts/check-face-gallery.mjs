/**
 * Read-only check of an Aarakshak gallery key, before it is stored as a Worker
 * secret: which gallery the key opens, what it holds, its limits and model.
 * It is Khozo's own adapter (shared/face-index.js) doing the reading, so a
 * pass also means Khozo understands the real answers.
 *
 *   node scripts/check-face-gallery.mjs
 *
 * The key is typed (or pasted) at a hidden prompt, or read from
 * AARAKSHAK_GALLERY_KEY, or piped on stdin. It is never an argument (shell
 * history keeps those), and it is never printed. Two GET calls: the gallery's
 * info and its list of case ids. Nothing is enrolled, searched or deleted.
 *
 * AARAKSHAK_GALLERY_URL (default https://aarakshak.com) and
 * AARAKSHAK_GALLERY_NAME (default khozo-sandbox) may be set too.
 */
import process from 'node:process';

import { aarakshakGalleryIndex } from '../shared/face-index.js';

const KHOZO_CASE_ID = /^r_[A-Za-z0-9_-]{4,40}$/;

async function readKey() {
  if (process.env.AARAKSHAK_GALLERY_KEY) return process.env.AARAKSHAK_GALLERY_KEY;
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  }
  process.stdout.write('Aarakshak gallery key (hidden): ');
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  return new Promise((resolve) => {
    let value = '';
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
      process.stdout.write('\n');
      resolve(value);
    };
    function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') {
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
      return undefined;
    }
    process.stdin.on('data', onData);
  });
}

const url = process.env.AARAKSHAK_GALLERY_URL || 'https://aarakshak.com';
const expected = process.env.AARAKSHAK_GALLERY_NAME || 'khozo-sandbox';
const raw = await readKey();
const key = String(raw || '').trim();
if (!key) {
  console.error('No key given.');
  process.exit(2);
}
if (key !== String(raw).replace(/[\r\n]+$/, '')) {
  console.log('Note: the key had spaces or a byte-order mark around it; they were removed (the Worker removes them too).');
}

const gallery = aarakshakGalleryIndex({ url, key, gallery: expected });
console.log(`\nAarakshak gallery check (read-only) - ${url}`);
const info = await gallery.info();
if (!info) {
  console.log('\nNo answer from GET /api/v2/gallery (the reason and X-Request-ID are above).');
  console.log('A 401 or 403 means the key was not accepted: check it with Aarakshak, out of band.');
  process.exit(1);
}
const ids = await gallery.listCaseIds();
const khozoIds = ids ? ids.filter((id) => KHOZO_CASE_ID.test(id)).length : null;

const row = (label, value) => console.log(`  ${label.padEnd(16)}${value}`);
row('gallery', `${info.galleryId || '?'}  (expected ${expected}: ${info.galleryMatches ? 'ok' : 'DIFFERENT'})`);
if (info.label) row('label', info.label);
row('cases / faces', `${info.cases} / ${info.faces}`);
row('limits', JSON.stringify(info.limits));
if (info.model) row('model', [info.model.version, info.model.embedding, info.model.score].filter(Boolean).join(' / '));
row('case ids', ids ? `${ids.length} (${khozoIds} Khozo case ids, ${ids.length - khozoIds} others)` : 'could not be listed');

if (!info.galleryMatches) {
  console.log(`\nThis key opens "${info.galleryId}", not "${expected}". Do not store it; ask Aarakshak which gallery it belongs to.`);
  process.exit(1);
}
console.log('\nThe key opens the expected gallery and Khozo reads its answers.');
console.log('Next, once the current code is deployed: npx wrangler secret put AARAKSHAK_GALLERY_KEY');
