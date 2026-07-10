import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Logo } from '../components.jsx';
import { fmtDate } from '../lib.jsx';

export default function TrackCase() {
  const [ref, setRef] = useState('');
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const lookup = async (event) => {
    event.preventDefault();
    const value = ref.trim();
    if (!value) return;
    setBusy(true);
    setErr('');
    setStatus(null);
    try {
      const data = await api.get(`/reports/public/status/${encodeURIComponent(value)}`);
      setStatus(data.status);
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-6 py-5">
          <Logo />
          <div className="flex gap-2">
            <Link to="/report" className="btn-primary">Submit sighting</Link>
            <Link to="/" className="btn-ghost">Home</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-khozo">Case status</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">Track a missing-child case</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-500">
            Enter a Khozo case id, FIR/GD number, or linked TrackChild/NCRB/GHAR reference. This page returns only safe progress information and never reveals guardian contacts, identity numbers, addresses, notes, photos, or care-plan details.
          </p>
        </div>

        <form onSubmit={lookup} className="mt-6 flex flex-col gap-3 rounded-xl bg-white p-4 ring-1 ring-black/5 sm:flex-row">
          <input className="field flex-1" value={ref} onChange={(event) => setRef(event.target.value)} placeholder="Example: FIR/2026/1234 or TC-2026-001" />
          <button className="btn-primary" disabled={busy}>{busy ? 'Checking...' : 'Check status'}</button>
        </form>

        {err && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

        {status && (
          <section className="mt-6 rounded-xl bg-white p-5 ring-1 ring-black/5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-500">Case {status.id}</p>
                <h2 className="mt-1 text-xl font-bold text-ink">{status.statusLabel}</h2>
              </div>
              <span className="rounded-full bg-khozo-light px-3 py-1 text-xs font-semibold text-khozo">
                {status.status.replaceAll('_', ' ')}
              </span>
            </div>

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">Public identity</dt>
                <dd className="mt-1 font-medium">{status.publicName}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">Age / gender</dt>
                <dd className="mt-1 font-medium">{[status.ageBand ? `approx. ${status.ageBand}` : null, status.gender].filter(Boolean).join(' / ') || '-'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">Jurisdiction</dt>
                <dd className="mt-1 font-medium">{[status.district, status.state].filter(Boolean).join(', ') || '-'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">FIR / GD</dt>
                <dd className="mt-1 font-medium">{status.firNo || '-'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">Registered</dt>
                <dd className="mt-1 font-medium">{fmtDate(status.registeredAt)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">Missing date</dt>
                <dd className="mt-1 font-medium">{fmtDate(status.dateOfMissing)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">External reference</dt>
                <dd className="mt-1 font-medium">{status.externalId ? `${status.externalId.label}: ${status.externalId.externalId}` : '-'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">Public bulletin</dt>
                <dd className="mt-1 font-medium">{status.publicBulletin ? 'Published' : 'Not published'}</dd>
              </div>
            </dl>

            <div className="mt-5 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
              <p className="font-semibold text-ink">{status.message}</p>
              {status.workflowStage && <p className="mt-1">Latest official stage: {status.workflowStage}</p>}
              {status.closureReason && <p className="mt-1">Closure reason: {status.closureReason}</p>}
              <p className="mt-1">{status.nextStep}</p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
