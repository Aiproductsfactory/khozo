/**
 * What an uploaded photograph actually is, read from its bytes.
 *
 * A browser's declared type is whatever the phone said: an iPhone HEIC
 * labelled "image/jpeg", a screenshot renamed .jpg. Neither face engine can
 * read those, and the comparison then fails as "no answer" with nothing on the
 * record to say why. So the first bytes decide, and both runtimes ask the same
 * question here (validateImageFile in shared/case-domain.js, and the engines in
 * worker/src/match.js and server/src/match.js before calling Rekognition).
 *
 * Pure and dependency-free, so the browser bundle may import it too.
 */

/** The largest photo either runtime accepts, in bytes (8 MB, as multer caps it). */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The largest image AWS Rekognition takes as raw bytes. A larger photo is not
 * "no match" but "not checked": the comparison was never made.
 */
export const REKOGNITION_MAX_BYTES = 5 * 1024 * 1024;

/** The formats Khozo stores, and the MIME type each is served as. */
export const PHOTO_TYPES = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** The formats Rekognition's CompareFaces reads. WebP is not one of them. */
const REKOGNITION_FORMATS = new Set(['jpeg', 'png']);

function byteAt(buf, i) {
  return buf && i < buf.length ? buf[i] : -1;
}

/**
 * 'jpeg' | 'png' | 'webp' from the file's leading bytes, or null for anything
 * else (HEIC, GIF, PDF, text).
 */
export function detectImageFormat(buf) {
  if (!buf || typeof buf.length !== 'number' || buf.length < 12) return null;
  if (byteAt(buf, 0) === 0xff && byteAt(buf, 1) === 0xd8 && byteAt(buf, 2) === 0xff) return 'jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => byteAt(buf, i) === b)) return 'png';
  const ascii = (from, to) => String.fromCharCode(...Array.from({ length: to - from }, (_, k) => byteAt(buf, from + k)));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}

/** The MIME type for the bytes, or null. */
export function detectImageMime(buf) {
  const format = detectImageFormat(buf);
  return format ? PHOTO_TYPES[format] : null;
}

/**
 * Whether Rekognition can be asked about this image, and if not, why:
 * `{ ok: true }`, or `{ ok: false, reason: 'unsupported_format' | 'too_large' }`.
 */
export function rekognitionReadable(buf) {
  const format = detectImageFormat(buf);
  if (!format || !REKOGNITION_FORMATS.has(format)) return { ok: false, reason: 'unsupported_format' };
  if (buf.length > REKOGNITION_MAX_BYTES) return { ok: false, reason: 'too_large' };
  return { ok: true };
}

/** A filename extension for a multipart part, by the bytes. */
export function imageExtension(buf) {
  const format = detectImageFormat(buf);
  return format === 'png' ? 'png' : format === 'webp' ? 'webp' : 'jpg';
}
