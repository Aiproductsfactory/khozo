/**
 * What Khozo lets Khozo Desktop do beyond reading a video for one case,
 * decided on Khozo and read by the app with the newest version
 * (GET /api/dashboard/desktop-version `policy`). The app keeps the last
 * answer, so a laptop with no internet knows what it may do.
 *
 * Both are off unless switched on, and each waits on its own agreement
 * (desktop specification, sections 10 and 16):
 *
 *   laptopAnswers  The laptop's own score, from Aarakshak's model on the
 *                  laptop, is shown as an answer while Khozo has not answered
 *                  (no internet), marked "on this laptop", and Khozo's answer
 *                  replaces it. The laptop then keeps the case's face
 *                  signatures, encrypted, for the life of the check, and tells
 *                  Khozo when it deleted them. Needs Aarakshak's word that the
 *                  laptop's score may stand until the cloud confirms it (A4,
 *                  A5) and the data-processing line for laptops (A6).
 *   liveWatch      Watching one live camera for one case until a set time,
 *                  the officer at the desk told when a close face appears.
 *                  Needs the legal line on watching a public place (L2) and
 *                  Aarakshak's live-stream support (A10).
 */

const isOn = (value) => /^(1|true|on|yes)$/i.test(String(value ?? '').trim());
const numberIn = (value, fallback, lo, hi) => {
  const n = Number(value);
  return value !== '' && value != null && Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
};

/** The longest a live watch may run before it must be started again, unless the settings say otherwise. */
export const LIVE_WATCH_HOURS = 12;
/** Aarakshak's own match line: the laptop calls a face close at or above it. */
export const LAPTOP_LINE = 0.35;
/** After a live watch's end, faces still on their way are taken for this long. */
export const LIVE_GRACE_MS = 10 * 60 * 1000;

export function desktopPolicyOf(settings = {}) {
  return {
    laptopAnswers: isOn(settings.laptopAnswers),
    laptopLine: numberIn(settings.laptopLine, LAPTOP_LINE, 0.1, 0.9),
    liveWatch: isOn(settings.liveWatch),
    liveWatchHours: numberIn(settings.liveWatchHours, LIVE_WATCH_HOURS, 1, 72),
  };
}

/**
 * When a live watch may run until, or `{ error }`: a time after now and no
 * more than the allowed hours ahead.
 */
export function liveUntilOf(value, policy, now = Date.now()) {
  const until = Date.parse(value || '');
  if (!Number.isFinite(until)) return { error: 'Say until when to watch the camera.' };
  if (until <= now) return { error: 'The end of the watch must be later than now.' };
  if (until - now > policy.liveWatchHours * 3600 * 1000 + 60 * 1000) {
    return { error: `A camera can be watched for at most ${policy.liveWatchHours} hours at a time. Start it again after that.` };
  }
  return { until: new Date(until).toISOString() };
}

/** Why faces may no longer be sent to a live watch, or null: switched off since, or past its end and the grace after it. */
export function liveWatchProblem(job, policy, now = Date.now()) {
  if (!job?.live) return null;
  if (!policy.liveWatch) return { status: 403, error: 'Watching a live camera is not switched on in Khozo.', code: 'live_off' };
  if (now > Date.parse(job.live.until) + LIVE_GRACE_MS) return { status: 409, error: 'This watch has ended. Start it again to go on watching.', code: 'live_ended' };
  return null;
}
