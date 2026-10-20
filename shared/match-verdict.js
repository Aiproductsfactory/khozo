/**
 * Reading the two face engines' scores side by side, for the pipeline
 * (shared/match-pipeline.js) and the review screens (web/src/dashboard/
 * Reunite.jsx) alike. No Node imports, so the browser build can use it.
 *
 * The two scores are on different scales and are never compared with each
 * other, only each with its own match line (`matchEngine.thresholds` on a
 * sighting, shared/match-config.js thresholdsOf):
 *
 *   - Aarakshak's score is how close two faces are. Measured on real pairs of
 *     photographs, the same person scored 0.48-0.86 and different people
 *     below 0.07 (server/src/match.js), so its line is 0.35.
 *   - Rekognition's score is how sure AWS is that two faces are one person.
 *     For the same person it is nearly always 0.99 or more; its line is 0.80.
 *
 * So Aarakshak 0.72 beside Rekognition 1.00 is two engines agreeing strongly.
 * The rule this replaced called a gap of 0.25 between the numbers a
 * disagreement, and flagged most of the strongest matches with a red "the two
 * checks disagree" next to a green "both checks agree".
 */

const known = (value) => value != null && value !== '' && Number.isFinite(Number(value));

/**
 * Whether the engines reached different verdicts on a pair: one put it at or
 * above its own match line and the other below. Null when either engine gave
 * no score or a line was not recorded.
 */
export function enginesDisagreeOn({ aarakshakScore, rekognitionScore } = {}, { aarakshak, rekognitionConfirm } = {}) {
  if (![aarakshakScore, rekognitionScore, aarakshak, rekognitionConfirm].every(known)) return null;
  const aarakshakSaysMatch = Number(aarakshakScore) >= Number(aarakshak);
  const rekognitionSaysMatch = Number(rekognitionScore) >= Number(rekognitionConfirm);
  return aarakshakSaysMatch !== rekognitionSaysMatch;
}

/** A recorded match line, or null. */
export function matchLine(value) {
  return known(value) ? Number(value) : null;
}
