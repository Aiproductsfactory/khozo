import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDate, timeAgo } from '../lib.jsx';
import { useT, msg } from '../i18n.jsx';

const ACTION_LABELS = {
  'auth.public_user_registered': msg('Public account registered'),
  'auth.privileged_registration_blocked': msg('Privileged signup blocked'),
  'security.public_rate_limited': msg('Public rate limit exceeded'),
  'export.signature_verified': msg('Export signature verified'),
  'audit.integrity_checked': msg('Audit integrity checked'),
  'audit.report_exported': msg('Audit report exported'),
  'case.report_registered': msg('Missing-child report registered'),
  'case.fir_registered': msg('FIR registered'),
  'case.match_confirmed': msg('Case match confirmed'),
  'case.sms_sent': msg('SMS alert sent'),
  'case.referred_cwc': msg('Case referred to CWC'),
  'case.assigned_cci': msg('Case assigned to CCI'),
  'case.cci_care_recorded': msg('CCI care recorded'),
  'case.referred_jjb': msg('Case referred to JJB'),
  'case.jjb_proceeding_recorded': msg('JJB proceeding recorded'),
  'case.escalated_state': msg('Case escalated to state'),
  'case.state_escalation_recorded': msg('State escalation recorded'),
  'case.notified_crime_bureau': msg('Crime bureau notified'),
  'case.bureau_report_recorded': msg('Bureau report recorded'),
  'case.external_id_linked': msg('External ID linked'),
  'case.handoff_exported': msg('Case handoff exported'),
  'case.welfare_referral_recorded': msg('Welfare referral recorded'),
  'case.adoption_recorded': msg('Adoption record updated'),
  'case.assessment_recorded': msg('Case assessment recorded'),
  'case.production_recorded': msg('Production recorded'),
  'sighting.submitted': msg('Public sighting submitted'),
  'sighting.cwc_queued': msg('Queued for 1098/CWC'),
  'sighting.referred_cwc': msg('Referred to 1098/CWC'),
  'sighting.match_confirmed': msg('Sighting match confirmed'),
  'sighting.rejected': msg('Sighting rejected'),
};

export default function AuditLog() {
  const t = useT();
  const [rows, setRows] = useState([]);
  const [integrity, setIntegrity] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState(null);

  useEffect(() => {
    api.get('/dashboard/audit').then((d) => {
      setRows(d.audit);
      setIntegrity(d.integrity || null);
    }).catch(() => {});
  }, []);

  const checkIntegrity = async () => {
    setChecking(true);
    try {
      const data = await api.get('/dashboard/audit/integrity');
      setIntegrity(data.integrity);
      setRows((current) => [
        {
          id: `local_integrity_${Date.now()}`,
          ts: Date.now(),
          actorName: t('Current user'),
          actorRole: '-',
          action: 'audit.integrity_checked',
          summary: data.integrity?.ok ? t('Checked audit integrity: valid') : t('Checked audit integrity: failed'),
          targetType: 'auditLog',
          scope: {},
        },
        ...current,
      ]);
    } finally {
      setChecking(false);
    }
  };

  const exportAudit = async () => {
    setExporting(true);
    try {
      const data = await api.get('/dashboard/audit/export');
      setIntegrity(data.exportAuditIntegrity || data.integrity || null);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `khozo-audit-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setRows((current) => [
        {
          id: `local_export_${Date.now()}`,
          ts: Date.now(),
          actorName: data.generatedBy?.name || t('Current user'),
          actorRole: data.generatedBy?.role || '-',
          action: 'audit.report_exported',
          summary: t('Exported audit log with {n} events', { n: data.totals?.events || 0 }),
          targetType: 'auditReport',
          scope: {},
        },
        ...current,
      ]);
    } finally {
      setExporting(false);
    }
  };

  const verifyExportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setVerifying(true);
    setVerification(null);
    try {
      const envelope = JSON.parse(await file.text());
      const data = await api.post('/dashboard/export/verify', envelope);
      setVerification(data);
      setRows((current) => [
        {
          id: `local_signature_${Date.now()}`,
          ts: Date.now(),
          actorName: 'Current user',
          actorRole: '-',
          action: 'export.signature_verified',
          summary: data.ok
            ? t('Verified {type} export signature: valid', { type: data.type || t('unknown') })
            : t('Verified {type} export signature: failed', { type: data.type || t('unknown') }),
          targetType: 'signedExport',
          scope: {},
        },
        ...current,
      ]);
    } catch (err) {
      setVerification({ ok: false, reason: err instanceof SyntaxError ? 'invalid_json' : err.message || 'verification_failed' });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{t('Audit log')}</h2>
          <p className="text-sm text-gray-500">{t('Case, sighting, referral, SMS, and access-control events in your scope.')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={checking} onClick={checkIntegrity}>
            {checking ? t('Checking...') : t('Verify')}
          </button>
          <button className="btn-ghost" disabled={exporting} onClick={exportAudit}>
            {exporting ? t('Exporting...') : t('Export JSON')}
          </button>
          <label className={`btn-ghost ${verifying ? 'pointer-events-none opacity-50' : ''}`}>
            {verifying ? t('Verifying...') : t('Verify export')}
            <input type="file" accept="application/json,.json" className="hidden" onChange={verifyExportFile} disabled={verifying} />
          </label>
        </div>
      </div>

      {integrity && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${integrity.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
          <p className="font-medium">{integrity.ok ? t('Audit chain verified') : t('Audit chain check failed')}</p>
          <p className="text-xs opacity-80">
            {integrity.checked === 1 ? t('1 event checked') : t('{n} events checked', { n: integrity.checked || 0 })}
            {integrity.headHash ? ` / ${t('head {hash}', { hash: integrity.headHash.slice(0, 12) })}` : ''}
            {integrity.failedId ? ` / ${t('failed at {id}', { id: integrity.failedId })}` : ''}
          </p>
        </div>
      )}

      {verification && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${verification.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
          <p className="font-medium">{verification.ok ? t('Export signature verified') : t('Export signature failed')}</p>
          <p className="text-xs opacity-80">
            {[verification.type, verification.keyId ? t('key {id}', { id: verification.keyId }) : null, verification.digest ? t('digest {hash}', { hash: verification.digest.slice(0, 12) }) : null, verification.reason].filter(Boolean).join(' / ')}
          </p>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="stack-scroll overflow-x-auto">
          <table className="stack-table w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-black/5 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">{t('Time')}</th>
                <th className="px-4 py-3">{t('Actor')}</th>
                <th className="px-4 py-3">{t('Action')}</th>
                <th className="px-4 py-3">{t('Summary')}</th>
                <th className="px-4 py-3">{t('Target')}</th>
                <th className="px-4 py-3">{t('Scope')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-3" data-label={t('Time')}>
                    <p className="font-medium">{timeAgo(r.ts)}</p>
                    <p className="text-xs text-gray-400">{fmtDate(r.ts)}</p>
                  </td>
                  <td className="px-4 py-3" data-label={t('Actor')}>
                    <p className="font-medium">{r.actorName}</p>
                    <p className="text-xs text-gray-400">{r.actorRole}</p>
                  </td>
                  <td className="stack-full px-4 py-3 max-sm:order-first">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium">
                      {ACTION_LABELS[r.action] ? t(ACTION_LABELS[r.action]) : r.action}
                    </span>
                  </td>
                  <td className="stack-full px-4 py-3 text-gray-700 max-sm:order-first">{r.summary || '-'}</td>
                  <td className="px-4 py-3 text-gray-500" data-label={t('Target')}>{[r.targetType, r.targetId].filter(Boolean).join(' / ') || '-'}</td>
                  <td className="px-4 py-3 text-gray-500" data-label={t('Scope')}>
                    {[r.scope?.district, r.scope?.state].filter(Boolean).join(', ') || r.scope?.reportId || r.scope?.matchedReportId || '-'}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="stack-full px-4 py-10 text-center text-gray-400">{t('No audit events in your scope yet.')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
