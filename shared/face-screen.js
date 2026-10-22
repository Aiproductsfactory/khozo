/**
 * Whether a sighting photo shows a person, read from the face screen
 * (screenPhoto in shared/match-pipeline.js).
 *
 * A face detector reports every face it finds, however small: a passer-by
 * thirty metres behind a signboard is a face. Aarakshak says when a face is
 * small in the frame or weakly detected (its warnings, and a quality score
 * from 0 to 1), and a photo whose only face is one of those is not a photo
 * of a person. Saying it was — in green, to an officer looking at a picture
 * of a door — is worse for trust than saying nothing.
 *
 * Used by the server (which sightings raise the general alert) and by the
 * console (what the review card says), so the two never disagree.
 */
import { WEAK_FACE_WARNINGS } from './face-index.js';
import { MAIN_PHOTO } from './photo-set.js';

/** Below this Aarakshak quality score a face is too poor to call a person. */
export const CLEAR_FACE_QUALITY = 0.5;

/** Whether the screen's face is one the engine itself called small or unclear. */
export function isWeakFace(screening) {
  if (!screening || typeof screening !== 'object') return false;
  const warnings = Array.isArray(screening.warnings) ? screening.warnings : [];
  if (warnings.some((w) => WEAK_FACE_WARNINGS.has(w))) return true;
  const quality = Number(screening.quality);
  return screening.quality != null && Number.isFinite(quality) && quality < CLEAR_FACE_QUALITY;
}

/**
 * Whether the screen found a clear person. A face the first engine called
 * weak counts only when a second engine also found one (`clearFace`, set by
 * screenPhoto); a record screened before that field existed is judged by its
 * stored warnings and quality.
 */
export function screenShowsPerson(screening) {
  if (!screening || screening.verdict !== 'person') return false;
  if (typeof screening.clearFace === 'boolean') return screening.clearFace;
  return !isWeakFace(screening);
}

/**
 * The screen's verdict as the review queue reads it: `person`,
 * `unclear_face`, or the stored verdict. An officer who has looked at the
 * photo and recorded what is in it (`screening.officer`) is the answer,
 * whatever the engine said.
 */
export function sightingScreenVerdict(screening) {
  if (!screening) return null;
  if (screening.officer?.verdict === 'no_person' || screening.officer?.verdict === 'person') return screening.officer.verdict;
  if (screening.verdict === 'person') return screenShowsPerson(screening) ? 'person' : 'unclear_face';
  return screening.verdict;
}

/**
 * Whether a face-matching engine found a face in the sighting's main photo
 * while comparing it with a case. An engine gives a score only when it found
 * a face on both sides, so a score for that photo is the face. A score of 0
 * is not counted: older records may hold 0 for an engine that did not answer.
 *
 * The scores are read where the review card reads them (currentCandidate in
 * web/src/dashboard/Reunite.jsx): the candidate list, and, for the current
 * link, the sighting's own evidence fields - all a link made before the list
 * was kept, or by the reverse search then, has.
 */
export function faceFoundByComparison(sighting) {
  const scored = (...scores) => scores.some((s) => Number(s) > 0);
  const onMain = (pair) => (pair?.sighting || MAIN_PHOTO) === MAIN_PHOTO;
  const candidates = Array.isArray(sighting?.matchCandidates) ? sighting.matchCandidates : [];
  if (candidates.some((c) => c && scored(c.aarakshakScore, c.rekognitionScore) && onMain(c.photoPair))) return true;
  return Boolean(sighting?.matchedReportId
    && scored(sighting.primaryScore, sighting.secondOpinionScore)
    && onMain(sighting.matchedPhotoPair));
}

/**
 * What the review card says about a sighting's main photo: the screen's
 * verdict, or `face_compared` when the screen never answered (`unverified`)
 * but an engine has since found a face in the photo while comparing it with
 * a case. A sighting sent while no engine answered the screen kept its photo
 * behind "Not screened" for good, beside a match both engines had made from
 * the face in it - and an officer cannot weigh a match without the photo.
 */
export function sightingPhotoVerdict(sighting) {
  const verdict = sightingScreenVerdict(sighting?.screening);
  return verdict === 'unverified' && faceFoundByComparison(sighting) ? 'face_compared' : verdict;
}
