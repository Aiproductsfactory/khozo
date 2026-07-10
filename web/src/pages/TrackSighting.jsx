import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Logo } from '../components.jsx';
import { fmtDate } from '../lib.jsx';

const STAGE_LABELS = {
  police_review_pending: 'Police review pending',
  cwc_intake_queued: 'CWC intake queued',
  childline_cwc_referred: 'Referred to Childline/CWC',
  cwc_followup_complete: 'CWC follow-up complete',
  formal_case_created: 'Formal found-child intake opened',
  review_complete: 'Reviewed',
  review_closed: 'Closed after review',
};

export default function TrackSighting() {
  const [receipt, setReceipt] = useState('');
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const lookup = async (e) => {
    e.preventDefault();
    const id = receipt.trim();
    if (!id) return;
    setBusy(true);
    setErr('');
    setStatus(null);
    try {
      const data = await api.get(`/reports/found/status/${encodeURIComponent(id)}`);
      setStatus(data.status);
    } catch (e2) {
      setErr(e2.message);
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
          <p className="text-xs font-semibold uppercase tracking-wide text-khozo">Receipt lookup</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">Track a sighting report</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-500">
            Enter the receipt id shown after submitting a public sighting. This page only shows safe progress information and never reveals child identity, guardian contacts, or matched case details.
          </p>
        </div>

        <form onSubmit={lookup} className="mt-6 flex flex-col gap-3 rounded-xl bg-white p-4 ring-1 ring-black/5 sm:flex-row">
          <input className="field flex-1" value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder="Example: f_abc12345" />
          <button className="btn-primary" disabled={busy}>{busy ? 'Checking...' : 'Check status'}</button>
        </form>

        {err && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

        {status && (
          <section className="mt-6 rounded-xl bg-white p-5 ring-1 ring-black/5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-500">Receipt {status.id}</p>
                <h2 className="mt-1 text-xl font-bold text-ink">{STAGE_LABELS[status.reviewStage] || status.status}</h2>
              </div>
              <span className="rounded-full bg-khozo-light px-3 py-1 text-xs font-semibold text-khozo">
                {status.status.replaceAll('_', ' ')}
              </span>
            </div>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">Submitted</dt>
                <dd className="mt-1 font-medium">{fmtDate(status.submittedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">Location</dt>
                <dd className="mt-1 font-medium">{[status.foundLocation, status.district, status.state].filter(Boolean).join(', ')}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">Referral</dt>
                <dd className="mt-1 font-medium">{status.referralStatus || '-'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">1098/CWC</dt>
                <dd className="mt-1 font-medium">{status.referredTo1098 ? 'Queued / referred' : 'Not referred'}</dd>
              </div>
            </dl>
            <div className="mt-5 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
              <p className="font-semibold text-ink">{status.message}</p>
              <p className="mt-1">{status.nextStep}</p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
