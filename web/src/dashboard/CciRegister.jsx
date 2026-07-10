import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const REVIEW_CLASS = {
  overdue: 'bg-red-50 text-red-700 ring-red-500/20',
  due_soon: 'bg-amber-50 text-amber-700 ring-amber-500/20',
  scheduled: 'bg-emerald-50 text-emerald-700 ring-emerald-500/20',
  not_scheduled: 'bg-gray-100 text-gray-600 ring-gray-500/20',
};

const REVIEW_LABEL = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  scheduled: 'Scheduled',
  not_scheduled: 'No review date',
};

function fmtDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-IN');
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
    </div>
  );
}

function CountList({ title, rows }) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-black/5">
      <div className="border-b border-black/5 px-4 py-3">
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="divide-y divide-black/5">
        {rows.length === 0 && <p className="px-4 py-5 text-sm text-gray-400">No records</p>}
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

export default function CciRegister() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('all');
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/dashboard/cci-register')
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  const rows = useMemo(() => {
    const all = data?.register || [];
    return status === 'all' ? all : all.filter((row) => row.reviewStatus === status);
  }, [data, status]);

  if (err) return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>;
  if (!data) return <div className="text-sm text-gray-400">Loading CCI register...</div>;

  const totals = data.totals || {};
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">CCI register</h2>
          <p className="text-sm text-gray-500">{data.scope} / care admissions and next-review tracking</p>
        </div>
        <select className="field w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All review states</option>
          <option value="overdue">Overdue</option>
          <option value="due_soon">Due soon</option>
          <option value="scheduled">Scheduled</option>
          <option value="not_scheduled">No review date</option>
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Care records" value={totals.records || 0} />
        <Stat label="Active children" value={totals.activeChildren || 0} />
        <Stat label="Institutions" value={totals.institutions || 0} />
        <Stat label="Overdue reviews" value={totals.overdueReviews || 0} />
        <Stat label="Due soon" value={totals.dueSoonReviews || 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CountList title="By institution" rows={data.byInstitution || []} />
        <CountList title="By admission type" rows={data.byAdmissionType || []} />
      </div>

      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
        <div className="border-b border-black/5 px-4 py-3">
          <h3 className="font-semibold">Children in CCI care workflow</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black/5 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3">Child / case</th>
                <th className="px-4 py-3">Institution</th>
                <th className="px-4 py-3">Admission</th>
                <th className="px-4 py-3">Next review</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Jurisdiction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <Link to="/app/cases" className="font-semibold text-khozo hover:underline">{row.childName}</Link>
                    <p className="text-xs text-gray-400">{row.gender || '-'} / age {row.age ?? '-'} / {row.caseStatus}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{row.cciName}</td>
                  <td className="px-4 py-3">
                    <p className="text-gray-700">{row.admissionLabel}</p>
                    <p className="text-xs text-gray-400">{fmtDate(row.admissionDate)}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{fmtDate(row.nextReviewDate)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${REVIEW_CLASS[row.reviewStatus] || REVIEW_CLASS.not_scheduled}`}>
                      {REVIEW_LABEL[row.reviewStatus] || row.reviewStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{[row.district, row.state].filter(Boolean).join(', ') || '-'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">No CCI care records in this view.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
