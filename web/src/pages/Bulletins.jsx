import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Logo } from '../components.jsx';
import { fmtDate } from '../lib.jsx';

export default function Bulletins() {
  const [rows, setRows] = useState([]);
  const [mode, setMode] = useState('bulletins');
  const [filters, setFilters] = useState({ state: '', district: '', gender: '', ageMin: '', ageMax: '', status: '' });
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.state.trim()) params.set('state', filters.state.trim());
    if (filters.district.trim()) params.set('district', filters.district.trim());
    if (mode === 'search') {
      if (filters.gender) params.set('gender', filters.gender);
      if (filters.ageMin) params.set('ageMin', filters.ageMin);
      if (filters.ageMax) params.set('ageMax', filters.ageMax);
      if (filters.status) params.set('status', filters.status);
    }
    const url = mode === 'search' ? `/reports/public/search?${params}` : `/reports/public/bulletins?${params}`;
    api.get(url)
      .then((d) => setRows(mode === 'search' ? d.results || [] : d.bulletins || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [mode]);

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-5">
          <Logo />
          <div className="flex gap-2">
            <Link to="/report" className="btn-primary">Submit sighting</Link>
            <Link to="/" className="btn-ghost">Home</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-khozo">Public bulletin</p>
            <h1 className="mt-1 text-3xl font-bold text-ink">Verified child search</h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-500">
              Search privacy-safe public bulletins and recovered-status records. Exact addresses, guardian contacts, identity numbers, notes, and protected photos are not shown publicly.
            </p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); load(); }} className="grid gap-2 lg:grid-cols-[130px_150px_160px_120px_90px_90px_120px_auto]">
            <select className="field" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="bulletins">Bulletins</option>
              <option value="search">All public</option>
            </select>
            <input className="field" value={filters.state} onChange={set('state')} placeholder="State" />
            <input className="field" value={filters.district} onChange={set('district')} placeholder="District" />
            <select className="field" value={filters.gender} onChange={set('gender')} disabled={mode !== 'search'}>
              <option value="">Any gender</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
            <input className="field" value={filters.ageMin} onChange={set('ageMin')} placeholder="Age min" inputMode="numeric" disabled={mode !== 'search'} />
            <input className="field" value={filters.ageMax} onChange={set('ageMax')} placeholder="Age max" inputMode="numeric" disabled={mode !== 'search'} />
            <select className="field" value={filters.status} onChange={set('status')} disabled={mode !== 'search'}>
              <option value="">Any status</option>
              <option value="missing">Missing</option>
              <option value="found">Found</option>
              <option value="closed">Closed</option>
            </select>
            <button className="btn-primary">Filter</button>
          </form>
        </div>

        <div className="mt-8 overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-black/5 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Child</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Missing since</th>
                  <th className="px-4 py-3">Published by</th>
                  <th className="px-4 py-3">What to do</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={`/api/reports/photo/${row.id}`}
                          alt={row.childName || 'Missing child'}
                          className="h-10 w-10 rounded-lg object-cover bg-gray-100 ring-1 ring-black/5"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <div>
                          <p className="font-semibold capitalize">{row.publicName || row.childName}</p>
                          <p className="text-xs text-gray-400">{row.gender || 'Gender under review'} / {row.ageBand ? `approx. ${row.ageBand}` : `age ${row.age ?? '-'}`}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{row.statusLabel || row.status}</td>
                    <td className="px-4 py-3 text-gray-600">{row.lastSeen || [row.district, row.state].filter(Boolean).join(', ') || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtDate(row.dateOfMissing)}</td>
                    <td className="px-4 py-3">
                      <p className="text-gray-700">{row.agency || 'Responsible agency'}</p>
                      <p className="text-xs text-gray-400">{row.publishedAt ? fmtDate(row.publishedAt) : 'Not a public bulletin'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Link to={row.status === 'missing' ? '/report' : '/track-case'} className="text-sm font-semibold text-khozo hover:underline">
                        {row.status === 'missing' ? 'Submit sighting' : 'Track exact case'}
                      </Link>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400">No public records match this filter.</td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400">Loading public records...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
