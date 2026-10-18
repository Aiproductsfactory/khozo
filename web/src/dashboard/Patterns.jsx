import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtDate } from '../lib.jsx';
import { currentLocale, useT } from '../i18n.jsx';
import { RISK_BADGES, riskReasonLabel } from './riskLabels.js';

/**
 * Trafficking patterns across the cases and sightings this desk can see
 * (GET /api/dashboard/patterns, shared/trafficking.js): high-risk open cases,
 * district surges, repeat disappearances, shared contact numbers, movement
 * between places, and places where sightings of children gather.
 *
 * Every item is a prompt with its reasons, never a finding, and every case
 * links to its record, which still opens only under the jurisdiction rules.
 */

const WINDOWS = [30, 90, 180];

function Stat({ label, value, tone = 'text-ink' }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function Section({ title, hint, children, empty }) {
  const t = useT();
  return (
    <section className="rounded-xl bg-white ring-1 ring-black/5">
      <div className="border-b border-black/5 px-4 py-3">
        <h3 className="font-semibold">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
      </div>
      {empty ? <p className="px-4 py-5 text-sm text-gray-400">{t('Nothing found in this period.')}</p> : <div className="divide-y divide-black/5">{children}</div>}
    </section>
  );
}

function CaseLink({ c }) {
  const t = useT();
  const badge = RISK_BADGES[c.riskLevel];
  return (
    <Link to={`/app/cases?id=${encodeURIComponent(c.id)}`} className="inline-flex flex-wrap items-center gap-1.5 rounded-lg bg-gray-50 px-2 py-1 text-xs ring-1 ring-black/5 hover:bg-gray-100">
      <span className="font-semibold capitalize text-ink">{c.childName || c.id}</span>
      <span className="text-gray-500">
        {[c.gender, c.age != null ? t('age {age}', { age: c.age }) : null, c.district].filter(Boolean).join(' / ')}
      </span>
      {c.dateOfMissing && <span className="text-gray-400">{fmtDate(c.dateOfMissing)}</span>}
      {badge && <span className={`rounded-full px-1.5 py-0.5 font-semibold ring-1 ${badge.className}`}>{t(badge.label)}</span>}
    </Link>
  );
}

export default function Patterns() {
  const t = useT();
  const { user } = useAuth();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [assessing, setAssessing] = useState(false);
  const [assessed, setAssessed] = useState(null);

  const load = useCallback(() => {
    setErr('');
    api.get(`/dashboard/patterns?days=${days}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [days]);

  useEffect(load, [load]);

  const assessOlder = () => {
    setAssessing(true);
    api.post('/dashboard/patterns/assess-cases', {})
      .then((res) => { setAssessed(res); load(); })
      .catch((e) => setErr(e.message))
      .finally(() => setAssessing(false));
  };

  if (err) return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>;
  if (!data) return <div className="text-sm text-gray-400">{t('Loading patterns...')}</div>;

  const counts = data.counts || {};
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold">{t('Trafficking patterns')}</h2>
          <p className="text-sm text-gray-500">
            {t('Generated {date} for {scope}', { date: new Date(data.generatedAt).toLocaleString(currentLocale()), scope: data.scope || '-' })}
          </p>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            {t('These are prompts for an officer to review, worked out from the cases and sightings you can see. None of them is a finding.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t('Period')}>
            {WINDOWS.map((w) => <option key={w} value={w}>{t('Last {days} days', { days: w })}</option>)}
          </select>
          <button className="btn-ghost" onClick={load}>{t('Refresh')}</button>
          {user?.role === 'super_admin' && (
            <button className="btn-ghost" onClick={assessOlder} disabled={assessing}>{t('Assess older cases')}</button>
          )}
        </div>
      </div>

      {assessed && (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {t('Assessed {count} cases: {high} high, {elevated} elevated.', { count: assessed.assessed, high: assessed.levels?.high || 0, elevated: assessed.levels?.elevated || 0 })}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={t('High-risk open cases')} value={counts.highRiskOpen || 0} tone={counts.highRiskOpen ? 'text-red-700' : 'text-ink'} />
        <Stat label={t('District surges')} value={counts.surges || 0} />
        <Stat label={t('Repeat disappearances')} value={counts.repeatMissing || 0} />
        <Stat label={t('Shared contact numbers')} value={counts.sharedContacts || 0} />
        <Stat label={t('Movement between places')} value={counts.corridors || 0} />
        <Stat label={t('Sighting hotspots')} value={counts.hotspots || 0} />
      </div>

      <Section title={t('High-risk open cases')} empty={!data.highRisk?.length}>
        {(data.highRisk || []).map((c) => (
          <div key={c.id} className="space-y-1.5 px-4 py-3 text-sm">
            <CaseLink c={c} />
            <ul className="ml-1 list-disc space-y-0.5 pl-4 text-gray-600">
              {(c.reasons || []).map((r) => <li key={r.code}>{riskReasonLabel(t, r)}</li>)}
            </ul>
          </div>
        ))}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t('District surges')} empty={!data.surges?.length}>
          {(data.surges || []).map((s) => (
            <div key={s.place} className="space-y-2 px-4 py-3 text-sm">
              <p className="font-semibold text-ink">{s.place}</p>
              <ul className="space-y-0.5 text-gray-600">
                <li>{t('{recent} missing in {days} days, against about {usual} usually', { recent: s.recent, days: data.windowDays, usual: s.usual })}</li>
                {s.adolescents > 0 && <li>{t('{count} aged 12 to 17, {girls} of them girls', { count: s.adolescents, girls: s.girls })}</li>}
                {s.flagged > 0 && <li>{t('{count} raised for trafficking risk', { count: s.flagged })}</li>}
              </ul>
              <div className="flex flex-wrap gap-1.5">{(s.cases || []).map((c) => <CaseLink key={c.id} c={c} />)}</div>
            </div>
          ))}
        </Section>

        <Section title={t('Repeat disappearances')} empty={!data.repeatMissing?.length}>
          {(data.repeatMissing || []).map((g) => (
            <div key={g.cases.map((c) => c.id).join()} className="space-y-2 px-4 py-3 text-sm">
              <p className="font-semibold text-ink">{t('Reported missing {count} times', { count: g.episodes })}</p>
              <div className="flex flex-wrap gap-1.5">{g.cases.map((c) => <CaseLink key={c.id} c={c} />)}</div>
            </div>
          ))}
        </Section>

        <Section title={t('Shared contact numbers')} hint={t('Siblings missing together, or one contact on several cases.')} empty={!data.sharedContacts?.length}>
          {(data.sharedContacts || []).map((g) => (
            <div key={g.cases.map((c) => c.id).join()} className="space-y-2 px-4 py-3 text-sm">
              <p className="font-semibold text-ink">{t('Number ending {suffix}', { suffix: g.phoneSuffix })}</p>
              <div className="flex flex-wrap gap-1.5">{g.cases.map((c) => <CaseLink key={c.id} c={c} />)}</div>
            </div>
          ))}
        </Section>

        <Section title={t('Movement between places')} empty={!data.corridors?.length}>
          {(data.corridors || []).map((r) => (
            <div key={`${r.from}>${r.to}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="font-semibold text-ink">{r.from} → {r.to}</span>
              <span className="flex items-center gap-2 text-gray-600">
                {r.interstate && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-red-200">{t('Interstate')}</span>}
                {t('{cases} cases, {sightings} sightings, {confirmed} confirmed', { cases: r.cases, sightings: r.sightings, confirmed: r.confirmed })}
              </span>
            </div>
          ))}
        </Section>

        <Section title={t('Sighting hotspots')} empty={!data.hotspots?.length}>
          {(data.hotspots || []).map((h) => (
            <div key={h.place} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="font-semibold text-ink">{h.place}</span>
              <span className="text-gray-600">{t('{count} sightings of children, {unmatched} not matched to a case', { count: h.sightings, unmatched: h.unmatched })}</span>
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
}
