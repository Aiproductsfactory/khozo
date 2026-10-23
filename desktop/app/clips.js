// "Play from here" and "See full picture": a short clip around a moment, and
// the whole frame with the face boxed, made from the officer's own video file
// when asked for and kept in memory only.
import { spawn } from 'node:child_process';
import { ffmpegPath } from '../scanner/ffmpeg.js';
import { markedFrame } from '../scanner/scan.js';

/** Seconds of video shown before and after the moment. */
export const CLIP_BEFORE = 5;
export const CLIP_AFTER = 15;

/**
 * An MP4 (H.264, at most 960 pixels wide, no sound) of the video from a few
 * seconds before `t` to some seconds after, as a Buffer. Any format FFmpeg
 * reads becomes one the window can play.
 */
export function clipAround(file, t, { before = CLIP_BEFORE, after = CLIP_AFTER } = {}) {
  const from = Math.max(0, t - before);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-ss', String(from), '-i', file, '-t', String(before + after),
    '-vf', "scale='min(960,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
    '-an', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('error', reject);
    child.on('close', (code) => {
      const video = Buffer.concat(out);
      if (code === 0 && video.length) resolve({ video, from });
      else reject(new Error(err.trim() || `The clip could not be made (FFmpeg ${code})`));
    });
  });
}

/** The whole frame at the person's moment, the face boxed, as a JPEG Buffer. */
export function frameOf(file, track) {
  return markedFrame(file.path, { width: file.width, height: file.height }, track);
}
