import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { currentLocale, msg, useT } from '../i18n.jsx';
import { ProtectedImage, txt } from '../lib.jsx';
import { formatBytes } from '../photoPrep.js';
import { VIDEO_SEARCH_BATCH, VIDEO_SEARCH_MAX_FACES } from '../../../shared/video-search.js';
import { formatVideoTime } from './faces.js';
import { fileSha256 } from './sha256.js';
import { frameBlob, releaseTracks, scanVideo, trackFile } from './videoScan.js';

/*
 * "Is this person anywhere in this footage?"
 *
 * An officer chooses a CCTV export (or any video) on their own computer. The
 * faces in it are found there, and the clearest picture of each face is
 * compared with this case's photo by the face engines, a few at a time
 * (POST /reports/:id/video-search). The video is never uploaded, and the
 * server keeps none of the pictures; every request is in the audit log with
 * the video's name, size, fingerprint and the camera's place.
 *
 * What comes back is a list of moments to look at, not an answer: the
 * officer looks at each frame, and goes to the place.
 */

const INTERVALS = [
  { value: '1', label: msg('Every second') },
  { value: '0.5', label: msg('Every half second (slower, misses less)') },
  { value: '2', label: msg('Every 2 seconds (faster)') },
];

const VERDICT_WORDS = {
  likely: msg('Both face engines say this may be the same person.'),
  possible: msg('One face engine says this may be the same person. Check by eye.'),
};

/** How long to wait before sending a batch again that no engine answered. */
const ENGINE_BUSY_WAIT_MS = 15000;

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

export default function VideoCaseSearch({ report }) {
  const t = useT();
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ cameraPlace: '', recordedFrom: '', interval: '1', smallFaces: false });
  // setup | loading | reading | found | fingerprint | comparing | done | error
  const [stage, setStage] = useState('setup');
  const [progress, setProgress] = useState(null);
  const [scan, setScan] = useState(null);
  const [verdicts, setVerdicts] = useState({});
  const [error, setError] = useState('');
  const [fingerprint, setFingerprint] = useState(null);
  const [frame, setFrame] = useState(null); // { id, url }
  const [notes, setNotes] = useState({}); // track id -> { open, text, busy, saved, error }
  const [stoppedEarly, setStoppedEarly] = useState(false);
  const [busyEngines, setBusyEngines] = useState(false);
  const fileRef = useRef(null);
  const abortRef = useRef(null);
  const scanRef = useRef(null);
  const frameRef = useRef(null);

  // Close the video and free its pictures when the officer leaves the case.
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
    setNotes({});
    setProgress(null);
    setError('');
    setStoppedEarly(false);
  };

  const chooseFile = (e) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    resetScan();
    setFile(picked);
    setStage('setup');
  };

  const placeMissing = form.cameraPlace.trim().length < 3;

  const findFaces = async () => {
    if (!file || placeMissing) return;
    resetScan();
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
      scanRef.current = result;
      setScan(result);
      setStage('found');
    } catch (err) {
      setError(err?.message || msg('The video could not be read.'));
      setStage('error');
    }
  };

  // The clearest faces first, at most VIDEO_SEARCH_MAX_FACES.
  const toSend = useMemo(() => (scan?.tracks || [])
    .slice()
    .sort((a, b) => b.quality - a.quality)
    .slice(0, VIDEO_SEARCH_MAX_FACES), [scan]);

  const compare = async (tracks, { fresh = true } = {}) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setError('');
    setStoppedEarly(false);
    let sha = fingerprint;
    if (!sha) {
      setStage('fingerprint');
      setProgress({ done: 0, total: 1 });
      try {
        sha = await fileSha256(file, { signal: controller.signal, onProgress: (share) => setProgress({ done: share, total: 1 }) });
        setFingerprint(sha);
      } catch {
        setStage('found');
        return;
      }
    }
    setStage('comparing');
    const searchId = fresh || !scanRef.current?.searchId ? newSearchId() : scanRef.current.searchId;
    if (scanRef.current) scanRef.current.searchId = searchId;
    const batches = [];
    for (let i = 0; i < tracks.length; i += VIDEO_SEARCH_BATCH) batches.push(tracks.slice(i, i + VIDEO_SEARCH_BATCH));
    setProgress({ done: 0, total: tracks.length });
    let done = 0;
    for (const [index, batch] of batches.entries()) {
      if (controller.signal.aborted) {
        setStoppedEarly(true);
        break;
      }
      const fd = new FormData();
      batch.forEach((track, i) => fd.append(i === 0 ? 'photo' : 'extraPhotos', trackFile(track, 'face')));
      fd.append('searchId', searchId);
      fd.append('videoName', (file.name || '').slice(0, 200));
      fd.append('videoBytes', String(file.size || 0));
      fd.append('videoSeconds', String(Math.round(scan.duration)));
      fd.append('videoSha256', sha);
      fd.append('cameraPlace', form.cameraPlace.trim().slice(0, 200));
      if (form.recordedFrom) fd.append('recordedFrom', form.recordedFrom);
      fd.append('batch', String(index + 1));
      fd.append('batches', String(batches.length));
      fd.append('facesFound', String(scan.tracks.length));
      fd.append('facesTooSmall', String(scan.tooSmall || 0));
      fd.append('times', batch.map((track) => track.time.toFixed(1)).join(','));
      try {
        // eslint-disable-next-line no-await-in-loop
        let data = await api.postForm(`/reports/${report.id}/video-search`, fd);
        // Every face unanswered: the engines are busy or briefly down. Wait,
        // and send this batch once more before moving on.
        if ((data.results || []).length && data.results.every((row) => row.verdict === 'no_answer') && !controller.signal.aborted) {
          setBusyEngines(true);
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, ENGINE_BUSY_WAIT_MS));
          setBusyEngines(false);
          // eslint-disable-next-line no-await-in-loop
          if (!controller.signal.aborted) data = await api.postForm(`/reports/${report.id}/video-search`, fd);
        }
        const answered = {};
        for (const row of data.results || []) {
          const track = batch[row.index];
          if (track) answered[track.id] = row.verdict;
        }
        setVerdicts((prev) => ({ ...prev, ...answered }));
      } catch (err) {
        // A refusal about the case or the search stops it; a fault leaves
        // these faces "not checked", to send again.
        if ([400, 403, 404, 409, 501, 503].includes(err.status)) {
          setError(err.message);
          setStoppedEarly(true);
          break;
        }
        setVerdicts((prev) => ({ ...prev, ...Object.fromEntries(batch.map((track) => [track.id, 'no_answer'])) }));
        if (err.status === 429) {
          setError(msg('Too many faces were sent in a short time. Wait a few minutes, then check the rest again.'));
          setStoppedEarly(true);
          break;
        }
      }
      done += batch.length;
      setProgress({ done, total: tracks.length });
    }
    setStage('done');
  };

  const stop = () => abortRef.current?.abort();

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

  const noteText = (track) => {
    const clock = clockAt(track.time);
    const parts = [
      'Video search: a possible sighting.',
      `Video "${file?.name || 'video'}" (${formatBytes(file?.size || 0)}), camera at ${form.cameraPlace.trim()}.`,
      `Seen ${formatVideoTime(track.time)} into the video${clock ? ` (about ${clock})` : ''}.`,
      verdicts[track.id] === 'likely' ? 'Both face engines say it may be the same person.' : 'One face engine says it may be the same person.',
      fingerprint ? `File fingerprint (SHA-256): ${fingerprint}.` : '',
      'Checked by eye: not yet.',
    ];
    return parts.filter(Boolean).join(' ').slice(0, 1000);
  };

  const openNote = (track) => setNotes((prev) => ({ ...prev, [track.id]: { open: true, text: prev[track.id]?.text || noteText(track) } }));

  const saveNote = async (track) => {
    const text = (notes[track.id]?.text || '').trim();
    if (text.length < 3) return;
    setNotes((prev) => ({ ...prev, [track.id]: { ...prev[track.id], busy: true, error: '' } }));
    try {
      await api.post(`/reports/${report.id}/notes`, { note: text });
      setNotes((prev) => ({ ...prev, [track.id]: { ...prev[track.id], busy: false, open: false, saved: true } }));
    } catch (err) {
      setNotes((prev) => ({ ...prev, [track.id]: { ...prev[track.id], busy: false, error: err.message } }));
    }
  };

  const checked = Object.keys(verdicts).length;
  const tracksById = useMemo(() => new Map((scan?.tracks || []).map((track) => [track.id, track])), [scan]);
  const ids = (wanted) => Object.entries(verdicts).filter(([, v]) => wanted.includes(v)).map(([id]) => tracksById.get(Number(id))).filter(Boolean);
  const hits = [...ids(['likely']), ...ids(['possible'])];
  const notMatched = ids(['unlikely', 'not_agreed']).length;
  const noFace = ids(['no_face']).length;
  const unanswered = ids(['no_answer']);
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const busy = ['loading', 'reading', 'fingerprint', 'comparing'].includes(stage);

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">
        {t('The video is read on this computer and is not uploaded. Each face found in it is compared with this case’s photo only, and is not kept. Every search is recorded in the audit log, with the video’s name, size and fingerprint and where the camera is.')}
      </p>

      <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={chooseFile} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          {file ? t('Choose another video') : t('Choose a video')}
        </button>
        {file && (
          <span className="min-w-0 break-all text-xs text-gray-600">
            {file.name} · {formatBytes(file.size)}
          </span>
        )}
      </div>

      {file && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor={`camera-${report.id}`}>{t('Where is the camera?')} *</label>
            <input id={`camera-${report.id}`} className="field" value={form.cameraPlace} onChange={set('cameraPlace')} disabled={busy}
              placeholder={t('e.g. Kalupur railway station, platform 1 gate')} maxLength={200} autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor={`recorded-${report.id}`}>{t('When does the recording start?')}</label>
            <input id={`recorded-${report.id}`} className="field" type="datetime-local" value={form.recordedFrom} onChange={set('recordedFrom')} disabled={busy} />
            <p className="mt-1 text-xs text-gray-500">{t('Optional. Then each face shows the time it was seen.')}</p>
          </div>
          <div>
            <label className="label" htmlFor={`interval-${report.id}`}>{t('How often to look')}</label>
            <select id={`interval-${report.id}`} className="field" value={form.interval} onChange={set('interval')} disabled={busy}>
              {INTERVALS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
            </select>
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700 sm:col-span-2">
            <input type="checkbox" className="mt-1" checked={form.smallFaces} onChange={set('smallFaces')} disabled={busy} />
            <span>{t('Also look for small faces far from the camera (slower)')}</span>
          </label>
        </div>
      )}

      {file && ['setup', 'error'].includes(stage) && (
        <>
          {placeMissing && <p className="text-xs font-medium text-amber-800">{t('Say where the camera is.')}</p>}
          <button type="button" className="btn-primary w-full sm:w-auto" disabled={placeMissing} onClick={findFaces}>
            {t('Find the faces in this video')}
          </button>
        </>
      )}

      {stage === 'error' && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{t(error)}</p>
      )}

      {busy && (
        <div role="status" className="rounded-xl bg-gray-50 p-3 ring-1 ring-black/5">
          <p className="text-sm font-semibold text-ink">
            {stage === 'loading' && t('Getting ready to read the video…')}
            {stage === 'reading' && t('Looking for faces… {pct}%', { pct })}
            {stage === 'fingerprint' && t('Making the video’s fingerprint for the audit log… {pct}%', { pct })}
            {stage === 'comparing' && t('Comparing faces with this case… {done} of {total}', { done: progress?.done || 0, total: progress?.total || 0 })}
          </p>
          {stage !== 'loading' && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
              <div className="h-full rounded-full bg-khozo transition-[width]" style={{ width: `${pct}%` }} />
            </div>
          )}
          {stage === 'reading' && <p className="mt-1 text-xs text-gray-500">{t('{n} faces found so far', { n: progress?.faces || 0 })}</p>}
          {stage === 'comparing' && busyEngines && (
            <p className="mt-1 text-xs font-medium text-amber-800">{t('The face engines did not answer. Waiting a few seconds, then trying again…')}</p>
          )}
          {['reading', 'comparing', 'fingerprint'].includes(stage) && (
            <button type="button" className="btn-ghost mt-2 min-h-11 px-3 py-2 text-sm" onClick={stop}>{t('Stop')}</button>
          )}
        </div>
      )}

      {stage === 'found' && scan && (
        <div className="rounded-xl bg-gray-50 p-3 ring-1 ring-black/5">
          {scan.stopped && <p className="mb-1 text-xs text-gray-500">{t('Stopped part way: these are the faces found until then.')}</p>}
          {scan.tracks.length ? (
            <>
              <p className="text-sm font-semibold text-ink">
                {t('{n} different faces were found in {length} of video.', { n: scan.tracks.length, length: formatVideoTime(scan.duration) })}
              </p>
              {scan.tracks.length > toSend.length && (
                <p className="mt-1 text-xs text-gray-600">{t('The clearest {n} will be compared.', { n: toSend.length })}</p>
              )}
              {scan.tooSmall > 0 && <p className="mt-1 text-xs text-gray-600">{t('Some faces were too small or too far away to compare, and are left out.')}</p>}
              <button type="button" className="btn-primary mt-3 w-full sm:w-auto" onClick={() => compare(toSend)}>
                {t('Compare {n} faces with this case', { n: toSend.length })}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-ink">{t('No face clear enough to compare was found in this video.')}</p>
              <p className="mt-1 text-xs text-gray-600">{t('Faces must be near enough to the camera and facing it. Try “Also look for small faces”, or another camera.')}</p>
            </>
          )}
        </div>
      )}

      {stage === 'done' && scan && (
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">{t(error)}</p>}
          {stoppedEarly && !error && <p className="text-xs text-gray-500">{t('Stopped part way.')}</p>}
          <p className="text-sm font-semibold text-ink">
            {hits.length
              ? t('{n} moment(s) to look at, out of {checked} faces compared.', { n: hits.length, checked })
              : t('No face in this video was found to match this case, out of {checked} compared.', { checked })}
          </p>
          {!hits.length && (
            <p className="text-xs text-gray-600">
              {t('This does not prove the person is not in the video. Faces that are small, turned away, dark or blurred cannot be compared.')}
            </p>
          )}

          {hits.length > 0 && (
            <ul className="space-y-3">
              {hits.map((track) => {
                const clock = clockAt(track.time);
                const note = notes[track.id] || {};
                return (
                  <li key={track.id} className={`rounded-xl p-3 ring-1 ${verdicts[track.id] === 'likely' ? 'bg-amber-50 ring-amber-300' : 'bg-white ring-black/10'}`}>
                    <div className="flex gap-3">
                      <img src={track.url} alt={t('Face seen at {time}', { time: formatVideoTime(track.time) })} className="h-24 w-24 shrink-0 rounded-lg object-cover ring-1 ring-black/10" />
                      {txt(report.photoUrl) && (
                        <ProtectedImage src={report.photoUrl} alt={t('Case photo')} className="h-24 w-24 shrink-0 rounded-lg object-cover ring-1 ring-black/10" />
                      )}
                      <div className="min-w-0 text-sm">
                        <p className="font-semibold text-ink">{t(VERDICT_WORDS[verdicts[track.id]] || VERDICT_WORDS.possible)}</p>
                        <p className="mt-1 text-gray-700">
                          {t('Seen {time} into the video', { time: formatVideoTime(track.time) })}
                          {clock && <span className="block text-xs text-gray-500">{t('About {clock}', { clock })}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn-ghost min-h-11 px-3 py-2 text-sm" onClick={() => showFrame(track)}>
                        {frame?.id === track.id ? t('Hide the whole frame') : t('See the whole frame')}
                      </button>
                      <button type="button" className="btn-ghost min-h-11 px-3 py-2 text-sm" onClick={() => saveFrame(track)}>{t('Save the frame')}</button>
                      {!note.saved && (
                        <button type="button" className="btn-ghost min-h-11 px-3 py-2 text-sm" onClick={() => openNote(track)}>{t('Add to the case notes')}</button>
                      )}
                      {note.saved && <span className="self-center text-xs font-semibold text-emerald-700">{t('Added to the case notes')}</span>}
                    </div>
                    {frame?.id === track.id && (
                      <img src={frame.url} alt={t('The whole frame, the face marked')} className="mt-2 w-full rounded-lg ring-1 ring-black/10" />
                    )}
                    {note.open && (
                      <div className="mt-2">
                        <textarea className="field min-h-24 w-full text-sm" maxLength={1000} value={note.text}
                          onChange={(e) => setNotes((prev) => ({ ...prev, [track.id]: { ...prev[track.id], text: e.target.value } }))} />
                        {note.error && <p className="mt-1 text-xs text-red-700">{t(note.error)}</p>}
                        <button type="button" className="btn-primary mt-2" disabled={note.busy} onClick={() => saveNote(track)}>
                          {note.busy ? t('Saving…') : t('Save the note')}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 ring-1 ring-black/5">
            <p>{t('Not a match: {n}', { n: notMatched })}</p>
            <p>{t('No face the engines could use: {n}', { n: noFace })}</p>
            {unanswered.length > 0 && (
              <p className="mt-1 font-medium text-amber-800">
                {t('Not checked, because the face engines did not answer: {n}', { n: unanswered.length })}{' '}
                <button type="button" className="font-semibold underline underline-offset-2" onClick={() => compare(unanswered, { fresh: false })}>
                  {t('Check these again')}
                </button>
              </p>
            )}
            {fingerprint && <p className="mt-1 break-all">{t('Video fingerprint (SHA-256): {sha}', { sha: fingerprint })}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
