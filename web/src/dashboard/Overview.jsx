import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { StatCard } from '../components.jsx';
import { timeAgo } from '../lib.jsx';

const PIE_COLORS = ['#ef4444', '#f59e0b', '#10b981'];

// Role-specific framing for the headline strip.
const HEADLINE = {
  super_admin: { title: 'National overview', sub: 'Every state, every district — the full Khozo picture.' },
  admin: { title: 'Jurisdiction overview', sub: 'Cases and stations under your command.' },
  police: { title: 'Station overview', sub: 'Your caseload, sightings to review, and pending alerts.' },
  sjpu: { title: 'SJPU overview', sub: 'Child-friendly police response, district cases, and urgent sightings.' },
  ahtu: { title: 'AHTU overview', sub: 'Trafficking-risk cases, rescue coordination, and urgent sightings.' },
  dcrb: { title: 'DCRB overview', sub: 'District crime records linkage, alerts, and missing-child follow-up.' },
  dlsa: { title: 'DLSA legal aid overview', sub: 'Legal-aid referrals, compensation support, and court follow-up.' },
  cwc: { title: 'Child welfare overview', sub: 'Sightings, referrals, and vulnerable children in your district.' },
  dcpu: { title: 'District child protection overview', sub: 'District cases, referrals, and child-protection coordination.' },
  rpf: { title: 'Railway protection overview', sub: 'Railway-area sightings and missing-child cases in your district.' },
  cci: { title: 'CCI intake overview', sub: 'Children in care, referrals, and district protection follow-up.' },
  saa: { title: 'SAA adoption overview', sub: 'Adoption follow-up, SAA intake, and CARINGS coordination.' },
  jjb: { title: 'JJB oversight overview', sub: 'District child-protection cases and review activity.' },
  state_nodal: { title: 'State nodal overview', sub: 'Statewide cases, referrals, privacy review, and stakeholder coordination.' },
  sara: { title: 'SARA adoption overview', sub: 'Statewide adoption governance, SAA coordination, and review queues.' },
  crime_bureau: { title: 'Crime records overview', sub: 'Statewide missing-child records and review queues.' },
  parent: { title: 'My reports', sub: 'The status of children you have reported.' },
  ngo: { title: 'Our reports', sub: 'Children your organisation has helped report.' },
};

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
const ROLE_WORK = {
  police: [
    { label: 'Sightings to review', from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: 'Cases open past 30 days', from: (s, f) => f?.totals.caseOverdue, to: '/app/cases' },
    { label: 'Cases with no recent note', from: (s, f) => f?.totals.staleUpdates, to: '/app/cases' },
  ],
  sjpu: [
    { label: 'Sightings to review', from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: 'Cases needing a follow-up note', from: (s, f) => f?.totals.staleUpdates, to: '/app/cases' },
  ],
  ahtu: [
    { label: 'Sightings to review', from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: 'Cases open past 30 days', from: (s, f) => f?.totals.caseOverdue, to: '/app/cases' },
  ],
  rpf: [
    { label: 'Sightings to review', from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: 'Active cases in your district', from: (s) => s.cards.activeCases, to: '/app/cases' },
  ],
  cwc: [
    { label: 'Sightings awaiting a decision', from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: 'Statutory records due', from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
    { label: 'Children in the CCI register', from: (s, f, c) => c?.totals.activeChildren, to: '/app/cci-register' },
  ],
  dcpu: [
    { label: 'Sightings awaiting a decision', from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: 'Statutory records due', from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
    { label: 'Children in the CCI register', from: (s, f, c) => c?.totals.activeChildren, to: '/app/cci-register' },
  ],
  cci: [
    { label: 'Children in your care', from: (s, f, c) => c?.totals.activeChildren, to: '/app/cci-register' },
    { label: 'Care reviews overdue', from: (s, f, c) => c?.totals.overdueReviews, to: '/app/cci-register' },
    { label: 'Care reviews due soon', from: (s, f, c) => c?.totals.dueSoonReviews, to: '/app/cci-register' },
  ],
  saa: [
    { label: 'Children in the register', from: (s, f, c) => c?.totals.activeChildren, to: '/app/cci-register' },
    { label: 'Adoption records due', from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
  ],
  sara: [
    { label: 'Children in the state register', from: (s, f, c) => c?.totals.activeChildren, to: '/app/cci-register' },
    { label: 'Adoption records due', from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
    { label: 'Statewide active cases', from: (s) => s.cards.activeCases, to: '/app/cases' },
  ],
  jjb: [
    { label: 'Proceedings and records due', from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
    { label: 'Active cases in your district', from: (s) => s.cards.activeCases, to: '/app/cases' },
  ],
  dlsa: [
    { label: 'Legal-aid records due', from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
    { label: 'Active cases in your district', from: (s) => s.cards.activeCases, to: '/app/cases' },
  ],
  dcrb: [
    { label: 'Bureau records due', from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
    { label: 'Cases open past 30 days', from: (s, f) => f?.totals.caseOverdue, to: '/app/cases' },
  ],
  crime_bureau: [
    { label: 'Bureau records due', from: (s, f) => f?.totals.formalFollowups, to: '/app/cases' },
    { label: 'Statewide active cases', from: (s) => s.cards.activeCases, to: '/app/cases' },
    { label: 'Abuse signals to review', from: (s, f) => f?.totals.high, to: '/app/fraud' },
  ],
  state_nodal: [
    { label: 'Statewide active cases', from: (s) => s.cards.activeCases, to: '/app/cases' },
    { label: 'Sightings awaiting review', from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: 'High-priority follow-ups', from: (s, f) => f?.totals.high, to: '/app/cases' },
  ],
  admin: [
    { label: 'Sightings awaiting review', from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: 'High-priority follow-ups', from: (s, f) => f?.totals.high, to: '/app/cases' },
    { label: 'Stakeholders on the network', from: (s, f, c, n) => n?.users.length, to: '/app/network' },
  ],
  super_admin: [
    { label: 'Sightings awaiting review', from: (s) => s.cards.pendingMatches, to: '/app/matches' },
    { label: 'High-priority follow-ups', from: (s, f) => f?.totals.high, to: '/app/cases' },
    { label: 'Stakeholders on the network', from: (s, f, c, n) => n?.users.length, to: '/app/network' },
  ],
};

export default function Overview() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [followups, setFollowups] = useState(null);
  const [readiness, setReadiness] = useState(null);

  const [cciRegister, setCciRegister] = useState(null);
  const [network, setNetwork] = useState(null);

  useEffect(() => {
    api.get('/dashboard/stats').then(setStats).catch(() => {});
    api.get('/dashboard/activity').then((d) => setActivity(d.activity)).catch(() => {});
    api.get('/dashboard/followups').then(setFollowups).catch(() => {});
    api.get('/dashboard/readiness').then(setReadiness).catch(() => {});
    // Only fetched for the roles whose work panel needs them, and only where
    // the role is permitted — a 403 here would just leave the tile blank.
    if (['cwc', 'dcpu', 'cci', 'saa', 'sara', 'super_admin', 'admin'].includes(user.role)) {
      api.get('/dashboard/cci-register').then(setCciRegister).catch(() => {});
    }
    if (['super_admin', 'admin', 'state_nodal', 'sara', 'crime_bureau'].includes(user.role)) {
      api.get('/dashboard/network').then(setNetwork).catch(() => {});
    }
  }, [user.role]);

  if (!stats) return <div className="text-gray-400">Loading dashboard…</div>;
  const h = HEADLINE[user.role] || HEADLINE.parent;
  const showOps = OP_ROLES.includes(user.role);
  const work = (ROLE_WORK[user.role] || [])
    .map((item) => ({ ...item, value: item.from(stats, followups, cciRegister, network) }))
    .filter((item) => item.value != null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{h.title}</h2>
          <p className="text-sm text-gray-500">{h.sub} · Scope: <span className="font-medium text-khozo">{stats.scope}</span></p>
        </div>
        <div className="flex gap-2">
          <Link to="/app/register" className="btn-primary">➕ Register a child</Link>
          {showOps && <Link to="/app/matches" className="btn-ghost">🔍 Review sightings</Link>}
        </div>
      </div>

      {/*
        Four figures that answer four different questions, each labelled with
        what it counts and over what. "Total missing" and "Active cases" were
        two names for nearly the same number, and a reunification rate was shown
        even when nothing had been reunited, reading as a 0% success rate rather
        than as no data yet.
      */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Children still missing"
          value={stats.cards.totalMissing.toLocaleString('en-IN')}
          accent="red"
          icon="🔴"
          sub={`${stats.statusSplit?.find((s) => s.name === 'Under review')?.value ?? 0} of them under review`}
        />
        <StatCard
          label="Reunited or closed"
          value={stats.cards.totalFound.toLocaleString('en-IN')}
          accent="khozo"
          icon="🏠"
          sub={
            stats.cards.totalMissing + stats.cards.totalFound === 0
              ? 'No cases recorded yet'
              : `${stats.cards.reunificationRate}% of all cases in ${stats.scope}`
          }
        />
        <StatCard
          label="Sightings awaiting review"
          value={stats.cards.pendingMatches.toLocaleString('en-IN')}
          accent="amber"
          icon="🔍"
          sub={
            followups?.totals.pendingSightings
              ? `${followups.totals.pendingSightings} waiting more than 2 days`
              : 'None overdue'
          }
        />
        <StatCard
          label="Needs your attention"
          value={(followups?.totals.alerts ?? 0).toLocaleString('en-IN')}
          accent="blue"
          icon="⚠️"
          sub={followups?.totals.high ? `${followups.totals.high} high priority` : 'Nothing overdue'}
        />
      </div>

      {/*
        The queues this particular officer owns. The four tiles above frame the
        caseload; this frames the shift.
      */}
      {work.length > 0 && (
        <div className="card p-5">
          <h3 className="font-semibold">Waiting on you</h3>
          <p className="text-xs text-gray-500">Scoped to {stats.scope}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {work.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="group rounded-xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-indigo-200 hover:bg-indigo-50/50"
              >
                <p className={`text-3xl font-extrabold ${item.value > 0 ? 'text-slate-900' : 'text-slate-300'}`}>
                  {Number(item.value).toLocaleString('en-IN')}
                </p>
                <p className="mt-1 text-sm font-medium text-slate-600 group-hover:text-indigo-700">{item.label}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      {showOps && readiness && (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Pilot readiness</h3>
              <p className="text-xs text-gray-500">
                {readiness.summary.pass} passed / {readiness.summary.warning} warnings / {readiness.summary.fail} failed
              </p>
            </div>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${readiness.summary.fail ? 'bg-red-50 text-red-700' : readiness.summary.warning ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {readiness.summary.fail ? 'blocked' : readiness.summary.warning ? 'pilot only' : 'ready'}
            </span>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            {readiness.checks.map((check) => (
              <div key={check.id} className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3.5 text-sm transition-all hover:shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-slate-900">{check.label}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${check.status === 'pass' ? 'bg-emerald-100 text-emerald-800' : check.status === 'fail' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>
                    {check.status}
                  </span>
                </div>
                <p className="mt-1.5 text-xs font-medium text-slate-600 leading-relaxed">{check.detail}</p>
              </div>
            ))}
          </div>

        </div>
      )}

      {showOps && followups?.alerts?.length > 0 && (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Follow-up alerts</h3>
              <p className="text-xs text-gray-500">{followups.totals.high} high priority / {followups.totals.alerts} total in {followups.scope}</p>
            </div>
            <Link to="/app/cases" className="btn-ghost py-1.5 text-xs">Open cases</Link>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {followups.alerts.slice(0, 6).map((alert) => (
              <div key={alert.id} className="rounded-xl border border-black/5 bg-gray-50 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-ink">{alert.title}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${alert.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {alert.priority}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{alert.detail}</p>
                <p className="mt-2 text-[11px] uppercase tracking-wide text-gray-400">{alert.type.replaceAll('_', ' ')}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h3 className="font-semibold">Registrations vs. reunions</h3>
          <p className="text-xs text-gray-500">Last 6 months</p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.trend}>
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
                <XAxis dataKey="key" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="registered" name="Registered" stroke="#3b82f6" fill="url(#g2)" strokeWidth={2} />
                <Area type="monotone" dataKey="reunited" name="Reunited" stroke="#67a426" fill="url(#g1)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold">Case status</h3>
          <p className="text-xs text-gray-500">Within your scope</p>
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats.statusSplit} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {stats.statusSplit.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
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
          <div className="card p-5 lg:col-span-2">
            <h3 className="font-semibold">State-wise caseload</h3>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.byState.slice(0, 7)}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2ee" />
                  <XAxis dataKey="state" tickLine={false} axisLine={false} fontSize={11} interval={0} angle={-12} textAnchor="end" height={50} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Legend iconType="circle" fontSize={12} />
                  <Bar dataKey="missing" name="Missing" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="found" name="Found" stackId="a" fill="#67a426" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className={`card p-5 ${showOps ? '' : 'lg:col-span-3'}`}>
          <h3 className="font-semibold">Recent activity</h3>
          <ul className="mt-4 space-y-3">
            {activity.map((a) => (
              <li key={a.id} className="flex gap-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-khozo-light text-sm">
                  {({ check: '✅', upload: '📤', plus: '➕', eye: '👁️', sms: '✉️' })[a.icon] || '•'}
                </span>
                <div className="min-w-0 text-sm">
                  <p><span className="font-medium">{a.actor}</span> {a.action}</p>
                  <p className="text-xs text-gray-400">{a.target} · {timeAgo(a.ts)}</p>
                </div>
              </li>
            ))}
            {activity.length === 0 && <li className="text-sm text-gray-400">No activity yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
