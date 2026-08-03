import { useState, useEffect } from 'react';
import { api } from '../api.js';

export default function SimulationResults() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchResults() {
      try {
        const res = await api.get('/reports/found/all');
        setResults((res.foundReports || []).slice(0, 50));
      } catch (err) {
        console.error('Failed to load simulation results', err);
      } finally {
        setLoading(false);
      }
    }
    fetchResults();
  }, []);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Simulation Results</h1>
        <p className="mt-2 text-lg text-slate-600">
          Real-world Aarakshak Live Match simulation outputs using test images.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-xl shadow-slate-200/50 ring-1 ring-slate-200">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className="px-6 py-4 text-left text-xs font-semibold tracking-wider text-slate-500 uppercase">
                ID / Reference
              </th>
              <th scope="col" className="px-6 py-4 text-left text-xs font-semibold tracking-wider text-slate-500 uppercase">
                Location
              </th>
              <th scope="col" className="px-6 py-4 text-left text-xs font-semibold tracking-wider text-slate-500 uppercase">
                Status
              </th>
              <th scope="col" className="px-6 py-4 text-left text-xs font-semibold tracking-wider text-slate-500 uppercase">
                Match Details
              </th>
              <th scope="col" className="px-6 py-4 text-left text-xs font-semibold tracking-wider text-slate-500 uppercase">
                Timestamp
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {loading ? (
              <tr>
                <td colSpan="5" className="px-6 py-8 text-center text-sm text-slate-500">
                  <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600"></div>
                  <span className="ml-3 font-medium">Loading simulation results...</span>
                </td>
              </tr>
            ) : results.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-6 py-12 text-center">
                  <span className="text-4xl block mb-3">🧪</span>
                  <p className="text-sm font-semibold text-slate-900">No simulations run yet.</p>
                  <p className="text-xs text-slate-500 mt-1">Run the simulation script to populate this table.</p>
                </td>
              </tr>
            ) : (
              results.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-slate-900">
                    #{r.id}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {r.foundLocation || '—'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
                      r.status === 'matched' ? 'bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-600/20' : 
                      r.status === 'rejected' || r.status === 'no_match' ? 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-600/20' : 
                      'bg-slate-100 text-slate-800 ring-1 ring-inset ring-slate-500/20'
                    }`}>
                      {r.status === 'matched' ? '✅ Matched' : r.status === 'rejected' || r.status === 'no_match' ? '❌ No Match' : '⏳ Pending'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {r.matchScore > 0 ? (
                      <span className="font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                        Confidence: {(r.matchScore * 100).toFixed(1)}%
                      </span>
                    ) : (
                      'N/A'
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
