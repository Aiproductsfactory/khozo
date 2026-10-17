# Backup and restore runbook

Khozo keeps missing-person records that cannot be recreated. Two layers protect
them; both must be on before a department relies on the service.

## Layer 1 — the database host's point-in-time recovery (photos included)

All records **and photo bytes** (`photo_blobs`) live in one Postgres database.
Turn on point-in-time recovery (PITR) in the database host's dashboard and keep
at least 7 days. This is the only layer that covers photos.

- [ ] PITR enabled, retention ≥ 7 days — owner: the database account holder
- [ ] Database password rotated after the 2026 git-history exposure (`docs/DEPLOYMENT.md` §2)

## Layer 2 — nightly encrypted export to R2 (records, not photos)

`worker/src/ops.js` `runBackup` runs at 02:00 IST (cron `30 20 * * *`). It
exports every table except photo bytes, leaves out password hashes, gzips it,
encrypts it with AES-256-GCM using `KHOZO_BACKUP_KEY`, and writes
`daily/YYYY-MM-DD.json.gz.aesgcm` to the R2 bucket bound as `BACKUPS`. Dailies
older than 35 days are deleted. A failed backup raises a super-admin alert.

To turn it on (account owner):

```bash
# 1. Enable R2 in the Cloudflare dashboard, then:
npx wrangler r2 bucket create khozo-backups --location apac
# 2. Generate the key and keep a copy OFFLINE (a backup cannot be read without it):
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put KHOZO_BACKUP_KEY
# 3. Uncomment the r2_buckets binding in wrangler.jsonc and deploy.
```

Note on location: R2 has no India jurisdiction. The export is encrypted before
it leaves the Worker, and the key never goes to R2, but a department that
requires all copies to stay in India should keep only Layer 1 or copy the file
to storage of its choosing.

## Restore

1. Download the object: `npx wrangler r2 object get khozo-backups/daily/<date>.json.gz.aesgcm --file backup.bin`
2. Decrypt and unpack (first 12 bytes are the IV):

```bash
node -e "
const fs=require('fs'),c=require('crypto'),z=require('zlib');
const b=fs.readFileSync('backup.bin'),k=Buffer.from(process.env.KHOZO_BACKUP_KEY,'base64');
const d=c.createDecipheriv('aes-256-gcm',k,b.subarray(0,12));d.setAuthTag(b.subarray(b.length-16));
const gz=Buffer.concat([d.update(b.subarray(12,b.length-16)),d.final()]);
fs.writeFileSync('backup.json',z.gunzipSync(gz));"
```

3. `backup.json` is `{ format, createdAt, tables: { users, reports, … } }`, one
   array of the stored `data` objects per table. Load it into a **new** database
   with `scripts/migrate-to-postgres.mjs`-style upserts, verify counts against
   the object's `counts` metadata, then point Hyperdrive at it.
4. Users are restored without passwords: rotate them with
   `scripts/rotate-account-passwords.mjs` and hand the new list to the desks.
5. Photos come from Layer 1 (PITR), not from this file.

Rehearse a restore into a scratch database once a quarter and record the date
here.

| Rehearsal date | By | Result |
| --- | --- | --- |
| | | |
