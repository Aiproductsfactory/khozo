import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Logo } from '../components.jsx';
import { ROLE_LABELS } from '../lib.jsx';

const ROLE_FILTERS = [
  { value: '', label: 'All services' },
  { value: 'police', label: 'Police' },
  { value: 'sjpu', label: 'SJPU' },
  { value: 'ahtu', label: 'AHTU' },
  { value: 'dcrb', label: 'DCRB' },
  { value: 'dlsa', label: 'DLSA' },
  { value: 'cwc', label: 'CWC' },
  { value: 'dcpu', label: 'DCPU' },
  { value: 'rpf', label: 'RPF' },
  { value: 'cci', label: 'CCI' },
  { value: 'saa', label: 'SAA' },
  { value: 'jjb', label: 'JJB' },
  { value: 'state_nodal', label: 'State nodal' },
  { value: 'sara', label: 'SARA' },
];
const INCIDENT_TYPES = [
  { value: 'missing_child', label: 'Missing child' },
  { value: 'immediate_danger', label: 'Immediate danger' },
  { value: 'welfare', label: 'Shelter / welfare' },
  { value: 'railway', label: 'Railway sighting' },
];

export default function Services() {
  const [rows, setRows] = useState([]);
  const [emergency, setEmergency] = useState([]);
  const [emergencyPlan, setEmergencyPlan] = useState(null);
  const [filters, setFilters] = useState({ state: '', district: '', role: '', incidentType: 'missing_child' });
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.state.trim()) params.set('state', filters.state.trim());
    if (filters.district.trim()) params.set('district', filters.district.trim());
    if (filters.role) params.set('role', filters.role);
    if (filters.incidentType) params.set('incidentType', filters.incidentType);
    api.get(`/dashboard/public/directory?${params}`)
      .then((d) => {
        setRows(d.directory || []);
        setEmergency(d.emergency || []);
        setEmergencyPlan(d.emergencyPlan || null);
      })
      .catch(() => {
        setRows([]);
        setEmergency([]);
        setEmergencyPlan(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const key = [row.jurisdiction?.district, row.jurisdiction?.state].filter(Boolean).join(', ') || row.jurisdiction?.state || 'State service';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return [...map.entries()];
  }, [rows]);

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const phoneLink = (phone) => (phone ? `tel:${String(phone).replace(/[^\d+]/g, '')}` : null);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-5">
          <Logo />
          <div className="flex gap-2">
            <Link to="/report" className="btn-primary">Submit sighting</Link>
            <Link to="/bulletins" className="btn-ghost">Bulletins</Link>
            <Link to="/" className="btn-ghost">Home</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-khozo">Child-protection directory</p>
            <h1 className="mt-1 text-3xl font-bold text-ink">Find a local response desk</h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-500">
              Public contact points for police, SJPU, AHTU, DCRB, DLSA, CWC, DCPU, railway, CCI, SAA, JJB, state nodal, and SARA services. Account emails and internal user details are not listed here.
            </p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); load(); }} className="grid gap-2 md:grid-cols-[150px_170px_150px_170px_auto]">
            <input className="field" value={filters.state} onChange={set('state')} placeholder="State" />
            <input className="field" value={filters.district} onChange={set('district')} placeholder="District" />
            <select className="field" value={filters.role} onChange={set('role')}>
              {ROLE_FILTERS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
            <select className="field" value={filters.incidentType} onChange={set('incidentType')}>
              {INCIDENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <button className="btn-primary">Search</button>
          </form>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
          <section className="rounded-lg bg-white p-4 ring-1 ring-black/5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Emergency routing</p>
                <h2 className="mt-1 text-lg font-bold text-ink">{emergencyPlan?.label || 'Missing child'}</h2>
                <p className="mt-1 max-w-2xl text-sm text-gray-500">{emergencyPlan?.instructions}</p>
              </div>
              {emergencyPlan?.primary && (
                <a href={phoneLink(emergencyPlan.primary.phone)} className="btn-primary">
                  Call {emergencyPlan.primary.phone}
                </a>
              )}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {emergencyPlan?.primary && (
                <a href={phoneLink(emergencyPlan.primary.phone)} className="rounded-lg border border-khozo/20 bg-khozo-light p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-khozo">Primary</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{emergencyPlan.primary.label}</p>
                  <p className="text-2xl font-bold text-ink">{emergencyPlan.primary.phone}</p>
                </a>
              )}
              <div className="rounded-lg border border-black/5 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Backup numbers</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(emergencyPlan?.secondary || emergency).map((item) => (
                    <a key={item.phone} href={phoneLink(item.phone)} className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-ink ring-1 ring-black/5 hover:bg-khozo-light">
                      {item.label} {item.phone}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-lg bg-white p-4 ring-1 ring-black/5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Local desks for this route</p>
            <div className="mt-3 space-y-3">
              {(emergencyPlan?.localContacts || []).slice(0, 4).map((member) => (
                <div key={member.id} className="flex items-start justify-between gap-3 border-b border-black/5 pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="text-sm font-semibold text-ink">{member.org || member.name}</p>
                    <p className="text-xs text-gray-500">{ROLE_LABELS[member.role] || member.role}</p>
                  </div>
                  {member.phone && <a href={phoneLink(member.phone)} className="text-sm font-semibold text-khozo">{member.phone}</a>}
                </div>
              ))}
              {!loading && (emergencyPlan?.localContacts || []).length === 0 && (
                <p className="text-sm text-gray-400">No local desk matches this incident and filter.</p>
              )}
            </div>
          </section>
        </div>

        <div className="mt-8 space-y-6">
          {grouped.map(([place, members]) => (
            <section key={place}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{place}</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {members.map((member) => (
                  <div key={member.id} className="rounded-xl bg-white p-4 ring-1 ring-black/5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{member.org || member.name}</p>
                        <p className="text-xs text-gray-500">{ROLE_LABELS[member.role] || member.role}</p>
                      </div>
                      {member.phone && (
                        <a href={phoneLink(member.phone)} className="btn-ghost py-1.5 text-xs">Call</a>
                      )}
                    </div>
                    <p className="mt-3 text-xs text-gray-500">
                      {[member.jurisdiction?.station, member.jurisdiction?.district, member.jurisdiction?.state].filter(Boolean).join(', ') || 'State service'}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-khozo">{member.phone || 'Contact via local administration'}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {!loading && grouped.length === 0 && (
            <div className="rounded-xl bg-white px-4 py-10 text-center text-gray-400 ring-1 ring-black/5">
              No public service contacts match this filter.
            </div>
          )}
          {loading && (
            <div className="rounded-xl bg-white px-4 py-10 text-center text-gray-400 ring-1 ring-black/5">
              Loading service directory...
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
