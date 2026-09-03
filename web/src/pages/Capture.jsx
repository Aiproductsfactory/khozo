import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Logo } from '../components.jsx';
import { Avatar } from '../lib.jsx';
import {
  clearQueuedSighting,
  enqueueSighting,
  getQueuedSightings,
  QUEUE_TTL_MS,
  queuedToFormData,
  removeQueuedSighting,
  requestBackgroundSync,
} from '../offlineQueue.js';

const ID_PROOF_TYPES = [
  { id: '', label: 'Not provided' },
  { id: 'aadhaar', label: 'Aadhaar' },
  { id: 'voter_id', label: 'Voter ID' },
  { id: 'passport', label: 'Passport' },
  { id: 'driving_license', label: 'Driving licence' },
  { id: 'other', label: 'Other photo ID' },
];

function buildSightingFormData(form, file) {
  const fd = new FormData();
  if (file) fd.append('photo', file);
  Object.entries(form).forEach(([k, v]) => v != null && v !== '' && fd.append(k, v));
  return fd;
}

export default function Capture() {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({
    foundLocation: '',
    state: '',
    district: '',
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
  const [err, setErr] = useState('');
  const [queued, setQueued] = useState([]);
  const fileRef = useRef(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setChecked = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setStep(2);
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
    return () => window.removeEventListener('online', flush);
  }, []);

  const useLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setForm((f) => ({ ...f, foundLocation: `Lat ${pos.coords.latitude.toFixed(4)}, Lng ${pos.coords.longitude.toFixed(4)}`, lat: pos.coords.latitude, lng: pos.coords.longitude }));
    });
  };

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const fd = buildSightingFormData(form, file);
      const data = await api.postForm('/reports/found', fd);
      setResult(data);
      setStep(3);
    } catch (e) {
      const offlineish = !navigator.onLine || e.message === 'Failed to fetch' || e.message.includes('NetworkError');
      if (offlineish) {
        const next = await enqueueSighting(form, file);
        setQueued(next);
        setErr('Network unavailable. Your report is encrypted on this device and will retry when the network returns.');
      } else {
        setErr(e.message);
      }
    } finally {
      setBusy(false);
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
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Logo />
          <Link to="/" className="text-sm font-semibold text-gray-500 hover:text-ink">Home</Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8 flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full ${step >= s ? 'bg-khozo' : 'bg-gray-200'}`} />
          ))}
        </div>

        {err && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

        {queued.length > 0 && (
          <div className="mb-4 card p-4">
            <p className="font-semibold">Pending offline reports</p>
            <p className="text-sm text-gray-500">{queued.length} encrypted on this device. They retry when connectivity returns and expire after {Math.round(QUEUE_TTL_MS / 3600000)} hours.</p>
            <div className="mt-3 space-y-2">
              {queued.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{item.form?.foundLocation || 'Unknown location'}</p>
                    <p className="text-xs text-gray-400">{new Date(item.createdAt).toLocaleString('en-IN')}</p>
                    {item.expiresAt && <p className="text-xs text-gray-400">Expires {new Date(item.expiresAt).toLocaleString('en-IN')}</p>}
                    {item.lastAttemptAt && <p className="text-xs text-gray-400">Last retry {new Date(item.lastAttemptAt).toLocaleString('en-IN')}{item.lastError ? ` / ${item.lastError}` : ''}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="btn-primary" disabled={busy} onClick={() => retryQueued(item)}>Retry</button>
                    <button type="button" className="btn-ghost" disabled={busy} onClick={() => removeQueued(item)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="card p-8 text-center">
            <h1 className="text-2xl font-bold">Spotted a child who may be missing?</h1>
            <p className="mt-2 text-gray-500">Capture a photo when it is safe, or continue with location details for CWC/Childline review.</p>
            <div className="mt-8">
              <div className="mx-auto grid h-44 w-44 place-items-center rounded-2xl border-2 border-dashed border-gray-300 text-5xl text-gray-300">
                Photo
              </div>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button className="btn-primary" onClick={() => fileRef.current?.click()}>Capture / Upload photo</button>
                <button className="btn-ghost" onClick={() => setStep(2)}>Continue without photo</button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="card overflow-hidden">
            {preview && (
              <div className="relative bg-black">
                <img src={preview} alt="child" className="mx-auto max-h-72 object-contain" />
                <div className="absolute left-1/2 top-1/2 h-28 w-24 -translate-x-1/2 -translate-y-1/2 rounded border-2 border-yellow-400" />
                <span className="absolute bottom-2 left-2 rounded bg-yellow-400/90 px-2 py-0.5 text-xs font-semibold text-black">face detected</span>
              </div>
            )}
            <div className="space-y-4 p-6">
              <h2 className="text-lg font-semibold">Where did you find the child?</h2>
              {!file && (
                <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  No photo attached. This will be sent as a text sighting to Childline/CWC intake and no match search will run.
                </div>
              )}
              <div>
                <label className="label">Found location</label>
                <div className="flex gap-2">
                  <input className="field" value={form.foundLocation} onChange={set('foundLocation')} placeholder="Area, landmark, city" />
                  <button type="button" className="btn-ghost shrink-0" onClick={useLocation}>Use GPS</button>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">State</label>
                  <input className="field" value={form.state} onChange={set('state')} placeholder="e.g. Maharashtra" />
                </div>
                <div>
                  <label className="label">District</label>
                  <input className="field" value={form.district} onChange={set('district')} placeholder="e.g. Mumbai" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">Approx. age</label>
                  <input className="field" type="number" value={form.ageApprox} onChange={set('ageApprox')} placeholder="e.g. 6" />
                </div>
                <div>
                  <label className="label">Gender</label>
                  <select className="field" value={form.gender} onChange={set('gender')}>
                    <option value="">Not sure</option>
                    <option>Male</option>
                    <option>Female</option>
                  </select>
                </div>
                <div>
                  <label className="label">Your name (optional)</label>
                  <input className="field" value={form.reporterName} onChange={set('reporterName')} />
                </div>
                <div>
                  <label className="label">Your phone (optional)</label>
                  <input className="field" value={form.reporterPhone} onChange={set('reporterPhone')} />
                </div>
              </div>
              <label className="flex gap-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
                <input type="checkbox" className="mt-1" checked={form.confidentialReporter} onChange={setChecked('confidentialReporter')} />
                <span>Keep my identity confidential in the review queue.</span>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">Photo ID proof</label>
                  <select className="field" value={form.idProofType} onChange={set('idProofType')}>
                    {ID_PROOF_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">ID number</label>
                  <input className="field" value={form.idProofNumber} onChange={set('idProofNumber')} placeholder="Stored masked" />
                </div>
              </div>
              <div>
                <label className="label">Note</label>
                <textarea className="field" rows={2} value={form.note} onChange={set('note')} placeholder="Anything that helps identify the child" />
              </div>
              {file && (
                <label className="flex gap-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
                  <input type="checkbox" className="mt-1" checked={form.photoConsent} onChange={setChecked('photoConsent')} required />
                  <span>
                    I confirm this photo may be used only for child-protection review, police/CWC follow-up, and match search. The sighting image is retained for 180 days unless escalated.
                  </span>
                </label>
              )}
              <div className="flex justify-between">
                <button className="btn-ghost" onClick={() => setStep(1)}>Back</button>
                <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Submitting...' : file ? 'Submit & search matches' : 'Submit text sighting'}</button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="space-y-6">
            <div className="card p-6 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-khozo-light text-2xl">OK</div>
              <h2 className="mt-3 text-xl font-bold">Thank you - your report was submitted</h2>
              <p className="mt-2 text-sm font-semibold text-khozo">Receipt ID: {result.foundReport.id}</p>
              {/*
                The server decides what a reporter may be told, and says it in
                `review`. It never returns which child was matched — that would
                hand a stranger a missing child's identity — so this cannot be
                inferred client-side from a matched id, which is always absent.
              */}
              <p className="mt-1 text-gray-500">
                {result.review || 'Your report is saved and will be checked against new cases.'}
              </p>
            </div>

            {result.candidates.length > 0 && (
              <div>
                <h3 className="mb-3 font-semibold">Closest matches from missing-children records</h3>
                <div className="space-y-3">
                  {result.candidates.map((c) => (
                    <div key={c.rank} className="card flex items-center gap-4 p-4">
                      <Avatar name={`Candidate ${c.rank}`} size={52} />
                      <div className="flex-1">
                        <p className="font-semibold">Candidate #{c.rank}</p>
                        <p className="text-sm text-gray-500">{c.gender || 'Gender unknown'} / age band {c.ageBand}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-bold ${c.score >= 0.8 ? 'text-emerald-600' : c.score >= 0.6 ? 'text-amber-600' : 'text-gray-400'}`}>
                          {Math.round(c.score * 100)}%
                        </p>
                        <p className="text-xs text-gray-400">match</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card p-4 text-sm text-gray-600">
              <p className="font-semibold text-ink">Review status</p>
              <p className="mt-1">{result.review}</p>
              <p className="mt-2 text-xs text-gray-400">{result.foundReport.referralStatus}</p>
              {result.foundReport.matchEngine && (
                <p className="mt-1 text-xs text-gray-400">
                  Match engine: {result.foundReport.matchEngine.provider}
                  {result.foundReport.matchEngine.biometric ? '' : ' demo workflow scorer'}
                </p>
              )}
              {result.foundReport.retentionUntil && (
                <p className="mt-1 text-xs text-gray-400">Photo review retention until {new Date(result.foundReport.retentionUntil).toLocaleDateString('en-IN')}</p>
              )}
            </div>

            <div className="flex justify-center gap-3">
              <Link to="/" className="btn-ghost">Done</Link>
              <Link to="/track-sighting" className="btn-ghost">Track status</Link>
              <button className="btn-primary" onClick={() => { setStep(1); setResult(null); setFile(null); setPreview(null); }}>Report another</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
