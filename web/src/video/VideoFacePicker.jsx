import { useEffect, useRef, useState } from 'react';
import { msg, useT } from '../i18n.jsx';
import { formatVideoTime } from './faces.js';
import { readVideoLocation, releaseTracks, scanVideo, trackFile } from './videoScan.js';

/*
 * Pictures from a video, instead of a photo.
 *
 * Someone who has a video, not a photo, of the person chooses it here. The
 * faces in it are found on this device (videoScan.js), shown as small
 * pictures with the moment each was seen, and the person taps the ones of
 * the person they mean. Those pictures, and nothing else, are handed to the
 * form as its photos. The video is never sent anywhere.
 *
 * `purpose` words the page: 'sighting' for the public report form, 'case' for
 * a missing person's photos. `onUse(files, { times, location, videoName })`
 * receives the chosen pictures, the first one the main photo.
 */
const COPY = {
  sighting: {
    intro: msg('Have a video instead of a photo? Choose it here. Khozo finds the faces in it on your phone, and you pick the clearest pictures of the person. The video stays on your phone. Only the pictures you pick are sent.'),
    pick: msg('Tap the pictures of the person you saw. You can choose up to {n}.'),
  },
  case: {
    intro: msg('Have a video of the person? Choose it here. Khozo finds the faces in it on this device, and you pick the clearest pictures to add as photos. The video is not uploaded.'),
    pick: msg('Tap the pictures of the missing person. You can choose up to {n}.'),
  },
};

export default function VideoFacePicker({ max = 3, purpose = 'sighting', maxSide = 960, onUse, onCancel }) {
  const t = useT();
  const copy = COPY[purpose] || COPY.sighting;
  // choose | loading | reading | done | error
  const [stage, setStage] = useState('choose');
  const [progress, setProgress] = useState(null);
  const [scan, setScan] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const abortRef = useRef(null);
  const scanRef = useRef(null);
  const videoRef = useRef({ name: '', location: null });
  const runRef = useRef(0);

  // Stop reading and free the pictures when the picker closes.
  useEffect(() => () => {
    abortRef.current?.abort();
    releaseTracks(scanRef.current?.tracks);
  }, []);

  const reset = () => {
    abortRef.current?.abort();
    releaseTracks(scanRef.current?.tracks);
    scanRef.current = null;
    setScan(null);
    setChosen([]);
    setProgress(null);
    setError('');
  };

  const start = async (file) => {
    reset();
    const run = ++runRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    videoRef.current = { name: file.name || '', location: null };
    readVideoLocation(file).then((location) => {
      if (run === runRef.current) videoRef.current.location = location;
    });
    try {
      const result = await scanVideo(file, {
        maxSide,
        maxTracks: 120,
        signal: controller.signal,
        onStage: (s) => run === runRef.current && setStage(s),
        onProgress: (p) => run === runRef.current && setProgress(p),
      });
      if (run !== runRef.current) {
        releaseTracks(result.tracks);
        return;
      }
      scanRef.current = result;
      setScan(result);
      setStage('done');
    } catch (err) {
      if (run !== runRef.current) return;
      setError(err?.message || msg('The video could not be read.'));
      setStage('error');
    }
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) start(file);
  };

  const toggle = (id) => setChosen((prev) => (
    prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < max ? [...prev, id] : prev
  ));

  const use = () => {
    const tracks = chosen.map((id) => scan.tracks.find((track) => track.id === id)).filter(Boolean);
    if (!tracks.length) return;
    onUse?.(tracks.map((track) => trackFile(track)), {
      times: tracks.map((track) => formatVideoTime(track.time)),
      location: videoRef.current.location,
      videoName: videoRef.current.name,
    });
  };

  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" accept="video/*" onChange={onFile} className="hidden" />

      {stage === 'choose' && (
        <>
          <p className="text-sm text-gray-600">{t(copy.intro)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()}>
              {t('Choose a video')}
            </button>
            {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>{t('Cancel')}</button>}
          </div>
        </>
      )}

      {(stage === 'loading' || stage === 'reading') && (
        <div role="status" className="rounded-xl bg-gray-50 p-3 ring-1 ring-black/5">
          <p className="text-sm font-semibold text-ink">
            {stage === 'loading' ? t('Getting ready to read the video…') : t('Looking for faces… {pct}%', { pct })}
          </p>
          {stage === 'loading' && (
            <p className="mt-0.5 text-xs text-gray-500">{t('The first time, this downloads about 4 MB.')}</p>
          )}
          {stage === 'reading' && (
            <>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
                <div className="h-full rounded-full bg-khozo transition-[width]" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-gray-500">{t('{n} faces found so far', { n: progress?.faces || 0 })}</p>
              <button type="button" className="btn-ghost mt-2 min-h-11 px-3 py-2 text-sm" onClick={() => abortRef.current?.abort()}>
                {t('Stop and show the faces found')}
              </button>
            </>
          )}
        </div>
      )}

      {stage === 'error' && (
        <div role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-100">
          <p>{t(error)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-ghost min-h-11 px-3 py-2 text-sm" onClick={() => fileRef.current?.click()}>{t('Choose another video')}</button>
            {onCancel && <button type="button" className="btn-ghost min-h-11 px-3 py-2 text-sm" onClick={onCancel}>{t('Cancel')}</button>}
          </div>
        </div>
      )}

      {stage === 'done' && scan && (
        <div className="space-y-3">
          {scan.stopped && <p className="text-xs text-gray-500">{t('Stopped part way: these are the faces found until then.')}</p>}
          {scan.tracks.length ? (
            <p className="text-sm font-medium text-ink">{t(copy.pick, { n: max })}</p>
          ) : (
            <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
              <p className="font-semibold">{t('No clear face was found in this video.')}</p>
              <p className="mt-0.5">{t('A face needs to be near enough to the camera and facing it. Try another video, or a photo.')}</p>
            </div>
          )}
          {scan.tooSmall > 0 && (
            <p className="text-xs text-gray-500">{t('Some faces were too small or too far away to use, and are not shown.')}</p>
          )}
          {scan.tracks.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label={t('Faces found in the video')}>
              {scan.tracks.map((track) => {
                const order = chosen.indexOf(track.id);
                const full = order === -1 && chosen.length >= max;
                return (
                  <li key={track.id}>
                    <button
                      type="button"
                      aria-pressed={order !== -1}
                      disabled={full}
                      onClick={() => toggle(track.id)}
                      className={`relative block w-full overflow-hidden rounded-lg bg-gray-100 text-left ring-1 transition ${
                        order !== -1 ? 'ring-4 ring-khozo' : 'ring-black/10 hover:ring-khozo/50'
                      } ${full ? 'opacity-40' : ''}`}
                    >
                      <img src={track.url} alt={t('Face seen at {time}', { time: formatVideoTime(track.time) })} className="aspect-square w-full object-cover" />
                      <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                        {formatVideoTime(track.time)}
                      </span>
                      {order !== -1 && (
                        <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-khozo text-xs font-bold text-white">
                          {order + 1}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {chosen.length > 1 && <p className="text-xs text-gray-500">{t('Picture 1 is the main photo.')}</p>}
          <div className="flex flex-wrap gap-2">
            {scan.tracks.length > 0 && (
              <button type="button" className="btn-primary" disabled={!chosen.length} onClick={use}>
                {chosen.length > 1 ? t('Use these {n} pictures', { n: chosen.length }) : t('Use this picture')}
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>{t('Choose another video')}</button>
            {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>{t('Cancel')}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
