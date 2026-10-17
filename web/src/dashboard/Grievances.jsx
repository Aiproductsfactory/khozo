import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { PhoneLink, fmtDate, timeAgo } from '../lib.jsx';
import { msg, useT } from '../i18n.jsx';

const STATUSES = [
  { id: 'under_review', label: msg('Under review') },
  { id: 'referred', label: msg('Referred') },
  { id: 'resolved', label: msg('Resolved') },
  { id: 'closed', label: msg('Closed') },
];
const STATUS_LABELS = { submitted: msg('Submitted'), ...Object.fromEntries(STATUSES.map((s) => [s.id, s.label])) };
// Labels the server attaches to each grievance; translated at render.
const SERVER_LABELS = [
  msg('Submitted'),
  msg('Missing child support'), msg('Sighting follow-up'), msg('CCI care concern'), msg('Adoption / CARINGS support'),
  msg('Restoration / repatriation'), msg('Service access'), msg('Data privacy'), msg('Other'),
  msg('SCPS / State'), msg('Ministry'),
];

export default function Grievances() {
  const t = useT();
  const [rows, setRows] = useState([]);
  const [forms, setForms] = useState({});
  const [busyId, setBusyId] = useState('');

  const load = () => {
    api.get('/grievances').then((data) => setRows(data.grievances)).catch(() => {});
  };
  useEffect(load, []);

  const setForm = (id, key) => (event) => {
    setForms((current) => ({
      ...current,
      [id]: { status: 'under_review', publicMessage: '', note: '', ...(current[id] || {}), [key]: event.target.value },
    }));
  };

  const updateStatus = async (row) => {
    const form = forms[row.id] || { status: 'under_review', publicMessage: '', note: '' };
    setBusyId(row.id);
    try {
      await api.post(`/grievances/${row.id}/status`, form);
      setForms((current) => ({ ...current, [row.id]: { status: 'under_review', publicMessage: '', note: '' } }));
      load();
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold">{t('Grievances')}</h2>
        <p className="text-sm text-gray-500">{t('Public grievance and feedback receipts in your operational scope.')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {rows.map((row) => {
          const form = forms[row.id] || { status: 'under_review', publicMessage: '', note: '' };
          return (
            <div key={row.id} className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{row.subject}</p>
                  <p className="text-xs text-gray-400">{row.id} / {timeAgo(row.createdAt)}</p>
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">
                  {row.statusLabel ? t(row.statusLabel) : STATUS_LABELS[row.status] ? t(STATUS_LABELS[row.status]) : row.status.replaceAll('_', ' ')}
                </span>
              </div>
              <div className="mt-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
                <p className="whitespace-pre-wrap">{row.description}</p>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-500 [&_dd]:break-words">
                <div><dt className="uppercase tracking-wide text-gray-400">{t('Type')}</dt><dd>{t(row.grievanceLabel)}</dd></div>
                <div><dt className="uppercase tracking-wide text-gray-400">{t('Report to')}</dt><dd>{t(row.reportToLabel)}</dd></div>
                <div className="col-span-2 sm:col-span-1"><dt className="uppercase tracking-wide text-gray-400">{t('Citizen')}</dt><dd>{row.name || t('Anonymous')}{row.phone ? <> / <PhoneLink phone={row.phone} /></> : ''}</dd></div>
                <div><dt className="uppercase tracking-wide text-gray-400">{t('Location')}</dt><dd>{[row.district, row.state].filter(Boolean).join(', ') || '-'}</dd></div>
                <div><dt className="uppercase tracking-wide text-gray-400">{t('Linked receipt')}</dt><dd>{row.linkedReceiptId || '-'}</dd></div>
                <div><dt className="uppercase tracking-wide text-gray-400">{t('Updated')}</dt><dd>{fmtDate(row.updatedAt || row.createdAt)}</dd></div>
              </dl>
              {/* On a phone Save follows the messages it sends. */}
              <div className="mt-4 rounded-xl border border-black/5 p-3 max-sm:flex max-sm:flex-col">
                <p className="text-sm font-medium">{t('Update status')}</p>
                <div className="mt-2 grid gap-2 max-sm:contents sm:grid-cols-[1fr_auto]">
                  <select className="field max-sm:mt-2" value={form.status} onChange={setForm(row.id, 'status')}>
                    {STATUSES.map((status) => <option key={status.id} value={status.id}>{t(status.label)}</option>)}
                  </select>
                  <button className="btn-primary max-sm:order-last max-sm:mt-2" disabled={busyId === row.id} onClick={() => updateStatus(row)}>
                    {busyId === row.id ? t('Saving...') : t('Save')}
                  </button>
                </div>
                <textarea className="field mt-2 min-h-16" value={form.publicMessage} onChange={setForm(row.id, 'publicMessage')} placeholder={t('Public status message')} />
                <textarea className="field mt-2 min-h-16" value={form.note} onChange={setForm(row.id, 'note')} placeholder={t('Internal note')} />
              </div>
              {row.history?.length > 0 && (
                <div className="mt-3 space-y-2">
                  {row.history.slice().reverse().slice(0, 3).map((event) => (
                    <div key={event.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      <p className="font-medium text-gray-700">{event.label ? t(event.label) : ''}</p>
                      <p>{event.actorName} / {fmtDate(event.ts)}</p>
                      {event.publicMessage && <p className="mt-1 text-gray-500">{event.publicMessage}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-gray-400">{t('No grievances in your scope yet.')}</p>}
      </div>
    </div>
  );
}
