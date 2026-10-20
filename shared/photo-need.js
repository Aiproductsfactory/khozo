// Whether a case's photo can find the person in a sighting, and if not, why.
import { PHOTO_REJECTION_REASONS, SMALL_FACE_WARNINGS } from './face-index.js';
import { extraPhotosOf } from './photo-set.js';

/** The reasons, most serious first. */
export const PHOTO_NEEDS = ['no_photo', 'no_face', 'group', 'weak'];

/**
 * Why a case's photo is unlikely to find the person in a sighting, or null
 * when it should. A photo that has not been checked yet is not counted: no
 * verdict is not a problem found.
 *
 *   no_photo  nothing to compare a sighting with at all
 *   no_face   the face check, or the face search gallery, found no face
 *   group     several faces: which one is the person is a guess
 *   weak      the face search gallery refused it, or took it with a face
 *             too small to match reliably (SMALL_FACE_WARNINGS; the face
 *             finder merely being unsure of a face does not count)
 *
 * The desk asks the family for a recent, clear photo of the face alone and
 * replaces it (POST /reports/:id/photo), or adds it beside the others (POST
 * /reports/:id/photos), which checks and enrols it again. A case with several
 * photos (shared/photo-set.js) needs none while any of them shows one face:
 * matching leads with that one. Reads only fields every desk view of a case
 * carries (deskCaseView), so the server's count and the console's list agree.
 */
export function photoNeedOf(report) {
  if (!report || typeof report !== 'object' || report.anonymizedAt) return null;
  if (!report.photoFile && !report.photoUrl) return 'no_photo';
  const index = report.faceIndex;
  // The gallery refused every photo it was given: no face check can clear that.
  const refused = index && typeof index === 'object' && index.status === 'failed' ? galleryRefusal(index) : null;
  if (refused) return refused;
  const usableExtra = extraPhotosOf(report).some((p) => p.check?.verdict === 'usable');
  const verdict = report.photoCheck?.verdict;
  if (verdict === 'no_face' && !usableExtra) return 'no_face';
  if (verdict === 'multiple_faces' && !usableExtra) return 'group';
  if (index && typeof index === 'object' && index.status === 'enrolled' && !hasAGoodFace(report)) return 'weak';
  return null;
}

const weak = (warnings) => Array.isArray(warnings) && warnings.some((w) => SMALL_FACE_WARNINGS.has(w));

/**
 * Why the gallery refused a case, as a photo need, or null when it was not
 * about the photos: a 5xx, a timeout or a missing key is about the gallery,
 * and says nothing of the photo. `photo_missing`: the stored file could not
 * be read, so nothing is left to compare with.
 */
function galleryRefusal(index) {
  const reason = String(index.reason || '');
  if (reason === 'photo_missing') return 'no_photo';
  if (reason === 'no_face' || reason === 'face_not_found_at_box') return 'no_face';
  if (reason === 'multiple_faces') return 'group';
  if (PHOTO_REJECTION_REASONS.has(reason) || reason.startsWith('refused_') || /^http_4\d\d$/.test(reason)) return 'weak';
  return null;
}

/**
 * Whether the face search gallery holds a face of the case it can match
 * well: any photo it enrolled without a small-or-unclear warning. Before the
 * gallery recorded each photo, its top-level warnings were the only photo's.
 * True when the gallery has said nothing.
 */
export function galleryHasGoodFace(index) {
  return hasAGoodFace({ faceIndex: index });
}

function hasAGoodFace(report) {
  const index = report.faceIndex;
  if (!index || typeof index !== 'object' || index.status !== 'enrolled') return true;
  const photos = Array.isArray(index.photos) ? index.photos.filter((p) => p && typeof p === 'object') : [];
  if (!photos.length) return !weak(index.warnings);
  return photos.some((p) => p.status === 'enrolled' && !weak(p.warnings));
}

/** Counts of open cases by reason, plus the total. */
export function photoNeedCounts(reports) {
  const counts = { total: 0, no_photo: 0, no_face: 0, group: 0, weak: 0 };
  for (const r of Array.isArray(reports) ? reports : []) {
    const need = photoNeedOf(r);
    if (!need) continue;
    counts[need] += 1;
    counts.total += 1;
  }
  return counts;
}
