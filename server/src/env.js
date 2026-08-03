// Loads .env before any other module reads process.env.
//
// Imported first by index.js: match.js and store.js both capture credentials at
// module scope, so anything that reads config must be imported after this.
//
// Uses Node's built-in .env parser (Node >= 20.6), so there is no dotenv
// dependency. Values already present in the real environment win, which is what
// you want on a host like Render where secrets are injected directly.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = process.env.KHOZO_ENV_FILE || path.join(__dirname, '..', '..', '.env');

if (fs.existsSync(ENV_FILE)) {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(ENV_FILE);
  } else {
    // Node 20.6-21 exposed the parser without the loader helper.
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const match = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
      if (!match || line.trimStart().startsWith('#')) continue;
      const key = match[1];
      let value = (match[2] || '').trim();
      if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

/** Reports which optional integrations are configured, for startup logging. */
export function envSummary() {
  return {
    envFile: fs.existsSync(ENV_FILE) ? ENV_FILE : null,
    database: process.env.DATABASE_URL ? 'postgres' : 'json-file',
    aarakshak: Boolean(process.env.AARAKSHAK_API_KEY),
    rekognition: Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
    jwtSecret: Boolean(process.env.KHOZO_JWT_SECRET),
  };
}
