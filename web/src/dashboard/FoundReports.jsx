import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { ProtectedImage, StatusBadge, timeAgo } from '../lib.jsx';
import { useAuth } from '../auth.jsx';

const CWC_OUTCOMES = [
  { id: 'child_located_safe', label: 'Child located safe' },
  { id: 'shelter_intake_required', label: 'Shelter / CCI intake' },
  { id: 'escalated_police', label: 'Escalate police' },
  { id: 'duplicate_or_invalid', label: 'Duplicate / invalid' },
];

const FILTERS = [
  { id: 'needs_review', label: 'Needs review', match: (f) => ['pending_review', 'no_match', 'referred_cwc'].includes(f.status) },
  { id: 'matched', label: 'Confirmed', match: (f) => ['matched', 'formalized_case', 'cwc_followup_complete'].includes(f.status) },
  { id: 'closed', label: 'Rejected', match: (f) => f.status === 'rejected' },
  { id: 'all', label: 'All', match: () => true },
];

/**
 * Describes a score against the threshold the system actually routes on (0.35),
 * not against a round number. The bands were 80/60, which painted a genuine
 * match at 0.5 the same grey as no match at all — in the one place a reviewer
 * looks before deciding whether to open a case.
 */
function confidenceBand(score) {
  const value = Number(score) || 0;
  if (value >= 0.6) return { label: 'Strong', className: 'text-emerald-600' };
  if (value >= 0.35) return { label: 'Worth reviewing', className: 'text-amber-600' };
  if (value > 0) return { label: 'Below threshold', className: 'text-slate-400' };
  return { label: 'No candidate', className: 'text-slate-300' };
}

/** What the intake screen found, for the reviewer who has to weigh it. */
function screeningNote(screening) {
  if (!screening) return null;
  if (screening.verdict === 'person') {
    return { label: 'Person detected in the photo', className: 'bg-emerald-50 text-emerald-700' };
  }
  if (screening.verdict === 'no_person') {
    return { label: 'No person detected — screened out of the general alert', className: 'bg-amber-50 text-amber-700' };
  }
  if (screening.verdict === 'unverified') {
    return { label: 'Not screened — no detection provider answered', className: 'bg-slate-100 text-slate-600' };
  }
  return null;
}

export default function FoundReports() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [reportsById, setReportsById] = useState({});
  const [followups, setFollowups] = useState({});
  const [intakes, setIntakes] = useState({});
  const [busyId, setBusyId] = useState('');
  const [compareModal, setCompareModal] = useState(null);
  const [filter, setFilter] = useState('needs_review');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // A notification links to one sighting, so arriving from an alert has to land
  // on that card rather than on a list of twenty-five.
  const [search] = useSearchParams();
  const highlightId = search.get('id') || '';
  const cardRefs = useRef({});

  const canConfirm = ['super_admin', 'admin', 'police', 'sjpu'].includes(user.role);
  const canCwcFollowup = ['super_admin', 'admin', 'cwc', 'dcpu', 'state_nodal', 'sara'].includes(user.role);
  const canFormalizeIntake = ['super_admin', 'admin', 'police', 'sjpu', 'cwc', 'dcpu', 'cci', 'saa', 'state_nodal', 'sara'].includes(user.role);

  const load = useCallback(() => {
    setError('');
    api.get('/reports/found/all')
      .then((d) => setRows(d.foundReports || []))
      // A swallowed failure here is indistinguishable from an empty queue, which
      // is the difference between "nothing to do" and "you are not being shown
      // the reports".
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    api.get('/reports').then((d) => {
      const m = {};
      (d.reports || []).forEach((r) => (m[r.id] = r));
      setReportsById(m);
    }).catch(() => {});
  }, []);
  useEffect(load, [load]);

  // Arriving from an alert: show every status so the linked sighting cannot be
  // hidden by whichever filter happened to be selected, then scroll to it.
  useEffect(() => {
    if (highlightId) setFilter('all');
  }, [highlightId]);

  useEffect(() => {
    if (!highlightId || !rows.length) return;
    const node = cardRefs.current[highlightId];
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, rows]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((tab) => [tab.id, rows.filter(tab.match).length])),
    [rows]
  );

  /**
   * Unreviewed first, then by score, then newest. The queue is worked from the
   * top, so the order is the triage.
   */
  const visible = useMemo(() => {
    const tab = FILTERS.find((t) => t.id === filter) || FILTERS[0];
    return rows
      .filter(tab.match)
      .slice()
      .sort((a, b) => {
        const pending = (f) => (f.status === 'pending_review' ? 0 : 1);
        if (pending(a) !== pending(b)) return pending(a) - pending(b);
        if ((b.matchScore || 0) !== (a.matchScore || 0)) return (b.matchScore || 0) - (a.matchScore || 0);
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
  }, [rows, filter]);

  /** Names the engine that actually ran, rather than asserting a provider. */
  const engineLabel = useMemo(() => {
    const engine = rows.find((f) => f.matchEngine?.provider)?.matchEngine;
    if (!engine) return { text: 'No comparison run yet', biometric: false, provider: 'none' };
    return {
      text: engine.biometric ? `Biometric · ${engine.provider}` : `Non-biometric · ${engine.provider}`,
      biometric: Boolean(engine.biometric),
      provider: engine.provider,
    };
  }, [rows]);

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
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-black/5 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Sightings &amp; matches</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Photographs the public sent in, ranked against open cases. A score is a prompt to look,
            never a decision — you confirm, and only then is a family contacted.
          </p>
        </div>
        {/*
          Names the engine that actually ran, from the sighting data. This
          previously read "Aarakshak Live AI v1.82" regardless of what was
          configured, which tells a reviewer a score is biometric when it may
          not be.
        */}
        <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
          <span className={`h-1.5 w-1.5 rounded-full ${engineLabel.biometric ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {engineLabel.text}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              filter === tab.id
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {tab.label}
            <span className={`ml-1.5 ${filter === tab.id ? 'text-white/70' : 'text-slate-400'}`}>
              {counts[tab.id] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          Could not load the review queue: {error}.{' '}
          <button onClick={load} className="font-semibold underline">Retry</button>
        </div>
      )}

      {loading && <p className="text-sm text-gray-400">Loading the review queue…</p>}

      {!loading && !error && visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {rows.length === 0 ? 'No sightings reported yet' : 'Nothing in this view'}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {rows.length === 0
              ? 'Reports from the public arrive here the moment they are submitted, and you are alerted.'
              : 'Try another filter.'}
          </p>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {visible.map((f) => {
          const matched = f.matchedReport || (f.matchedReportId ? reportsById[f.matchedReportId] : null);
          const scorePct = Math.round((f.matchScore || 0) * 100);
          const band = confidenceBand(f.matchScore);
          const screen = screeningNote(f.screening);
          return (
            <div
              key={f.id}
              ref={(node) => { cardRefs.current[f.id] = node; }}
              className={`card p-6 shadow-sm transition-shadow hover:shadow-md ${
                highlightId === f.id ? 'ring-2 ring-indigo-500 ring-offset-2' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-gray-900">{f.reporterName}</p>
                  <p className="text-xs text-gray-500">{timeAgo(f.createdAt)} • {f.reporterPhone || 'confidential'}</p>
                </div>
                <StatusBadge status={f.status} />
              </div>

              {/*
                The photograph the citizen sent is the thing being reviewed, so
                it belongs on the card. It used to be reachable only through a
                modal, leaving the reviewer judging a percentage without ever
                seeing the face it came from.
              */}
              <div className="mt-4 flex gap-4">
                <div className="h-32 w-32 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                  <ProtectedImage
                    src={f.photoUrl || `/api/reports/photo/${f.id}`}
                    alt="Reported sighting"
                    className="h-full w-full object-cover"
                    fallback={
                      <div className="grid h-full w-full place-items-center px-2 text-center text-[11px] text-slate-400">
                        No photo — text report
                      </div>
                    }
                  />
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  <p className="flex items-start gap-1.5 text-sm font-medium text-slate-800">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    </svg>
                    <span className="min-w-0">
                      {f.foundLocation}
                      {(f.district || f.state) && (
                        <span className="block text-xs font-normal text-slate-500">
                          {[f.district, f.state].filter(Boolean).join(', ')}
                          {f.locationSource === 'coordinates' && ' · from the reporter’s location'}
                        </span>
                      )}
                      {!f.state && !f.district && (
                        <span className="block text-xs font-normal text-amber-600">
                          No jurisdiction given — visible to every review desk
                        </span>
                      )}
                    </span>
                  </p>
                  {f.note && <p className="text-sm italic text-slate-600">“{f.note}”</p>}
                  {screen && (
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${screen.className}`}>
                      {screen.label}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {matched && (
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-indigo-200 bg-indigo-100">
                        <ProtectedImage
                          src={matched.photoUrl || `/api/reports/photo/${matched.id}`}
                          alt={matched.childName}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}
                    <div className="min-w-0">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Closest open case</span>
                      <p className="truncate text-base font-bold capitalize text-gray-900">
                        {matched ? matched.childName : 'No candidate above the review threshold'}
                      </p>
                      {matched && (
                        <p className="truncate text-xs text-gray-500">
                          Case #{matched.id} • {matched.address || matched.district}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`text-2xl font-extrabold ${band.className}`}>{scorePct}%</div>
                    <p className="text-[10px] font-medium text-gray-400">{band.label}</p>
                  </div>
                </div>

                {matched && (
                  <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-2.5">
                    <span className="text-xs text-slate-500">{f.matchEngine?.provider || engineLabel.provider}</span>
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
