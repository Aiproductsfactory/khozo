import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ProtectedImage, StatusBadge, timeAgo } from '../lib.jsx';
import { useAuth } from '../auth.jsx';

const CWC_OUTCOMES = [
  { id: 'child_located_safe', label: 'Child located safe' },
  { id: 'shelter_intake_required', label: 'Shelter / CCI intake' },
  { id: 'escalated_police', label: 'Escalate police' },
  { id: 'duplicate_or_invalid', label: 'Duplicate / invalid' },
];

export default function FoundReports() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [reportsById, setReportsById] = useState({});
  const [followups, setFollowups] = useState({});
  const [intakes, setIntakes] = useState({});
  const [busyId, setBusyId] = useState('');
  const [compareModal, setCompareModal] = useState(null);

  const canConfirm = ['super_admin', 'admin', 'police', 'sjpu'].includes(user.role);
  const canCwcFollowup = ['super_admin', 'admin', 'cwc', 'dcpu', 'state_nodal', 'sara'].includes(user.role);
  const canFormalizeIntake = ['super_admin', 'admin', 'police', 'sjpu', 'cwc', 'dcpu', 'cci', 'saa', 'state_nodal', 'sara'].includes(user.role);

  const load = () => {
    api.get('/reports/found/all').then((d) => setRows(d.foundReports)).catch(() => {});
    api.get('/reports').then((d) => {
      const m = {};
      d.reports.forEach((r) => (m[r.id] = r));
      setReportsById(m);
    }).catch(() => {});
  };
  useEffect(load, []);

  const review = async (f, decision) => {
    await api.post(`/reports/found/${f.id}/review`, { decision });
    load();
  };

  const cwcFollowup = async (f) => {
    const form = followups[f.id] || { outcome: 'child_located_safe', note: '' };
    await api.post(`/reports/found/${f.id}/cwc-followup`, form);
    setFollowups((rows) => ({ ...rows, [f.id]: { outcome: 'child_located_safe', note: '' } }));
    load();
  };

  const formalizeIntake = async (f) => {
    const form = intakes[f.id] || {};
    setBusyId(f.id);
    try {
      await api.post(`/reports/found/${f.id}/formal-intake`, {
        childName: form.childName || 'Unknown child',
        guardianName: form.guardianName || 'Unknown guardian',
        intakeAuthority: form.intakeAuthority || user.org || user.name,
        admissionDate: form.admissionDate || new Date().toISOString().slice(0, 10),
        nextReviewDate: form.nextReviewDate || '',
        ageApprox: form.ageApprox || f.ageApprox || '',
        gender: form.gender || f.gender || 'Other',
        note: form.note || '',
      });
      setIntakes((rows) => ({ ...rows, [f.id]: {} }));
      load();
    } finally {
      setBusyId('');
    }
  };

  const setFollowup = (id, key) => (e) => {
    setFollowups((rows) => ({
      ...rows,
      [id]: { outcome: 'child_located_safe', note: '', ...(rows[id] || {}), [key]: e.target.value },
    }));
  };

  const setIntake = (id, key) => (e) => {
    setIntakes((rows) => ({
      ...rows,
      [id]: {
        childName: 'Unknown child',
        guardianName: 'Unknown guardian',
        intakeAuthority: user.org || user.name,
        admissionDate: new Date().toISOString().slice(0, 10),
        nextReviewDate: '',
        ageApprox: '',
        gender: 'Other',
        note: '',
        ...(rows[id] || {}),
        [key]: e.target.value,
      },
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/5 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight">Sightings &amp; Biometric Matches</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Aarakshak Live AI v1.82
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Field citizen sightings ranked against missing-children cases using primary Aarakshak Face Recognition API &amp; AWS Rekognition.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {rows.map((f) => {
          const matched = f.matchedReport || (f.matchedReportId ? reportsById[f.matchedReportId] : null);
          const scorePct = Math.round((f.matchScore || 0) * 100);
          return (
            <div key={f.id} className="card p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-gray-900">{f.reporterName}</p>
                  <p className="text-xs text-gray-500">{timeAgo(f.createdAt)} • {f.reporterPhone || 'confidential'}</p>
                </div>
                <StatusBadge status={f.status} />
              </div>

              <div className="mt-4 rounded-xl bg-slate-50 p-3.5 text-sm border border-slate-100">
                <p className="font-medium text-slate-800 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  </svg>
                  {f.foundLocation}
                </p>
                {f.note && <p className="mt-1 text-slate-600 italic">"{f.note}"</p>}
              </div>

              {/* Match Card Gauge */}
              <div className="mt-4 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/40 to-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {matched && (
                      <div className="h-12 w-12 rounded-lg bg-indigo-100 overflow-hidden shrink-0 border border-indigo-200">
                        <ProtectedImage
                          src={matched.photoUrl || `/api/reports/photo/${matched.id}`}
                          alt={matched.childName}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">Biometric Candidate Match</span>
                      <p className="text-base font-bold text-gray-900 capitalize">{matched ? matched.childName : 'No strong match'}</p>
                      {matched && <p className="text-xs text-gray-500">Case #{matched.id} • {matched.address || matched.district}</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`inline-flex items-center gap-1 text-2xl font-extrabold ${scorePct >= 80 ? 'text-emerald-600' : scorePct >= 60 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {scorePct}%
                    </div>
                    <p className="text-[10px] font-medium text-gray-400">Confidence</p>
                  </div>
                </div>

                {matched && (
                  <div className="mt-3 flex items-center justify-between border-t border-indigo-100/60 pt-2.5">
                    <span className="text-xs font-medium text-indigo-700">Aarakshak AI Engine</span>
                    <button
                      onClick={() => setCompareModal({ sighting: f, matched })}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      Side-by-side comparison &rarr;
                    </button>
                  </div>
                )}
              </div>

              {f.status === 'pending_review' && (
                <div className={`mt-4 grid gap-2 ${canConfirm ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                  {canConfirm && (
                    <button onClick={() => review(f, 'matched')} className="btn-primary py-2.5 text-xs font-semibold">
                      Confirm &amp; Reunite
                    </button>
                  )}
                  <button onClick={() => review(f, 'rejected')} className="btn-ghost py-2.5 text-xs">Reject</button>
                  <button onClick={() => review(f, 'refer_cwc')} className="btn-ghost py-2.5 text-xs">Refer 1098/CWC</button>
                </div>
              )}

              {canCwcFollowup && ['no_match', 'referred_cwc'].includes(f.status) && (
                <div className="mt-4 rounded-xl border border-black/5 p-4 bg-white">
                  <p className="text-sm font-semibold text-gray-800">CWC / DCPU Follow-up Action</p>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <select
                      className="field text-xs py-2"
                      value={(followups[f.id]?.outcome) || 'child_located_safe'}
                      onChange={setFollowup(f.id, 'outcome')}
                    >
                      {CWC_OUTCOMES.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.label}</option>)}
                    </select>
                    <button className="btn-primary text-xs px-4 py-2" onClick={() => cwcFollowup(f)}>Record Action</button>
                  </div>
                  <textarea
                    className="field mt-2 text-xs min-h-16 w-full"
                    value={(followups[f.id]?.note) || ''}
                    onChange={setFollowup(f.id, 'note')}
                    placeholder="Follow-up disposition note"
                  />
                </div>
              )}

              {f.cwcFollowup && (
                <div className="mt-3 rounded-lg bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
                  <p className="font-semibold">{f.cwcFollowup.label}</p>
                  <p>{f.cwcFollowup.actorName} • {new Date(f.cwcFollowup.completedAt).toLocaleString('en-IN')}</p>
                </div>
              )}

              {canFormalizeIntake && ['no_match', 'referred_cwc', 'cwc_followup_complete'].includes(f.status) && !f.formalReportId && (
                <div className="mt-4 rounded-xl border border-black/5 p-4 bg-white">
                  <p className="text-sm font-semibold text-gray-800">Formal Child Protection Intake</p>
                  <p className="text-xs text-gray-500 mt-0.5">Open a formal case for CCI shelter intake when no missing match exists.</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <input
                      className="field text-xs py-2"
                      value={(intakes[f.id]?.childName) || ''}
                      onChange={setIntake(f.id, 'childName')}
                      placeholder="Temporary child identifier"
                    />
                    <input
                      className="field text-xs py-2"
                      value={(intakes[f.id]?.intakeAuthority) || ''}
                      onChange={setIntake(f.id, 'intakeAuthority')}
                      placeholder={user.org || user.name}
                    />
                    <input
                      className="field text-xs py-2"
                      type="date"
                      value={(intakes[f.id]?.admissionDate) || new Date().toISOString().slice(0, 10)}
                      onChange={setIntake(f.id, 'admissionDate')}
                    />
                    <input
                      className="field text-xs py-2"
                      type="date"
                      value={(intakes[f.id]?.nextReviewDate) || ''}
                      onChange={setIntake(f.id, 'nextReviewDate')}
                    />
                  </div>
                  <textarea
                    className="field mt-2 text-xs min-h-16 w-full"
                    value={(intakes[f.id]?.note) || ''}
                    onChange={setIntake(f.id, 'note')}
                    placeholder="Intake note, rehabilitation plan, family tracing action"
                  />
                  <button
                    className="btn-primary mt-2.5 w-full py-2 text-xs font-semibold"
                    disabled={busyId === f.id || ((intakes[f.id]?.note) || '').trim().length < 10}
                    onClick={() => formalizeIntake(f)}
                  >
                    {busyId === f.id ? 'Opening Case...' : 'Open Formal Intake'}
                  </button>
                </div>
              )}

              {f.formalReportId && (
                <div className="mt-3 rounded-lg bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800 border border-emerald-100">
                  <p className="font-bold">Formal Child-Protection Case Created</p>
                  <p>Case Reference: {f.formalReportId}</p>
                </div>
              )}

              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-[11px] text-gray-500 space-y-0.5">
                <p><span className="font-semibold text-gray-700">Data Purpose:</span> {f.dataPurpose || 'sighting review & child protection'}</p>
                {f.retentionUntil && <p><span className="font-semibold text-gray-700">Photo Retention Until:</span> {new Date(f.retentionUntil).toLocaleDateString('en-IN')}</p>}
                <p><span className="font-semibold text-gray-700">Consent:</span> {f.photoConsent ? 'Recorded' : 'Not recorded'}</p>
                <p><span className="font-semibold text-gray-700">Reporter Identity:</span> {f.confidentialReporter ? 'Confidential' : 'Visible'}</p>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-gray-400 col-span-2">No sightings reported yet.</p>}
      </div>

      {/* Side-by-Side Compare Modal */}
      {compareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card max-w-xl w-full p-6 space-y-5 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Biometric Face Comparison</h3>
                <p className="text-xs text-gray-500">Aarakshak Live AI • Threshold 0.35</p>
              </div>
              <button
                onClick={() => setCompareModal(null)}
                className="text-gray-400 hover:text-gray-600 text-lg font-bold"
              >
                &times;
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <span className="text-xs font-semibold text-gray-600 block mb-2">Field Sighting Photo</span>
                <div className="aspect-square rounded-xl bg-slate-100 border flex items-center justify-center text-slate-400 text-xs overflow-hidden">
                  <ProtectedImage
                    src={compareModal.sighting.photoUrl || (compareModal.sighting.id ? `/api/reports/photo/${compareModal.sighting.id}` : null)}
                    alt="Sighting"
                    className="h-full w-full object-cover rounded-xl"
                    fallback={<span>Field Sighting Image</span>}
                  />
                </div>
                <p className="mt-2 text-xs font-medium text-gray-700">{compareModal.sighting.foundLocation}</p>
              </div>

              <div className="text-center">
                <span className="text-xs font-semibold text-indigo-600 block mb-2">Missing Child Record</span>
                <div className="aspect-square rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-400 text-xs overflow-hidden">
                  <ProtectedImage
                    src={compareModal.matched.photoUrl || (compareModal.matched.id ? `/api/reports/photo/${compareModal.matched.id}` : null)}
                    alt="Missing Child"
                    className="h-full w-full object-cover rounded-xl"
                    fallback={<span>Missing Child Record Image</span>}
                  />
                </div>
                <p className="mt-2 text-xs font-bold text-gray-900">{compareModal.matched.childName}</p>
              </div>
            </div>

            <div className="rounded-xl bg-indigo-50 p-3.5 text-center">
              <span className="text-xs font-semibold text-indigo-700 block">AI Match Similarity Confidence</span>
              <span className="text-3xl font-extrabold text-indigo-900">{Math.round((compareModal.sighting.matchScore || 0) * 100)}%</span>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button onClick={() => setCompareModal(null)} className="btn-ghost text-xs py-2 px-4">
                Close
              </button>
              {canConfirm && compareModal.sighting.status === 'pending_review' && (
                <button
                  onClick={() => {
                    review(compareModal.sighting, 'matched');
                    setCompareModal(null);
                  }}
                  className="btn-primary text-xs py-2 px-4"
                >
                  Confirm Match &amp; Reunite
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
