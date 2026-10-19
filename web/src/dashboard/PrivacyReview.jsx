import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDate } from '../lib.jsx';
import { useAuth } from '../auth.jsx';
import { useT, msg, currentLocale } from '../i18n.jsx';

const PRIVACY_REVIEW_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'cwc', 'dcpu', 'state_nodal'];
const PRIVACY_EXPORT_ROLES = ['super_admin', 'admin', 'state_nodal', 'crime_bureau'];
const PRIVACY_ANONYMIZE_ROLES = ['super_admin', 'admin', 'state_nodal'];

function defaultCapabilities(role) {
  return {
    canReview: PRIVACY_REVIEW_ROLES.includes(role),
    canExport: PRIVACY_EXPORT_ROLES.includes(role),
    canAnonymize: PRIVACY_ANONYMIZE_ROLES.includes(role),
  };
}

const STATE_CLASS = {
  expired: 'bg-red-50 text-red-700 ring-red-600/20',
  due_soon: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  missing_retention: 'bg-gray-100 text-gray-600 ring-gray-500/20',
};

const STATE_LABEL = {
  expired: msg('Expired'),
  due_soon: msg('Due soon'),
  active: msg('Active'),
  missing_retention: msg('No delete-by date'),
};

export default function PrivacyReview() {
  const t = useT();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [capabilities, setCapabilities] = useState(() => defaultCapabilities(user?.role));
  const [busyId, setBusyId] = useState('');
  const [exportData, setExportData] = useState(null);
  const [approvalForms, setApprovalForms] = useState({});
  const [batchApprovalRef, setBatchApprovalRef] = useState('');

  const load = () => {
    api.get('/dashboard/privacy/retention').then((d) => {
      setRows(d.retention);
      if (d.capabilities) setCapabilities(d.capabilities);
    }).catch(() => {});
  };

  useEffect(load, []);

  const decide = async (row, decision) => {
    setBusyId(`${row.type}:${row.id}:${decision}`);
    try {
      const approval = approvalForms[`${row.type}:${row.id}`] || { approvalType: 'privacy_officer', approvalReference: batchApprovalRef || '', approvalNote: '' };
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
      [id]: { approvalType: 'privacy_officer', approvalReference: batchApprovalRef || '', approvalNote: '', ...(current[id] || {}), [key]: event.target.value },
    }));
  };

  const exportReport = async () => {
    const data = await api.get('/dashboard/privacy/export');
    setExportData(data);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold">{t('Privacy review')}</h2>
        <p className="text-sm text-gray-500">{t('Review photo consent, purpose, and how long cases and sightings in your area are kept.')}</p>
      </div>
      {capabilities.canExport && (
        <div className="flex justify-end">
          <button className="btn-ghost" onClick={exportReport}>{t('Export privacy report')}</button>
        </div>
      )}

      {capabilities.canAnonymize && (
        <div className="card p-4 text-sm bg-gray-50/50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-gray-700">{t('Approval to remove details')}</p>
              <p className="text-xs text-gray-500">{t('Give an approval or court order number before removing a person’s details.')}</p>
            </div>
            <input
              className="field py-1.5 text-xs sm:max-w-xs"
              placeholder={t('Approval/order reference')}
              value={batchApprovalRef}
              onChange={(e) => setBatchApprovalRef(e.target.value)}
            />
          </div>
        </div>
      )}

      {exportData && (
        <div className="card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{t('Privacy report generated')}</p>
              <p className="text-gray-500">{new Date(exportData.generatedAt).toLocaleString(currentLocale())} / {exportData.scope}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs sm:flex-nowrap">
              <span className="rounded-full bg-gray-100 px-2 py-1">{t('{n} records', { n: exportData.totals.records })}</span>
              <span className="rounded-full bg-gray-100 px-2 py-1">{t('{n} with details removed', { n: exportData.totals.anonymized })}</span>
              <span className="rounded-full bg-gray-100 px-2 py-1">{t('{n} with no delete-by date', { n: exportData.totals.missingRetention })}</span>
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="stack-scroll overflow-x-auto">
          <table className="stack-table w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-black/5 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">{t('Record')}</th>
                <th className="px-4 py-3">{t('Status')}</th>
                <th className="px-4 py-3">{t('Purpose')}</th>
                <th className="px-4 py-3">{t('Consent')}</th>
                <th className="px-4 py-3">{t('Keep until')}</th>
                <th className="px-4 py-3 text-right">{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.type}:${r.id}`} className="border-b border-black/5 last:border-0">
                  <td className="stack-full px-4 py-3">
                    <p className="font-semibold">{r.subject}</p>
                    <p className="text-xs text-gray-400">{r.type === 'report' ? t('Case') : t('Sighting')} / {r.location || t('location unknown')}</p>
                  </td>
                  <td className="px-4 py-3" data-label={t('Status')}>
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATE_CLASS[r.retentionState] || STATE_CLASS.missing_retention}`}>
                      {STATE_LABEL[r.retentionState] ? t(STATE_LABEL[r.retentionState]) : r.retentionState}
                    </span>
                    <p className="mt-1 text-xs text-gray-400">{r.status}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600" data-label={t('Purpose')}>{r.dataPurpose}</td>
                  <td className="px-4 py-3 text-gray-600" data-label={t('Consent')}>{r.photoConsent ? t('Recorded') : t('No photo / not recorded')}</td>
                  <td className="px-4 py-3" data-label={t('Keep until')}>
                    <p className="text-gray-700">{r.retentionUntil ? fmtDate(r.retentionUntil) : '-'}</p>
                    {r.daysUntilRetention != null && <p className="text-xs text-gray-400">{t('{n} days', { n: r.daysUntilRetention })}</p>}
                  </td>
                  <td className="stack-full px-4 py-3 text-right">
                    {capabilities.canReview ? (
                      <div className="space-y-2">
                        {capabilities.canAnonymize && (
                          <div className="grid gap-2 text-left sm:grid-cols-[120px_1fr]">
                            <select className="field py-2 text-xs" value={(approvalForms[`${r.type}:${r.id}`] || {}).approvalType || 'privacy_officer'} onChange={setApproval(r, 'approvalType')}>
                              <option value="privacy_officer">{t('Privacy officer')}</option>
                              <option value="cwc_order">{t('CWC order')}</option>
                              <option value="court_order">{t('Court order')}</option>
                              <option value="data_retention_policy">{t('How long records are kept')}</option>
                            </select>
                            <input className="field py-2 text-xs" value={(approvalForms[`${r.type}:${r.id}`] || {}).approvalReference || ''} onChange={setApproval(r, 'approvalReference')} placeholder={t('Approval/order reference')} />
                            <input className="field py-2 text-xs sm:col-span-2" maxLength={280} value={(approvalForms[`${r.type}:${r.id}`] || {}).approvalNote || ''} onChange={setApproval(r, 'approvalNote')} placeholder={t('Approval note')} />
                          </div>
                        )}
                        <div className="flex justify-end gap-2 max-sm:flex-wrap max-sm:[overflow-wrap:normal]">
                        <button className="btn-ghost max-sm:flex-auto" disabled={!!busyId} onClick={() => decide(r, 'close')}>
                          {busyId === `${r.type}:${r.id}:close` ? t('Saving...') : t('Mark reviewed')}
                        </button>
                        {capabilities.canAnonymize && (
                          <button className="btn-ghost max-sm:flex-auto" disabled={!!busyId} onClick={() => decide(r, 'anonymize')}>
                            {busyId === `${r.type}:${r.id}:anonymize` ? t('Saving...') : t('Remove details')}
                          </button>
                        )}
                        <button className="btn-primary max-sm:flex-auto" disabled={!!busyId} onClick={() => decide(r, 'extend')}>
                          {busyId === `${r.type}:${r.id}:extend` ? t('Saving...') : t('Extend')}
                        </button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">{t('Read-only')}</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="stack-full px-4 py-10 text-center text-gray-400">{t('No records to review in your area.')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
