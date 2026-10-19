import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDate } from '../lib.jsx';
import { currentLocale, msg, useT } from '../i18n.jsx';

// The open-case bands the server sends (shared/outcomes.js), registered for
// translation.
msg('Under 30 days');
msg('30 days to 6 months');
msg('6 to 12 months');
msg('1 to 5 years');
msg('Over 5 years');
// The row for sightings sent without a poster code (GET /dashboard/mis).
msg('No poster code');

const pct = (rate) => (rate == null ? '-' : `${Math.round(rate * 100)}%`);
const days = (value) => (value == null ? '-' : value);

function OutcomeTable({ rows }) {
  const t = useT();
  return (
    <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
      <div className="border-b border-black/5 px-4 py-3">
        <h3 className="font-semibold">{t('Recovery by district')}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-sm text-gray-400">{t('No records')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-4 py-2 font-semibold">{t('District')}</th>
              <th className="px-4 py-2 text-right font-semibold">{t('Registered')}</th>
              <th className="px-4 py-2 text-right font-semibold">{t('Recovered')}</th>
              <th className="px-4 py-2 text-right font-semibold">{t('Recovery rate')}</th>
              <th className="px-4 py-2 text-right font-semibold">{t('Median days to recovery')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {rows.map((row) => (
              <tr key={row.name}>
                <td className="px-4 py-2 text-gray-700">{row.name}</td>
                <td className="px-4 py-2 text-right">{row.registered}</td>
                <td className="px-4 py-2 text-right">{row.recovered}</td>
                <td className="px-4 py-2 text-right font-semibold">{pct(row.recoveryRate)}</td>
                <td className="px-4 py-2 text-right">{days(row.medianDaysToRecovery)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
    </div>
  );
}

function CountTable({ title, note = null, rows, empty, translate = false }) {
  const t = useT();
  return (
    <div className="rounded-xl bg-white ring-1 ring-black/5">
      <div className="border-b border-black/5 px-4 py-3">
        <h3 className="font-semibold">{title}</h3>
        {note && <p className="mt-0.5 text-xs text-gray-500">{note}</p>}
      </div>
      <div className="divide-y divide-black/5">
        {rows.length === 0 && <p className="px-4 py-5 text-sm text-gray-400">{empty || t('No records')}</p>}
        {rows.map((row) => (
          <div key={row.name} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="text-gray-600">{translate ? t(row.name) : row.name}</span>
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
  const t = useT();
  const [report, setReport] = useState(null);
  const [err, setErr] = useState('');

  const load = () => {
    api.get('/dashboard/mis')
      .then(setReport)
      .catch((e) => setErr(e.message));
  };

  useEffect(load, []);

  if (err) return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>;
  if (!report) return <div className="text-sm text-gray-400">{t('Loading MIS report...')}</div>;

  const totals = report.totals || {};
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{t('MIS report')}</h2>
          <p className="text-sm text-gray-500">
            {report.scope} / {t('generated {date} by {name}', {
              date: new Date(report.generatedAt).toLocaleString(currentLocale()),
              name: report.generatedBy?.name || '-',
            })}
          </p>
          {report.signature && (
            <p className="mt-1 text-xs text-gray-400">
              {t('Signed {type} / {algorithm} / digest {digest}...', {
                type: report.signature.type,
                algorithm: report.signature.algorithm,
                digest: report.signature.digest?.slice(0, 12),
              })}
            </p>
          )}
        </div>
        <button className="btn-ghost" onClick={load}>{t('Refresh')}</button>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat label={t('Reports')} value={totals.reports} />
        <Stat label={t('Active cases')} value={totals.activeCases} />
        <Stat label={t('Pending intake')} value={totals.pendingCitizenIntake} />
        <Stat label={t('Pending sightings')} value={totals.pendingSightings} />
        <Stat label={t('Privacy due')} value={totals.privacyDue} />
      </div>

      {report.outcomes && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat label={t('Recovered')} value={`${report.outcomes.recovered} / ${report.outcomes.registered}`} />
            <Stat label={t('Recovery rate')} value={pct(report.outcomes.recoveryRate)} />
            <Stat label={t('Median days to recovery')} value={days(report.outcomes.medianDaysToRecovery)} />
            <Stat label={t('Median days to first match candidate')} value={days(report.outcomes.medianDaysToFirstCandidate)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <CountTable title={t('Open cases by time missing')} rows={report.outcomes.openBacklog || []} translate />
            <div className="lg:col-span-2"><OutcomeTable rows={report.outcomes.byDistrict || []} /></div>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label={t('Formal follow-ups')} value={totals.formalFollowups || 0} />
        <Stat label={t('Production records')} value={totals.productionRecords || 0} />
        <Stat label={t('Within 24h')} value={totals.productionWithin24h || 0} />
        <Stat label={t('Delayed production')} value={totals.productionDelayed || 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CountTable title={t('Case status')} rows={objectRows(report.caseStatus)} />
        <CountTable title={t('Sighting status')} rows={objectRows(report.sightingStatus)} />
        <CountTable title={t('Top states')} rows={report.byState || []} />
        <CountTable title={t('Top districts')} rows={report.byDistrict || []} />
      </div>

      {/* Poster codes are slugs a department chose; only "No poster code" has a translation. */}
      <CountTable
        title={t('Sightings by poster code')}
        note={t('Reports sent from the form after scanning a poster’s code. It counts posters, never people.')}
        rows={report.sightingsBySource || []}
        translate
      />

      <div className="grid gap-4 lg:grid-cols-4">
        {/* Child / Woman / Adult person — the server sends these fixed English names. */}
        <CountTable title={t('Who is missing')} rows={report.demographics?.byCategory || []} translate />
        <CountTable title={t('Age bands')} rows={report.demographics?.byAgeBand || []} />
        <CountTable title={t('Gender split')} rows={report.demographics?.byGender || []} />
        <CountTable title={t('Registration source')} rows={report.demographics?.byRegistrationSource || []} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <CountTable title={t('Formal follow-ups due')} rows={report.compliance?.formalFollowups || []} empty={t('No formal follow-ups due')} />
        <CountTable title={t('Production compliance')} rows={report.compliance?.production || []} empty={t('No production records')} />
        <CountTable title={t('Pending work')} rows={report.compliance?.pendingWork || []} empty={t('No pending work alerts')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CountTable title={t('Workflow actions')} rows={report.workflowActions || []} empty={t('No workflow activity yet')} />
        <div className="rounded-xl bg-white ring-1 ring-black/5">
          <div className="border-b border-black/5 px-4 py-3">
            <h3 className="font-semibold">{t('Recent audit')}</h3>
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
              <p className="px-4 py-5 text-sm text-gray-400">{t('No audit activity in scope.')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
