/**
 * Where a sighting happened, found without asking the reporter to type it.
 *
 * Two sources, best first:
 *   1. The GPS block the camera wrote into the photo's EXIF. That is where the
 *      picture was taken, which is what matters for a photo picked from the
 *      gallery an hour later and somewhere else.
 *   2. The phone's own position at the moment of upload.
 *
 * Mobile browsers usually strip the EXIF location from a file handed to a web
 * page (iOS Safari always does), so (2) is the ordinary path on a phone and (1)
 * is what makes a desktop or shared-file upload land in the right place.
 */

/** How much of the file to read: EXIF sits in the first segment of a JPEG. */
const EXIF_SCAN_BYTES = 256 * 1024;

function readIfd(view, tiff, little, ifdOffset) {
  const entries = new Map();
  const count = view.getUint16(tiff + ifdOffset, little);
  for (let i = 0; i < count; i += 1) {
    const entry = tiff + ifdOffset + 2 + i * 12;
    entries.set(view.getUint16(entry, little), entry);
  }
  return entries;
}

function parseTiffGps(view, tiff) {
  const order = view.getUint16(tiff);
  const little = order === 0x4949; // "II"
  if (!little && order !== 0x4d4d) return null; // "MM"
  if (view.getUint16(tiff + 2, little) !== 42) return null;

  const ifd0 = readIfd(view, tiff, little, view.getUint32(tiff + 4, little));
  const gpsPointer = ifd0.get(0x8825);
  if (gpsPointer == null) return null;
  const gps = readIfd(view, tiff, little, view.getUint32(gpsPointer + 8, little));

  const ref = (tag) => {
    const entry = gps.get(tag);
    return entry == null ? '' : String.fromCharCode(view.getUint8(entry + 8));
  };
  // Degrees, minutes, seconds: three RATIONALs stored at an offset.
  const degrees = (tag) => {
    const entry = gps.get(tag);
    if (entry == null) return null;
    const at = tiff + view.getUint32(entry + 8, little);
    let value = 0;
    for (let i = 0; i < 3; i += 1) {
      const num = view.getUint32(at + i * 8, little);
      const den = view.getUint32(at + i * 8 + 4, little);
      // Some cameras write 0/0 for the seconds they did not measure.
      if (!den) {
        if (i === 0) return null;
        continue;
      }
      value += num / den / 60 ** i;
    }
    return value;
  };

  let lat = degrees(2);
  let lng = degrees(4);
  if (lat == null || lng == null) return null;
  if (ref(1) === 'S') lat = -lat;
  if (ref(3) === 'W') lng = -lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // 0,0 is what a camera writes when it never got a fix — the Gulf of Guinea,
  // not a sighting.
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function parseJpegGps(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null; // start of image data: no EXIF
    const size = view.getUint16(offset + 2);
    // APP1 holding "Exif\0\0", then a TIFF header.
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0) {
      return parseTiffGps(view, offset + 10);
    }
    offset += 2 + size;
  }
  return null;
}

/**
 * The coordinates stored in a JPEG's EXIF, or null. Never throws: a malformed
 * or truncated header is the same answer as no header.
 */
export async function readPhotoGps(file) {
  if (!file || typeof file.slice !== 'function') return null;
  try {
    const buffer = await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer();
    return parseJpegGps(buffer);
  } catch {
    return null;
  }
}

/**
 * The phone's current position as `{ lat, lng, accuracy }`. Rejects with the
 * browser's GeolocationPositionError (code 1 = permission denied).
 */
export function getDeviceLocation({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error('Location is not available in this browser'), { code: 0 }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      reject,
      // A fix up to a minute old is still where the reporter is standing, and
      // returns instantly instead of waiting on a cold GPS.
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

export function formatCoordinates({ lat, lng }) {
  return `Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}`;
}
