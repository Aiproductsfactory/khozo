/**
 * Lists interface strings that are wrapped for translation but missing from a
 * language's dictionary.
 *
 *   node scripts/i18n-check.mjs                 # summary per language
 *   node scripts/i18n-check.mjs --lang gu --list  # every missing gu string
 *   node scripts/i18n-check.mjs --file web/src/pages/Landing.jsx --list
 *   node scripts/i18n-check.mjs --json missing.json  # all strings + where used
 *
 * A string counts as wrapped when it is the first argument of t(...) or msg(...)
 * as a plain string literal. Template literals with ${} are not extractable;
 * use t('Expires {date}', { date }) instead.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const SRC = path.join(ROOT, 'web', 'src');
const LOCALES = path.join(SRC, 'locales');
const LANGS = ['gu', 'hi', 'mr'];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'locales' ? [] : walk(p);
    if (e.name === 'i18n.jsx') return [];
    return /\.(jsx?|tsx?)$/.test(e.name) ? [p] : [];
  });
}

// t('...'), t("..."), t(`...`) and msg(...) — the literal must be the first argument.
const CALL = /\b(?:t|msg)\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.|\$(?!\{))*)`)\s*[,)]/g;

function unescape(s) {
  return s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
}

export function extract(files) {
  const keys = new Map();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(CALL)) {
      const key = unescape(m[1] ?? m[2] ?? m[3]);
      if (!key.trim()) continue;
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (!keys.has(key)) keys.set(key, new Set());
      keys.get(key).add(rel);
    }
  }
  return keys;
}

function loadDict(lang) {
  const dir = path.join(LOCALES, lang);
  const dict = {};
  if (!existsSync(dir)) return dict;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    Object.assign(dict, JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
  }
  return dict;
}

const only = arg('file');
const files = only ? [path.resolve(ROOT, only)] : walk(SRC);
const keys = extract(files);
const langs = arg('lang') && arg('lang') !== true ? [arg('lang')] : LANGS;

let missingTotal = 0;
for (const lang of langs) {
  const dict = loadDict(lang);
  const missing = [...keys.keys()].filter((k) => !dict[k]);
  missingTotal += missing.length;
  console.log(`${lang}: ${keys.size - missing.length}/${keys.size} translated, ${missing.length} missing`);
  if (arg('list')) for (const k of missing) console.log(`   - ${JSON.stringify(k)}  (${[...keys.get(k)].join(', ')})`);
}

const out = arg('json');
if (out && out !== true) {
  const rows = Object.fromEntries([...keys].map(([k, where]) => [k, [...where]]));
  writeFileSync(out, JSON.stringify(rows, null, 2));
  console.log(`wrote ${keys.size} strings to ${out}`);
}

if (arg('strict') && missingTotal) process.exit(1);
