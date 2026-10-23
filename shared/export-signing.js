// Exports signed with Khozo's export key (KHOZO_EXPORT_SIGNING_KEY,
// shared/privacy.js): the content as canonical JSON, its SHA-256, and an
// HMAC over the type and that digest. A copy can be checked later with
// POST /api/dashboard/export/verify. Used by the dashboard's exports and by
// a CCTV check's report.
import crypto from 'node:crypto';

/** The same value with every object's keys in order, so the same content always gives the same digest. */
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stable(value[key]);
        return acc;
      }, {});
  }
  return value;
}

/** `payload` with its `signature`: `{ type, algorithm, keyId, digest, value, generatedAt }`. */
export function signExport(payload, type, exportSigning = {}) {
  const keyId = exportSigning?.keyId || 'demo-local';
  const key = exportSigning?.key || 'khozo-demo-export-signing-key';
  const digest = crypto.createHash('sha256').update(JSON.stringify(stable(payload))).digest('hex');
  const value = crypto.createHmac('sha256', key).update(`${type}.${digest}`).digest('hex');
  return {
    ...payload,
    signature: { type, algorithm: 'sha256-hmac', keyId, digest, value, generatedAt: new Date().toISOString() },
  };
}
