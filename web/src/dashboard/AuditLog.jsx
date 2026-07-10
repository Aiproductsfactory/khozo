import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDate, timeAgo } from '../lib.jsx';

const ACTION_LABELS = {
  'auth.public_user_registered': 'Public account registered',
  'auth.privileged_registration_blocked': 'Privileged signup blocked',
  'security.public_rate_limited': 'Public rate limit exceeded',
  'export.signature_verified': 'Export signature verified',
  'audit.integrity_checked': 'Audit integrity checked',
  'audit.report_exported': 'Audit report exported',
  'case.report_registered': 'Missing-child report registered',
  'case.fir_registered': 'FIR registered',
  'case.match_confirmed': 'Case match confirmed',
  'case.sms_sent': 'SMS alert sent',
  'case.referred_cwc': 'Case referred to CWC',
  'case.assigned_cci': 'Case assigned to CCI',
  'case.cci_care_recorded': 'CCI care recorded',
  'case.referred_jjb': 'Case referred to JJB',
  'case.jjb_proceeding_recorded': 'JJB proceeding recorded',
  'case.escalated_state': 'Case escalated to state',
  'case.state_escalation_recorded': 'State escalation recorded',
  'case.notified_crime_bureau': 'Crime bureau notified',
  'case.bureau_report_recorded': 'Bureau report recorded',
  'case.external_id_linked': 'External ID linked',
  'case.handoff_exported': 'Case handoff exported',
  'case.welfare_referral_recorded': 'Welfare referral recorded',
  'case.adoption_recorded': 'Adoption record updated',
  'case.assessment_recorded': 'Case assessment recorded',
  'case.production_recorded': 'Production recorded',
  'sighting.submitted': 'Public sighting submitted',
  'sighting.cwc_queued': 'Queued for 1098/CWC',
  'sighting.referred_cwc': 'Referred to 1098/CWC',
  'sighting.match_confirmed': 'Sighting match confirmed',
  'sighting.rejected': 'Sighting rejected',
};

export default function AuditLog() {
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
          actorName: 'Current user',
          actorRole: '-',
          action: 'audit.integrity_checked',
          summary: `Checked audit integrity: ${data.integrity?.ok ? 'valid' : 'failed'}`,
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
          actorName: data.generatedBy?.name || 'Current user',
          actorRole: data.generatedBy?.role || '-',
          action: 'audit.report_exported',
          summary: `Exported audit log with ${data.totals?.events || 0} events`,
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
          summary: `Verified ${data.type || 'unknown'} export signature: ${data.ok ? 'valid' : 'failed'}`,
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
          <h2 className="text-2xl font-bold">Audit log</h2>
          <p className="text-sm text-gray-500">Case, sighting, referral, SMS, and access-control events in your scope.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={checking} onClick={checkIntegrity}>
            {checking ? 'Checking...' : 'Verify'}
          </button>
          <button className="btn-ghost" disabled={exporting} onClick={exportAudit}>
            {exporting ? 'Exporting...' : 'Export JSON'}
          </button>
          <label className={`btn-ghost ${verifying ? 'pointer-events-none opacity-50' : ''}`}>
            {verifying ? 'Verifying...' : 'Verify export'}
            <input type="file" accept="application/json,.json" className="hidden" onChange={verifyExportFile} disabled={verifying} />
          </label>
        </div>
      </div>

      {integrity && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${integrity.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
          <p className="font-medium">{integrity.ok ? 'Audit chain verified' : 'Audit chain check failed'}</p>
          <p className="text-xs opacity-80">
            {integrity.checked || 0} events checked{integrity.headHash ? ` / head ${integrity.headHash.slice(0, 12)}` : ''}{integrity.failedId ? ` / failed at ${integrity.failedId}` : ''}
          </p>
        </div>
      )}

      {verification && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${verification.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
          <p className="font-medium">{verification.ok ? 'Export signature verified' : 'Export signature failed'}</p>
          <p className="text-xs opacity-80">
            {[verification.type, verification.keyId ? `key ${verification.keyId}` : null, verification.digest ? `digest ${verification.digest.slice(0, 12)}` : null, verification.reason].filter(Boolean).join(' / ')}
          </p>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-black/5 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Summary</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Scope</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{timeAgo(r.ts)}</p>
                    <p className="text-xs text-gray-400">{fmtDate(r.ts)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{r.actorName}</p>
                    <p className="text-xs text-gray-400">{r.actorRole}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium">
                      {ACTION_LABELS[r.action] || r.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{r.summary || '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{[r.targetType, r.targetId].filter(Boolean).join(' / ') || '-'}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {[r.scope?.district, r.scope?.state].filter(Boolean).join(', ') || r.scope?.reportId || r.scope?.matchedReportId || '-'}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">No audit events in your scope yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
