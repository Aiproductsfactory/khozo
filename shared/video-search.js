/**
 * Video, both ways it reaches Khozo. Pure and dependency-free: the browser
 * bundle imports it too.
 *
 * 1. Pictures from a video. A reporter or a family chooses a video instead of
 *    a photo; the faces are found on their own device (web/src/video/), they
 *    pick the clearest pictures of the person, and those pictures are sent as
 *    the photos. The video itself is never uploaded. A sighting made this way
 *    says when in the video each picture was taken (`fromVideo`).
 *
 * 2. Searching a video for one person. An officer opens a case, chooses a
 *    CCTV export, and every face in it is compared with that case's photo
 *    (POST /reports/:id/video-search), a few at a time. Again the video stays
 *    on the officer's computer: each request carries up to
 *    VIDEO_SEARCH_BATCH small pictures of one face each, compared in memory
 *    and not kept. Each request is audited with the video's name, size and
 *    fingerprint (SHA-256) and the camera's place.
 */

/** Face pictures in one video-search request: the main photo field and the four extras. */
export const VIDEO_SEARCH_BATCH = 5;

/** The most faces one search of one video sends; the clearest are sent first. */
export const VIDEO_SEARCH_MAX_FACES = 300;

/**
 * What the engines said about each face (shared/match-pipeline.js
 * frameVerdict), from most to least worth an officer's time.
 */
export const FRAME_VERDICTS = ['likely', 'possible', 'not_agreed', 'unlikely', 'no_face', 'no_answer'];

/** The fields a video-search request carries beside its pictures. */
export const VIDEO_SEARCH_FIELDS = {
  searchId: ['text', 40],
  videoName: ['text', 200],
  videoBytes: 'number',
  videoSeconds: 'number',
  videoSha256: ['text', 64],
  cameraPlace: ['text', 200],
  recordedFrom: ['text', 40],
  batch: 'number',
  batches: 'number',
  facesFound: 'number',
  facesTooSmall: 'number',
  times: ['text', 200],
};

const SEARCH_ID = /^vs_[A-Za-z0-9_-]{6,32}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/**
 * The record a video-search request is audited with, or `{ error }`. A
 * search must say which search it is part of and where the camera is; the
 * rest is kept when it is well formed and dropped when it is not.
 */
export function videoSearchRecord(body = {}) {
  const searchId = String(body.searchId || '');
  if (!SEARCH_ID.test(searchId)) return { error: 'This search has no reference. Start the search again.' };
  const cameraPlace = String(body.cameraPlace || '').trim();
  if (cameraPlace.length < 3) return { error: 'Say where the camera is.' };
  const sha = String(body.videoSha256 || '').trim().toLowerCase();
  const recorded = String(body.recordedFrom || '').trim();
  const times = String(body.times || '')
    .split(',')
    .map((t) => Number(t))
    .filter((t) => Number.isFinite(t) && t >= 0)
    .slice(0, VIDEO_SEARCH_BATCH)
    .map((t) => Math.round(t * 10) / 10);
  return {
    searchId,
    cameraPlace,
    videoName: String(body.videoName || '').trim() || null,
    videoBytes: count(body.videoBytes),
    videoSeconds: count(body.videoSeconds),
    videoSha256: SHA256.test(sha) ? sha : null,
    recordedFrom: recorded && Number.isFinite(Date.parse(recorded)) ? recorded : null,
    batch: count(body.batch),
    batches: count(body.batches),
    facesFound: count(body.facesFound),
    facesTooSmall: count(body.facesTooSmall),
    times,
  };
}

/** A time in a video as a sighting stores it: "0:12", "1:02:09". */
const VIDEO_TIME = /^\d{1,2}(?::[0-5]\d){1,2}$/;

/**
 * The moments in a video a sighting's pictures were taken from, from the
 * form's `videoFrames` text ("0:12, 0:47"): at most three, or null.
 */
export function videoFrameTimesOf(value, max = 3) {
  const times = String(value || '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => VIDEO_TIME.test(t))
    .slice(0, max);
  return times.length ? times : null;
}
