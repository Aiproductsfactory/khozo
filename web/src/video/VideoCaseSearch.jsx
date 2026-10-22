import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { currentLocale, msg, useT } from '../i18n.jsx';
import { ProtectedImage, txt } from '../lib.jsx';
import { formatBytes } from '../photoPrep.js';
import { useBackClose } from '../useBackClose.js';
import { VIDEO_SEARCH_BATCH, VIDEO_SEARCH_MAX_FACES } from '../../../shared/video-search.js';
import { formatVideoTime } from './faces.js';
import { fileSha256 } from './sha256.js';
import { frameBlob, releaseTracks, scanVideo, trackFile } from './videoScan.js';

/*
 * "Check CCTV video": is this missing person anywhere in this footage?
 *
 * Written for an officer who is not a computer person: one window, three
 * screens. Choose the video and say where the camera is; wait while it is
 * checked; see the places the person may be, each with two buttons. Every
 * technical step is still done, out of sight: the faces are found on this
 * computer (the video is never uploaded), the clearest picture of each face
 * is compared with this case's photo by the face engines, a few at a time
 * (POST /reports/:id/video-search), and the file's fingerprint (SHA-256) goes
 * into the audit log with every request.
 */

const INTERVALS = [
  { value: '1', label: msg('Normal') },
  { value: '0.5', label: msg('Careful (slower)') },
  { value: '2', label: msg('Quick') },
];

const VERDICT_WORDS = {
  likely: msg('Likely the same person'),
  possible: msg('Possibly the same person'),
};

/** How long to wait before sending faces again that no engine answered. */
const ENGINE_BUSY_WAIT_MS = 15000;

/** The share of the progress bar each part of the work fills. */
const SHARE = { reading: [0, 70], fingerprint: [70, 76], comparing: [76, 100] };

const newSearchId = () => `vs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function VideoCaseSearch({ report, onClose }) {
  const t = useT();
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ cameraPlace: '', recordedFrom: '', interval: '1', smallFaces: false });
  // start | working | done | error
  const [screen, setScreen] = useState('start');
  // loading | reading | fingerprint | comparing, while working
  const [stage, setStage] = useState('loading');
  const [progress, setProgress] = useState(null);
  const [scan, setScan] = useState(null);
  const [verdicts, setVerdicts] = useState({});
  const [error, setError] = useState('');
  const [fingerprint, setFingerprint] = useState(null);
  const [frame, setFrame] = useState(null); // { id, url }
  const [saved, setSaved] = useState({}); // track id -> 'busy' | 'done' | error text
  const [busyEngines, setBusyEngines] = useState(false);
  const [stopped, setStopped] = useState(false);
  const fileRef = useRef(null);
  const abortRef = useRef(null);
  const scanRef = useRef(null);
  const frameRef = useRef(null);

  const close = () => {
    abortRef.current?.abort();
    onClose?.();
  };
  // The phone's Back button and Escape close the window, as any dialog.
  useBackClose(true, close);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Close the video and free its pictures when the window closes.
  useEffect(() => () => {
    abortRef.current?.abort();
    releaseTracks(scanRef.current?.tracks);
    scanRef.current?.opened?.close();
    if (frameRef.current) URL.revokeObjectURL(frameRef.current);
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const clockAt = (seconds) => {
    const start = Date.parse(form.recordedFrom);
    if (!Number.isFinite(start)) return null;
    return new Date(start + seconds * 1000).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'medium' });
  };

  const resetScan = () => {
    abortRef.current?.abort();
    releaseTracks(scanRef.current?.tracks);
    scanRef.current?.opened?.close();
    scanRef.current = null;
    if (frameRef.current) URL.revokeObjectURL(frameRef.current);
    frameRef.current = null;
    setScan(null);
    setVerdicts({});
    setFingerprint(null);
    setFrame(null);
    setSaved({});
    setProgress(null);
    setError('');
    setStopped(false);
  };

  const chooseFile = (e) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    resetScan();
    setFile(picked);
    setScreen('start');
  };

  const placeMissing = form.cameraPlace.trim().length < 3;
  const ready = Boolean(file) && !placeMissing;

  /** Sends faces to be compared with the case, a few at a time. */
  const compare = async (result, tracks, { searchId, sha, controller }) => {
    setStage('comparing');
    const batches = [];
    for (let i = 0; i < tracks.length; i += VIDEO_SEARCH_BATCH) batches.push(tracks.slice(i, i + VIDEO_SEARCH_BATCH));
    setProgress({ done: 0, total: tracks.length });

    const formFor = (faces, index) => {
      const fd = new FormData();
      faces.forEach((track, i) => fd.append(i === 0 ? 'photo' : 'extraPhotos', trackFile(track, 'face')));
      fd.append('searchId', searchId);
      fd.append('videoName', (file.name || '').slice(0, 200));
      fd.append('videoBytes', String(file.size || 0));
      fd.append('videoSeconds', String(Math.round(result.duration)));
      fd.append('videoSha256', sha);
      fd.append('cameraPlace', form.cameraPlace.trim().slice(0, 200));
      if (form.recordedFrom) fd.append('recordedFrom', form.recordedFrom);
      fd.append('batch', String(index + 1));
      fd.append('batches', String(batches.length));
      fd.append('facesFound', String(result.tracks.length));
      fd.append('facesTooSmall', String(result.tooSmall || 0));
      fd.append('times', faces.map((track) => track.time.toFixed(1)).join(','));
      return fd;
    };
    // Every face unanswered means the engines were busy or briefly down:
    // wait, and send them once more.
    const ask = async (faces, index) => {
      let data = await api.postForm(`/reports/${report.id}/video-search`, formFor(faces, index));
      if ((data.results || []).length && data.results.every((row) => row.verdict === 'no_answer') && !controller.signal.aborted) {
        setBusyEngines(true);
        await new Promise((resolve) => setTimeout(resolve, ENGINE_BUSY_WAIT_MS));
        setBusyEngines(false);
        if (!controller.signal.aborted) data = await api.postForm(`/reports/${report.id}/video-search`, formFor(faces, index));
      }
      const answered = {};
      for (const row of data.results || []) {
        const track = faces[row.index];
        if (track) answered[track.id] = row.verdict;
      }
      return answered;
    };
    // The server itself failed, with no answer in words: on the smallest
    // hosting plan a request doing too much is cut off.
    const isFault = (err) => [500, 502, 503, 504].includes(err?.status) && !err?.data?.error;

    let done = 0;
    for (const [index, batch] of batches.entries()) {
      if (controller.signal.aborted) break;
      const answered = {};
      let stop = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        Object.assign(answered, await ask(batch, index));
      } catch (err) {
        if (isFault(err) && batch.length > 1) {
          // Several faces at once were too much: one at a time.
          for (const track of batch) {
            if (controller.signal.aborted) break;
            try {
              // eslint-disable-next-line no-await-in-loop
              Object.assign(answered, await ask([track], index));
            } catch (single) {
              if (!isFault(single)) {
                stop = single;
                break;
              }
            }
          }
        } else {
          stop = err;
        }
      }
      // A face with no verdict is "not checked", to send again.
      setVerdicts((prev) => ({ ...prev, ...Object.fromEntries(batch.map((track) => [track.id, answered[track.id] || 'no_answer'])) }));
      if (stop) {
        if (stop.status === 429) {
          setError(msg('Too many faces were checked in a short time. Wait a few minutes, then press Try again.'));
          break;
        }
        if ([400, 403, 404, 409, 501, 503].includes(stop.status) && !isFault(stop)) {
          setError(stop.message);
          break;
        }
      }
      done += batch.length;
      setProgress({ done, total: tracks.length });
    }
  };

  /** Everything, from the chosen video to the answer, in one go. */
  const start = async () => {
    if (!ready) return;
    resetScan();
    setScreen('working');
    setStage('loading');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await scanVideo(file, {
        maxSide: form.smallFaces ? 1920 : 1280,
        interval: Number(form.interval) || 1,
        maxTracks: 1000,
        keepOpen: true,
        signal: controller.signal,
        onStage: setStage,
        onProgress: setProgress,
      });
      if (controller.signal.aborted) {
        // Stopped while looking for faces: back to the start (stop()).
        releaseTracks(result.tracks);
        result.opened?.close();
        return;
      }
      scanRef.current = result;
      setScan(result);
      if (!result.tracks.length) {
        setScreen('done');
        return;
      }
      setStage('fingerprint');
      setProgress({ done: 0, total: 1 });
      const sha = await fileSha256(file, { signal: controller.signal, onProgress: (share) => setProgress({ done: share, total: 1 }) });
      setFingerprint(sha);
      const searchId = newSearchId();
      result.searchId = searchId;
      // The clearest faces first, at most VIDEO_SEARCH_MAX_FACES.
      const clearest = result.tracks.slice().sort((a, b) => b.quality - a.quality).slice(0, VIDEO_SEARCH_MAX_FACES);
      await compare(result, clearest, { searchId, sha, controller });
      setStopped(controller.signal.aborted);
      setScreen('done');
    } catch (err) {
      // Stopped before comparing began: stop() has gone back to the start.
      if (err?.name === 'AbortError') return;
      setError(err?.message || msg('The video could not be read.'));
      setScreen('error');
    }
  };

  /** Sends again the faces no engine answered for. */
  const tryAgain = async (tracks) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setError('');
    setScreen('working');
    await compare(scan, tracks, { searchId: scan.searchId || newSearchId(), sha: fingerprint, controller });
    setStopped(controller.signal.aborted);
    setScreen('done');
  };

  /**
   * Stop: while faces are still being found there is nothing to show yet, so
   * back to the start; while comparing, the answers so far are kept.
   */
  const stop = () => {
    const comparing = stage === 'comparing';
    abortRef.current?.abort();
    if (!comparing) {
      resetScan();
      setScreen('start');
    }
  };

  const showFrame = async (track) => {
    if (!scanRef.current?.opened) return;
    if (frame?.id === track.id) {
      setFrame(null);
      return;
    }
    const blob = await frameBlob(scanRef.current.opened, track.time, { mark: track.face });
    if (frameRef.current) URL.revokeObjectURL(frameRef.current);
    frameRef.current = URL.createObjectURL(blob);
    setFrame({ id: track.id, url: frameRef.current });
  };

  const saveFrame = async (track) => {
    if (!scanRef.current?.opened) return;
    const blob = await frameBlob(scanRef.current.opened, track.time);
    download(blob, `khozo-${report.id}-${formatVideoTime(track.time).replace(/:/g, '-')}.jpg`);
  };

  /** Records the moment on the case, in words any desk can read later. */
  const addToCase = async (track) => {
    const clock = clockAt(track.time);
    const note = [
      'CCTV check: a possible sighting.',
      `Camera: ${form.cameraPlace.trim()}.`,
      `Seen ${formatVideoTime(track.time)} into the video${clock ? ` (about ${clock})` : ''}.`,
      verdicts[track.id] === 'likely' ? 'Likely the same person: both face engines agree.' : 'Possibly the same person: one face engine.',
      `Video "${file?.name || 'video'}" (${formatBytes(file?.size || 0)})${fingerprint ? `, fingerprint (SHA-256) ${fingerprint}` : ''}.`,
      'Checked by eye: not yet.',
    ].join(' ').slice(0, 1000);
    setSaved((prev) => ({ ...prev, [track.id]: 'busy' }));
    try {
      await api.post(`/reports/${report.id}/notes`, { note });
      setSaved((prev) => ({ ...prev, [track.id]: 'done' }));
    } catch (err) {
      setSaved((prev) => ({ ...prev, [track.id]: err.message || msg('Could not save. Try again.') }));
    }
  };

  const tracksById = useMemo(() => new Map((scan?.tracks || []).map((track) => [track.id, track])), [scan]);
  const ids = (wanted) => Object.entries(verdicts).filter(([, v]) => wanted.includes(v)).map(([id]) => tracksById.get(Number(id))).filter(Boolean);
  const hits = [...ids(['likely']), ...ids(['possible'])];
  const unanswered = ids(['no_answer']);
  const checked = Object.values(verdicts).filter((v) => v !== 'no_answer').length;

  // One bar for the whole job.
  const [from, to] = SHARE[stage] || [0, 0];
  const share = progress?.total ? Math.min(1, progress.done / progress.total) : 0;
  const pct = Math.round(from + (to - from) * share);
  const stageWords = {
    loading: msg('Getting ready…'),
    reading: msg('Looking for faces in the video…'),
    fingerprint: msg('Getting ready to compare…'),
    comparing: msg('Comparing faces with the case photo…'),
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="cctv-check-title">
      <div className="card flex h-full max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none bg-white shadow-2xl sm:h-auto sm:max-h-[94vh] sm:rounded-2xl">
        <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
          {txt(report.photoUrl) && (
            <ProtectedImage src={report.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-black/10" />
          )}
          <div className="min-w-0 flex-1">
            <h3 id="cctv-check-title" className="text-lg font-bold text-ink">{t('Check CCTV video')}</h3>
            <p className="truncate text-sm text-gray-600">{t('Looking for: {name}', { name: report.childName || report.id })}</p>
          </div>
          <button type="button" onClick={close} aria-label={t('Close')} className="grid h-11 w-11 place-items-center rounded-xl text-2xl font-bold text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            &times;
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
          <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={chooseFile} />

          {/* 1. Choose the video and say where the camera is. */}
          {screen === 'start' && (
            <>
              <div>
                <p className="label">{t('1. The video')}</p>
                {file ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-50 px-3 py-3 ring-1 ring-black/5">
                    <span className="min-w-0 flex-1 break-all text-sm font-medium text-ink">{file.name}</span>
                    <span className="text-xs text-gray-500">{formatBytes(file.size)}</span>
                    <button type="button" className="btn-ghost min-h-11 px-3 py-2 text-sm" onClick={() => fileRef.current?.click()}>{t('Change')}</button>
                  </div>
                ) : (
                  <button type="button" className="btn-primary w-full py-4 text-base" onClick={() => fileRef.current?.click()}>
                    {t('Choose the CCTV video')}
                  </button>
                )}
              </div>
              <div>
                <label className="label" htmlFor={`camera-${report.id}`}>{t('2. Where is this camera?')}</label>
                <input
                  id={`camera-${report.id}`}
                  className="field"
                  value={form.cameraPlace}
                  onChange={set('cameraPlace')}
                  placeholder={t('e.g. Kalupur railway station, gate 1')}
                  maxLength={200}
                  autoComplete="off"
                />
              </div>
              <details className="group rounded-xl ring-1 ring-black/10">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-2 text-sm font-semibold text-gray-700 [&::-webkit-details-marker]:hidden">
                  {t('More options')}
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 text-gray-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </summary>
                <div className="space-y-4 border-t border-black/5 px-4 py-4">
                  <div>
                    <label className="label" htmlFor={`recorded-${report.id}`}>{t('When does the recording start?')}</label>
                    <input id={`recorded-${report.id}`} className="field" type="datetime-local" step="1" value={form.recordedFrom} onChange={set('recordedFrom')} />
                    <p className="mt-1 text-xs text-gray-500">{t('Then each match shows the real time.')}</p>
                  </div>
                  <div>
                    <label className="label" htmlFor={`interval-${report.id}`}>{t('How carefully to check')}</label>
                    <select id={`interval-${report.id}`} className="field" value={form.interval} onChange={set('interval')}>
                      {INTERVALS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
                    </select>
                  </div>
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input type="checkbox" className="mt-1" checked={form.smallFaces} onChange={set('smallFaces')} />
                    <span>{t('Also look for faces far from the camera (slower)')}</span>
                  </label>
                </div>
              </details>
              <p className="flex items-start gap-2 text-xs text-gray-500">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                <span>{t('The video stays on this computer. Only the faces in it are checked against this case. Every check is recorded.')}</span>
              </p>
            </>
          )}

          {/* 2. Working: one bar for the whole job. */}
          {screen === 'working' && (
            <div role="status" className="py-6 text-center">
              <p className="text-base font-semibold text-ink">{t(stageWords[stage] || stageWords.loading)}</p>
              <div className="mx-auto mt-4 h-3 max-w-md overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
                <div className="h-full rounded-full bg-khozo transition-[width]" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 text-sm text-gray-600">{pct}%</p>
              {stage === 'reading' && progress?.faces > 0 && (
                <p className="mt-1 text-sm text-gray-600">{t('Faces found: {n}', { n: progress.faces })}</p>
              )}
              {busyEngines && <p className="mt-2 text-sm font-medium text-amber-800">{t('Waiting a few seconds, then trying again…')}</p>}
              <p className="mt-4 text-xs text-gray-500">{t('Keep this window open. A short video takes about a minute.')}</p>
            </div>
          )}

          {screen === 'error' && (
            <div role="alert" className="rounded-xl bg-red-50 px-4 py-4 text-sm text-red-800 ring-1 ring-red-100">
              <p className="font-semibold">{t(error)}</p>
            </div>
          )}

          {/* 3. The answer. */}
          {screen === 'done' && scan && (
            <div className="space-y-4">
              {error && <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">{t(error)}</p>}
              {stopped && <p className="text-sm text-gray-600">{t('Stopped part way. These are the answers so far.')}</p>}
              {!scan.tracks.length ? (
                <div className="rounded-xl bg-gray-50 px-4 py-4 ring-1 ring-black/5">
                  <p className="text-base font-semibold text-ink">{t('No clear face was found in this video.')}</p>
                  <p className="mt-1 text-sm text-gray-600">{t('Faces must be near the camera and facing it. Try another camera, or “Also look for faces far from the camera” under More options.')}</p>
                </div>
              ) : hits.length ? (
                <div className="rounded-xl bg-amber-50 px-4 py-4 ring-1 ring-amber-300">
                  <p className="text-base font-bold text-ink">
                    {hits.length === 1 ? t('1 possible match found') : t('{n} possible matches found', { n: hits.length })}
                  </p>
                  <p className="mt-1 text-sm text-gray-700">{t('Look at each one. If it is the same person, go to the place and check.')}</p>
                </div>
              ) : (
                <div className="rounded-xl bg-gray-50 px-4 py-4 ring-1 ring-black/5">
                  <p className="text-base font-semibold text-ink">{t('No match found in this video.')}</p>
                  <p className="mt-1 text-sm text-gray-600">{t('Faces that are small, turned away or blurred cannot be checked, so the person may still be there.')}</p>
                </div>
              )}

              {hits.map((track) => {
                const clock = clockAt(track.time);
                const state = saved[track.id];
                return (
                  <div key={track.id} className="rounded-xl p-3 ring-1 ring-black/10">
                    <div className="grid grid-cols-2 gap-2">
                      <figure>
                        <img src={track.url} alt="" className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10" />
                        <figcaption className="mt-1 text-center text-xs text-gray-500">{t('From the video')}</figcaption>
                      </figure>
                      <figure>
                        {txt(report.photoUrl) && <ProtectedImage src={report.photoUrl} alt="" className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10" />}
                        <figcaption className="mt-1 text-center text-xs text-gray-500">{t('Case photo')}</figcaption>
                      </figure>
                    </div>
                    <p className={`mt-3 text-base font-bold ${verdicts[track.id] === 'likely' ? 'text-amber-900' : 'text-ink'}`}>{t(VERDICT_WORDS[verdicts[track.id]] || VERDICT_WORDS.possible)}</p>
                    <p className="text-sm text-gray-700">
                      {t('At {time} in the video', { time: formatVideoTime(track.time) })}
                      {clock && <span className="text-gray-500"> · {clock}</span>}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" className="btn-ghost min-h-11" onClick={() => showFrame(track)}>
                        {frame?.id === track.id ? t('Hide full picture') : t('See full picture')}
                      </button>
                      {state === 'done' ? (
                        <span className="grid min-h-11 place-items-center rounded-xl bg-emerald-50 text-sm font-semibold text-emerald-800">{t('Added to case')}</span>
                      ) : (
                        <button type="button" className="btn-primary min-h-11" disabled={state === 'busy'} onClick={() => addToCase(track)}>
                          {state === 'busy' ? t('Saving…') : t('Add to case')}
                        </button>
                      )}
                    </div>
                    {state && !['busy', 'done'].includes(state) && <p className="mt-1 text-xs text-red-700">{t(state)}</p>}
                    {frame?.id === track.id && (
                      <div className="mt-3">
                        <img src={frame.url} alt={t('The full picture, the face marked')} className="w-full rounded-lg ring-1 ring-black/10" />
                        <button type="button" className="mt-1 text-sm font-semibold text-khozo-dark underline underline-offset-2" onClick={() => saveFrame(track)}>
                          {t('Download this picture')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {scan.tracks.length > 0 && (
                <p className="text-xs text-gray-500">
                  {t('{n} faces checked.', { n: checked })}
                  {unanswered.length > 0 && <> {t('{n} could not be checked.', { n: unanswered.length })}</>}
                </p>
              )}
            </div>
          )}
        </div>

        {/* The one next step, always at the bottom. */}
        <div className="flex gap-2 border-t bg-white px-4 py-3 sm:px-6">
          {screen === 'start' && (
            <>
              <button type="button" className="btn-ghost" onClick={close}>{t('Cancel')}</button>
              <button type="button" className="btn-primary flex-1 py-3 text-base" disabled={!ready} onClick={start}>
                {!file ? t('Choose the video first') : placeMissing ? t('Say where the camera is') : t('Start checking')}
              </button>
            </>
          )}
          {screen === 'working' && (
            <button type="button" className="btn-ghost flex-1" onClick={stop}>{t('Stop')}</button>
          )}
          {screen === 'error' && (
            <>
              <button type="button" className="btn-ghost" onClick={close}>{t('Close')}</button>
              <button type="button" className="btn-primary flex-1" onClick={() => { setError(''); setScreen('start'); }}>{t('Try again')}</button>
            </>
          )}
          {screen === 'done' && (
            <>
              {unanswered.length > 0 ? (
                <button type="button" className="btn-ghost" onClick={() => tryAgain(unanswered)}>{t('Try again')}</button>
              ) : (
                <button type="button" className="btn-ghost" onClick={() => { resetScan(); setFile(null); setScreen('start'); }}>{t('Check another video')}</button>
              )}
              <button type="button" className="btn-primary flex-1" onClick={close}>{t('Done')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
