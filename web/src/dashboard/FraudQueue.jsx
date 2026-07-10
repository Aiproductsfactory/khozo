import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDate, timeAgo } from '../lib.jsx';
import { StatCard } from '../components.jsx';

const ACTION_LABELS = {
  'security.public_rate_limited': 'Rate limit exceeded',
  'auth.otp_failed': 'OTP failure',
  'auth.privileged_registration_blocked': 'Privileged signup blocked',
};

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
      row.signal?.phoneSuffix ? `phone ending ${row.signal.phoneSuffix}` : null,
      row.signal?.attempts ? `${row.signal.attempts} attempts` : null,
    ].filter(Boolean).join(' / ');
  }
  return row.signal?.requestedRole ? `requested ${row.signal.requestedRole}` : 'Blocked official-role request';
}

export default function FraudQueue() {
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
          <h2 className="text-2xl font-bold">Public abuse queue</h2>
          <p className="text-sm text-gray-500">Redacted public intake, OTP, and rate-limit signals for command review.</p>
        </div>
        <button className="btn-ghost" onClick={exportReport}>Export report</button>
      </div>

      {exportData && (
        <div className="card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Public abuse report generated</p>
              <p className="text-gray-500">{new Date(exportData.generatedAt).toLocaleString('en-IN')} / {exportData.scope}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-gray-100 px-2 py-1">{exportData.totals?.signals || 0} signals</span>
              <span className="rounded-full bg-gray-100 px-2 py-1">{exportData.totals?.slaBreached || 0} SLA breached</span>
              <span className="rounded-full bg-gray-100 px-2 py-1">digest {exportData.signature?.digest?.slice(0, 12)}...</span>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Signals" value={data.totals?.signals || 0} sub={data.scope} accent="blue" icon="!" />
        <StatCard label="SLA breached" value={data.totals?.slaBreached || 0} sub="Open overdue signals" accent="red" icon="!" />
        <StatCard label="Open" value={data.totals?.open || 0} sub="Awaiting disposition" accent="amber" icon="!" />
        <StatCard label="Escalated" value={data.totals?.escalated || 0} sub="Command follow-up" accent="khozo" icon="!" />
      </div>

      {data.byLimiter?.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-semibold">Top signal sources</p>
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-black/5 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Signal</th>
                <th className="px-4 py-3">Detail</th>
                <th className="px-4 py-3">Public identity</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">SLA</th>
                <th className="px-4 py-3">Disposition</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const form = forms[row.id] || { disposition: 'reviewed', note: '' };
                return (
                  <tr key={row.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{timeAgo(row.ts)}</p>
                      <p className="text-xs text-gray-400">{fmtDate(row.ts)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.severity === 'high' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                        {row.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{ACTION_LABELS[row.action] || row.action}</td>
                    <td className="px-4 py-3 text-gray-600">{signalDetail(row) || row.summary || '-'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.signal?.identityHash || 'redacted'}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {[row.scope?.district, row.scope?.state].filter(Boolean).join(', ') || 'Public'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.sla?.state === 'breached' ? 'bg-rose-50 text-rose-700' : row.sla?.state === 'due_soon' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {(row.sla?.state || 'open').replaceAll('_', ' ')}
                      </span>
                      <p className="mt-1 text-xs text-gray-400">
                        {row.sla?.state === 'breached'
                          ? `${row.sla.overdueMinutes || 0} min overdue`
                          : row.sla?.state === 'closed'
                            ? 'closed'
                            : `${row.sla?.hours || 24}h target`}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="min-w-64 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                            {row.disposition?.status || 'open'}
                          </span>
                          {row.disposition?.actorName && (
                            <span className="text-xs text-gray-400">
                              {row.disposition.actorName} / {timeAgo(row.disposition.ts)}
                            </span>
                          )}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <select className="field py-2 text-xs" value={form.disposition} onChange={setForm(row.id, 'disposition')}>
                            <option value="reviewed">Reviewed</option>
                            <option value="escalated">Escalated</option>
                            <option value="dismissed">Dismissed</option>
                          </select>
                          <button className="btn-primary px-3 py-2 text-xs" disabled={busyId === row.id} onClick={() => saveDisposition(row)}>
                            {busyId === row.id ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                        <input className="field py-2 text-xs" maxLength={280} value={form.note} onChange={setForm(row.id, 'note')} placeholder="Disposition note" />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400">No public abuse signals yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
