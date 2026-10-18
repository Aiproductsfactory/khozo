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
