/**
 * Several photos of one person: the main photo and the extras.
 *
 * A family often has more than one photo of a missing child - different ages,
 * angles, a clearer face - and a passer-by often takes more than one of a
 * child they saw. One blurred or old photo is a case that is never found, so
 * a case holds up to five and a sighting up to three, and a sighting is
 * compared with every photo of a case (shared/match-pipeline.js).
 *
 * The main photo stays where every reader has always found it (`photoFile`,
 * `photoUrl`, `photoCheck`); the others are `extraPhotos` entries:
 *
 *   { id: 'p_…', file, url, check, addedAt, addedById, addedByRole }
 *
 * `file` is the storage key, `url` where an authorised desk fetches it
 * (GET /reports/photo/:recordId?p=<id>, the same access rule as the main
 * photo), `check` the face check of that photo alone.
 *
 * Pure and dependency-free: the browser bundle imports it too.
 */

/** The most photos a missing-person case holds: the main one and four more. */
export const MAX_CASE_PHOTOS = 5;

/** The most photos one public sighting carries. */
export const MAX_SIGHTING_PHOTOS = 3;

/** The multipart field the extra photos travel in; the main one stays `photo`. */
export const EXTRA_PHOTO_FIELD = 'extraPhotos';

/** The most extra files any one upload may carry (a case's four). */
export const MAX_EXTRA_FILES = MAX_CASE_PHOTOS - 1;

/** The refusal for an upload carrying more photos than the record may hold. */
export const TOO_MANY_PHOTOS = `Too many photos: a case holds at most ${MAX_CASE_PHOTOS} and a sighting at most ${MAX_SIGHTING_PHOTOS}.`;

/**
 * The largest multipart body either runtime reads: three photos at the 8 MB
 * cap a photo has (shared/photo-format.js). The forms shrink photos before
 * sending (web/src/photoPrep.js), so five prepared photos fit well inside it.
 */
export const MULTIPART_MAX_BYTES = 24 * 1024 * 1024;

/** The refusal for a body over MULTIPART_MAX_BYTES. */
export const PHOTOS_TOO_LARGE = 'The photos are too large to send together (24 MB at most). Send fewer or smaller photos.';

/** How the main photo is named where a photo is named by id (a matched pair). */
export const MAIN_PHOTO = 'main';

const EXTRA_ID = /^p_[A-Za-z0-9_-]{4,40}$/;

export function isExtraPhotoId(id) {
  return EXTRA_ID.test(String(id || ''));
}

/**
 * The storage key of an extra photo. Distinct from the `${id}-${version}`
 * keys a replaced main photo is stored under.
 */
export function extraPhotoKey(recordId, photoId) {
  return `${recordId}_${photoId}`;
}

export function extraPhotoUrl(recordId, photoId) {
  return `/api/reports/photo/${recordId}?p=${photoId}`;
}

/** A record's extra photos, well-formed entries only. */
export function extraPhotosOf(record) {
  return (Array.isArray(record?.extraPhotos) ? record.extraPhotos : [])
    .filter((p) => p && typeof p === 'object' && isExtraPhotoId(p.id) && typeof p.file === 'string' && p.file);
}

/** How many photos a record holds. */
export function photoCountOf(record) {
  if (!record || typeof record !== 'object' || record.anonymizedAt) return 0;
  return (record.photoFile || record.photoUrl ? 1 : 0) + extraPhotosOf(record).length;
}

/**
 * Every photo of a record, the main one first:
 * [{ id, file, url, check, main, addedAt }]. Nothing for an anonymised record.
 */
export function photosOf(record) {
  if (!record || typeof record !== 'object' || record.anonymizedAt) return [];
  const out = [];
  if (record.photoFile) {
    out.push({
      id: MAIN_PHOTO,
      file: record.photoFile,
      url: record.photoUrl || `/api/reports/photo/${record.id}`,
      check: record.photoCheck || null,
      main: true,
      addedAt: null,
    });
  }
  for (const p of extraPhotosOf(record)) {
    out.push({ id: p.id, file: p.file, url: extraPhotoUrl(record.id, p.id), check: p.check || null, main: false, addedAt: p.addedAt || null });
  }
  return out;
}

/** Whether a face check says a photo is not one face of one person. */
const notOneFace = (check) => check?.verdict === 'no_face' || check?.verdict === 'multiple_faces';

/**
 * The photo a record is compared on first (shared/match-pipeline.js): the
 * main photo, unless its own face check found no face or a group and another
 * photo's found one face - then that one. Null without a photo.
 */
export function leadPhotoOf(record) {
  const photos = photosOf(record);
  if (!photos.length) return null;
  if (!notOneFace(photos[0].check)) return photos[0];
  return photos.find((p) => p.check?.verdict === 'usable') || photos[0];
}

/**
 * The extra photos as a view that lists fields one by one shows them: where
 * to fetch each and what its face check said, never the storage key.
 */
export function extraPhotosView(record) {
  if (!record || record.anonymizedAt) return [];
  return extraPhotosOf(record).map((p) => ({
    id: p.id,
    url: extraPhotoUrl(record.id, p.id),
    check: p.check || null,
    addedAt: p.addedAt || null,
  }));
}

/** The storage keys of every photo a record holds, for deletion. */
export function photoFilesOf(record) {
  if (!record || typeof record !== 'object') return [];
  return [record.photoFile, ...extraPhotosOf(record).map((p) => p.file)].filter(Boolean);
}

/**
 * The bytes of every photo of a record, main first, as
 * [{ id, buffer, check }], read with `readPhoto(file)`. `given` stands in for
 * bytes already in hand: a Buffer for the main photo, an array of Buffers in
 * photosOf order, or { [photoId]: Buffer }. A photo that cannot be read is
 * left out.
 */
export async function loadPhotos(record, readPhoto, given = null) {
  const photos = photosOf(record);
  const out = [];
  for (let i = 0; i < photos.length; i += 1) {
    const photo = photos[i];
    let buffer = null;
    if (Array.isArray(given)) buffer = given[i] || null;
    else if (given && typeof given === 'object' && !given.length && given[photo.id]) buffer = given[photo.id];
    else if (given?.length && photo.main) buffer = given;
    if (!buffer?.length && typeof readPhoto === 'function') {
      // eslint-disable-next-line no-await-in-loop
      buffer = await Promise.resolve(readPhoto(photo.file)).catch(() => null);
    }
    if (buffer?.length) out.push({ id: photo.id, buffer, check: photo.check });
  }
  return out;
}

/** Where to fetch one photo of a record, by id: the main photo or an extra. */
export function photoUrlOf(record, photoId = MAIN_PHOTO) {
  if (!record || typeof record !== 'object') return null;
  if (!photoId || photoId === MAIN_PHOTO) {
    return record.photoUrl || (record.photoFile ? `/api/reports/photo/${record.id}` : null);
  }
  const extra = (Array.isArray(record.extraPhotos) ? record.extraPhotos : []).find((p) => p?.id === photoId);
  return extra ? extra.url || extraPhotoUrl(record.id, photoId) : null;
}

/**
 * Every photo of a record as the console shows it, main first:
 * [{ id, src, check }]. Reads any view of a record - a desk's, which lists
 * the storage keys, or a review or family view, which does not.
 */
export function viewPhotosOf(record) {
  if (!record || typeof record !== 'object' || record.anonymizedAt) return [];
  const main = photoUrlOf(record, MAIN_PHOTO);
  const out = main ? [{ id: MAIN_PHOTO, src: main, check: record.photoCheck || null }] : [];
  for (const p of Array.isArray(record.extraPhotos) ? record.extraPhotos : []) {
    if (p && isExtraPhotoId(p.id)) out.push({ id: p.id, src: p.url || extraPhotoUrl(record.id, p.id), check: p.check || null });
  }
  return out;
}
