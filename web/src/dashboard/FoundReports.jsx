import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { StatusBadge, timeAgo } from '../lib.jsx';
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
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold">Sightings &amp; matches</h2>
        <p className="text-sm text-gray-500">Citizen and NGO sightings ranked against missing-children records in your scope.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((f) => {
          const matched = f.matchedReport || (f.matchedReportId ? reportsById[f.matchedReportId] : null);
          return (
            <div key={f.id} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{f.reporterName}</p>
                  <p className="text-xs text-gray-400">{timeAgo(f.createdAt)} / {f.reporterPhone || 'no contact'}</p>
                </div>
                <StatusBadge status={f.status} />
              </div>

              <div className="mt-3 rounded-xl bg-gray-50 p-3 text-sm">
                <p className="text-gray-700">{f.foundLocation}</p>
                {f.note && <p className="mt-1 text-gray-500">"{f.note}"</p>}
              </div>

              <div className="mt-3 flex items-center justify-between rounded-xl border border-black/5 p-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400">Best candidate</p>
                  <p className="font-semibold capitalize">{matched ? matched.childName : 'No strong match'}</p>
                  {matched && <p className="text-xs text-gray-500">last seen {matched.address || matched.district}</p>}
                </div>
                <div className="text-right">
                  <p className={`text-xl font-bold ${f.matchScore >= 0.8 ? 'text-emerald-600' : f.matchScore >= 0.6 ? 'text-amber-600' : 'text-gray-400'}`}>
                    {Math.round(f.matchScore * 100)}%
                  </p>
                </div>
              </div>

              {f.status === 'pending_review' && (
                <div className={`mt-3 grid gap-2 ${canConfirm ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                  {canConfirm && <button onClick={() => review(f, 'matched')} className="btn-primary flex-1">Confirm &amp; reunite</button>}
                  <button onClick={() => review(f, 'rejected')} className="btn-ghost flex-1">Reject</button>
                  <button onClick={() => review(f, 'refer_cwc')} className="btn-ghost flex-1">Refer 1098/CWC</button>
                </div>
              )}
              {canCwcFollowup && ['no_match', 'referred_cwc'].includes(f.status) && (
                <div className="mt-3 rounded-xl border border-black/5 p-3">
                  <p className="text-sm font-medium">CWC / DCPU follow-up</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <select
                      className="field"
                      value={(followups[f.id]?.outcome) || 'child_located_safe'}
                      onChange={setFollowup(f.id, 'outcome')}
                    >
                      {CWC_OUTCOMES.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.label}</option>)}
                    </select>
                    <button className="btn-primary" onClick={() => cwcFollowup(f)}>Record</button>
                  </div>
                  <textarea
                    className="field mt-2 min-h-16 w-full"
                    value={(followups[f.id]?.note) || ''}
                    onChange={setFollowup(f.id, 'note')}
                    placeholder="Follow-up note"
                  />
                </div>
              )}
              {f.cwcFollowup && (
                <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  <p className="font-semibold">{f.cwcFollowup.label}</p>
                  <p>{f.cwcFollowup.actorName} / {new Date(f.cwcFollowup.completedAt).toLocaleString('en-IN')}</p>
                </div>
              )}
              {canFormalizeIntake && ['no_match', 'referred_cwc', 'cwc_followup_complete'].includes(f.status) && !f.formalReportId && (
                <div className="mt-3 rounded-xl border border-black/5 p-3">
                  <p className="text-sm font-medium">Formal found-child intake</p>
                  <p className="text-xs text-gray-600">Open a child-protection case for CCI/MIS follow-up when no missing-case match exists.</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input
                      className="field"
                      value={(intakes[f.id]?.childName) || ''}
                      onChange={setIntake(f.id, 'childName')}
                      placeholder="Temporary child identifier"
                    />
                    <input
                      className="field"
                      value={(intakes[f.id]?.intakeAuthority) || ''}
                      onChange={setIntake(f.id, 'intakeAuthority')}
                      placeholder={user.org || user.name}
                    />
                    <input
                      className="field"
                      type="date"
                      value={(intakes[f.id]?.admissionDate) || new Date().toISOString().slice(0, 10)}
                      onChange={setIntake(f.id, 'admissionDate')}
                    />
                    <input
                      className="field"
                      type="date"
                      value={(intakes[f.id]?.nextReviewDate) || ''}
                      onChange={setIntake(f.id, 'nextReviewDate')}
                    />
                  </div>
                  <textarea
                    className="field mt-2 min-h-16 w-full"
                    value={(intakes[f.id]?.note) || ''}
                    onChange={setIntake(f.id, 'note')}
                    placeholder="Intake note, care needs, family tracing action"
                  />
                  <button
                    className="btn-primary mt-2 w-full"
                    disabled={busyId === f.id || ((intakes[f.id]?.note) || '').trim().length < 10}
                    onClick={() => formalizeIntake(f)}
                  >
                    {busyId === f.id ? 'Opening...' : 'Open formal intake'}
                  </button>
                </div>
              )}
              {f.formalReportId && (
                <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  <p className="font-semibold">Formal found-child intake opened</p>
                  <p>Case reference {f.formalReportId}</p>
                </div>
              )}
              {f.referralStatus && <p className="mt-3 text-xs text-gray-400">{f.referralStatus}</p>}
              <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
                <p>Purpose: {f.dataPurpose || 'sighting review and child protection'}</p>
                {f.retentionUntil && <p>Photo retention until {new Date(f.retentionUntil).toLocaleDateString('en-IN')}</p>}
                <p>Consent: {f.photoConsent ? 'recorded' : 'not recorded'}</p>
                <p>Reporter identity: {f.confidentialReporter ? 'confidential' : 'visible'}</p>
                <p>ID proof: {f.idProofLabel ? `${f.idProofLabel} ${f.idProofNumberMasked || ''}` : 'not captured'}</p>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-gray-400">No sightings reported yet.</p>}
      </div>
    </div>
  );
}
