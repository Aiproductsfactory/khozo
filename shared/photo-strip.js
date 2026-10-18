/**
 * Removes the metadata a phone writes into a photograph: GPS position, device
 * make and serial, capture time, editing software, embedded thumbnails and
 * comments (DPIA G13). A sighting's place is recorded deliberately, with the
 * reporter's consent, in the sighting's own fields; nothing else about the
 * reporter's phone needs to travel with the picture, to the database or to a
 * face engine.
 *
 * One thing is kept: the EXIF orientation flag. A portrait photo from most
 * phones is stored sideways with a flag saying "rotate me", and dropping the
 * flag would hand the face engines a sideways face. The flag is rewritten into
 * a minimal EXIF block that holds nothing else.
 *
 *   JPEG  APP1 Exif becomes orientation-only; APP1 XMP, APP3-APP13, APP15,
 *         non-colour APP2 and comments are dropped; JFIF (APP0), the ICC
 *         colour profile (APP2) and Adobe colour transform (APP14) are kept;
 *         the scans are copied byte for byte up to the end-of-image marker,
 *         and anything appended after it is dropped.
 *   PNG   eXIf, tEXt, zTXt, iTXt and tIME chunks are dropped.
 *   WebP  EXIF and XMP chunks are dropped and the VP8X flags updated.
 *
 * Anything this does not fully understand is returned unchanged: a photograph
 * with its metadata is a privacy gap, a corrupted photograph is a child nobody
 * can match.
 *
 * Pure and dependency-free.
 */
import { detectImageFormat } from './photo-format.js';

const asBytes = (buf) => (buf instanceof Uint8Array ? buf : new Uint8Array(buf));

/** Returns `out` as the same kind of object the caller passed in. */
function like(input, out) {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) return Buffer.from(out.buffer, out.byteOffset, out.length);
  return out;
}

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const ascii = (bytes, from, length) => String.fromCharCode(...bytes.subarray(from, from + length));

// ---------------------------------------------------------------- JPEG ---

/** The orientation (1-8) in an APP1 Exif payload, or null. */
export function exifOrientation(payload) {
  // payload: the segment's data, starting "Exif\0\0".
  if (payload.length < 14 || ascii(payload, 0, 4) !== 'Exif') return null;
  const tiff = 6;
  const order = ascii(payload, tiff, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (at) => (le ? payload[at] | (payload[at + 1] << 8) : (payload[at] << 8) | payload[at + 1]);
  const u32 = (at) => (le
    ? (payload[at] | (payload[at + 1] << 8) | (payload[at + 2] << 16) | (payload[at + 3] << 24)) >>> 0
    : ((payload[at] << 24) | (payload[at + 1] << 16) | (payload[at + 2] << 8) | payload[at + 3]) >>> 0);
  if (u16(tiff + 2) !== 42) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > payload.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > payload.length) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** A complete APP1 segment holding only an orientation tag. */
function orientationSegment(orientation) {
  const payload = [
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF header, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT, 1
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ];
  const length = payload.length + 2;
  return new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...payload]);
}

const KEEP_APP = new Set([0xe0, 0xe2, 0xee]); // JFIF, ICC profile (APP2), Adobe

/**
 * Where the image ends: just past the EOI marker that closes the last scan,
 * walking scan data and the table segments a progressive JPEG puts between
 * scans. -1 when the file does not end the way a JPEG should, in which case
 * nothing after the first scan is touched. Whatever a phone appends after EOI
 * (a motion-photo video, a vendor trailer) is not part of the picture.
 */
function endOfImage(bytes, at) {
  let i = at;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return -1;
    const marker = bytes[i + 1];
    if (marker === 0xd9) return i + 2;
    if (marker === 0xff) { i += 1; continue; }
    if (i + 4 > bytes.length) return -1;
    let j = i + 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
    if (marker === 0xda) {
      // Entropy-coded data: 0xFF is followed by 0x00 (a stuffed byte), a
      // restart marker, or the next marker.
      while (j + 1 < bytes.length) {
        if (bytes[j] !== 0xff) { j += 1; continue; }
        const next = bytes[j + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { j += 2; continue; }
        if (next === 0xff) { j += 1; continue; }
        break;
      }
    }
    if (j + 1 >= bytes.length) return -1;
    i = j;
  }
  return -1;
}

function stripJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const parts = [bytes.subarray(0, 2)];
  let at = 2;
  let orientation = null;
  let removed = 0;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    // Fill bytes before a marker.
    while (bytes[at] === 0xff && bytes[at + 1] === 0xff) at += 1;
    const marker = bytes[at + 1];
    if (marker === undefined) return null;
    if (marker === 0xda) {
      // Start of scan: the image data, verbatim, up to the end of the image.
      const end = endOfImage(bytes, at);
      if (end > 0 && end < bytes.length) {
        parts.push(bytes.subarray(at, end));
        removed += 1;
      } else {
        parts.push(bytes.subarray(at));
      }
      break;
    }
    if (marker === 0xd9) {
      parts.push(bytes.subarray(at, at + 2));
      at += 2;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // Markers without a length.
      parts.push(bytes.subarray(at, at + 2));
      at += 2;
      continue;
    }
    if (at + 4 > bytes.length) return null;
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2 || at + 2 + length > bytes.length) return null;
    const segment = bytes.subarray(at, at + 2 + length);
    const payload = bytes.subarray(at + 4, at + 2 + length);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if (marker === 0xe1) {
      if (ascii(payload, 0, 4) === 'Exif') orientation = orientation ?? exifOrientation(payload);
      removed += 1;
    } else if ((isApp && !KEEP_APP.has(marker)) || marker === 0xfe) {
      removed += 1;
    } else if (marker === 0xe2 && ascii(payload, 0, 11) !== 'ICC_PROFILE') {
      // APP2 also carries multi-picture indexes pointing past EOI.
      removed += 1;
    } else {
      parts.push(segment);
    }
    at += 2 + length;
  }
  if (!parts.some((p) => p[0] === 0xff && p[1] === 0xda)) return null;
  if (!removed) return bytes;
  if (orientation && orientation !== 1) parts.splice(1, 0, orientationSegment(orientation));
  return concat(parts);
}

// ----------------------------------------------------------------- PNG ---

const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function stripPng(bytes) {
  const parts = [bytes.subarray(0, 8)];
  let at = 8;
  let removed = 0;
  let ended = false;
  while (at + 12 <= bytes.length) {
    const length = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    const type = ascii(bytes, at + 4, 4);
    const end = at + 12 + length;
    if (end > bytes.length) return null;
    if (PNG_DROP.has(type)) removed += 1;
    else parts.push(bytes.subarray(at, end));
    at = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended) return null;
  // Bytes after IEND are kept as they are: no phone writes metadata there.
  if (at < bytes.length) parts.push(bytes.subarray(at));
  return removed ? concat(parts) : bytes;
}

// ---------------------------------------------------------------- WebP ---

function stripWebp(bytes) {
  const parts = [];
  let at = 12;
  let removed = 0;
  let vp8xIndex = -1;
  while (at + 8 <= bytes.length) {
    const type = ascii(bytes, at, 4);
    const size = (bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] << 24)) >>> 0;
    const end = at + 8 + size + (size % 2);
    if (at + 8 + size > bytes.length) return null;
    if (type === 'EXIF' || type === 'XMP ') {
      removed += 1;
    } else {
      if (type === 'VP8X') vp8xIndex = parts.length;
      parts.push(new Uint8Array(bytes.subarray(at, Math.min(end, bytes.length))));
    }
    at = end;
  }
  if (!removed) return bytes;
  if (vp8xIndex >= 0) parts[vp8xIndex][8] &= ~(0x08 | 0x04); // EXIF and XMP flags
  const body = concat(parts);
  const riffSize = body.length + 4;
  const header = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, riffSize & 0xff, (riffSize >> 8) & 0xff, (riffSize >> 16) & 0xff, (riffSize >> 24) & 0xff,
    0x57, 0x45, 0x42, 0x50,
  ]);
  return concat([header, body]);
}

/**
 * The photograph without its metadata, in the same format and of the same
 * kind (Buffer or Uint8Array) as given; unchanged when there is nothing to
 * remove or the file is not one this understands.
 */
export function stripImageMetadata(input) {
  if (!input || typeof input.length !== 'number' || input.length < 12) return input;
  const bytes = asBytes(input);
  let out = null;
  try {
    const format = detectImageFormat(bytes);
    if (format === 'jpeg') out = stripJpeg(bytes);
    else if (format === 'png') out = stripPng(bytes);
    else if (format === 'webp') out = stripWebp(bytes);
  } catch {
    out = null;
  }
  if (!out || out === bytes) return input;
  return like(input, out);
}
