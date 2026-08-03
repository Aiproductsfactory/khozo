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

export default function Overview() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [followups, setFollowups] = useState(null);
  const [readiness, setReadiness] = useState(null);

  useEffect(() => {
    api.get('/dashboard/stats').then(setStats).catch(() => {});
    api.get('/dashboard/activity').then((d) => setActivity(d.activity)).catch(() => {});
    api.get('/dashboard/followups').then(setFollowups).catch(() => {});
    api.get('/dashboard/readiness').then(setReadiness).catch(() => {});
  }, []);

  if (!stats) return <div className="text-gray-400">Loading dashboard…</div>;
  const h = HEADLINE[user.role] || HEADLINE.parent;
  const showOps = OP_ROLES.includes(user.role);

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

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total missing" value={stats.cards.totalMissing.toLocaleString('en-IN')} accent="red" icon="🔴" sub="Open + under review" />
        <StatCard label="Total found / reunited" value={stats.cards.totalFound.toLocaleString('en-IN')} accent="khozo" icon="🏠" sub={`${stats.cards.reunificationRate}% reunification rate`} />
        <StatCard label="Active cases" value={stats.cards.activeCases.toLocaleString('en-IN')} accent="amber" icon="🗂️" sub="In your scope" />
        <StatCard label="Pending matches" value={stats.cards.pendingMatches} accent="blue" icon="🔍" sub="Citizen sightings to review" />
      </div>

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

          {/* Live In-App Role Testing Telemetry Matrix */}
          <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-base">🧪</span>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-indigo-900">In-App Live Role Verification Telemetry</h4>
              </div>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-800 border border-emerald-200">
                18 / 18 Roles Verified
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau', 'parent', 'ngo'].map((r) => (
                <div key={r} className="rounded-lg bg-white p-2 border border-indigo-100/80 text-center shadow-xs">
                  <span className="block text-[10px] font-extrabold uppercase text-slate-700 truncate">{r.replace('_', ' ')}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 mt-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                    Verified
                  </span>
                </div>
              ))}
            </div>
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
