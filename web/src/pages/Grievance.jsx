import { useState } from 'react';
import { api } from '../api.js';
import { fmtDate } from '../lib.jsx';
import { msg, useT } from '../i18n.jsx';
import { PublicFooter, PublicHeader, usePageMeta } from '../PublicChrome.jsx';

const TYPES = [
  { id: 'missing_child_support', label: msg('Missing child support') },
  { id: 'sighting_followup', label: msg('Sighting follow-up') },
  { id: 'cci_care', label: msg('CCI care concern') },
  { id: 'adoption_carings', label: msg('Adoption / CARINGS support') },
  { id: 'restoration_repatriation', label: msg('Restoration / repatriation') },
  { id: 'service_access', label: msg('Service access') },
  { id: 'data_privacy', label: msg('Data privacy') },
  { id: 'other', label: msg('Other') },
];
const LEVELS = [
  { id: 'cci', label: 'CCI' },
  { id: 'dcpu', label: 'DCPU' },
  { id: 'cwc', label: 'CWC' },
  { id: 'saa', label: 'SAA' },
  { id: 'sara', label: 'SARA' },
  { id: 'scps', label: msg('SCPS / State') },
  { id: 'ministry', label: msg('Ministry') },
];
// The server sends these English labels; they are translated at render.
const SERVER_LABELS = [msg('Submitted'), msg('Under review'), msg('Referred'), msg('Resolved'), msg('Closed')];
const DEFAULT_MESSAGE = msg('Your grievance is recorded and queued for review.');

export default function Grievance() {
  usePageMeta({ title: msg('Raise a grievance'), description: msg('Raise a complaint about how a missing-person case or a sighting was handled, and follow its status.') });
  const t = useT();
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
    <div className="flex min-h-screen flex-col bg-[#f6f8f5]">
      <PublicHeader />

      <main className="mx-auto w-full flex-1 max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-khozo">{t('Grievance / feedback')}</p>
            <h1 className="mt-1 text-3xl font-bold text-ink">{t('Public grievance desk')}</h1>
          </div>
          <div className="rounded-xl bg-white p-1 ring-1 ring-black/5">
            <button className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === 'new' ? 'bg-khozo text-white' : 'text-gray-600'}`} onClick={() => setMode('new')}>{t('New')}</button>
            <button className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === 'track' ? 'bg-khozo text-white' : 'text-gray-600'}`} onClick={() => setMode('track')}>{t('Track')}</button>
          </div>
        </div>

        {err && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

        {mode === 'new' ? (
          <form onSubmit={submit} className="mt-6 space-y-5 rounded-xl bg-white p-5 ring-1 ring-black/5">
            <div className="grid gap-4 md:grid-cols-2">
              <label>
                <span className="label">{t('Type')}</span>
                <select className="field" value={form.grievanceType} onChange={set('grievanceType')}>
                  {TYPES.map((type) => <option key={type.id} value={type.id}>{t(type.label)}</option>)}
                </select>
              </label>
              <label>
                <span className="label">{t('Report to')}</span>
                <select className="field" value={form.reportToLevel} onChange={set('reportToLevel')}>
                  {LEVELS.map((level) => <option key={level.id} value={level.id}>{t(level.label)}</option>)}
                </select>
              </label>
              <label>
                <span className="label">{t('Name')}</span>
                <input className="field" autoComplete="name" value={form.name} onChange={set('name')} />
              </label>
              <label>
                <span className="label">{t('Mobile')}</span>
                <input className="field" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
              </label>
              <label>
                <span className="label">{t('Email')}</span>
                <input className="field" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" spellCheck={false} value={form.email} onChange={set('email')} />
              </label>
              <label>
                <span className="label">{t('Linked receipt')}</span>
                <input className="field font-mono" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={form.linkedReceiptId} onChange={set('linkedReceiptId')} placeholder={t('Case / sighting / grievance id')} />
              </label>
              <label>
                <span className="label">{t('State')}</span>
                <input className="field" autoComplete="address-level1" value={form.state} onChange={set('state')} />
              </label>
              <label>
                <span className="label">{t('District')}</span>
                <input className="field" autoComplete="address-level2" value={form.district} onChange={set('district')} />
              </label>
            </div>
            <label>
              <span className="label">{t('Subject')}</span>
              <input className="field" value={form.subject} onChange={set('subject')} required />
            </label>
            <label>
              <span className="label">{t('Details')}</span>
              <textarea className="field min-h-32" value={form.description} onChange={set('description')} required />
            </label>
            <label>
              <span className="label">{t('Attachment reference')}</span>
              <input className="field" value={form.attachmentName} onChange={set('attachmentName')} placeholder={t('File name / document reference')} />
            </label>
            <button className="btn-primary" disabled={busy}>{busy ? t('Submitting...') : t('Submit grievance')}</button>
          </form>
        ) : (
          <form onSubmit={lookup} className="mt-6 flex flex-col gap-3 rounded-xl bg-white p-4 ring-1 ring-black/5 sm:flex-row">
            <input className="field flex-1 font-mono" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={receipt} onChange={(event) => setReceipt(event.target.value)} placeholder={t('Example: {id}', { id: 'g_abc12345' })} />
            <button className="btn-primary" disabled={busy}>{busy ? t('Checking...') : t('Check status')}</button>
          </form>
        )}

        {result && (
          <section className="mt-6 rounded-xl bg-white p-5 ring-1 ring-black/5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-500">{t('Reference {id}', { id: result.id })}</p>
                <h2 className="mt-1 text-xl font-bold text-ink">{t(result.statusLabel)}</h2>
              </div>
              <span className="rounded-full bg-khozo-light px-3 py-1 text-xs font-semibold text-khozo">{t(result.grievanceLabel)}</span>
            </div>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs uppercase tracking-wide text-gray-400">{t('Submitted')}</dt><dd className="mt-1 font-medium">{fmtDate(result.submittedAt)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-gray-400">{t('Updated')}</dt><dd className="mt-1 font-medium">{fmtDate(result.updatedAt)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-gray-400">{t('Report to')}</dt><dd className="mt-1 font-medium">{t(result.reportToLabel)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-gray-400">{t('Location')}</dt><dd className="mt-1 font-medium">{[result.district, result.state].filter(Boolean).join(', ') || '-'}</dd></div>
            </dl>
            <div className="mt-5 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
              <p className="font-semibold text-ink">{result.message === DEFAULT_MESSAGE ? t(DEFAULT_MESSAGE) : result.message}</p>
              {result.linkedReceiptId && <p className="mt-1">{t('Linked receipt: {id}', { id: result.linkedReceiptId })}</p>}
            </div>
          </section>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
