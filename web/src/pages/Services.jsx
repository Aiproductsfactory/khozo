import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Logo } from '../components.jsx';
import { asList, ROLE_LABELS, roleLabel, txt } from '../lib.jsx';
import { useT, msg, LanguageSwitcher } from '../i18n.jsx';
import { useDisplay } from '../useDisplay.js';

const ROLE_FILTERS = [
  { value: '', label: msg('All services') },
  { value: 'police', label: msg('Police') },
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
  { value: 'state_nodal', label: msg('State nodal') },
  { value: 'sara', label: 'SARA' },
];
const INCIDENT_TYPES = [
  { value: 'missing_child', label: msg('Missing child') },
  { value: 'immediate_danger', label: msg('Immediate danger') },
  { value: 'welfare', label: msg('Shelter / welfare') },
  { value: 'railway', label: msg('Railway sighting') },
];

/*
 * The directory endpoint answers with a fixed set of English labels and
 * instructions (shared/routes/dashboard.js: PUBLIC_EMERGENCY_CONTACTS and
 * PUBLIC_INCIDENT_ROUTES). They are listed here so the dictionaries carry
 * them and t() can translate them at render; anything else the server sends
 * falls back to itself.
 */
// eslint-disable-next-line no-unused-vars
const SERVER_TEXT = [
  msg('Childline'),
  msg('Police emergency'),
  msg('Railway helpline'),
  msg('Shelter or welfare support'),
  msg('Railway or station sighting'),
  msg('Call 1098 first for child-protection intake; call 112 immediately if there is active danger.'),
  msg('Call 112 first for emergency response, then 1098 for child-protection support.'),
  msg('Call 1098 for child welfare support and use local CWC/DCPU/DLSA/SAA desks for follow-up.'),
  msg('Call 139 for railway response; use 1098/112 based on protection or emergency need.'),
];

const STATE_SERVICE = 'State service';

/*
 * The directory lists desks, not people: each entry is { role, roleLabel,
 * org, state, district } and carries no officer's name, phone number or
 * account id. deskOf() reads only those fields — an older server that still
 * sent a name or a number has them ignored here, not shown — and turns
 * anything that is not text into ''.
 */
function deskOf(row) {
  if (!row || typeof row !== 'object') return null;
  const desk = {
    role: txt(row.role),
    roleLabel: txt(row.roleLabel),
    org: txt(row.org),
    state: txt(row.state) || txt(row.jurisdiction?.state),
    district: txt(row.district) || txt(row.jurisdiction?.district),
  };
  return desk.role || desk.org ? desk : null;
}

const desks = (value) => asList(value).map(deskOf).filter(Boolean);
const deskKey = (desk, i) => [desk.role, desk.org, desk.district, desk.state, i].join('|');

/** The helplines (1098, 112, 139, 181): a label and a public number. */
const helplines = (value) => asList(value)
  .filter((item) => item && typeof item === 'object' && txt(item.phone))
  .map((item) => ({ label: txt(item.label), phone: txt(item.phone) }));

export default function Services() {
  const t = useT();
  const d = useDisplay();
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
      .then((data) => {
        setRows(desks(data?.directory));
        setEmergency(helplines(data?.emergency));
        const plan = data?.emergencyPlan && typeof data.emergencyPlan === 'object' ? data.emergencyPlan : null;
        setEmergencyPlan(plan
          ? {
              label: txt(plan.label),
              instructions: txt(plan.instructions),
              primary: helplines([plan.primary])[0] || null,
              secondary: helplines(plan.secondary),
              localDesks: desks(plan.localContacts),
            }
          : null);
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
    for (const desk of rows) {
      const key = [desk.district, desk.state].filter(Boolean).join('\u0000') || STATE_SERVICE;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(desk);
    }
    return [...map.entries()];
  }, [rows]);

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const phoneLink = (phone) => (phone ? `tel:${String(phone).replace(/[^\d+]/g, '')}` : null);
  // A desk's role in the reader's language: our own label when the role is
  // known, else the server's label, else nothing.
  const deskRole = (desk) => (ROLE_LABELS[desk.role] ? roleLabel(desk.role) : t(desk.roleLabel) || '');
  const deskPlace = (desk) => d.places(desk.district, desk.state) || t(STATE_SERVICE);
  const placeLabel = (key) => (key === STATE_SERVICE ? t(STATE_SERVICE) : d.places(...key.split('\u0000')));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-3 sm:flex-wrap sm:gap-3 sm:px-6 sm:py-5">
          <Logo />
          <div className="flex items-center gap-1 sm:flex-wrap sm:gap-2">
            <LanguageSwitcher />
            <Link to="/report" className="btn-primary hidden sm:inline-flex">{t('Submit sighting')}</Link>
            <Link to="/track-sighting" className="btn-ghost hidden sm:inline-flex">{t('Track a report I made')}</Link>
            <Link to="/" className="btn-ghost">{t('Home')}</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-khozo">{t('Child-protection directory')}</p>
            <h1 className="mt-1 text-3xl font-bold text-ink">{t('Find a local response desk')}</h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-500">
              {t('Public contact points for police, SJPU, AHTU, DCRB, DLSA, CWC, DCPU, railway, CCI, SAA, JJB, state nodal, and SARA services. Account emails and internal user details are not listed here.')}
            </p>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              {t('Desks are listed, not people. To reach one, call the helplines below or contact the local administration.')}
            </p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); load(); }} className="grid w-full grid-cols-2 gap-2 md:w-auto md:grid-cols-[150px_170px_150px_170px_auto]">
            <input className="field" autoComplete="address-level1" aria-label={t('State')} value={filters.state} onChange={set('state')} placeholder={t('State')} />
            <input className="field" autoComplete="address-level2" aria-label={t('District')} value={filters.district} onChange={set('district')} placeholder={t('District')} />
            <select className="field col-span-2 md:col-span-1" value={filters.role} onChange={set('role')} aria-label={t('All services')}>
              {ROLE_FILTERS.map((role) => <option key={role.value} value={role.value}>{t(role.label)}</option>)}
            </select>
            <select className="field col-span-2 md:col-span-1" value={filters.incidentType} onChange={set('incidentType')}>
              {INCIDENT_TYPES.map((type) => <option key={type.value} value={type.value}>{t(type.label)}</option>)}
            </select>
            <button className="btn-primary col-span-2 md:col-span-1">{t('Search')}</button>
          </form>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
          <section className="rounded-lg bg-white p-4 ring-1 ring-black/5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('Emergency routing')}</p>
                <h2 className="mt-1 text-lg font-bold text-ink">{emergencyPlan?.label ? t(emergencyPlan.label) : t('Missing child')}</h2>
                <p className="mt-1 max-w-2xl text-sm text-gray-500">{emergencyPlan?.instructions ? t(emergencyPlan.instructions) : null}</p>
              </div>
              {emergencyPlan?.primary && (
                <a href={phoneLink(emergencyPlan.primary.phone)} className="btn-primary">
                  {t('Call {phone}', { phone: emergencyPlan.primary.phone })}
                </a>
              )}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {emergencyPlan?.primary && (
                <a href={phoneLink(emergencyPlan.primary.phone)} className="rounded-lg border border-khozo/20 bg-khozo-light p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-khozo">{t('Primary')}</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{t(emergencyPlan.primary.label)}</p>
                  <p className="text-2xl font-bold text-ink">{emergencyPlan.primary.phone}</p>
                </a>
              )}
              <div className="rounded-lg border border-black/5 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('Backup numbers')}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(emergencyPlan?.secondary?.length ? emergencyPlan.secondary : emergency).map((item) => (
                    <a key={item.phone} href={phoneLink(item.phone)} className="inline-flex min-h-11 items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-ink ring-1 ring-black/5 hover:bg-khozo-light">
                      {t(item.label)} {item.phone}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-lg bg-white p-4 ring-1 ring-black/5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('Local desks for this route')}</p>
            <div className="mt-3 space-y-3">
              {(emergencyPlan?.localDesks || []).slice(0, 4).map((desk, i) => (
                <div key={deskKey(desk, i)} className="border-b border-black/5 pb-3 last:border-0 last:pb-0">
                  <p className="text-sm font-semibold text-ink">{desk.org || deskRole(desk)}</p>
                  <p className="text-xs text-gray-500">{[desk.org ? deskRole(desk) : '', deskPlace(desk)].filter(Boolean).join(' · ')}</p>
                </div>
              ))}
              {!loading && (emergencyPlan?.localDesks || []).length === 0 && (
                <p className="text-sm text-gray-400">{t('No local desk matches this incident and filter.')}</p>
              )}
            </div>
          </section>
        </div>

        <div className="mt-8 space-y-6">
          {grouped.map(([place, members]) => (
            <section key={place}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{placeLabel(place)}</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {members.map((desk, i) => (
                  <div key={deskKey(desk, i)} className="rounded-xl bg-white p-4 ring-1 ring-black/5">
                    <p className="font-semibold text-ink">{desk.org || deskRole(desk)}</p>
                    {desk.org && <p className="text-xs text-gray-500">{deskRole(desk)}</p>}
                    <p className="mt-3 text-xs text-gray-500">{deskPlace(desk)}</p>
                    <p className="mt-2 text-sm font-semibold text-khozo">{t('Contact via local administration')}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {!loading && grouped.length === 0 && (
            <div className="rounded-xl bg-white px-4 py-10 text-center text-gray-400 ring-1 ring-black/5">
              {t('No public service contacts match this filter.')}
            </div>
          )}
          {loading && (
            <div className="rounded-xl bg-white px-4 py-10 text-center text-gray-400 ring-1 ring-black/5">
              {t('Loading service directory...')}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
