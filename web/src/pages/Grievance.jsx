import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Logo } from '../components.jsx';
import { fmtDate } from '../lib.jsx';

const TYPES = [
  { id: 'missing_child_support', label: 'Missing child support' },
  { id: 'sighting_followup', label: 'Sighting follow-up' },
  { id: 'cci_care', label: 'CCI care concern' },
  { id: 'adoption_carings', label: 'Adoption / CARINGS support' },
  { id: 'restoration_repatriation', label: 'Restoration / repatriation' },
  { id: 'service_access', label: 'Service access' },
  { id: 'data_privacy', label: 'Data privacy' },
  { id: 'other', label: 'Other' },
];
const LEVELS = [
  { id: 'cci', label: 'CCI' },
  { id: 'dcpu', label: 'DCPU' },
  { id: 'cwc', label: 'CWC' },
  { id: 'saa', label: 'SAA' },
  { id: 'sara', label: 'SARA' },
  { id: 'scps', label: 'SCPS / State' },
  { id: 'ministry', label: 'Ministry' },
];

export default function Grievance() {
  const [mode, setMode] = useState('new');
  const [form, setForm] = useState({
    grievanceType: 'sighting_followup',
    reportToLevel: 'dcpu',
    name: '',
    phone: '',
    email: '',
    state: '',
    district: '',
    linkedReceiptId: '',
    subject: '',
    description: '',
    attachmentName: '',
  });
  const [receipt, setReceipt] = useState('');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const data = await api.post('/grievances', form);
      setResult(data.grievance);
      setReceipt(data.grievance.id);
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const lookup = async (event) => {
    event.preventDefault();
    if (!receipt.trim()) return;
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const data = await api.get(`/grievances/status/${encodeURIComponent(receipt.trim())}`);
      setResult(data.grievance);
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-5">
          <Logo />
          <div className="flex gap-2">
            <Link to="/report" className="btn-primary">Submit sighting</Link>
            <Link to="/" className="btn-ghost">Home</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-khozo">Grievance / feedback</p>
            <h1 className="mt-1 text-3xl font-bold text-ink">Public grievance desk</h1>
          </div>
          <div className="rounded-xl bg-white p-1 ring-1 ring-black/5">
            <button className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === 'new' ? 'bg-khozo text-white' : 'text-gray-600'}`} onClick={() => setMode('new')}>New</button>
            <button className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === 'track' ? 'bg-khozo text-white' : 'text-gray-600'}`} onClick={() => setMode('track')}>Track</button>
          </div>
        </div>

        {err && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

        {mode === 'new' ? (
          <form onSubmit={submit} className="mt-6 space-y-5 rounded-xl bg-white p-5 ring-1 ring-black/5">
            <div className="grid gap-4 md:grid-cols-2">
              <label>
                <span className="label">Type</span>
                <select className="field" value={form.grievanceType} onChange={set('grievanceType')}>
                  {TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                </select>
              </label>
              <label>
                <span className="label">Report to</span>
                <select className="field" value={form.reportToLevel} onChange={set('reportToLevel')}>
                  {LEVELS.map((level) => <option key={level.id} value={level.id}>{level.label}</option>)}
                </select>
              </label>
              <label>
                <span className="label">Name</span>
                <input className="field" value={form.name} onChange={set('name')} />
              </label>
              <label>
                <span className="label">Mobile</span>
                <input className="field" value={form.phone} onChange={set('phone')} />
              </label>
              <label>
                <span className="label">Email</span>
                <input className="field" type="email" value={form.email} onChange={set('email')} />
              </label>
              <label>
                <span className="label">Linked receipt</span>
                <input className="field" value={form.linkedReceiptId} onChange={set('linkedReceiptId')} placeholder="Case / sighting / grievance id" />
              </label>
              <label>
                <span className="label">State</span>
                <input className="field" value={form.state} onChange={set('state')} />
              </label>
              <label>
                <span className="label">District</span>
                <input className="field" value={form.district} onChange={set('district')} />
              </label>
            </div>
            <label>
              <span className="label">Subject</span>
              <input className="field" value={form.subject} onChange={set('subject')} required />
            </label>
            <label>
              <span className="label">Details</span>
              <textarea className="field min-h-32" value={form.description} onChange={set('description')} required />
            </label>
            <label>
              <span className="label">Attachment reference</span>
              <input className="field" value={form.attachmentName} onChange={set('attachmentName')} placeholder="File name / document reference" />
            </label>
            <button className="btn-primary" disabled={busy}>{busy ? 'Submitting...' : 'Submit grievance'}</button>
          </form>
        ) : (
          <form onSubmit={lookup} className="mt-6 flex flex-col gap-3 rounded-xl bg-white p-4 ring-1 ring-black/5 sm:flex-row">
            <input className="field flex-1" value={receipt} onChange={(event) => setReceipt(event.target.value)} placeholder="Example: g_abc12345" />
            <button className="btn-primary" disabled={busy}>{busy ? 'Checking...' : 'Check status'}</button>
          </form>
        )}

        {result && (
          <section className="mt-6 rounded-xl bg-white p-5 ring-1 ring-black/5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-500">Reference {result.id}</p>
                <h2 className="mt-1 text-xl font-bold text-ink">{result.statusLabel}</h2>
              </div>
              <span className="rounded-full bg-khozo-light px-3 py-1 text-xs font-semibold text-khozo">{result.grievanceLabel}</span>
            </div>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs uppercase tracking-wide text-gray-400">Submitted</dt><dd className="mt-1 font-medium">{fmtDate(result.submittedAt)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-gray-400">Updated</dt><dd className="mt-1 font-medium">{fmtDate(result.updatedAt)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-gray-400">Report to</dt><dd className="mt-1 font-medium">{result.reportToLabel}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-gray-400">Location</dt><dd className="mt-1 font-medium">{[result.district, result.state].filter(Boolean).join(', ') || '-'}</dd></div>
            </dl>
            <div className="mt-5 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
              <p className="font-semibold text-ink">{result.message}</p>
              {result.linkedReceiptId && <p className="mt-1">Linked receipt: {result.linkedReceiptId}</p>}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
