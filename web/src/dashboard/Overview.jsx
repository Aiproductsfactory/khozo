import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { StatCard } from '../components.jsx';
import { asList, categoryLabel, timeAgo, txt } from '../lib.jsx';
import { currentLocale, msg, useT } from '../i18n.jsx';
import { PHONE_QUERY, useMediaQuery } from '../useMediaQuery.js';

const PIE_COLORS = ['#ef4444', '#f59e0b', '#10b981'];

// Role-specific framing for the headline strip.
const HEADLINE = {
  super_admin: { title: msg('National overview'), sub: msg('Every state, every district — the full Khozo picture.') },
  admin: { title: msg('Jurisdiction overview'), sub: msg('Cases and stations under your command.') },
  police: { title: msg('Station overview'), sub: msg('Your caseload, sightings to review, and pending alerts.') },
  sjpu: { title: msg('SJPU overview'), sub: msg('Child-friendly police response, district cases, and urgent sightings.') },
  ahtu: { title: msg('AHTU overview'), sub: msg('Trafficking-risk cases, rescue coordination, and urgent sightings.') },
  dcrb: { title: msg('DCRB overview'), sub: msg('District crime records linkage, alerts, and missing-child follow-up.') },
  dlsa: { title: msg('DLSA legal aid overview'), sub: msg('Legal-aid referrals, compensation support, and court follow-up.') },
  cwc: { title: msg('Child welfare overview'), sub: msg('Sightings, referrals, and vulnerable children in your district.') },
  dcpu: { title: msg('District child protection overview'), sub: msg('District cases, referrals, and child-protection coordination.') },
  rpf: { title: msg('Railway protection overview'), sub: msg('Railway-area sightings and missing-child cases in your district.') },
  cci: { title: msg('CCI intake overview'), sub: msg('Children in care, referrals, and district protection follow-up.') },
  saa: { title: msg('SAA adoption overview'), sub: msg('Adoption follow-up, SAA intake, and CARINGS coordination.') },
  jjb: { title: msg('JJB oversight overview'), sub: msg('District child-protection cases and review activity.') },
  state_nodal: { title: msg('State nodal overview'), sub: msg('Statewide cases, referrals, privacy review, and stakeholder coordination.') },
  sara: { title: msg('SARA adoption overview'), sub: msg('Statewide adoption governance, SAA coordination, and review queues.') },
  crime_bureau: { title: msg('Crime records overview'), sub: msg('Statewide missing-child records and review queues.') },
  parent: { title: msg('My reports'), sub: msg('The status of children you have reported.') },
  ngo: { title: msg('Our reports'), sub: msg('Children your organisation has helped report.') },
};

// The server sends these four names in English; they are a fixed set.
const STATUS_NAMES = {
  Missing: msg('Missing'),
  'Under review': msg('Under review'),
  Found: msg('Found'),
  Closed: msg('Closed'),
};

const READINESS_STATUS = { pass: msg('pass'), warning: msg('warning'), fail: msg('fail') };
const PRIORITY = { high: msg('high'), medium: msg('medium'), low: msg('low') };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The trend arrives keyed by English short month names; show them in the active language. */
function monthLabel(key) {
  const i = MONTHS.indexOf(String(key).slice(0, 3));
  if (i === -1) return key;
  return new Date(2000, i, 1).toLocaleString(currentLocale(), { month: 'short' });
}

/** A count from the API as a figure; anything else reads as 0. */
const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0).toLocaleString('en-IN');

const OP_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'];

/**
 * What each role is actually responsible for, as live counts.
 *
 * Every operational role saw the same four national-shaped tiles, which told a
 * CWC desk how many cases exist nationally and nothing about the children
 * waiting on them. Each entry reads its number out of data the page already
 * holds — all of it scoped to the signed-in officer by the API — so a queue
 * showing zero means zero, not "not implemented".
 */
// Reports from families and NGOs that wait for this desk to verify them: none
// of them is compared with a sighting until an officer does.
const INTAKE_WORK = { label: msg('Intakes to verify'), from: (s) => s.intakes?.pending, to: '/app/cases?status=intake_pending' };

const ROLE_WORK = {
  police: [
    INTAKE_WORK,
    { label: msg('Sightings to review'), from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: msg('Cases open past 30 days'), from: (s, f) => f?.totals.caseOverdue, to: '/app/cases' },
    { label: msg('Cases with no recent note'), from: (s, f) => f?.totals.staleUpdates, to: '/app/cases' },
  ],
  sjpu: [
    INTAKE_WORK,
    { label: msg('Sightings to review'), from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: msg('Cases needing a follow-up note'), from: (s, f) => f?.totals.staleUpdates, to: '/app/cases' },
  ],
  ahtu: [
    { label: msg('Sightings to review'), from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: msg('Cases open past 30 days'), from: (s, f) => f?.totals.caseOverdue, to: '/app/cases' },
  ],
  rpf: [
    { label: msg('Sightings to review'), from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: msg('Active cases in your district'), from: (s) => s.cards.activeCases, to: '/app/cases' },
  ],
  cwc: [
    INTAKE_WORK,
    { label: msg('Sightings awaiting a decision'), from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: msg('Statutory records due'), from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
    { label: msg('Children in the CCI register'), from: (s, f, c) => c?.totals.activeChildren, to: '/app/cci-register' },
  ],
  dcpu: [
    INTAKE_WORK,
    { label: msg('Sightings awaiting a decision'), from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: msg('Statutory records due'), from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
    { label: msg('Children in the CCI register'), from: (s, f, c) => c?.totals.activeChildren, to: '/app/cci-register' },
  ],
  cci: [
    { label: msg('Children in your care'), from: (s, f, c) => c?.totals.activeChildren, to: '/app/cci-register' },
    { label: msg('Care reviews overdue'), from: (s, f, c) => c?.totals.overdueReviews, to: '/app/cci-register' },
    { label: msg('Care reviews due soon'), from: (s, f, c) => c?.totals.dueSoonReviews, to: '/app/cci-register' },
  ],
  saa: [
    { label: msg('Children in the register'), from: (s, f, c) => c?.totals.activeChildren, to: '/app/cci-register' },
    { label: msg('Adoption records due'), from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
  ],
  sara: [
    { label: msg('Children in the state register'), from: (s, f, c) => c?.totals.activeChildren, to: '/app/cci-register' },
    { label: msg('Adoption records due'), from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
    { label: msg('Statewide active cases'), from: (s) => s.cards.activeCases, to: '/app/cases' },
  ],
  jjb: [
    { label: msg('Proceedings and records due'), from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
    { label: msg('Active cases in your district'), from: (s) => s.cards.activeCases, to: '/app/cases' },
  ],
  dlsa: [
    { label: msg('Legal-aid records due'), from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
    { label: msg('Active cases in your district'), from: (s) => s.cards.activeCases, to: '/app/cases' },
  ],
  dcrb: [
    { label: msg('Bureau records due'), from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
    { label: msg('Cases open past 30 days'), from: (s, f) => f?.totals.caseOverdue, to: '/app/cases' },
  ],
  crime_bureau: [
    { label: msg('Bureau records due'), from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
    { label: msg('Statewide active cases'), from: (s) => s.cards.activeCases, to: '/app/cases' },
    { label: msg('Abuse signals to review'), from: (s, f) => f?.totals.high, to: '/app/fraud' },
  ],
  state_nodal: [
    INTAKE_WORK,
    { label: msg('Statewide active cases'), from: (s) => s.cards.activeCases, to: '/app/cases' },
    { label: msg('Sightings awaiting review'), from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: msg('High-priority follow-ups'), from: (s, f) => f?.totals.high, to: '/app/cases' },
  ],
  admin: [
    INTAKE_WORK,
    { label: msg('Sightings awaiting review'), from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: msg('High-priority follow-ups'), from: (s, f) => f?.totals.high, to: '/app/cases' },
    { label: msg('Stakeholders on the network'), from: (s, f, c, n) => n?.users.length, to: '/app/network' },
  ],
  super_admin: [
    INTAKE_WORK,
    { label: msg('Sightings awaiting review'), from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: msg('High-priority follow-ups'), from: (s, f) => f?.totals.high, to: '/app/cases' },
    { label: msg('Stakeholders on the network'), from: (s, f, c, n) => n?.users.length, to: '/app/network' },
  ],
};

export default function Overview() {
  const t = useT();
  const phone = useMediaQuery(PHONE_QUERY);
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [followups, setFollowups] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [statsError, setStatsError] = useState('');

  const [cciRegister, setCciRegister] = useState(null);
  const [network, setNetwork] = useState(null);

  useEffect(() => {
    // The headline figures are what the page is built around, so a failure here
    // has to be said out loud. Swallowing it left the console showing
    // "Loading dashboard…" for as long as the officer was willing to wait.
    api.get('/dashboard/stats').then(setStats).catch((e) => setStatsError(e.message));
    api.get('/dashboard/activity').then((d) => setActivity(asList(d?.activity))).catch(() => {});
    api.get('/dashboard/followups').then(setFollowups).catch(() => {});
    // Pilot readiness describes the deployment (providers, secrets, storage),
    // which is the platform operator's business and nobody else's. The server
    // answers 403 to every other role, so it is not asked.
    if (user.role === 'super_admin') {
      api.get('/dashboard/readiness').then(setReadiness).catch(() => {});
    } else {
      setReadiness(null);
    }
    // Only fetched for the roles whose work panel needs them, and only where
    // the role is permitted — a 403 here would just leave the tile blank.
    if (['cwc', 'dcpu', 'cci', 'saa', 'sara', 'super_admin', 'admin'].includes(user.role)) {
      api.get('/dashboard/cci-register').then(setCciRegister).catch(() => {});
    }
    if (['super_admin', 'admin', 'state_nodal', 'sara', 'crime_bureau'].includes(user.role)) {
      api.get('/dashboard/network').then(setNetwork).catch(() => {});
    }
  }, [user.role]);

  if (statsError) {
    return (
      <div className="rounded-2xl bg-red-50 p-6 ring-1 ring-red-100">
        <p className="text-sm font-semibold text-red-800">{t('The dashboard could not load')}</p>
        <p className="mt-1 text-sm text-red-700">{statsError}</p>
        <button onClick={() => window.location.reload()} className="btn-primary mt-4">
          {t('Try again')}
        </button>
      </div>
    );
  }
  if (!stats) return <div className="text-gray-400">{t('Loading dashboard…')}</div>;
  const h = HEADLINE[user.role] || HEADLINE.parent;
  const showOps = OP_ROLES.includes(user.role);
  const work = (ROLE_WORK[user.role] || [])
    .map((item) => {
      // A reader that meets a shape it does not expect yields no tile, not a crash.
      let value;
      try {
        value = item.from(stats, followups, cciRegister, network);
      } catch {
        value = null;
      }
      return { ...item, value };
    })
    .filter((item) => item.value != null && Number.isFinite(Number(item.value)));
  const cards = stats.cards || {};
  const intakes = stats.intakes && typeof stats.intakes === 'object' ? stats.intakes : null;
  const scope = txt(stats.scope);
  // Names translated for the chart legend; the raw English names stay on stats.
  const statusSplit = asList(stats.statusSplit).map((s) => ({
    ...s,
    name: STATUS_NAMES[s.name] ? t(STATUS_NAMES[s.name]) : txt(s.name),
  }));
  // Who is missing. While the caseload is children only, the headline reads as
  // it always did; once women or adults are registered it counts people.
  const categorySplit = asList(stats.categorySplit).filter((row) => row && typeof row === 'object');
  const hasAdults = categorySplit.some((row) => row.category !== 'child' && row.total > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{t(h.title)}</h2>
          <p className="text-sm text-gray-500">{t(h.sub)} · {t('Scope:')} <span className="font-medium text-khozo">{scope}</span></p>
        </div>
        <div className={`grid w-full gap-2 sm:flex sm:w-auto ${showOps ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <Link to="/app/register" className="btn-primary text-center">➕ {t('Register a missing person')}</Link>
          {showOps && <Link to="/app/matches" className="btn-ghost text-center">🔍 {t('Review sightings')}</Link>}
        </div>
      </div>

      {/*
        Four figures that answer four different questions, each labelled with
        what it counts and over what. "Total missing" and "Active cases" were
        two names for nearly the same number, and a reunification rate was shown
        even when nothing had been reunited, reading as a 0% success rate rather
        than as no data yet.
      */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label={hasAdults ? t('People still missing') : t('Children still missing')}
          value={count(cards.totalMissing)}
          accent="red"
          icon="🔴"
          sub={t('{n} of them under review', { n: Number(asList(stats.statusSplit).find((s) => s?.name === 'Under review')?.value) || 0 })}
        />
        <StatCard
          label={t('Reunited or closed')}
          value={count(cards.totalFound)}
          accent="khozo"
          icon="🏠"
          sub={
            (Number(cards.totalMissing) || 0) + (Number(cards.totalFound) || 0) === 0
              ? t('No cases recorded yet')
              : t('{pct}% of all cases in {scope}', { pct: Number(cards.reunificationRate) || 0, scope })
          }
        />
        <StatCard
          label={t('Sightings awaiting review')}
          value={count(cards.pendingMatches)}
          accent="amber"
          icon="🔍"
          sub={
            Number(followups?.totals?.pendingSightings)
              ? t('{n} waiting more than 2 days', { n: Number(followups.totals.pendingSightings) })
              : t('None overdue')
          }
        />
        <StatCard
          label={t('Needs your attention')}
          value={count(followups?.totals?.alerts)}
          accent="blue"
          icon="⚠️"
          sub={Number(followups?.totals?.high) ? t('{n} high priority', { n: Number(followups.totals.high) }) : t('Nothing overdue')}
        />
      </div>

      {hasAdults && (
        <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-sm">
          <span className="font-semibold text-ink">{t('Still missing, by who is missing')}</span>
          {categorySplit.map((row) => (
            <span key={row.category} className="text-gray-600">
              {categoryLabel(row.category)}: <span className="font-semibold text-ink">{count(row.active)}</span>
            </span>
          ))}
        </div>
      )}

      {/*
        The queues this particular officer owns. The four tiles above frame the
        caseload; this frames the shift.
      */}
      {work.length > 0 && (
        <div className="card p-5">
          <h3 className="font-semibold">{t('Waiting on you')}</h3>
          <p className="text-xs text-gray-500">{t('Scoped to {scope}', { scope })}</p>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
            {work.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="group min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 p-3 transition hover:border-indigo-200 hover:bg-indigo-50/50 sm:p-4"
              >
                <p className={`text-2xl font-extrabold sm:text-3xl ${item.value > 0 ? 'text-slate-900' : 'text-slate-300'}`}>
                  {Number(item.value).toLocaleString('en-IN')}
                </p>
                <p className="mt-1 text-sm font-medium text-slate-600 group-hover:text-indigo-700">{t(item.label)}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/*
        Reports from families and NGOs, oldest first. Nothing is compared with
        them until an officer verifies them, so one that has waited a day is
        said out loud. Listed by case id, place and wait: the name is in Cases.
      */}
      {intakes && intakes.pending > 0 && (
        <div className={`card p-4 sm:p-5 ${intakes.overdue ? 'ring-1 ring-red-200' : ''}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold">{t('Intakes to verify')}</h3>
              <p className="text-xs text-gray-500">
                {t('Reports from families and NGOs. Matching with sightings starts only after an officer verifies one.')}
              </p>
            </div>
            <Link to="/app/cases?status=intake_pending" className="btn-ghost w-full py-1.5 text-center text-xs sm:w-auto">
              {t('Open all {n}', { n: count(intakes.pending) })}
            </Link>
          </div>
          {intakes.overdue > 0 && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
              {intakes.overdue === 1
                ? t('1 report has waited more than {h} hours for verification.', { h: Number(intakes.overdueAfterHours) || 24 })
                : t('{n} reports have waited more than {h} hours for verification.', { n: count(intakes.overdue), h: Number(intakes.overdueAfterHours) || 24 })}
            </p>
          )}
          <ul className="mt-3 divide-y divide-black/5">
            {asList(intakes.oldest).filter((row) => row && row.id).map((row) => (
              <li key={row.id}>
                <Link
                  to={`/app/cases?status=intake_pending&id=${encodeURIComponent(row.id)}`}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm hover:text-khozo"
                >
                  <span className="min-w-0">
                    <span className="font-semibold text-ink">{txt(row.id)}</span>
                    <span className="text-gray-500"> · {categoryLabel(row.personCategory)}</span>
                    <span className="block truncate text-xs text-gray-500">
                      {[txt(row.district) || txt(row.districtText), txt(row.state)].filter(Boolean).join(', ') || t('Place not given')}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${row.overdue ? 'bg-red-100 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                    {t('waiting {h} h', { h: Number(row.waitingHours) || 0 })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pilot readiness: the platform operator's panel, and only theirs. */}
      {user.role === 'super_admin' && readiness?.summary && (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">{t('Pilot readiness')}</h3>
              <p className="text-xs text-gray-500">
                {t('{pass} passed / {warning} warnings / {fail} failed', {
                  pass: readiness.summary.pass,
                  warning: readiness.summary.warning,
                  fail: readiness.summary.fail,
                })}
              </p>
            </div>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${readiness.summary.fail ? 'bg-red-50 text-red-700' : readiness.summary.warning ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {readiness.summary.fail ? t('blocked') : readiness.summary.warning ? t('pilot only') : t('ready')}
            </span>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            {asList(readiness.checks).filter((check) => check && typeof check === 'object').map((check, i) => (
              <div key={txt(check.id) || i} className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3.5 text-sm transition-all hover:shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-slate-900">{txt(check.label)}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${check.status === 'pass' ? 'bg-emerald-100 text-emerald-800' : check.status === 'fail' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>
                    {READINESS_STATUS[check.status] ? t(READINESS_STATUS[check.status]) : txt(check.status)}
                  </span>
                </div>
                <p className="mt-1.5 text-xs font-medium text-slate-600 leading-relaxed">{txt(check.detail)}</p>
              </div>
            ))}
          </div>

        </div>
      )}

      {showOps && asList(followups?.alerts).length > 0 && (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">{t('Follow-up alerts')}</h3>
              <p className="text-xs text-gray-500">
                {t('{high} high priority / {total} total in {scope}', {
                  high: Number(followups.totals?.high) || 0,
                  total: Number(followups.totals?.alerts) || 0,
                  scope: txt(followups.scope),
                })}
              </p>
            </div>
            <Link to="/app/cases" className="btn-ghost py-1.5 text-xs">{t('Open cases')}</Link>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {asList(followups.alerts).filter((alert) => alert && typeof alert === 'object').slice(0, 6).map((alert, i) => (
              <div key={txt(alert.id) || i} className="rounded-xl border border-black/5 bg-gray-50 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-ink">
                    {alert.type === 'intake_overdue'
                      ? t('Report {id} waiting {h} hours for verification', { id: txt(alert.reportId), h: Number(alert.ageHours) || 0 })
                      : txt(alert.title)}
                  </p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${alert.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {PRIORITY[alert.priority] ? t(PRIORITY[alert.priority]) : txt(alert.priority)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{txt(alert.detail)}</p>
                <p className="mt-2 text-[11px] uppercase tracking-wide text-gray-400">{txt(alert.type).replaceAll('_', ' ')}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-4 sm:p-5 lg:col-span-2">
          <h3 className="font-semibold">{t('Registrations vs. reunions')}</h3>
          <p className="text-xs text-gray-500">{t('Last 6 months')}</p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={asList(stats.trend)}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#67a426" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#67a426" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2ee" />
                <XAxis dataKey="key" tickLine={false} axisLine={false} fontSize={12} tickFormatter={monthLabel} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} allowDecimals={false} />
                <Tooltip labelFormatter={monthLabel} />
                <Area type="monotone" dataKey="registered" name={t('Registrations')} stroke="#3b82f6" fill="url(#g2)" strokeWidth={2} />
                <Area type="monotone" dataKey="reunited" name={t('Reunions')} stroke="#67a426" fill="url(#g1)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4 sm:p-5">
          <h3 className="font-semibold">{t('Case status')}</h3>
          <p className="text-xs text-gray-500">{t('Within your scope')}</p>
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusSplit} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {statusSplit.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Legend verticalAlign="bottom" iconType="circle" fontSize={12} />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {showOps && (
          <div className="card p-4 sm:p-5 lg:col-span-2">
            <h3 className="font-semibold">{t('State-wise caseload')}</h3>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={asList(stats.byState).slice(0, 7)}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2ee" />
                  <XAxis dataKey="state" tickLine={false} axisLine={false} fontSize={11} interval={phone ? 'preserveStartEnd' : 0} angle={phone ? -30 : -12} textAnchor="end" height={phone ? 72 : 50} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Legend iconType="circle" fontSize={12} />
                  <Bar dataKey="missing" name={t('Missing')} stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="found" name={t('Found')} stackId="a" fill="#67a426" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className={`card p-5 ${showOps ? '' : 'lg:col-span-3'}`}>
          <h3 className="font-semibold">{t('Recent activity')}</h3>
          <ul className="mt-4 space-y-3">
            {activity.filter((a) => a && typeof a === 'object').map((a, i) => (
              <li key={txt(a.id) || i} className="flex gap-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-khozo-light text-sm">
                  {({ check: '✅', upload: '📤', plus: '➕', eye: '👁️', sms: '✉️' })[a.icon] || '•'}
                </span>
                <div className="min-w-0 text-sm">
                  <p><span className="font-medium">{txt(a.actor)}</span> {txt(a.action)}</p>
                  <p className="text-xs text-gray-400">{txt(a.target)} · {timeAgo(a.ts)}</p>
                </div>
              </li>
            ))}
            {activity.length === 0 && <li className="text-sm text-gray-400">{t('No activity yet.')}</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
