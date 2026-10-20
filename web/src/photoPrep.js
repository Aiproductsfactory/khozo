// Photos taken on a phone are 3-12 MB. Before one is uploaded (or queued on
// the device while offline) it is redrawn as a JPEG of at most 1920 px on its
// longer edge at quality 0.8: a few hundred KB, which a slow connection sends
// in seconds.
//
// 1920, not less, because a sighting is often taken from a distance. A face
// 150 px wide in a 4000 px photo was 48 px after shrinking to 1280, near the
// smallest a face engine will look at; at 1920 it keeps 72. Not more, because
// Rekognition's smallest face (40 px, 50 px to compare reliably) is set for a
// 1920 × 1080 picture and grows in proportion above it, so a larger photo
// costs bytes and gains nothing.
//
// Redrawing drops the EXIF block, GPS included, so anything that reads the
// photo's own location (photoLocation.js readPhotoGps) must run on the
// original file first.
import { toJpeg } from './bulk/photos.js';

export const PHOTO_MAX_SIDE = 1920;
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
