import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDate } from '../lib.jsx';

const STATE_CLASS = {
  expired: 'bg-red-50 text-red-700 ring-red-600/20',
  due_soon: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  missing_retention: 'bg-gray-100 text-gray-600 ring-gray-500/20',
};

const STATE_LABEL = {
  expired: 'Expired',
  due_soon: 'Due soon',
  active: 'Active',
  missing_retention: 'No retention date',
};

export default function PrivacyReview() {
  const [rows, setRows] = useState([]);
  const [capabilities, setCapabilities] = useState({ canReview: false, canExport: false, canAnonymize: false });
  const [busyId, setBusyId] = useState('');
  const [exportData, setExportData] = useState(null);
  const [approvalForms, setApprovalForms] = useState({});

  const load = () => {
    api.get('/dashboard/privacy/retention').then((d) => {
      setRows(d.retention);
      setCapabilities(d.capabilities || { canReview: false, canExport: false, canAnonymize: false });
    }).catch(() => {});
  };

  useEffect(load, []);

  const decide = async (row, decision) => {
    setBusyId(`${row.type}:${row.id}:${decision}`);
    try {
      const approval = approvalForms[`${row.type}:${row.id}`] || { approvalType: 'privacy_officer', approvalReference: '', approvalNote: '' };
      await api.post(`/dashboard/privacy/retention/${row.type}/${row.id}`, {
        decision,
        extendDays: row.type === 'report' ? 365 : 180,
        ...(decision === 'anonymize' ? approval : {}),
      });
      load();
    } finally {
      setBusyId('');
    }
  };

  const setApproval = (row, key) => (event) => {
    const id = `${row.type}:${row.id}`;
    setApprovalForms((current) => ({
      ...current,
      [id]: { approvalType: 'privacy_officer', approvalReference: '', approvalNote: '', ...(current[id] || {}), [key]: event.target.value },
    }));
  };

  const exportReport = async () => {
    const data = await api.get('/dashboard/privacy/export');
    setExportData(data);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold">Privacy review</h2>
        <p className="text-sm text-gray-500">Review photo consent, purpose, and retention dates for cases and sightings in your scope.</p>
      </div>
      {capabilities.canExport && (
        <div className="flex justify-end">
          <button className="btn-ghost" onClick={exportReport}>Export privacy report</button>
        </div>
      )}

      {exportData && (
        <div className="card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Privacy report generated</p>
              <p className="text-gray-500">{new Date(exportData.generatedAt).toLocaleString('en-IN')} / {exportData.scope}</p>
            </div>
            <div className="flex gap-2 text-xs">
              <span className="rounded-full bg-gray-100 px-2 py-1">{exportData.totals.records} records</span>
              <span className="rounded-full bg-gray-100 px-2 py-1">{exportData.totals.anonymized} anonymized</span>
              <span className="rounded-full bg-gray-100 px-2 py-1">{exportData.totals.missingRetention} missing retention</span>
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-black/5 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Record</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Purpose</th>
                <th className="px-4 py-3">Consent</th>
                <th className="px-4 py-3">Retention</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.type}:${r.id}`} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-semibold">{r.subject}</p>
                    <p className="text-xs text-gray-400">{r.type === 'report' ? 'Case' : 'Sighting'} / {r.location || 'location unknown'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATE_CLASS[r.retentionState] || STATE_CLASS.missing_retention}`}>
                      {STATE_LABEL[r.retentionState] || r.retentionState}
                    </span>
                    <p className="mt-1 text-xs text-gray-400">{r.status}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.dataPurpose}</td>
                  <td className="px-4 py-3 text-gray-600">{r.photoConsent ? 'Recorded' : 'No photo / not recorded'}</td>
                  <td className="px-4 py-3">
                    <p className="text-gray-700">{r.retentionUntil ? fmtDate(r.retentionUntil) : '-'}</p>
                    {r.daysUntilRetention != null && <p className="text-xs text-gray-400">{r.daysUntilRetention} days</p>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {capabilities.canReview ? (
                      <div className="space-y-2">
                        {capabilities.canAnonymize && (
                          <div className="grid gap-2 text-left sm:grid-cols-[120px_1fr]">
                            <select className="field py-2 text-xs" value={(approvalForms[`${r.type}:${r.id}`] || {}).approvalType || 'privacy_officer'} onChange={setApproval(r, 'approvalType')}>
                              <option value="privacy_officer">Privacy officer</option>
                              <option value="cwc_order">CWC order</option>
                              <option value="court_order">Court order</option>
                              <option value="data_retention_policy">Retention policy</option>
                            </select>
                            <input className="field py-2 text-xs" value={(approvalForms[`${r.type}:${r.id}`] || {}).approvalReference || ''} onChange={setApproval(r, 'approvalReference')} placeholder="Approval/order reference" />
                            <input className="field py-2 text-xs sm:col-span-2" maxLength={280} value={(approvalForms[`${r.type}:${r.id}`] || {}).approvalNote || ''} onChange={setApproval(r, 'approvalNote')} placeholder="Approval note" />
                          </div>
                        )}
                        <div className="flex justify-end gap-2">
                        <button className="btn-ghost" disabled={!!busyId} onClick={() => decide(r, 'close')}>
                          {busyId === `${r.type}:${r.id}:close` ? 'Saving...' : 'Mark reviewed'}
                        </button>
                        {capabilities.canAnonymize && (
                          <button className="btn-ghost" disabled={!!busyId} onClick={() => decide(r, 'anonymize')}>
                            {busyId === `${r.type}:${r.id}:anonymize` ? 'Saving...' : 'Anonymize'}
                          </button>
                        )}
                        <button className="btn-primary" disabled={!!busyId} onClick={() => decide(r, 'extend')}>
                          {busyId === `${r.type}:${r.id}:extend` ? 'Saving...' : 'Extend'}
                        </button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">Read-only</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">No privacy retention records in your scope.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
