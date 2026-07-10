import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDate } from '../lib.jsx';

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
    </div>
  );
}

function CountTable({ title, rows, empty = 'No records' }) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-black/5">
      <div className="border-b border-black/5 px-4 py-3">
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="divide-y divide-black/5">
        {rows.length === 0 && <p className="px-4 py-5 text-sm text-gray-400">{empty}</p>}
        {rows.map((row) => (
          <div key={row.name} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="text-gray-600">{row.name}</span>
            <span className="font-semibold text-ink">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function objectRows(obj) {
  return Object.entries(obj || {})
    .map(([name, count]) => ({ name: name.replaceAll('_', ' '), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export default function MisReport() {
  const [report, setReport] = useState(null);
  const [err, setErr] = useState('');

  const load = () => {
    api.get('/dashboard/mis')
      .then(setReport)
      .catch((e) => setErr(e.message));
  };

  useEffect(load, []);

  if (err) return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>;
  if (!report) return <div className="text-sm text-gray-400">Loading MIS report...</div>;

  const totals = report.totals || {};
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">MIS report</h2>
          <p className="text-sm text-gray-500">
            {report.scope} / generated {new Date(report.generatedAt).toLocaleString('en-IN')} by {report.generatedBy?.name}
          </p>
          {report.signature && (
            <p className="mt-1 text-xs text-gray-400">
              Signed {report.signature.type} / {report.signature.algorithm} / digest {report.signature.digest?.slice(0, 12)}...
            </p>
          )}
        </div>
        <button className="btn-ghost" onClick={load}>Refresh</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Reports" value={totals.reports} />
        <Stat label="Active cases" value={totals.activeCases} />
        <Stat label="Pending intake" value={totals.pendingCitizenIntake} />
        <Stat label="Pending sightings" value={totals.pendingSightings} />
        <Stat label="Privacy due" value={totals.privacyDue} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Formal follow-ups" value={totals.formalFollowups || 0} />
        <Stat label="Production records" value={totals.productionRecords || 0} />
        <Stat label="Within 24h" value={totals.productionWithin24h || 0} />
        <Stat label="Delayed production" value={totals.productionDelayed || 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CountTable title="Case status" rows={objectRows(report.caseStatus)} />
        <CountTable title="Sighting status" rows={objectRows(report.sightingStatus)} />
        <CountTable title="Top states" rows={report.byState || []} />
        <CountTable title="Top districts" rows={report.byDistrict || []} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <CountTable title="Age bands" rows={report.demographics?.byAgeBand || []} />
        <CountTable title="Gender split" rows={report.demographics?.byGender || []} />
        <CountTable title="Registration source" rows={report.demographics?.byRegistrationSource || []} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <CountTable title="Formal follow-ups due" rows={report.compliance?.formalFollowups || []} empty="No formal follow-ups due" />
        <CountTable title="Production compliance" rows={report.compliance?.production || []} empty="No production records" />
        <CountTable title="Pending work" rows={report.compliance?.pendingWork || []} empty="No pending work alerts" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CountTable title="Workflow actions" rows={report.workflowActions || []} empty="No workflow activity yet" />
        <div className="rounded-xl bg-white ring-1 ring-black/5">
          <div className="border-b border-black/5 px-4 py-3">
            <h3 className="font-semibold">Recent audit</h3>
          </div>
          <div className="divide-y divide-black/5">
            {(report.recentAudit || []).map((row) => (
              <div key={row.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-medium text-ink">{row.action}</p>
                  <p className="text-xs text-gray-400">{fmtDate(row.ts)}</p>
                </div>
                <p className="mt-1 text-gray-600">{row.summary || '-'}</p>
                <p className="mt-1 text-xs text-gray-400">{row.actorRole} / {row.targetType || 'system'}</p>
              </div>
            ))}
            {(!report.recentAudit || report.recentAudit.length === 0) && (
              <p className="px-4 py-5 text-sm text-gray-400">No audit activity in scope.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
