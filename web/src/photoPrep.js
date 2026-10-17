// Photos taken on a phone are 3-12 MB. Before one is uploaded (or queued on
// the device while offline) it is redrawn as a JPEG of at most 1280 px on its
// longer edge at quality 0.8: a few hundred KB, which a slow connection sends
// in seconds and which is still far more than face matching needs.
//
// Redrawing drops the EXIF block, GPS included, so anything that reads the
// photo's own location (photoLocation.js readPhotoGps) must run on the
// original file first.
import { toJpeg } from './bulk/photos.js';

export const PHOTO_MAX_SIDE = 1280;
export const PHOTO_QUALITY = 0.8;

/**
 * A resized JPEG File, or the original file when the browser cannot decode it
 * (an unusual format): a large upload is better than no upload.
 */
export async function preparePhoto(file) {
  if (!file || typeof file.arrayBuffer !== 'function') return file;
  try {
    const ext = String(file.name || '').split('.').pop().toLowerCase() || 'jpg';
    const blob = await toJpeg(file, ext, { maxSide: PHOTO_MAX_SIDE, quality: PHOTO_QUALITY });
    if (!blob || !blob.size) return file;
    // An already-small JPEG is sent as it is rather than re-compressed.
    if (file.type === 'image/jpeg' && blob.size >= file.size) return file;
    const base = String(file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}

/** "2.4 MB", "380 KB": for telling a reporter what will be sent. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
