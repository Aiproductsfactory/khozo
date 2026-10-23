// What the app keeps on the laptop, encrypted: the face pictures of everyone
// seen in the footage and each job's record. AES-256-GCM with one key for the
// install; the key itself is kept encrypted by Windows for this user account
// (Electron safeStorage, which uses DPAPI), so the files are unreadable to
// another account or on another computer.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const IV = 12;
const TAG = 16;

/** Encrypts bytes with `key`: the nonce, the tag, then the ciphertext. */
export function seal(key, bytes) {
  const iv = crypto.randomBytes(IV);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** Decrypts what seal() made; throws when the bytes were changed or the key is wrong. */
export function open(key, sealed) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV));
  decipher.setAuthTag(sealed.subarray(IV, IV + TAG));
  return Buffer.concat([decipher.update(sealed.subarray(IV + TAG)), decipher.final()]);
}

/**
 * The install's key: made once, kept in `file` wrapped by `wrap`/`unwrap`
 * (safeStorage in the app). Without them (tests) the key is kept as it is.
 */
export function loadKey(file, { wrap = (b) => b, unwrap = (b) => b } = {}) {
  if (fs.existsSync(file)) return Buffer.from(unwrap(fs.readFileSync(file)));
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, wrap(key));
  return key;
}

/** Reading and writing encrypted files under one folder. */
export function secureFiles(key) {
  return {
    write(file, bytes) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, seal(key, bytes));
      fs.renameSync(`${file}.tmp`, file);
    },
    read(file) { return open(key, fs.readFileSync(file)); },
    writeJson(file, value) { this.write(file, Buffer.from(JSON.stringify(value))); },
    readJson(file) { return JSON.parse(this.read(file).toString('utf8')); },
  };
}
