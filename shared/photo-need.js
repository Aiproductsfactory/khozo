// Whether a case's photo can find the person in a sighting, and if not, why.
import { PHOTO_REJECTION_REASONS, WEAK_FACE_WARNINGS } from './face-index.js';

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
 *             too small or unclear to match reliably
 *
 * The desk asks the family for a recent, clear photo of the face alone and
 * replaces it (POST /reports/:id/photo), which checks and enrols it again.
 * Reads only fields every desk view of a case carries (deskCaseView), so the
 * server's count and the console's list agree.
 */
export function photoNeedOf(report) {
  if (!report || typeof report !== 'object' || report.anonymizedAt) return null;
  if (!report.photoFile && !report.photoUrl) return 'no_photo';
  const verdict = report.photoCheck?.verdict;
  if (verdict === 'no_face') return 'no_face';
  if (verdict === 'multiple_faces') return 'group';
  const index = report.faceIndex;
  if (index && typeof index === 'object') {
    const reason = String(index.reason || '');
    if (index.status === 'failed') {
      // The stored file could not be read: nothing is left to compare with.
      if (reason === 'photo_missing') return 'no_photo';
      if (reason === 'no_face' || reason === 'face_not_found_at_box') return 'no_face';
      if (reason === 'multiple_faces') return 'group';
      // The gallery's other refusals are about the photo; a 5xx, a timeout
      // or a missing key is about the gallery, and says nothing of the photo.
      if (PHOTO_REJECTION_REASONS.has(reason) || reason.startsWith('refused_') || /^http_4\d\d$/.test(reason)) return 'weak';
    }
    if (index.status === 'enrolled' && Array.isArray(index.warnings) && index.warnings.some((w) => WEAK_FACE_WARNINGS.has(w))) return 'weak';
  }
  return null;
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
