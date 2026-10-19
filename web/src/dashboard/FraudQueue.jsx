import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDate, timeAgo } from '../lib.jsx';
import { StatCard } from '../components.jsx';
import { useT, msg, t, currentLocale } from '../i18n.jsx';

const ACTION_LABELS = {
  'security.public_rate_limited': msg('Too many requests'),
  'auth.otp_failed': msg('OTP failure'),
  'auth.privileged_registration_blocked': msg('Privileged signup blocked'),
  'sighting.dismissed_misuse': msg('Sighting dismissed as misuse'),
};

// Display names for the enum values the API returns; the values stay English.
const SEVERITY_LABELS = { high: msg('High'), medium: msg('Medium'), low: msg('Low') };
const SLA_LABELS = { open: msg('Open'), due_soon: msg('Due soon'), breached: msg('Breached'), closed: msg('Closed') };
const DISPOSITION_LABELS = {
  open: msg('Open'),
  reviewed: msg('Reviewed'),
  escalated: msg('Referred up'),
  dismissed: msg('Dismissed'),
};

function labelFor(map, value) {
  return map[value] ? t(map[value]) : value;
}

function signalDetail(row) {
  if (row.action === 'security.public_rate_limited') {
    return [
      row.signal?.method,
      row.signal?.route,
      row.signal?.limiter,
      row.signal?.count && row.signal?.limit ? `${row.signal.count}/${row.signal.limit}` : null,
    ].filter(Boolean).join(' / ');
  }
  if (row.action === 'auth.otp_failed') {
    return [
      row.signal?.phoneSuffix ? t('phone ending {suffix}', { suffix: row.signal.phoneSuffix }) : null,
      row.signal?.attempts == 1 ? t('1 attempt') : row.signal?.attempts ? t('{n} attempts', { n: row.signal.attempts }) : null,
    ].filter(Boolean).join(' / ');
  }
  return row.signal?.requestedRole
    ? t('requested {role}', { role: row.signal.requestedRole })
    : t('Blocked official-role request');
}

export default function FraudQueue() {
  const t = useT();
  const [data, setData] = useState({ totals: {}, signals: [], byLimiter: [] });
  const [forms, setForms] = useState({});
  const [busyId, setBusyId] = useState('');
  const [exportData, setExportData] = useState(null);

  const load = () => api.get('/dashboard/fraud').then(setData).catch(() => {});

  useEffect(() => {
    load();
  }, []);

  const setForm = (id, key) => (event) => {
    setForms((current) => ({
      ...current,
      [id]: { disposition: 'reviewed', note: '', ...(current[id] || {}), [key]: event.target.value },
    }));
  };

  const saveDisposition = async (row) => {
    const form = forms[row.id] || { disposition: 'reviewed', note: '' };
    setBusyId(row.id);
    try {
      await api.post(`/dashboard/fraud/${row.id}/disposition`, form);
      setForms((current) => ({ ...current, [row.id]: { disposition: 'reviewed', note: '' } }));
      await load();
    } finally {
      setBusyId('');
    }
  };

  const exportReport = async () => {
    const report = await api.get('/dashboard/fraud/export');
    setExportData(report);
  };

  const rows = data.signals || [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{t('Public abuse')}</h2>
          <p className="text-sm text-gray-500">{t('Warnings about misuse of the public forms, failed OTPs and too many requests, for senior officers to review. Personal details are hidden.')}</p>
        </div>
        <button className="btn-ghost" onClick={exportReport}>{t('Export report')}</button>
      </div>

      {exportData && (
        <div className="card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{t('Public abuse report generated')}</p>
              <p className="text-gray-500">{new Date(exportData.generatedAt).toLocaleString(currentLocale())} / {exportData.scope}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-gray-100 px-2 py-1">{t('{n} warnings', { n: exportData.totals?.signals || 0 })}</span>
              <span className="rounded-full bg-gray-100 px-2 py-1">{t('{n} past the time limit', { n: exportData.totals?.slaBreached || 0 })}</span>
              <span className="rounded-full bg-gray-100 px-2 py-1">{t('seal {hash}', { hash: exportData.signature?.digest?.slice(0, 12) })}...</span>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-1 sm:gap-4 md:grid-cols-4">
        <StatCard label={t('Warnings')} value={data.totals?.signals || 0} sub={data.scope} accent="blue" icon="!" />
        <StatCard label={t('Past the time limit')} value={data.totals?.slaBreached || 0} sub={t('Overdue warnings')} accent="red" icon="!" />
        <StatCard label={t('Open')} value={data.totals?.open || 0} sub={t('Waiting for a decision')} accent="amber" icon="!" />
        <StatCard label={t('Referred up')} value={data.totals?.escalated || 0} sub={t('Follow-up by senior officers')} accent="khozo" icon="!" />
      </div>

      {data.byLimiter?.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-semibold">{t('Where warnings come from')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.byLimiter.slice(0, 8).map((item) => (
              <span key={item.name} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                {item.name.replaceAll('_', ' ')}: {item.count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="stack-scroll overflow-x-auto">
          <table className="stack-table w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-black/5 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">{t('Time')}</th>
                <th className="px-4 py-3">{t('Priority')}</th>
                <th className="px-4 py-3">{t('Warning')}</th>
                <th className="px-4 py-3">{t('Detail')}</th>
                <th className="px-4 py-3">{t('Public identity')}</th>
                <th className="px-4 py-3">{t('Area')}</th>
                <th className="px-4 py-3">{t('Time limit')}</th>
                <th className="px-4 py-3">{t('Decision')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const form = forms[row.id] || { disposition: 'reviewed', note: '' };
                return (
                  <tr key={row.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3" data-label={t('Time')}>
                      <p className="font-medium">{timeAgo(row.ts)}</p>
                      <p className="text-xs text-gray-400">{fmtDate(row.ts)}</p>
                    </td>
                    <td className="px-4 py-3" data-label={t('Priority')}>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.severity === 'high' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                        {labelFor(SEVERITY_LABELS, row.severity)}
                      </span>
                    </td>
                    <td className="stack-full px-4 py-3 font-medium max-sm:order-first">{ACTION_LABELS[row.action] ? t(ACTION_LABELS[row.action]) : row.action}</td>
                    <td className="px-4 py-3 text-gray-600" data-label={t('Detail')}>{signalDetail(row) || row.summary || '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500" data-label={t('Public identity')}><span className="font-mono">{row.signal?.identityHash || t('hidden')}</span></td>
                    <td className="px-4 py-3 text-gray-500" data-label={t('Area')}>
                      {[row.scope?.district, row.scope?.state].filter(Boolean).join(', ') || t('Public')}
                    </td>
                    <td className="px-4 py-3" data-label={t('Time limit')}>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.sla?.state === 'breached' ? 'bg-rose-50 text-rose-700' : row.sla?.state === 'due_soon' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {labelFor(SLA_LABELS, row.sla?.state || 'open').replaceAll('_', ' ')}
                      </span>
                      <p className="mt-1 text-xs text-gray-400">
                        {row.sla?.state === 'breached'
                          ? t('{n} min overdue', { n: row.sla.overdueMinutes || 0 })
                          : row.sla?.state === 'closed'
                            ? t('closed')
                            : t('{n}h target', { n: row.sla?.hours || 24 })}
                      </p>
                    </td>
                    <td className="stack-full px-4 py-3" data-label={t('Decision')}>
                      {/* On a phone the note comes before Save, so Save is the last thing tapped. */}
                      <div className="space-y-2 max-sm:flex max-sm:flex-col max-sm:gap-2 max-sm:space-y-0 sm:min-w-64">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                            {labelFor(DISPOSITION_LABELS, row.disposition?.status || 'open')}
                          </span>
                          {row.disposition?.actorName && (
                            <span className="text-xs text-gray-400">
                              {row.disposition.actorName} / {timeAgo(row.disposition.ts)}
                            </span>
                          )}
                        </div>
                        <div className="grid gap-2 max-sm:contents sm:grid-cols-[1fr_auto]">
                          <select className="field py-2 text-xs" value={form.disposition} onChange={setForm(row.id, 'disposition')}>
                            <option value="reviewed">{t('Reviewed')}</option>
                            <option value="escalated">{t('Referred up')}</option>
                            <option value="dismissed">{t('Dismissed')}</option>
                          </select>
                          <button className="btn-primary px-3 py-2 text-xs max-sm:order-last" disabled={busyId === row.id} onClick={() => saveDisposition(row)}>
                            {busyId === row.id ? t('Saving...') : t('Save')}
                          </button>
                        </div>
                        <input className="field py-2 text-xs" maxLength={280} value={form.note} onChange={setForm(row.id, 'note')} placeholder={t('Decision note')} />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="stack-full px-4 py-10 text-center text-gray-400">{t('No warnings yet.')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
