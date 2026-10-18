/**
 * Checks shared/photo-strip.js: an uploaded photo loses its GPS position,
 * device make, comments and XMP, keeps its orientation flag and its pixels,
 * and anything the stripper does not understand comes back unchanged.
 *
 * Builds its own test images, so it needs no fixtures. When the optional
 * `sharp` module is installed it also decodes every result, to prove the
 * stripped file is still a valid image; without it those checks are skipped.
 *
 *   node scripts/photo-strip-smoke.mjs
 */
import process from 'node:process';
import zlib from 'node:zlib';

import { exifOrientation, stripImageMetadata } from '../shared/photo-strip.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.log('  (sharp is not installed: decode checks are skipped)');
}

const has = (buf, text) => Buffer.from(buf).includes(Buffer.from(text, 'latin1'));

// A valid 1x1 JPEG (the same one worker/src/ops.js sends as a probe).
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

/** An APP1 Exif payload: Make, Orientation and a GPS sub-IFD, little-endian. */
function exifPayload(orientation) {
  const make = Buffer.from('SecretPhoneCo\0', 'latin1');
  // TIFF header (8) + IFD0: count (2) + 3 entries (36) + next (4) = 50,
  // then the Make string, then the GPS IFD.
  const ifd0 = 8;
  const makeAt = ifd0 + 2 + 3 * 12 + 4;
  const gpsAt = makeAt + make.length;
  const tiff = Buffer.alloc(gpsAt + 2 + 12 + 4);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(ifd0, 4);
  tiff.writeUInt16LE(3, ifd0);
  let e = ifd0 + 2;
  tiff.writeUInt16LE(0x010f, e); tiff.writeUInt16LE(2, e + 2); tiff.writeUInt32LE(make.length, e + 4); tiff.writeUInt32LE(makeAt, e + 8);
  e += 12;
  tiff.writeUInt16LE(0x0112, e); tiff.writeUInt16LE(3, e + 2); tiff.writeUInt32LE(1, e + 4); tiff.writeUInt16LE(orientation, e + 8);
  e += 12;
  tiff.writeUInt16LE(0x8825, e); tiff.writeUInt16LE(4, e + 2); tiff.writeUInt32LE(1, e + 4); tiff.writeUInt32LE(gpsAt, e + 8);
  make.copy(tiff, makeAt);
  tiff.writeUInt16LE(1, gpsAt);
  // GPSLatitudeRef = "N"
  tiff.writeUInt16LE(1, gpsAt + 2); tiff.writeUInt16LE(2, gpsAt + 4); tiff.writeUInt32LE(2, gpsAt + 6); tiff.write('N\0', gpsAt + 10, 'latin1');
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
}

const segment = (marker, payload) => {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
};

function jpegWith({ orientation = 6 } = {}) {
  const exif = segment(0xe1, exifPayload(orientation));
  const xmp = segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>SecretXmp</x:xmpmeta>', 'latin1'));
  const comment = segment(0xfe, Buffer.from('SecretComment', 'latin1'));
  // SOI, then the metadata, then the rest of the original file (its JFIF onward).
  return Buffer.concat([TINY_JPEG.subarray(0, 2), exif, xmp, comment, TINY_JPEG.subarray(2)]);
}

const scanOf = (buf) => buf.subarray(buf.indexOf(Buffer.from([0xff, 0xda])));

// ---- JPEG
{
  const input = jpegWith({ orientation: 6 });
  check('the test JPEG carries its metadata', has(input, 'SecretPhoneCo') && has(input, 'SecretComment') && has(input, 'SecretXmp'));
  const out = stripImageMetadata(input);
  check('device make is removed', !has(out, 'SecretPhoneCo'));
  check('the GPS block is removed', exifOrientation(out.subarray(out.indexOf(Buffer.from('Exif', 'latin1')))) === 6 && out.length < input.length - 40);
  check('comments are removed', !has(out, 'SecretComment'));
  check('XMP is removed', !has(out, 'SecretXmp'));
  check('the orientation flag survives', exifOrientation(out.subarray(out.indexOf(Buffer.from('Exif', 'latin1')))) === 6);
  check('the image data is byte for byte the same', scanOf(out).equals(scanOf(input)));
  check('the JFIF header is kept', has(out, 'JFIF'));
  check('a Buffer in is a Buffer out', Buffer.isBuffer(out));
  const upright = stripImageMetadata(jpegWith({ orientation: 1 }));
  check('an upright photo keeps no EXIF at all', !has(upright, 'Exif') && scanOf(upright).equals(scanOf(TINY_JPEG)));
  check('a JPEG with no metadata comes back unchanged', stripImageMetadata(TINY_JPEG) === TINY_JPEG);
  check('a Uint8Array in is a Uint8Array out', !Buffer.isBuffer(stripImageMetadata(new Uint8Array(input))) && stripImageMetadata(new Uint8Array(input)) instanceof Uint8Array);
  if (sharp) {
    const meta = await sharp(out).metadata();
    check('the stripped JPEG still decodes', meta.width === 1 && meta.height === 1);
    check('a decoder still reads the orientation', meta.orientation === 6, `orientation ${meta.orientation}`);
  }
  const truncated = input.subarray(0, 60);
  check('a truncated JPEG comes back unchanged', stripImageMetadata(truncated) === truncated);
}

// ---- A phone-like JPEG: real encoder, ICC profile, GPS, orientation 8
if (sharp) {
  const phone = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#3a7bd5' } })
    .jpeg({ quality: 90 })
    .withExif({ IFD0: { Make: 'SecretPhoneCo', Model: 'SecretModel9' }, IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' } })
    .withMetadata({ orientation: 8, icc: 'srgb' })
    .toBuffer();
  const out = stripImageMetadata(phone);
  const before = await sharp(phone).metadata();
  const after = await sharp(out).metadata();
  check('a phone JPEG loses make, model and GPS', has(phone, 'SecretModel9') && !has(out, 'SecretModel9') && !has(out, 'SecretPhoneCo'));
  check('a phone JPEG keeps its orientation', before.orientation === 8 && after.orientation === 8, `orientation ${after.orientation}`);
  check('a phone JPEG keeps its colour profile', Boolean(after.icc) === Boolean(before.icc));
  const [a, b] = await Promise.all([sharp(phone).raw().toBuffer(), sharp(out).raw().toBuffer()]);
  check('a phone JPEG decodes to the same pixels', a.equals(b));
}

// ---- Progressive JPEG with a trailer appended after EOI (a motion photo)
if (sharp) {
  const progressive = await sharp({ create: { width: 96, height: 64, channels: 3, background: '#d53a7b' } })
    .jpeg({ quality: 85, progressive: true })
    .withExif({ IFD0: { Make: 'SecretPhoneCo' } })
    .toBuffer();
  const trailer = Buffer.from('....ftypmp42 SecretMotionVideo with GPS ©xyz+19.07+072.87/', 'latin1');
  const motion = Buffer.concat([progressive, trailer]);
  const out = stripImageMetadata(motion);
  check('a trailer after the end of the image is dropped', has(motion, 'SecretMotionVideo') && !has(out, 'SecretMotionVideo'));
  check('a progressive JPEG ends at its EOI marker', out[out.length - 2] === 0xff && out[out.length - 1] === 0xd9);
  const [a, b] = await Promise.all([sharp(progressive).raw().toBuffer(), sharp(out).raw().toBuffer()]);
  check('a progressive JPEG decodes to the same pixels', a.equals(b));
}

// ---- PNG
function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
{
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2; // 1x1 RGB
  const idat = zlib.deflateSync(Buffer.from([0, 200, 100, 50]));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from('Comment\0SecretPngText', 'latin1')),
    chunk('eXIf', exifPayload(1).subarray(6)),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const out = stripImageMetadata(png);
  check('PNG text chunks are removed', has(png, 'SecretPngText') && !has(out, 'SecretPngText'));
  check('PNG EXIF chunks are removed', !has(out, 'eXIf') && !has(out, 'SecretPhoneCo'));
  check('PNG image data is kept', has(out, 'IDAT') && has(out, 'IEND'));
  if (sharp) {
    const meta = await sharp(out).metadata();
    check('the stripped PNG still decodes', meta.width === 1 && meta.format === 'png');
  }
}

// ---- WebP (needs sharp to make one)
if (sharp) {
  const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#c86432' } })
    .webp()
    .withExif({ IFD0: { Make: 'SecretPhoneCo' } })
    .toBuffer();
  const out = stripImageMetadata(webp);
  check('WebP EXIF is removed', has(webp, 'SecretPhoneCo') && !has(out, 'SecretPhoneCo'));
  const meta = await sharp(out).metadata();
  check('the stripped WebP still decodes', meta.width === 4 && meta.format === 'webp' && !meta.exif);
}

// ---- Not an image
{
  const text = Buffer.from('this is not a photograph at all');
  check('anything else comes back unchanged', stripImageMetadata(text) === text);
  check('nothing comes back as nothing', stripImageMetadata(null) === null);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) process.exit(1);
console.log('Photo metadata checks passed.');
