// Photos for bulk import: decoding the pictures a register embeds, dropping
// the shadow masks Excel stores beside them, and downscaling every photo in
// the browser to a JPEG of at most 1200 px before it is uploaded.
//
// The pure parts (shadow rule, EMF bitmap extraction) run under Node for the
// smoke checks; the canvas parts only run in the browser.

export const MAX_SIDE = 1200;
export const JPEG_QUALITY = 0.88;

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

export const extOf = (name) => String(name || '').split('.').pop().toLowerCase();
export const mimeOf = (ext) => MIME[ext] || 'application/octet-stream';

/**
 * Excel groups a soft shadow with some photos: a tiny image that is pure
 * black with only an alpha channel. It is not a photo of anyone.
 */
export function isShadowStats({ byteLength, maxRgb, maxAlpha }) {
  return byteLength < 3000 && (maxRgb < 16 || maxAlpha < 128);
}

/** Highest colour and alpha values in RGBA pixel data. */
export function pixelStats(rgba) {
  let maxRgb = 0;
  let maxAlpha = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] > maxRgb) maxRgb = rgba[i];
    if (rgba[i + 1] > maxRgb) maxRgb = rgba[i + 1];
    if (rgba[i + 2] > maxRgb) maxRgb = rgba[i + 2];
    if (rgba[i + 3] > maxAlpha) maxAlpha = rgba[i + 3];
  }
  return { maxRgb, maxAlpha };
}

// ------------------------------------------------------------------ EMF

/**
 * The largest bitmap inside an EMF (Windows metafile) picture. A photo pasted
 * into older Excel often lands as an EMF that is nothing but one embedded
 * device-independent bitmap; browsers cannot draw EMF, but they can draw that.
 * Returns { width, height, bpp, compression, rgba() } or null.
 */
export function dibFromEmf(u8) {
  const bytes = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 88 || dv.getUint32(0, true) !== 1) return null; // EMR_HEADER
  let best = null;
  let off = 0;
  while (off + 8 <= bytes.length) {
    const type = dv.getUint32(off, true);
    const size = dv.getUint32(off + 4, true);
    if (size < 8 || off + size > bytes.length) break;
    let bmiAt = null;
    if (type === 80 || type === 81) bmiAt = 48; // SETDIBITSTODEVICE, STRETCHDIBITS
    else if (type === 76 || type === 77) bmiAt = 84; // BITBLT, STRETCHBLT
    if (bmiAt != null && size >= bmiAt + 16) {
      const offBmi = dv.getUint32(off + bmiAt, true);
      const cbBmi = dv.getUint32(off + bmiAt + 4, true);
      const offBits = dv.getUint32(off + bmiAt + 8, true);
      const cbBits = dv.getUint32(off + bmiAt + 12, true);
      if (cbBmi >= 40 && cbBits > 0 && offBmi + cbBmi <= size && offBits + cbBits <= size) {
        const b = off + offBmi;
        const dib = {
          width: dv.getInt32(b + 4, true),
          height: dv.getInt32(b + 8, true),
          bpp: dv.getUint16(b + 14, true),
          compression: dv.getUint32(b + 16, true),
          headerSize: dv.getUint32(b, true),
          clrUsed: dv.getUint32(b + 32, true),
          bmiStart: b,
          bitsStart: off + offBits,
          bitsLength: cbBits,
        };
        if (!best || cbBits > best.bitsLength) best = dib;
      }
    }
    if (type === 14) break; // EMR_EOF
    off += size;
  }
  if (!best || best.width <= 0 || best.height === 0) return null;
  return { ...best, rgba: () => dibToRgba(bytes, best) };
}

/** Uncompressed 8/24/32-bit DIB pixels as top-down RGBA, or null for other kinds. */
function dibToRgba(bytes, d) {
  const { width, bpp, compression } = d;
  const height = Math.abs(d.height);
  const bottomUp = d.height > 0;
  if (![8, 24, 32].includes(bpp) || ![0, 3].includes(compression)) return null;
  const stride = ((width * bpp + 31) >> 5) << 2;
  if (d.bitsLength < stride * height) return null;
  let palette = null;
  if (bpp === 8) {
    const count = d.clrUsed || 256;
    palette = bytes.subarray(d.bmiStart + d.headerSize, d.bmiStart + d.headerSize + count * 4);
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const src = d.bitsStart + (bottomUp ? height - 1 - y : y) * stride;
    let o = y * width * 4;
    for (let x = 0; x < width; x++, o += 4) {
      if (bpp === 8) {
        const p = bytes[src + x] * 4;
        out[o] = palette[p + 2];
        out[o + 1] = palette[p + 1];
        out[o + 2] = palette[p];
      } else {
        const s = src + x * (bpp >> 3);
        out[o] = bytes[s + 2];
        out[o + 1] = bytes[s + 1];
        out[o + 2] = bytes[s];
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

// ------------------------------------------------------------------ browser

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), type, quality));
}

/** Something drawImage accepts, with its size: { source, width, height, close() }. */
export async function decodePicture(bytes, ext) {
  if (ext === 'emf') {
    const dib = dibFromEmf(bytes);
    const rgba = dib?.rgba();
    if (!rgba) throw new Error('unsupported-picture');
    const h = Math.abs(dib.height);
    const canvas = makeCanvas(dib.width, h);
    canvas.getContext('2d').putImageData(new ImageData(rgba, dib.width, h), 0, 0);
    return { source: canvas, width: dib.width, height: h, close() {} };
  }
  if (ext === 'wmf' || ext === 'tif' || ext === 'tiff') throw new Error('unsupported-picture');
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mimeOf(ext) });
  const bitmap = await createImageBitmap(blob);
  return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
}

/** True when an embedded picture is one of Excel's shadow masks. */
export async function isShadowPicture(bytes, ext) {
  const byteLength = bytes.byteLength ?? bytes.size ?? 0;
  if (byteLength >= 3000) return false;
  try {
    const pic = await decodePicture(bytes, ext);
    const canvas = makeCanvas(pic.width, pic.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(pic.source, 0, 0);
    pic.close();
    const { data } = ctx.getImageData(0, 0, pic.width, pic.height);
    return isShadowStats({ byteLength, ...pixelStats(data) });
  } catch {
    return false;
  }
}

/** Fits a size inside maxSide on its longer edge, keeping the aspect ratio. */
export function fitSize(width, height, maxSide = MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * A JPEG of at most maxSide px on the longer edge. Transparent areas become
 * white, as they would on paper.
 */
export async function toJpeg(bytes, ext, { maxSide = MAX_SIDE, quality = JPEG_QUALITY } = {}) {
  const pic = await decodePicture(bytes, ext);
  const { width, height } = fitSize(pic.width, pic.height, maxSide);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(pic.source, 0, 0, width, height);
  pic.close();
  return canvasToBlob(canvas, 'image/jpeg', quality);
}
