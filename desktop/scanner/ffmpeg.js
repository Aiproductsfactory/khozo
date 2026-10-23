// Reading video files with FFmpeg: what a file holds, its frames at a steady
// rate from a chosen window, and one whole frame at a moment.
//
// FFmpeg opens what a browser cannot: DVR exports in H.265, Dahua .dav, raw
// .264 streams, MPEG-TS. The video is read in place and never copied; frames
// come out as raw pixels on a pipe, one at a time, and are dropped as soon as
// they have been looked at.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

const ffprobePath = ffprobe.path;

function run(cmd, args, { stderrLimit = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { err = (err + d.toString()).slice(-stderrLimit); });
    child.on('error', (e) => reject(new Error(`${cmd} could not start: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim() || `${cmd} exited with code ${code}`))));
  });
}

/** A frame rate from ffprobe's "25/1" or "30000/1001". */
function rate(value) {
  const [n, d] = String(value || '').split('/').map(Number);
  return n > 0 && d > 0 ? n / d : 0;
}

/**
 * What a video file holds: `{ bytes, duration, width, height, fps, codec,
 * recordedFrom }`. `recordedFrom` is the recording's start as the file says it
 * (`creation_time`), or null: DVR exports often carry it, phone videos too, and
 * the officer confirms it before it is used.
 */
export async function probe(file) {
  const raw = await run(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const info = JSON.parse(raw.toString('utf8'));
  const video = (info.streams || []).find((s) => s.codec_type === 'video');
  if (!video) throw new Error('No video stream in this file');
  const fps = rate(video.avg_frame_rate) || rate(video.r_frame_rate) || 25;
  const tags = { ...(info.format?.tags || {}), ...(video.tags || {}) };
  const created = tags.creation_time || tags.CREATION_TIME || null;
  return {
    bytes: Number(info.format?.size) || fs.statSync(file).size,
    duration: Number(info.format?.duration) || Number(video.duration) || 0,
    width: Number(video.width) || 0,
    height: Number(video.height) || 0,
    fps,
    codec: video.codec_name || null,
    recordedFrom: created && Number.isFinite(Date.parse(created)) ? new Date(created).toISOString() : null,
  };
}

/** The file's SHA-256, streamed, so a 10 GB export is fingerprinted without being held in memory. */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Reads the frames of `file` between `from` and `to` seconds, `fps` a second,
 * as RGBA pixels at the video's own size, and gives each to `onFrame(rgba, t)`.
 * Reading waits while `onFrame` runs, so no more than one frame is held at a
 * time. `signal` stops the read; what was found so far is kept by the caller.
 */
export async function readFrames(file, { from = 0, to = null, fps = 2, width, height, signal } = {}, onFrame) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (from > 0) args.push('-ss', String(from));
  if (to != null && to > from) args.push('-t', String(to - from));
  args.push('-i', file, '-vf', `fps=${fps}`, '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1');
  const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err = (err + d.toString()).slice(-4000); });
  const stop = () => child.kill();
  signal?.addEventListener('abort', stop, { once: true });

  const frameBytes = width * height * 4;
  let pending = [];
  let pendingBytes = 0;
  let index = 0;
  try {
    for await (const chunk of child.stdout) {
      pending.push(chunk);
      pendingBytes += chunk.length;
      while (pendingBytes >= frameBytes) {
        const all = pending.length === 1 ? pending[0] : Buffer.concat(pending);
        const frame = all.subarray(0, frameBytes);
        const rest = all.subarray(frameBytes);
        pending = rest.length ? [rest] : [];
        pendingBytes = rest.length;
        if (signal?.aborted) return index;
        // The fps filter puts frames at even steps from the start of the window.
        await onFrame(frame, from + index / fps);
        index += 1;
      }
    }
  } finally {
    signal?.removeEventListener('abort', stop);
  }
  if (!signal?.aborted) {
    const code = await new Promise((resolve) => (child.exitCode != null ? resolve(child.exitCode) : child.on('close', resolve)));
    if (code !== 0 && index === 0) throw new Error(err.trim() || `This video could not be opened (FFmpeg exited with code ${code})`);
  }
  return index;
}

/**
 * The whole frame at `t` seconds as RGBA pixels, `{ rgba, width, height }`,
 * for "see full picture" and "play from here".
 */
export async function frameAt(file, t, { width, height }) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1'];
  const rgba = await run(ffmpegPath, args);
  if (rgba.length < width * height * 4) throw new Error(`No frame at ${t}s`);
  return { rgba: rgba.subarray(0, width * height * 4), width, height };
}

export { ffmpegPath, ffprobePath };
