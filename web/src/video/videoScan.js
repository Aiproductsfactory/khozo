// Reading a video on the device and finding the faces in it.
//
// The video file never leaves the device. It is opened by the browser's own
// player, looked at every so often (faces.js sampleTimes), and each face found
// is followed from one look to the next (faces.js createTracker), keeping the
// clearest picture of each person (on a small video, the clearest few). What
// comes out is a short list of face pictures with the moment each was seen:
// the only thing that is ever sent.
import {
  COMPARE_SIDE, CROP_SIDE, MIN_FACE_PX, SMALL_FACE_SCORE_MIN, SMALL_VIDEO_ENLARGE, SMALL_VIDEO_PICTURES, cropBox, createTracker,
  faceQuality, isSmallVideo, lookRate, minFaceFor, sampleInterval, sampleTimes, scaleFaces, sharpness,
} from './faces.js';
import { loadDetector } from './detector.js';
import { msg } from '../i18n.jsx';

/** A video this browser cannot open or play, with what to do about it. */
export class VideoUnreadable extends Error {}

const UNREADABLE = msg('This video could not be opened here. Save it as an MP4 (H.264) file and try again. Camera software can usually export one.');

/** The largest face picture made, in pixels on a side. */
const CROP_MAX = 960;

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No picture'))), type, quality));
}

/** Resolves on the first of `events`, rejects on `error`, or settles as `false` after `ms`. */
function waitFor(target, events, ms) {
  return new Promise((resolve, reject) => {
    const done = () => { clean(); resolve(true); };
    const fail = () => { clean(); reject(new VideoUnreadable(UNREADABLE)); };
    const timer = setTimeout(() => { clean(); resolve(false); }, ms);
    function clean() {
      clearTimeout(timer);
      events.forEach((e) => target.removeEventListener(e, done));
      target.removeEventListener('error', fail);
    }
    events.forEach((e) => target.addEventListener(e, done));
    target.addEventListener('error', fail);
  });
}

/** Moves the player to `t` seconds; false if it did not get there in time. */
export async function seekTo(video, t) {
  const arrived = waitFor(video, ['seeked'], 10000);
  video.currentTime = t;
  return arrived;
}

/**
 * Opens a video file in a player that is never shown:
 * `{ video, duration, width, height, close() }`. Throws VideoUnreadable when
 * the browser cannot play it (an AVI or a camera maker's own format, or a
 * codec this device has no decoder for).
 */
export async function openVideo(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const close = () => {
    try {
      video.removeAttribute('src');
      video.load();
    } catch {}
    URL.revokeObjectURL(url);
  };
  try {
    const loaded = waitFor(video, ['loadedmetadata'], 20000);
    video.src = url;
    if (!(await loaded)) throw new VideoUnreadable(UNREADABLE);
    // A recording whose length was never written (some phone and browser
    // recordings): asking for a moment far past the end makes the player
    // find the real end.
    if (!Number.isFinite(video.duration)) {
      const found = waitFor(video, ['durationchange', 'seeked'], 15000);
      video.currentTime = 1e7;
      await found;
      await seekTo(video, 0);
    }
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration) || video.duration <= 0) {
      throw new VideoUnreadable(UNREADABLE);
    }
    return { video, duration: video.duration, width: video.videoWidth, height: video.videoHeight, close };
  } catch (err) {
    close();
    throw err instanceof VideoUnreadable ? err : new VideoUnreadable(UNREADABLE);
  }
}

/** How sharp a face is, read from the player's current frame at 64 px. */
function faceSharpness(video, face, ctx) {
  const side = 64;
  ctx.drawImage(video, face.x, face.y, face.w, face.h, 0, 0, side, side);
  const { data } = ctx.getImageData(0, 0, side, side);
  const luma = new Float32Array(side * side);
  for (let i = 0, j = 0; i < luma.length; i += 1, j += 4) luma[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  return sharpness(luma, side, side);
}

/** A face picture cut from the player's current frame, as a JPEG Blob. */
async function cropPicture(video, face, width, height) {
  const box = cropBox(face, width, height);
  const side = Math.max(CROP_SIDE, Math.min(CROP_MAX, box.w));
  const canvas = makeCanvas(side, side);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, box.x, box.y, box.w, box.h, 0, 0, side, side);
  return canvasBlob(canvas, 'image/jpeg', 0.9);
}

/**
 * The whole frame at `t` seconds as a JPEG Blob. With `mark`, a box is drawn
 * round that face so the person looking knows which one is meant; the copy
 * saved as a record is left unmarked.
 */
export async function frameBlob(opened, t, { mark = null } = {}) {
  const { video, width, height } = opened;
  await seekTo(video, t);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);
  if (mark) {
    ctx.lineWidth = Math.max(3, Math.round(Math.max(width, height) / 400));
    ctx.strokeStyle = '#facc15';
    const pad = mark.w * 0.25;
    ctx.strokeRect(mark.x - pad, mark.y - pad, mark.w + 2 * pad, mark.h + 2 * pad);
  }
  return canvasBlob(canvas, 'image/jpeg', 0.92);
}

/**
 * Finds the faces in a video file.
 *
 * Options:
 *   maxSide   the size the frames are searched at, on their longer side: 960
 *             finds faces in an ordinary phone video quickly; 1280 or 1920
 *             finds the smaller faces of a camera on a wall, more slowly
 *   interval  seconds between looks; by default set from the length
 *   minFace   the narrowest face used, in the video's pixels (MIN_FACE_PX)
 *   smallVideo  true: a small video (faces.js isSmallVideo) is looked at more
 *             often (lookRate), its faces are found on the frame enlarged
 *             (SMALL_VIDEO_ENLARGE), faces down to SMALL_MIN_FACE_PX are used,
 *             and up to SMALL_VIDEO_PICTURES pictures of each person are kept
 *   maxTracks the most people kept; past it, a clearer face replaces the
 *             least clear person
 *   keepOpen  leave the player open afterwards, to show whole frames
 *   onStage   'loading' (the face finder), then 'reading'
 *   onProgress({ done, total, faces })
 *   signal    an AbortSignal: stopping keeps what was found so far
 *
 * Resolves to { tracks, duration, width, height, interval, looks, tooSmall,
 * small, stopped, opened }. Each track is { id, time, firstTime, lastTime,
 * seen, face, quality, blob, url, pictures }, earliest first, where blob and
 * url are its clearest picture and `pictures` the ones kept, clearest first,
 * each { blob, url, quality, time, face }; every `url` is an object URL the
 * caller revokes (releaseTracks).
 */
export async function scanVideo(file, {
  maxSide = 960, interval = null, minFace = null, smallVideo = false, maxTracks = 200, keepOpen = false, onStage, onProgress, signal,
} = {}) {
  onStage?.('loading');
  const detector = await loadDetector();
  const opened = await openVideo(file);
  const { video, duration, width, height } = opened;
  try {
    onStage?.('reading');
    const small = smallVideo && isSmallVideo(width, height);
    // A small video's frame is enlarged to find its faces; any other is made no larger than maxSide.
    const scale = small ? SMALL_VIDEO_ENLARGE : Math.min(1, maxSide / Math.max(width, height));
    const dw = Math.max(32, Math.round(width * scale));
    const dh = Math.max(32, Math.round(height * scale));
    const usual = interval || sampleInterval(duration);
    const step = small ? 1 / lookRate(1 / usual, width, height) : usual;
    const times = sampleTimes(duration, step);
    const smallest = minFace ?? (small ? minFaceFor(width, height) : MIN_FACE_PX);
    const keep = small ? SMALL_VIDEO_PICTURES : 1;
    const look = makeCanvas(dw, dh).getContext('2d', { willReadFrequently: true });
    look.imageSmoothingEnabled = true;
    look.imageSmoothingQuality = 'high';
    const patch = makeCanvas(64, 64).getContext('2d', { willReadFrequently: true });
    const tracker = createTracker({ maxGap: Math.max(3, step * 3) });
    // Track id -> [{ blob, url, quality, time, face }], clearest first, at most `keep`
    const pictures = new Map();
    let tooSmall = 0;
    let looks = 0;
    let stopped = false;

    const weakest = () => {
      let worst = null;
      for (const [id, list] of pictures) if (!worst || list[0].quality < worst.quality) worst = { id, quality: list[0].quality };
      return worst;
    };
    const drop = (list) => list.forEach((p) => URL.revokeObjectURL(p.url));

    for (const t of times) {
      if (signal?.aborted) {
        stopped = true;
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      if (!(await seekTo(video, t))) continue;
      look.drawImage(video, 0, 0, dw, dh);
      // eslint-disable-next-line no-await-in-loop
      const found = scaleFaces(await detector.detect(look.getImageData(0, 0, dw, dh), small ? SMALL_FACE_SCORE_MIN : undefined), 1 / scale);
      looks += 1;
      const usable = [];
      for (const face of found) {
        if (face.w < smallest) {
          tooSmall += 1;
          continue;
        }
        face.quality = faceQuality(face, faceSharpness(video, face, patch));
        usable.push(face);
      }
      for (const { track, better } of tracker.add(t, usable)) {
        const face = track.last;
        const list = pictures.get(track.id) || [];
        // The clearest `keep` moments of the person, whatever their spacing.
        if (!better && !(list.length < keep || face.quality > list.at(-1).quality)) continue;
        if (!pictures.has(track.id) && pictures.size >= maxTracks) {
          const worst = weakest();
          if (!worst || worst.quality >= face.quality) continue;
          drop(pictures.get(worst.id));
          pictures.delete(worst.id);
        }
        // eslint-disable-next-line no-await-in-loop
        const blob = await cropPicture(video, face, width, height);
        list.push({ blob, url: URL.createObjectURL(blob), quality: face.quality, time: t, face });
        list.sort((a, b) => b.quality - a.quality);
        drop(list.splice(keep));
        pictures.set(track.id, list);
      }
      onProgress?.({ done: looks, total: times.length, faces: pictures.size });
    }

    const tracks = tracker.tracks()
      .filter((track) => pictures.has(track.id))
      .map((track) => {
        const list = pictures.get(track.id);
        return { ...track, quality: track.face.quality, blob: list[0].blob, url: list[0].url, pictures: list };
      })
      .sort((a, b) => a.time - b.time);
    return { tracks, duration, width, height, interval: step, looks, tooSmall, small, stopped, opened: keepOpen ? opened : null };
  } finally {
    if (!keepOpen) opened.close();
  }
}

/** Frees the face pictures of a scan. */
export function releaseTracks(tracks) {
  for (const track of tracks || []) {
    if (track?.url) URL.revokeObjectURL(track.url);
    for (const p of track?.pictures || []) if (p?.url) URL.revokeObjectURL(p.url);
  }
}

/** A face picture as a File, named by when in the video it was seen. */
export function trackFile(track, prefix = 'video') {
  const at = Math.round(Number(track.time) * 10) / 10;
  return new File([track.blob], `${prefix}-${String(at).replace('.', '_')}s.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

/**
 * The copy of a face picture the face engines are sent to compare: the
 * picture at COMPARE_SIDE pixels square (faces.js says why). The picture
 * itself, kept and shown, is not changed; if the copy cannot be made, the
 * picture goes as it is.
 */
export async function comparisonFile(track, prefix = 'face') {
  const at = Math.round(Number(track.time) * 10) / 10;
  let blob = track.blob;
  try {
    const bitmap = await createImageBitmap(track.blob);
    const canvas = makeCanvas(COMPARE_SIDE, COMPARE_SIDE);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, COMPARE_SIDE, COMPARE_SIDE);
    bitmap.close?.();
    blob = await canvasBlob(canvas, 'image/jpeg', 0.9);
  } catch { /* the picture as it is */ }
  return new File([blob], `${prefix}-${String(at).replace('.', '_')}s.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

/**
 * Where a phone recorded a video, from the place written into the file:
 * `{ lat, lng }` or null. Phones write it as an ISO 6709 text such as
 * "+23.0225+072.5714/", in the '©xyz' or 'location.ISO6709' entry, which
 * sits at the start or the end of the file, so only those are read.
 */
export async function readVideoLocation(file) {
  try {
    const size = file.size || 0;
    const span = 1024 * 1024;
    const parts = [file.slice(0, Math.min(size, span))];
    if (size > span) parts.push(file.slice(Math.max(span, size - span), size));
    for (const part of parts) {
      // eslint-disable-next-line no-await-in-loop
      const text = new TextDecoder('latin1').decode(await part.arrayBuffer());
      for (const marker of ['©xyz', 'ISO6709']) {
        let at = text.indexOf(marker);
        while (at !== -1) {
          const m = /([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)/.exec(text.slice(at, at + 120));
          if (m) {
            const lat = Number(m[1]);
            const lng = Number(m[2]);
            if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) return { lat, lng };
          }
          at = text.indexOf(marker, at + marker.length);
        }
      }
    }
  } catch {}
  return null;
}
