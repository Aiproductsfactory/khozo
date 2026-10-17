import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import DistrictPicker from '../DistrictPicker.jsx';
import { Logo } from '../components.jsx';
import { genderLabel, isAdultCategory, PERSON_CATEGORY_OPTIONS } from '../lib.jsx';
import {
  clearQueuedSighting,
  enqueueSighting,
  getQueuedSightings,
  QUEUE_TTL_MS,
  queuedToFormData,
  removeQueuedSighting,
  requestBackgroundSync,
} from '../offlineQueue.js';
import { formatCoordinates, getDeviceLocation, readPhotoGps } from '../photoLocation.js';
import { formatBytes, preparePhoto } from '../photoPrep.js';
import { saveReceipt } from '../myReports.js';
import ReceiptActions from '../ReceiptActions.jsx';
import InstallPrompt from '../InstallPrompt.jsx';
import { useAuth } from '../auth.jsx';
import { currentLocale, LanguageSwitcher, msg, useT } from '../i18n.jsx';

const ID_PROOF_TYPES = [
  { id: '', label: msg('Not provided') },
  { id: 'aadhaar', label: msg('Aadhaar') },
  { id: 'voter_id', label: msg('Voter ID') },
  { id: 'passport', label: msg('Passport') },
  { id: 'driving_license', label: msg('Driving licence') },
  { id: 'other', label: msg('Other photo ID') },
];

/*
 * The copy that changes with who was seen. The child wording is exactly what
 * the page always said, so the default flow reads as it did.
 */
const SEEN_COPY = {
  child: {
    title: msg('Spotted a child who may be missing?'),
    where: msg('Where did you find the child?'),
    note: msg('Anything that helps identify the child'),
    agePlaceholder: msg('e.g. 6'),
    alt: msg('Child'),
    noPhoto: msg('No photo attached. This will be sent as a text sighting to Childline/CWC intake and no match search will run.'),
    consent: msg('I confirm this photo may be used only for child-protection review, police/CWC follow-up, and match search. The sighting image is retained for 180 days unless escalated.'),
    danger: msg('If the child is in immediate danger, call 1098 or 112.'),
  },
  woman: {
    title: msg('Spotted a woman who may be missing?'),
    where: msg('Where did you see her?'),
    note: msg('Anything that helps identify her — clothing, language, what she said'),
    agePlaceholder: msg('e.g. 30'),
    alt: msg('Woman'),
    noPhoto: msg('No photo attached. This will be sent as a text sighting for police review and no match search will run.'),
    consent: msg('I confirm this photo may be used only for police review, follow-up, and match search. The sighting image is retained for 180 days unless escalated.'),
    danger: msg('If she is in immediate danger, call 112. The Women Helpline 181 and the One Stop Centre (Sakhi) can also help.'),
  },
  adult: {
    title: msg('Spotted a person who may be missing?'),
    where: msg('Where did you see the person?'),
    note: msg('Anything that helps identify the person — clothing, language, what they said'),
    agePlaceholder: msg('e.g. 70'),
    alt: msg('Person'),
    noPhoto: msg('No photo attached. This will be sent as a text sighting for police review and no match search will run.'),
    consent: msg('I confirm this photo may be used only for police review, follow-up, and match search. The sighting image is retained for 180 days unless escalated.'),
    danger: msg('If the person is in immediate danger, call 112.'),
  },
};

// The age a reporter can enter, matching the server's limits for the category.
const SEEN_AGE_LIMITS = {
  child: { min: 0, max: 18 },
  woman: { min: 18, max: 110 },
  adult: { min: 18, max: 110 },
};

function LocationStatus({ located, hasPhoto, onClear }) {
  const t = useT();
  if (!located) return null;
  const { status, accuracy } = located;
  if (status === 'locating') {
    return <p className="mt-1.5 text-xs text-gray-500">{t('Finding where you are…')}</p>;
  }
  if (status === 'denied' || status === 'failed') {
    return (
      <p className="mt-1.5 text-xs text-amber-700">
        {status === 'denied'
          ? t('Location permission is off, so no location was attached. Type the place, or allow location for this site and tap Use GPS.')
          : t('Could not get a location fix. Type the place, or tap Use GPS to try again.')}
      </p>
    );
  }
  const remove = (label) => (
    <button type="button" className="tap-inline font-semibold underline underline-offset-2" onClick={onClear}>
      {label}
    </button>
  );
  if (status === 'photo') {
    return (
      <p className="mt-1.5 text-xs text-khozo-dark">
        {t('Location taken from the photo’s own GPS. Add a landmark if you can.')} {remove(t('Remove'))}
      </p>
    );
  }
  const where = accuracy
    ? t('Your phone’s current location is attached (within about {m} m).', { m: Math.round(accuracy) })
    : t('Your phone’s current location is attached.');
  return (
    <p className="mt-1.5 text-xs text-khozo-dark">
      {where}{' '}
      {hasPhoto ? (
        <>{t('If the photo was taken somewhere else,')} {remove(t('remove it'))} {t('and type that place.')}</>
      ) : (
        <>{t('Add a landmark if you can.')} {remove(t('Remove'))}</>
      )}
    </p>
  );
}

function buildSightingFormData(form, file) {
  const fd = new FormData();
  if (file) fd.append('photo', file);
  Object.entries(form).forEach(([k, v]) => v != null && v !== '' && fd.append(k, v));
  return fd;
}

export default function Capture() {
  const t = useT();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({
    personCategory: 'child',
    foundLocation: '',
    state: '',
    stateCode: '',
    district: '',
    districtCode: '',
    reporterName: '',
    reporterPhone: '',
    confidentialReporter: false,
    idProofType: '',
    idProofNumber: '',
    note: '',
    gender: '',
    ageApprox: '',
    photoConsent: false,
  });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  // 0..1 while the report is being sent; null otherwise.
  const [progress, setProgress] = useState(null);
  // True while the chosen photo is being shrunk on the phone.
  const [preparing, setPreparing] = useState(false);
  const [originalSize, setOriginalSize] = useState(0);
  const { user } = useAuth() || {};
  const [err, setErr] = useState('');
  const [queued, setQueued] = useState([]);
  // { status: 'locating' | 'photo' | 'device' | 'denied' | 'failed', lat, lng, accuracy }
  const [located, setLocated] = useState(null);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const locateRun = useRef(0);
  const photoRun = useRef(0);
  const autoLocationText = useRef('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setChecked = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));
  const seen = form.personCategory;
  const copy = SEEN_COPY[seen] || SEEN_COPY.child;
  const ageLimits = SEEN_AGE_LIMITS[seen] || SEEN_AGE_LIMITS.child;

  // A guessed age outside the new range is dropped rather than sent and
  // refused; a woman's gender is implied.
  const chooseSeen = (next) => {
    setForm((f) => {
      const limits = SEEN_AGE_LIMITS[next] || SEEN_AGE_LIMITS.child;
      const ageApprox = f.ageApprox === '' || (Number(f.ageApprox) >= limits.min && Number(f.ageApprox) <= limits.max) ? f.ageApprox : '';
      return {
        ...f,
        personCategory: next,
        ageApprox,
        gender: next === 'woman' ? 'Female' : f.personCategory === 'woman' ? '' : f.gender,
      };
    });
  };

  /*
   * The location is fetched the moment a photo is chosen, not when the reporter
   * remembers to press a button. The server turns the coordinates into the
   * state and district that decide which officers are alerted, so a report
   * without them reaches everyone slowly instead of the right desk at once.
   * The photo's own GPS is preferred: a gallery picture may have been taken
   * somewhere other than where the reporter is now.
   */
  const locate = async (photo) => {
    const run = ++locateRun.current;
    setLocated({ status: 'locating' });
    let coords = photo ? await readPhotoGps(photo) : null;
    let status = 'photo';
    if (!coords) {
      status = 'device';
      try {
        coords = await getDeviceLocation();
      } catch (e) {
        if (run === locateRun.current) setLocated({ status: e?.code === 1 ? 'denied' : 'failed' });
        return;
      }
    }
    // A newer photo or a Use GPS tap has started its own lookup since.
    if (run !== locateRun.current) return;
    const text = formatCoordinates(coords);
    // Read before the update: React runs the updater later, after the ref has moved on.
    const previousFill = autoLocationText.current;
    autoLocationText.current = text;
    setForm((f) => {
      // What the reporter typed is a landmark an officer can walk to, and it
      // is never overwritten; only an empty field or our own earlier fill is.
      const typed = f.foundLocation.trim() && f.foundLocation !== previousFill;
      return { ...f, lat: coords.lat, lng: coords.lng, foundLocation: typed ? f.foundLocation : text };
    });
    setLocated({ status, ...coords });
  };

  const clearLocation = () => {
    locateRun.current += 1;
    const previousFill = autoLocationText.current;
    autoLocationText.current = '';
    setForm((f) => ({
      ...f,
      lat: null,
      lng: null,
      foundLocation: f.foundLocation === previousFill ? '' : f.foundLocation,
    }));
    setLocated(null);
  };

  /*
   * The photo's own GPS is read from the original file first: shrinking it
   * (below) redraws the picture and drops the EXIF block that holds it. The
   * shrunk copy, a few hundred KB instead of several MB, is what is sent or
   * kept in the offline queue.
   */
  const onFile = async (e) => {
    const picked = e.target.files?.[0];
    // Cleared so choosing the same photo again still fires a change.
    e.target.value = '';
    if (!picked) return;
    const run = ++photoRun.current;
    setFile(picked);
    setOriginalSize(picked.size || 0);
    setPreview(URL.createObjectURL(picked));
    setStep(2);
    locate(picked);
    setPreparing(true);
    const ready = await preparePhoto(picked);
    if (run !== photoRun.current) return;
    setFile(ready);
    setPreparing(false);
  };

  useEffect(() => {
    getQueuedSightings().then(setQueued).catch(() => setQueued([]));
  }, []);

  useEffect(() => {
    const flush = () => {
      requestBackgroundSync()
        .then(() => getQueuedSightings())
        .then(setQueued)
        .catch(() => {});
    };
    window.addEventListener('online', flush);
    // The service worker sent a queued report in the background: the list
    // of waiting reports is out of date (its receipt is saved by pwa.js).
    const onWorkerMessage = (event) => {
      if (event.data?.type === 'KHOZO_SIGHTING_SYNCED') getQueuedSightings().then(setQueued).catch(() => {});
    };
    navigator.serviceWorker?.addEventListener?.('message', onWorkerMessage);
    return () => {
      window.removeEventListener('online', flush);
      navigator.serviceWorker?.removeEventListener?.('message', onWorkerMessage);
    };
  }, []);

  const submit = async () => {
    setBusy(true);
    setErr('');
    setProgress(file ? 0 : null);
    try {
      const fd = buildSightingFormData(form, file);
      const data = await api.postFormWithProgress('/reports/found', fd, file ? setProgress : undefined);
      setResult(data);
      if (data?.foundReport?.id) {
        saveReceipt({ id: data.foundReport.id, at: Date.now(), personCategory: data.foundReport.personCategory || form.personCategory });
      }
      setStep(3);
      try { window.scrollTo({ top: 0 }); } catch {}
    } catch (e) {
      const offlineish = e.network || !navigator.onLine || e.message === 'Failed to fetch' || String(e.message).includes('NetworkError');
      if (offlineish) {
        const next = await enqueueSighting(form, file);
        setQueued(next);
        setErr(msg('Network unavailable. Your report is encrypted on this device and will retry when the network returns.'));
      } else {
        setErr(e.message);
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const retryQueued = async (item) => {
    setBusy(true);
    setErr('');
    try {
      const fd = await queuedToFormData(item);
      const data = await api.postForm('/reports/found', fd);
      await clearQueuedSighting(item.id);
      const next = await getQueuedSightings();
      setQueued(next);
      setResult(data);
      if (data?.foundReport?.id) {
        saveReceipt({ id: data.foundReport.id, at: item.createdAt, personCategory: data.foundReport.personCategory || item.form?.personCategory });
      }
      setStep(3);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const removeQueued = (item) => {
    removeQueuedSighting(item.id).then(setQueued).catch(() => {});
  };

  return (
    <div className="min-h-screen bg-[#f6f8f5]">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-1 sm:gap-3">
            <LanguageSwitcher />
            <Link to={user ? '/app' : '/'} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-2 text-sm font-semibold text-gray-500 hover:text-ink">
              {user ? t('Console') : t('Home')}
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center gap-2 sm:mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full ${step >= s ? 'bg-khozo' : 'bg-gray-200'}`} />
          ))}
        </div>

        {err && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{t(err)}</div>}

        {queued.length > 0 && (
          <div className="mb-4 card p-4">
            <p className="font-semibold">{t('Pending offline reports')}</p>
            <p className="text-sm text-gray-500">
              {t('{n} encrypted on this device. They retry when connectivity returns and expire after {hours} hours.', {
                n: queued.length,
                hours: Math.round(QUEUE_TTL_MS / 3600000),
              })}
            </p>
            <div className="mt-3 space-y-2">
              {queued.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{item.form?.foundLocation || t('Unknown location')}</p>
                    <p className="text-xs text-gray-400">{new Date(item.createdAt).toLocaleString(currentLocale())}</p>
                    {item.expiresAt && <p className="text-xs text-gray-400">{t('Expires {date}', { date: new Date(item.expiresAt).toLocaleString(currentLocale()) })}</p>}
                    {item.lastAttemptAt && <p className="text-xs text-gray-400">{t('Last retry {date}', { date: new Date(item.lastAttemptAt).toLocaleString(currentLocale()) })}{item.lastError ? ` / ${item.lastError}` : ''}</p>}
                  </div>
                  <div className="flex w-full gap-2 sm:w-auto">
                    <button type="button" className="btn-primary flex-1 sm:flex-none" disabled={busy} onClick={() => retryQueued(item)}>{t('Retry')}</button>
                    <button type="button" className="btn-ghost" disabled={busy} onClick={() => removeQueued(item)}>{t('Remove')}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="card p-5 text-center sm:p-8">
            <h1 className="text-2xl font-bold">{t(copy.title)}</h1>
            <p className="mt-2 text-gray-500">
              {isAdultCategory(seen)
                ? t('Capture a photo when it is safe, or continue with location details for police review.')
                : t('Capture a photo when it is safe, or continue with location details for CWC/Childline review.')}
            </p>
            {/*
              Who was seen. Child stays the default, so the flow a reporter has
              always used is one tap shorter than any other; the choice only
              changes the wording, the age range and which desk is told.
            */}
            <div className="mx-auto mt-6 max-w-md">
              <p className="text-sm font-semibold text-ink">{t('Who did you see?')}</p>
              <div role="radiogroup" aria-label={t('Who did you see?')} className="mt-2 grid grid-cols-3 gap-2">
                {PERSON_CATEGORY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={seen === option.id}
                    onClick={() => chooseSeen(option.id)}
                    className={`rounded-xl border px-2 py-2 text-sm font-semibold transition ${
                      seen === option.id
                        ? 'border-khozo bg-khozo-light text-khozo-dark ring-1 ring-khozo/40'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {t(option.label)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {t('Not sure of their age? Choose the closest — every report reaches a person who reads it.')}
              </p>
            </div>
            {/*
              Two ways in: the camera, opened straight away, for someone looking
              at the child now; and the gallery, for a photo taken a moment ago
              or sent on by someone else.
            */}
            <div className="mt-6 sm:mt-8">
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="mx-auto grid h-36 w-36 place-items-center rounded-2xl border-2 border-dashed border-gray-300 text-gray-400 hover:border-khozo hover:text-khozo sm:h-44 sm:w-44"
                aria-label={t('Take a photo')}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.6l1.4-2h7l1.4 2h1.6A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
                  <circle cx="12" cy="13" r="3.8" />
                </svg>
              </button>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
              <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
              <div className="mx-auto mt-6 grid max-w-md gap-3 sm:grid-cols-2">
                <button type="button" className="btn-primary" onClick={() => cameraRef.current?.click()}>
                  <span aria-hidden="true">📷</span> {t('Take a photo')}
                </button>
                <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
                  <span aria-hidden="true">🖼️</span> {t('Choose from gallery')}
                </button>
                <button type="button" data-action="continue-without-photo" className="btn-ghost sm:col-span-2" onClick={() => { setStep(2); locate(null); }}>{t('Continue without photo')}</button>
              </div>
              <p className="mt-4 text-sm text-gray-500">
                <Link to="/track-sighting" className="inline-flex min-h-11 items-center font-semibold text-khozo hover:underline">{t('Track a report I made')}</Link>
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="card">
            {preview && (
              /*
                The photo as taken, and nothing drawn over it. A yellow "face
                detected" box used to sit in the middle of every preview, but no
                detection runs on the phone: it told the sender something had
                been checked when nothing had.
              */
              <div className="overflow-hidden rounded-t-2xl bg-black">
                <img src={preview} alt={t(copy.alt)} className="mx-auto max-h-72 object-contain" />
              </div>
            )}
            {file && (
              <p className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 px-4 py-2 text-xs text-gray-500 sm:px-6">
                <span>
                  {preparing
                    ? t('Preparing the photo…')
                    : file.size && originalSize && file.size < originalSize
                      ? t('Photo made smaller for sending: {from} → {to}', { from: formatBytes(originalSize), to: formatBytes(file.size) })
                      : t('Photo ready to send ({size})', { size: formatBytes(file.size) })}
                </span>
                <button type="button" className="font-semibold text-khozo hover:underline" onClick={() => fileRef.current?.click()}>
                  {t('Change photo')}
                </button>
              </p>
            )}
            <div className="space-y-4 p-4 sm:p-6">
              <h2 className="text-lg font-semibold">{t(copy.where)}</h2>
              {!file && (
                <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  {t(copy.noPhoto)}
                </div>
              )}
              {seen === 'woman' && (
                <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900">
                  {t(copy.danger)}
                </div>
              )}
              <div>
                <label className="label">{t('Found location')}</label>
                <div className="flex gap-2">
                  <input className="field" value={form.foundLocation} onChange={set('foundLocation')} placeholder={t('Area, landmark, city')} autoComplete="off" enterKeyHint="next" />
                  <button
                    type="button"
                    className="btn-ghost shrink-0"
                    disabled={located?.status === 'locating'}
                    onClick={() => locate(null)}
                  >
                    {t('Use GPS')}
                  </button>
                </div>
                <LocationStatus located={located} hasPhoto={!!file} onClear={clearLocation} />
              </div>
              {/*
                The state and district decide which officers this report
                reaches, so both are chosen from the gazetteer's lists rather
                than typed: "Ahmdabad" used to reach no Ahmedabad desk. Both
                stay optional. "Not sure" sends no place and the phone's
                location decides (shared/geocode.js); a report with no place at
                all still goes to every review desk rather than being refused.
              */}
              <div>
                <DistrictPicker
                  allowUnsure
                  value={form}
                  onChange={(place) => setForm((f) => ({ ...f, ...place }))}
                />
                <p className="mt-1.5 text-xs text-gray-500">
                  {t('Not sure where you are? Choose “Not sure” and your phone’s location decides which desk is told.')}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">{t('Approx. age')}</label>
                  <input className="field" type="number" inputMode="numeric" min={ageLimits.min} max={ageLimits.max} value={form.ageApprox} onChange={set('ageApprox')} placeholder={t(copy.agePlaceholder)} />
                </div>
                {seen !== 'woman' && (
                  <div>
                    <label className="label">{t('Gender')}</label>
                    <select className="field" value={form.gender} onChange={set('gender')}>
                      <option value="">{t('Not sure')}</option>
                      <option value="Male">{genderLabel('Male', seen)}</option>
                      <option value="Female">{genderLabel('Female', seen)}</option>
                    </select>
                  </div>
                )}
                <div>
                  <label className="label">{t('Your name (optional)')}</label>
                  <input className="field" value={form.reporterName} onChange={set('reporterName')} autoComplete="name" />
                </div>
                <div>
                  <label className="label">{t('Your phone (optional)')}</label>
                  <input className="field" type="tel" inputMode="tel" autoComplete="tel" value={form.reporterPhone} onChange={set('reporterPhone')} />
                </div>
              </div>
              <label className="flex gap-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
                <input type="checkbox" className="mt-1" checked={form.confidentialReporter} onChange={setChecked('confidentialReporter')} />
                <span>{t('Keep my identity confidential in the review queue.')}</span>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">{t('Photo ID proof')}</label>
                  <select className="field" value={form.idProofType} onChange={set('idProofType')}>
                    {ID_PROOF_TYPES.map((type) => <option key={type.id} value={type.id}>{t(type.label)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{t('ID number')}</label>
                  <input className="field" value={form.idProofNumber} onChange={set('idProofNumber')} placeholder={t('Stored masked')} autoComplete="off" autoCapitalize="characters" />
                </div>
              </div>
              <div>
                <label className="label">{t('Note')}</label>
                <textarea className="field" rows={2} value={form.note} onChange={set('note')} placeholder={t(copy.note)} />
              </div>
              {file && (
                <label className="flex gap-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
                  <input type="checkbox" className="mt-1" checked={form.photoConsent} onChange={setChecked('photoConsent')} required />
                  <span>
                    {t(copy.consent)}
                  </span>
                </label>
              )}
              {/*
                The send button stays at the bottom of the screen on a phone,
                with the upload's progress on it, so a long form never hides it.
              */}
              <div className="safe-bottom sticky bottom-0 z-10 -mx-4 -mb-4 rounded-b-2xl border-t border-black/5 bg-white/95 px-4 pt-3 backdrop-blur sm:static sm:mx-0 sm:mb-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
                {progress != null && (
                  <div className="mb-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label={t('Sending your report')}>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                      <div className="h-full rounded-full bg-khozo transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {progress < 1 ? t('Sending photo… {pct}%', { pct: Math.round(progress * 100) }) : t('Checking the photo…')}
                    </p>
                  </div>
                )}
                <div className="flex gap-3 pb-3 sm:justify-between sm:pb-0">
                  <button className="btn-ghost" onClick={() => setStep(1)} disabled={busy}>{t('Back')}</button>
                  <button className="btn-primary flex-1 sm:flex-none" onClick={submit} disabled={busy || preparing}>
                    {busy ? t('Submitting...') : preparing ? t('Preparing the photo…') : file ? t('Submit & search matches') : t('Submit text sighting')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="space-y-6">
            <div className="card p-6 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-khozo-light text-khozo-dark">
                <svg aria-hidden="true" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </div>
              <h2 className="mt-3 text-xl font-bold">{t('Thank you - your report was submitted')}</h2>
              <p className="mt-2 text-sm font-semibold text-khozo">{t('Receipt ID: {id}', { id: result.foundReport.id })}</p>
              <ReceiptActions id={result.foundReport.id} className="mt-3" />
              <p className="mt-2 text-xs text-gray-500">{t('Saved on this phone: find it again on the tracking page.')}</p>
              {/*
                The same receipt for every reporter, whatever the engines found.
                Telling a stranger "possible match", a score, or a candidate's
                age band tells them that the person they photographed is being
                looked for — a disclosure in itself, and the kind that can lead
                someone to a child or a woman who is hiding from them. The
                outcome lives on the record, for officers. This text is fixed
                here rather than taken from the response, so a signed-in
                officer using this page sees the same receipt as the public.
              */}
              <p className="mt-1 text-gray-500">
                {t('Thank you. Your report has reached the police and child-protection desks for this area. Keep your receipt number to track it.')}
              </p>
            </div>

            <div className="card p-4 text-sm text-gray-600">
              <p className="font-semibold text-ink">{t('What happens next')}</p>
              <p className="mt-1">{t('An officer reviews every report. You will not be contacted unless the desk needs more detail from you.')}</p>
              <p className="mt-2">{t((SEEN_COPY[result.foundReport.personCategory] || copy).danger)}</p>
              {result.foundReport.retentionUntil && (
                <p className="mt-2 text-xs text-gray-400">{t('Photo review retention until {date}', { date: new Date(result.foundReport.retentionUntil).toLocaleDateString(currentLocale()) })}</p>
              )}
            </div>

            <InstallPrompt />

            <div className="grid gap-3 sm:flex sm:justify-center">
              <button className="btn-primary sm:order-3" onClick={() => { setStep(1); setResult(null); setFile(null); setPreview(null); setOriginalSize(0); clearLocation(); }}>{t('Report another')}</button>
              <Link to={`/track-sighting?receipt=${encodeURIComponent(result.foundReport.id)}`} className="btn-ghost sm:order-2">{t('Track status')}</Link>
              <Link to="/" className="btn-ghost sm:order-1">{t('Done')}</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
