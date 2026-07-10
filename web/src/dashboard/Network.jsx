import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { ROLE_LABELS, Avatar } from '../lib.jsx';
import { useAuth } from '../auth.jsx';

const ORDER = ['super_admin', 'admin', 'state_nodal', 'sara', 'crime_bureau', 'dcrb', 'dlsa', 'police', 'sjpu', 'ahtu', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'ngo', 'parent'];
const ROLE_OPTIONS = [
  { value: 'police', label: 'Police station' },
  { value: 'sjpu', label: 'SJPU' },
  { value: 'ahtu', label: 'AHTU' },
  { value: 'dcrb', label: 'DCRB' },
  { value: 'dlsa', label: 'DLSA legal aid' },
  { value: 'cwc', label: 'CWC' },
  { value: 'dcpu', label: 'DCPU' },
  { value: 'rpf', label: 'RPF post' },
  { value: 'cci', label: 'CCI' },
  { value: 'saa', label: 'SAA' },
  { value: 'jjb', label: 'JJB' },
  { value: 'state_nodal', label: 'State nodal officer' },
  { value: 'sara', label: 'SARA adoption desk' },
  { value: 'crime_bureau', label: 'Crime records bureau' },
  { value: 'admin', label: 'State admin' },
  { value: 'ngo', label: 'NGO' },
];
const ALERT_AUDIENCES = [
  { value: 'all_operational', label: 'All operational stakeholders' },
  { value: 'police_rpf', label: 'Police / SJPU / AHTU / RPF' },
  { value: 'records', label: 'DCRB / crime records' },
  { value: 'welfare', label: 'CWC / DCPU / CCI / SAA / JJB / DLSA' },
  { value: 'legal', label: 'DLSA / legal services' },
  { value: 'adoption', label: 'SARA / SAA adoption desks' },
  { value: 'ngo', label: 'NGO partners' },
];

function allowedRoles(role) {
  if (role === 'super_admin') return ROLE_OPTIONS;
  if (['admin', 'state_nodal', 'sara'].includes(role)) return ROLE_OPTIONS.filter((r) => ['police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'sara', 'crime_bureau', 'ngo'].includes(r.value));
  if (role === 'crime_bureau') return ROLE_OPTIONS.filter((r) => ['police', 'sjpu', 'ahtu', 'dcrb', 'rpf'].includes(r.value));
  return [];
}

export default function Network() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    role: allowedRoles(user.role)[0]?.value || 'police',
    phone: '',
    org: '',
    state: user.jurisdiction?.state || '',
    district: user.jurisdiction?.district || '',
    station: '',
  });
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [alertBusy, setAlertBusy] = useState(false);
  const [networkAlert, setNetworkAlert] = useState({
    audience: 'all_operational',
    state: user.jurisdiction?.state || '',
    district: user.jurisdiction?.district || '',
    caseRef: '',
    subject: '',
    message: '',
  });
  const roles = allowedRoles(user.role);

  const load = () => {
    api.get('/dashboard/network').then((d) => {
      setUsers(d.users || []);
      setCoverage(d.coverage || null);
    }).catch(() => {});
  };
  useEffect(load, []);

  const grouped = useMemo(() => ORDER
    .map((role) => ({ role, members: users.filter((u) => u.role === role) }))
    .filter((g) => g.members.length), [users]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setAlert = (k) => (e) => setNetworkAlert((f) => ({ ...f, [k]: e.target.value }));
  const waLink = (phone) => `https://wa.me/${String(phone || '').replace(/\D/g, '')}`;

  const provision = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const data = await api.post('/dashboard/network/users', form);
      setOk(`${ROLE_LABELS[data.user.role] || data.user.role} account created for ${data.user.name}. Temporary password: ${data.initialPassword}`);
      setForm((f) => ({ ...f, name: '', email: '', phone: '', org: '', station: '' }));
      load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const sendAlert = async (e) => {
    e.preventDefault();
    setAlertBusy(true);
    setErr('');
    setOk('');
    try {
      const data = await api.post('/dashboard/network/alerts', networkAlert);
      setOk(`Network alert queued for ${data.alert.recipientCount} recipients.`);
      setNetworkAlert((f) => ({ ...f, caseRef: '', subject: '', message: '' }));
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setAlertBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Stakeholder network</h2>
        <p className="text-sm text-gray-500">Provision official accounts, drill down the access pyramid, and reach out directly.</p>
      </div>

      {roles.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          <form onSubmit={provision} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Provision stakeholder account</h3>
                <p className="text-sm text-gray-500">Public signup remains limited to parents/citizens and NGOs.</p>
              </div>
              <button className="btn-primary" disabled={busy}>{busy ? 'Creating...' : 'Create account'}</button>
            </div>
            {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
            {ok && <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div>
                <label className="label">Name</label>
                <input className="field" value={form.name} onChange={set('name')} required />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="field" type="email" value={form.email} onChange={set('email')} required />
              </div>
              <div>
                <label className="label">Role</label>
                <select className="field" value={form.role} onChange={set('role')}>
                  {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">State</label>
                <input className="field" value={form.state} onChange={set('state')} />
              </div>
              <div>
                <label className="label">District</label>
                <input className="field" value={form.district} onChange={set('district')} />
              </div>
              <div>
                <label className="label">Station / post</label>
                <input className="field" value={form.station} onChange={set('station')} />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="field" value={form.phone} onChange={set('phone')} />
              </div>
              <div className="md:col-span-2">
                <label className="label">Organisation</label>
                <input className="field" value={form.org} onChange={set('org')} />
              </div>
            </div>
          </form>

          <form onSubmit={sendAlert} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Network alert</h3>
                <p className="text-sm text-gray-500">Queue a scoped coordination alert to official stakeholders or NGO partners.</p>
              </div>
              <button className="btn-primary" disabled={alertBusy || networkAlert.subject.trim().length < 4 || networkAlert.message.trim().length < 10}>
                {alertBusy ? 'Sending...' : 'Send alert'}
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <label className="label">Audience</label>
                <select className="field" value={networkAlert.audience} onChange={setAlert('audience')}>
                  {ALERT_AUDIENCES.map((audience) => <option key={audience.value} value={audience.value}>{audience.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Case reference</label>
                <input className="field" value={networkAlert.caseRef} onChange={setAlert('caseRef')} placeholder="Khozo / FIR / external ID" />
              </div>
              <div>
                <label className="label">State</label>
                <input className="field" value={networkAlert.state} onChange={setAlert('state')} />
              </div>
              <div>
                <label className="label">District</label>
                <input className="field" value={networkAlert.district} onChange={setAlert('district')} />
              </div>
              <div className="md:col-span-2">
                <label className="label">Subject</label>
                <input className="field" value={networkAlert.subject} onChange={setAlert('subject')} />
              </div>
              <div className="md:col-span-2">
                <label className="label">Message</label>
                <textarea className="field min-h-24" value={networkAlert.message} onChange={setAlert('message')} />
              </div>
            </div>
          </form>
        </div>
      )}

      {coverage && (
        <section className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Stakeholder coverage</h3>
              <p className="text-sm text-gray-500">{coverage.totals.coveragePct}% of required state and district desks are present in {coverage.scope}.</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-lg font-bold text-ink">{coverage.totals.coveredSlots}</p>
                <p className="text-gray-500">Covered</p>
              </div>
              <div className="rounded-lg bg-red-50 px-3 py-2">
                <p className="text-lg font-bold text-red-700">{coverage.totals.missingSlots}</p>
                <p className="text-red-700">Missing</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-lg font-bold text-ink">{coverage.totals.jurisdictions}</p>
                <p className="text-gray-500">Areas</p>
              </div>
            </div>
          </div>

          {coverage.gaps?.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {coverage.gaps.slice(0, 12).map((gap) => (
                <span key={`${gap.jurisdiction}-${gap.role}`} className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                  {gap.jurisdiction}: {gap.label}
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-black/5 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Jurisdiction</th>
                  <th className="px-3 py-2">Level</th>
                  <th className="px-3 py-2">Covered desks</th>
                  <th className="px-3 py-2">Missing desks</th>
                </tr>
              </thead>
              <tbody>
                {coverage.rows.slice(0, 8).map((row) => {
                  const covered = row.roles.filter((role) => role.status === 'covered');
                  const missing = row.roles.filter((role) => role.status === 'missing');
                  return (
                    <tr key={`${row.type}-${row.label}`} className="border-b border-black/5 last:border-0">
                      <td className="px-3 py-3 font-medium text-ink">{row.label}</td>
                      <td className="px-3 py-3 text-gray-500">{row.type}</td>
                      <td className="px-3 py-3 text-gray-600">{covered.map((role) => role.label).join(', ') || '-'}</td>
                      <td className="px-3 py-3">
                        <span className={missing.length ? 'font-semibold text-red-700' : 'text-gray-400'}>
                          {missing.map((role) => role.label).join(', ') || 'None'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {grouped.map((g) => (
        <div key={g.role}>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{ROLE_LABELS[g.role]} / {g.members.length}</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {g.members.map((u) => (
              <div key={u.id} className="card flex flex-col gap-3 p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={u.name} size={44} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{u.name}</p>
                    <p className="truncate text-xs text-gray-500">{u.org || ROLE_LABELS[u.role]}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  {[u.jurisdiction?.station, u.jurisdiction?.district, u.jurisdiction?.state].filter(Boolean).join(', ') || 'National'}
                </p>
                <div className="mt-auto flex gap-2">
                  <a href={`mailto:${u.email || ''}`} className="btn-ghost flex-1 py-1.5 text-xs">Email</a>
                  <a href={waLink(u.phone)} target="_blank" rel="noreferrer" className="btn-ghost flex-1 py-1.5 text-xs">WhatsApp</a>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
