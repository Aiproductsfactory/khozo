// Applies the plain-language change list to a Khozo checkout.
//
//   node scripts/plain-language-apply.mjs . scripts/plain-language-map.json [--dry-run]
//
// web:    only text inside t('…') / msg('…') calls is changed, never a bare
//         string, so a short label that is also an internal name is safe.
// server: exact string literals anywhere in the code and tests. A "legacy"
//         entry is a value stored on old records: serverMessages keeps the old
//         msg() and gains the new one, and the locales keep the old key too.
// mobile: string literals and JSX text in mobile/src.
// substring: each locale key containing the text is rewritten as a web entry.
// Locales: keys renamed in place, translations kept.
import fs from 'node:fs';
import path from 'node:path';

const [repo, mapFile, flag] = process.argv.slice(2);
const dry = flag === '--dry-run';
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const LANGS = ['gu', 'hi', 'mr'];
const localeDir = path.join(repo, 'web', 'src', 'locales');

function walk(dir, exts, skip = []) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || skip.includes(e.name) ? [] : walk(p, exts, skip);
    return exts.some((x) => e.name.endsWith(x)) ? [p] : [];
  });
}

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const forms = (s) => ({
  "'": s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
  '"': s.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
  '`': s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${'),
});

// Locale keys, for substring rules.
const allKeys = new Set();
for (const lang of LANGS) {
  for (const f of fs.readdirSync(path.join(localeDir, lang))) {
    for (const k of Object.keys(JSON.parse(fs.readFileSync(path.join(localeDir, lang, f), 'utf8')))) allKeys.add(k);
  }
}
const web = [...map.web];
// Every substring rule applied to a key in turn, giving one entry per key.
for (const k of allKeys) {
  let next = k;
  for (const [sub, rep] of map.substring || []) next = next.split(sub).join(rep);
  if (next !== k && !web.some(([a]) => a === k)) web.push([k, next]);
}

const files = {
  web: walk(path.join(repo, 'web', 'src'), ['.js', '.jsx'], ['locales']),
  code: [
    ...walk(path.join(repo, 'web', 'src'), ['.js', '.jsx'], ['locales']),
    ...walk(path.join(repo, 'shared'), ['.js']),
    ...walk(path.join(repo, 'server', 'src'), ['.js']),
    ...walk(path.join(repo, 'worker'), ['.js']),
    ...walk(path.join(repo, 'scripts'), ['.mjs', '.js']),
  ],
  mobile: walk(path.join(repo, 'mobile', 'src'), ['.js', '.jsx']),
};
const content = new Map();
const read = (f) => (content.has(f) ? content.get(f) : (content.set(f, fs.readFileSync(f, 'utf8')), content.get(f)));
const isRegistry = (f) => /serverMessages\w*\.js$/.test(f);

const report = [];
function replaceIn(list, entries, kind) {
  for (const [oldText, newText, mode] of entries) {
    const o = forms(oldText);
    const n = forms(newText);
    let hits = 0;
    for (const f of list) {
      let src = read(f);
      const before = src;
      for (const q of ["'", '"', '`']) {
        if (kind === 'web') {
          const re = new RegExp(`(\\b(?:t|msg)\\(\\s*)${reEsc(q)}${reEsc(o[q])}${reEsc(q)}`, 'g');
          src = src.replace(re, (_m, pre) => { hits++; return `${pre}${q}${n[q]}${q}`; });
        } else if (mode === 'legacy' && isRegistry(f)) {
          // Already registered beside the old wording: a second run changes nothing.
          if (src.includes(`msg(${q}${n[q]}${q})`)) continue;
          const re = new RegExp(`^(\\s*)msg\\(${reEsc(q)}${reEsc(o[q])}${reEsc(q)}\\),$`, 'm');
          src = src.replace(re, (line, ind) => { hits++; return `${line}\n${ind}msg(${q}${n[q]}${q}),`; });
        } else {
          const re = new RegExp(`${reEsc(q)}${reEsc(o[q])}${reEsc(q)}`, 'g');
          src = src.replace(re, () => { hits++; return `${q}${n[q]}${q}`; });
        }
      }
      if (kind === 'mobile') {
        const re = new RegExp(`>(\\s*)${reEsc(oldText)}(\\s*)<`, 'g');
        src = src.replace(re, (_m, a, b) => { hits++; return `>${a}${newText}${b}<`; });
      }
      if (src !== before) content.set(f, src);
    }
    report.push({ kind, oldText, hits });
  }
}
replaceIn(files.web, web, 'web');
replaceIn(files.code, map.server || [], 'server');
replaceIn(files.mobile, map.mobile || [], 'mobile');

// Locales: rename keys in place, keep translations.
const renames = [...web.map(([a, b]) => [a, b, null]), ...(map.server || [])];
let keyChanges = 0;
for (const lang of LANGS) {
  const langFiles = fs.readdirSync(path.join(localeDir, lang)).map((f) => path.join(localeDir, lang, f));
  const dicts = new Map(langFiles.map((f) => [f, JSON.parse(fs.readFileSync(f, 'utf8'))]));
  const has = (k) => [...dicts.values()].some((d) => Object.hasOwn(d, k));
  for (const [oldKey, newKey, mode] of renames) {
    for (const [f, d] of dicts) {
      if (!Object.hasOwn(d, oldKey)) continue;
      const exists = has(newKey);
      const out = {};
      for (const [k, v] of Object.entries(d)) {
        if (k === oldKey) {
          if (mode === 'legacy') out[k] = v;
          if (!exists) out[newKey] = v;
        } else out[k] = v;
      }
      dicts.set(f, out);
      keyChanges++;
    }
  }
  if (!dry) for (const [f, d] of dicts) fs.writeFileSync(f, `${JSON.stringify(d, null, 2)}\n`);
}

if (!dry) for (const [f, src] of content) if (src !== fs.readFileSync(f, 'utf8')) fs.writeFileSync(f, src);
const missed = report.filter((r) => r.hits === 0);
console.log(`${report.length} entries, ${report.reduce((s, r) => s + r.hits, 0)} replacements in code, ${keyChanges} locale keys renamed${dry ? ' (dry run)' : ''}`);
for (const m of missed) console.log(`  no match [${m.kind}]: ${m.oldText.slice(0, 100)}`);
