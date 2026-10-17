import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Avatar, roleLabel } from '../lib.jsx';
import { useAuth } from '../auth.jsx';
import { msg, useT } from '../i18n.jsx';

const ORDER = ['super_admin', 'admin', 'state_nodal', 'sara', 'crime_bureau', 'dcrb', 'dlsa', 'police', 'sjpu', 'ahtu', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'ngo', 'parent'];
const ROLE_OPTIONS = [
  { value: 'police', label: msg('Police station') },
  { value: 'sjpu', label: msg('SJPU') },
  { value: 'ahtu', label: msg('AHTU') },
  { value: 'dcrb', label: msg('DCRB') },
  { value: 'dlsa', label: msg('DLSA legal aid') },
  { value: 'cwc', label: msg('CWC') },
  { value: 'dcpu', label: msg('DCPU') },
  { value: 'rpf', label: msg('RPF post') },
  { value: 'cci', label: msg('CCI') },
  { value: 'saa', label: msg('SAA') },
  { value: 'jjb', label: msg('JJB') },
  { value: 'state_nodal', label: msg('State nodal officer') },
  { value: 'sara', label: msg('SARA adoption desk') },
  { value: 'crime_bureau', label: msg('Crime records bureau') },
  { value: 'admin', label: msg('State admin') },
  { value: 'ngo', label: msg('NGO') },
];
const ALERT_AUDIENCES = [
  { value: 'all_operational', label: msg('All operational stakeholders') },
  { value: 'police_rpf', label: msg('Police / SJPU / AHTU / RPF') },
  { value: 'records', label: msg('DCRB / crime records') },
  { value: 'welfare', label: msg('CWC / DCPU / CCI / SAA / JJB / DLSA') },
  { value: 'legal', label: msg('DLSA / legal services') },
  { value: 'adoption', label: msg('SARA / SAA adoption desks') },
  { value: 'ngo', label: msg('NGO partners') },
];

// The coverage report names desks by these same short labels; translate by role.
const DESK_LABELS = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));
const LEVELS = { state: msg('State'), district: msg('District') };

function allowedRoles(role) {
  if (role === 'super_admin') return ROLE_OPTIONS;
  if (['admin', 'state_nodal', 'sara'].includes(role)) return ROLE_OPTIONS.filter((r) => ['police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'sara', 'crime_bureau', 'ngo'].includes(r.value));
  if (role === 'crime_bureau') return ROLE_OPTIONS.filter((r) => ['police', 'sjpu', 'ahtu', 'dcrb', 'rpf'].includes(r.value));
  return [];
}

export default function Network() {
  const t = useT();
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
  const deskLabel = (desk) => (DESK_LABELS[desk.role] ? t(DESK_LABELS[desk.role]) : desk.label);
  const waLink = (phone) => `https://wa.me/${String(phone || '').replace(/\D/g, '')}`;
  // Phones only: a desk can be rung straight from its card.
  const telOf = (phone) => {
    const shown = String(phone || '');
    return /x/i.test(shown) || shown.replace(/\D/g, '').length < 3 ? '' : shown.replace(/[^\d+]/g, '');
  };

  const provision = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const data = await api.post('/dashboard/network/users', form);
      setOk(t('{role} account created for {name}. Temporary password: {password}', {
        role: roleLabel(data.user.role),
        name: data.user.name,
        password: data.initialPassword,
      }));
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
      setOk(data.alert.recipientCount === 1
        ? t('Network alert queued for 1 recipient.')
        : t('Network alert queued for {n} recipients.', { n: data.alert.recipientCount }));
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
        <h2 className="text-2xl font-bold">{t('Stakeholder network')}</h2>
        <p className="text-sm text-gray-500">{t('Provision official accounts, drill down the access pyramid, and reach out directly.')}</p>
      </div>

      {roles.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          <form onSubmit={provision} className="card p-5 max-sm:flex max-sm:flex-col">
            {/* On a phone the button follows the fields it submits. */}
            <div className="flex flex-wrap items-start justify-between gap-3 max-sm:contents">
              <div>
                <h3 className="font-semibold">{t('Provision stakeholder account')}</h3>
                <p className="text-sm text-gray-500">{t('Public signup remains limited to parents/citizens and NGOs.')}</p>
              </div>
              <button className="btn-primary max-sm:order-last max-sm:mt-4" disabled={busy}>{busy ? t('Creating…') : t('Create account')}</button>
            </div>
            {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
            {ok && <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div>
                <label className="label">{t('Name')}</label>
                <input className="field" value={form.name} onChange={set('name')} autoComplete="off" required />
              </div>
              <div>
                <label className="label">{t('Email')}</label>
                <input className="field" type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={form.email} onChange={set('email')} required />
              </div>
              <div>
                <label className="label">{t('Role')}</label>
                <select className="field" value={form.role} onChange={set('role')}>
                  {roles.map((role) => <option key={role.value} value={role.value}>{t(role.label)}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('State')}</label>
                <input className="field" value={form.state} onChange={set('state')} autoComplete="off" />
              </div>
              <div>
                <label className="label">{t('District')}</label>
                <input className="field" value={form.district} onChange={set('district')} autoComplete="off" />
              </div>
              <div>
                <label className="label">{t('Station / post')}</label>
                <input className="field" value={form.station} onChange={set('station')} autoComplete="off" />
              </div>
              <div>
                <label className="label">{t('Phone')}</label>
                <input className="field" type="tel" inputMode="tel" autoComplete="off" value={form.phone} onChange={set('phone')} />
              </div>
              <div className="md:col-span-2">
                <label className="label">{t('Organisation')}</label>
                <input className="field" value={form.org} onChange={set('org')} autoComplete="off" />
              </div>
            </div>
          </form>

          <form onSubmit={sendAlert} className="card p-5 max-sm:flex max-sm:flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3 max-sm:contents">
              <div>
                <h3 className="font-semibold">{t('Network alert')}</h3>
                <p className="text-sm text-gray-500">{t('Queue a scoped coordination alert to official stakeholders or NGO partners.')}</p>
              </div>
              <button className="btn-primary max-sm:order-last max-sm:mt-4" disabled={alertBusy || networkAlert.subject.trim().length < 4 || networkAlert.message.trim().length < 10}>
                {alertBusy ? t('Sending…') : t('Send alert')}
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <label className="label">{t('Audience')}</label>
                <select className="field" value={networkAlert.audience} onChange={setAlert('audience')}>
                  {ALERT_AUDIENCES.map((audience) => <option key={audience.value} value={audience.value}>{t(audience.label)}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('Case reference')}</label>
                <input className="field" value={networkAlert.caseRef} onChange={setAlert('caseRef')} placeholder={t('Khozo / FIR / external ID')} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
              </div>
              <div>
                <label className="label">{t('State')}</label>
                <input className="field" value={networkAlert.state} onChange={setAlert('state')} autoComplete="off" />
              </div>
              <div>
                <label className="label">{t('District')}</label>
                <input className="field" value={networkAlert.district} onChange={setAlert('district')} autoComplete="off" />
              </div>
              <div className="md:col-span-2">
                <label className="label">{t('Subject')}</label>
                <input className="field" value={networkAlert.subject} onChange={setAlert('subject')} autoComplete="off" />
              </div>
              <div className="md:col-span-2">
                <label className="label">{t('Message')}</label>
                <textarea className="field min-h-24" value={networkAlert.message} onChange={setAlert('message')} />
              </div>
            </div>
          </form>
        </div>
      )}

      {coverage && (
        <section className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">{t('Stakeholder coverage')}</h3>
              <p className="text-sm text-gray-500">
                {t('{pct}% of required state and district desks are present in {scope}.', {
                  pct: coverage.totals.coveragePct,
                  scope: coverage.scope,
                })}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-lg font-bold text-ink">{coverage.totals.coveredSlots}</p>
                <p className="text-gray-500">{t('Covered')}</p>
              </div>
              <div className="rounded-lg bg-red-50 px-3 py-2">
                <p className="text-lg font-bold text-red-700">{coverage.totals.missingSlots}</p>
                <p className="text-red-700">{t('Not covered')}</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-lg font-bold text-ink">{coverage.totals.jurisdictions}</p>
                <p className="text-gray-500">{t('Areas')}</p>
              </div>
            </div>
          </div>

          {coverage.gaps?.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {coverage.gaps.slice(0, 12).map((gap) => (
                <span key={`${gap.jurisdiction}-${gap.role}`} className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                  {gap.jurisdiction}: {deskLabel(gap)}
                </span>
              ))}
            </div>
          )}

          <div className="stack-scroll mt-4 overflow-x-auto">
            <table className="stack-table w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-black/5 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">{t('Jurisdiction')}</th>
                  <th className="px-3 py-2">{t('Level')}</th>
                  <th className="px-3 py-2">{t('Covered desks')}</th>
                  <th className="px-3 py-2">{t('Missing desks')}</th>
                </tr>
              </thead>
              <tbody>
                {coverage.rows.slice(0, 8).map((row) => {
                  const covered = row.roles.filter((role) => role.status === 'covered');
                  const missing = row.roles.filter((role) => role.status === 'missing');
                  return (
                    <tr key={`${row.type}-${row.label}`} className="border-b border-black/5 last:border-0">
                      <td className="px-3 py-3 font-medium text-ink" data-label={t('Jurisdiction')}>{row.label}</td>
                      <td className="px-3 py-3 text-gray-500" data-label={t('Level')}>{LEVELS[row.type] ? t(LEVELS[row.type]) : row.type}</td>
                      <td className="stack-full px-3 py-3 text-gray-600" data-label={t('Covered desks')}>{covered.map(deskLabel).join(', ') || '-'}</td>
                      <td className="stack-full px-3 py-3" data-label={t('Missing desks')}>
                        <span className={missing.length ? 'font-semibold text-red-700' : 'text-gray-400'}>
                          {missing.map(deskLabel).join(', ') || t('None')}
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
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{roleLabel(g.role)} / {g.members.length}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {g.members.map((u) => (
              <div key={u.id} className="card flex flex-col gap-3 p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={u.name} size={44} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{u.name}</p>
                    <p className="truncate text-xs text-gray-500">{u.org || roleLabel(u.role)}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  {[u.jurisdiction?.station, u.jurisdiction?.district, u.jurisdiction?.state].filter(Boolean).join(', ') || t('National')}
                </p>
                <div className="mt-auto flex gap-2">
                  <a href={`mailto:${u.email || ''}`} className="btn-ghost flex-1 py-1.5 text-xs">{t('Email')}</a>
                  <a href={waLink(u.phone)} target="_blank" rel="noreferrer" className="btn-ghost flex-1 py-1.5 text-xs">WhatsApp</a>
                  {telOf(u.phone) && <a href={`tel:${telOf(u.phone)}`} className="btn-ghost flex-1 py-1.5 text-xs sm:hidden">{t('Call')}</a>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
