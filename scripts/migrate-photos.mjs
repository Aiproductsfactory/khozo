/**
 * Moves photos from the local uploads directory into Postgres.
 *
 *   node scripts/migrate-photos.mjs            # copy local files into the database
 *   node scripts/migrate-photos.mjs --verify   # compare disk vs database
 *   node scripts/migrate-photos.mjs --prune    # delete local files already stored
 *
 * A host like Render gives the API an ephemeral filesystem, so anything left in
 * server/data/uploads disappears on the next deploy, taking the photo attached
 * to every open case with it.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import '../server/src/env.js';
import { savePhotoBlob, readPhotoBlob, photoBlobStats, isPostgres, closePool } from '../server/src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', 'server', 'data', 'uploads');
const flag = (n) => process.argv.includes(`--${n}`);

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function localFiles() {
  if (!fs.existsSync(UPLOAD_DIR)) return [];
  return fs.readdirSync(UPLOAD_DIR).filter((f) => MIME[path.extname(f).toLowerCase()]);
}

async function main() {
  if (!isPostgres) {
    console.error('DATABASE_URL is not set — nothing to migrate to.');
    process.exit(1);
  }

  const files = localFiles();
  console.log(`Local uploads : ${files.length} file(s) in ${UPLOAD_DIR}`);

  if (flag('verify')) {
    let ok = 0;
    let missing = [];
    for (const name of files) {
      const blob = await readPhotoBlob(name);
      const local = fs.readFileSync(path.join(UPLOAD_DIR, name));
      if (blob && blob.buffer.length === local.length) ok += 1;
      else missing.push(name);
    }
    console.log(`In database   : ${ok} match by size`);
    if (missing.length) console.log(`Missing/differing: ${missing.join(', ')}`);
    console.log(`Database totals: ${JSON.stringify(await photoBlobStats())}`);
    return;
  }

  if (flag('prune')) {
    let removed = 0;
    for (const name of files) {
      const blob = await readPhotoBlob(name);
      const local = fs.readFileSync(path.join(UPLOAD_DIR, name));
      // Only delete once the database copy is confirmed byte-for-byte.
      if (blob && blob.buffer.equals(local)) {
        fs.unlinkSync(path.join(UPLOAD_DIR, name));
        removed += 1;
      } else {
        console.log(`  keeping ${name} — no verified copy in the database`);
      }
    }
    console.log(`Pruned ${removed} local file(s).`);
    return;
  }

  let written = 0;
  for (const name of files) {
    const buffer = fs.readFileSync(path.join(UPLOAD_DIR, name));
    await savePhotoBlob(name, buffer, MIME[path.extname(name).toLowerCase()]);
    written += 1;
    console.log(`  stored ${name.padEnd(24)} ${(buffer.length / 1024).toFixed(0)} KB`);
  }

  const stats = await photoBlobStats();
  console.log(`\nMigrated ${written} photo(s).`);
  console.log(`Database now holds ${stats.count} photo(s), ${(stats.totalBytes / 1024 / 1024).toFixed(2)} MB.`);
  console.log('\nRun with --verify to confirm, then --prune to clear the local copies.');
}

main()
  .catch((err) => {
    console.error(`\nPhoto migration failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
