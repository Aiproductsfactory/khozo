import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Avatar, asList, fmtDate, genderLabel, personCategoryOf, PERSON_CATEGORY_OPTIONS,
  roleLabel, StatusBadge, timeAgo, txt,
} from '../lib.jsx';
import { msg, useT } from '../i18n.jsx';
import { useDisplay } from '../useDisplay.js';
import { useBackClose } from '../useBackClose.js';
import { photoNeedOf } from '../../../shared/photo-need.js';

/*
 * What is behind a figure on the Overview. An officer who sees "220 still
 * missing" asks next: since when, from which station, how many have no photo
 * to match against. Each figure opens this sheet with the same records the
 * figure counts, broken down, and each record one tap from its case.
 *
 * Nothing here is new data: the case register and the sighting queue are the
 * lists Cases and Matches already fetch for this officer (scoped by the API),
 * and the alerts, roster and CCI register are what the Overview has loaded.
 */

const DAY = 86400000;
const PAGE = 50;
const TOP = 6;

const timeOf = (value) => {
  const n = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * The police station a case belongs to: recorded on a transferred case; the
 * Gujarat Police import names it in the circumstances ("Police station:
 * Narol (નારોલ).") and in the FIR reference ("Narol P.S. Cr. No. …").
 */
function stationOf(r) {
  const own = txt(r?.station);
  if (own) return own;
  const said = /Police station:\s*([^(.]+?)\s*[(.]/i.exec([txt(r?.vulnerabilityProfile?.circumstances), txt(r?.circumstances)].join(' '));
  if (said && said[1] !== 'undefined') return said[1].trim();
  const fir = txt(r?.firNo);
  const en = /^(.+?)\s+P\.\s?S\./i.exec(fir);
  if (en) return en[1].trim();
  const gu = /^(.+?)\s*પો\.\s?સ્ટે/.exec(fir);
  if (gu) return gu[1].trim();
  return '';
}

const MISSING_FOR = [
  ['m1', msg('Under 1 month')],
  ['m6', msg('1 to 6 months')],
  ['y1', msg('6 to 12 months')],
  ['y5', msg('1 to 5 years')],
  ['y5p', msg('Over 5 years')],
  ['nr', msg('Date not recorded')],
];
function missingForKey(r, now) {
  const at = timeOf(r.dateOfMissing);
  if (at == null) return 'nr';
  const days = (now - at) / DAY;
  if (days < 30) return 'm1';
  if (days < 183) return 'm6';
  if (days < 365) return 'y1';
  if (days < 1826) return 'y5';
  return 'y5p';
}

const AGE_BANDS = [
  ['a5', msg('5 or under')],
  ['a11', msg('6 to 11')],
  ['a14', msg('12 to 14')],
  ['a17', msg('15 to 17')],
  ['a18', msg('18 or over')],
  ['nr', msg('Not recorded')],
];
function ageKey(r) {
  const age = Number(r.age);
  if (r.age == null || r.age === '' || !Number.isFinite(age)) return 'nr';
  if (age <= 5) return 'a5';
  if (age <= 11) return 'a11';
  if (age <= 14) return 'a14';
  if (age <= 17) return 'a17';
  return 'a18';
}

const STATUS_ORDER = [
  ['missing', msg('Missing')],
  ['under_review', msg('Under review')],
  ['intake_pending', msg('Waiting to be checked')],
  ['found', msg('Found')],
  ['closed', msg('Closed')],
];

const ALERT_TYPES = [
  ['case_overdue', msg('Open 30 days or more')],
  ['case_no_recent_update', msg('No note for 14 days or more')],
  ['pending_sighting', msg('Sighting waiting 2 days or more')],
  ['intake_overdue', msg('Family report waiting over 24 hours')],
  ['formal', msg('Statutory record due')],
];
const PRIORITY = [['high', msg('high')], ['medium', msg('medium')], ['low', msg('low')]];

// Why a case's photo will not find the person (shared/photo-need.js).
const PHOTO_NEED = [
  ['no_photo', msg('No photo')],
  ['no_face', msg('No face found')],
  ['group', msg('Group photo')],
  ['weak', msg('Face small or unclear')],
  ['ok', msg('No problem found')],
];
const PHOTO_NEED_LABEL = Object.fromEntries(PHOTO_NEED);
const PHOTO_ADVICE = msg('Ask the family for a recent, clear photo of the face alone, and replace it from the case.');
const isOpen = (r) => r.status === 'missing' || r.status === 'under_review';

const REVIEW_STATUS = [
  ['overdue', msg('Review overdue')],
  ['due_soon', msg('Review due within 7 days')],
  ['scheduled', msg('Review scheduled')],
  ['not_scheduled', msg('No review date')],
];

/**
 * The breakdowns a sheet can show. `order` fixes the buckets and their
 * labels; without it the buckets are the values found, largest first.
 */
function groupSpecs({ t, d, now, rows }) {
  const byStation = rows.some((r) => stationOf(r));
  const place = (r) => txt(r.district) || txt(r.districtText) || '';
  return {
    missingFor: { title: msg('How long missing'), order: MISSING_FOR, of: (r) => missingForKey(r, now) },
    place: byStation
      ? { title: msg('By police station'), of: stationOf, label: (id) => (id ? d(id) : t('Not recorded')) }
      : { title: msg('By district'), of: place, label: (id) => (id ? d.place(id) : t('Not recorded')) },
    status: { title: msg('By status'), order: STATUS_ORDER, of: (r) => r.status },
    gender: { title: msg('By gender'), of: (r) => txt(r.gender), label: (id) => (id ? genderLabel(id) : t('Not recorded')) },
    age: { title: msg('Age'), order: AGE_BANDS, of: ageKey },
    photo: {
      title: msg('Photo for matching'),
      note: PHOTO_ADVICE,
      order: PHOTO_NEED,
      of: (r) => photoNeedOf(r) || 'ok',
    },
    who: { title: msg('Who is missing'), order: PERSON_CATEGORY_OPTIONS.map((o) => [o.id, o.label]), of: personCategoryOf, hideSingle: true },
    closure: {
      title: msg('How it ended'),
      of: (r) => (r.status === 'found' ? '~found' : txt(r.closure?.label) || txt(r.closureLabel)),
      label: (id) => (id === '~found' ? t('Marked found') : id || t('Not recorded')),
    },
    waited: {
      title: msg('Waiting'),
      order: [['under', msg('Under 24 hours')], ['over', msg('Over 24 hours')]],
      of: (r) => (now - (timeOf(r.createdAt) ?? now) > DAY ? 'over' : 'under'),
    },
    hasMatch: {
      title: msg('Possible match'),
      order: [['yes', msg('With a possible match')], ['no', msg('No possible match yet')]],
      of: (f) => (f.matchedReportId ? 'yes' : 'no'),
    },
    sightingWait: {
      title: msg('Waiting'),
      order: [['d2', msg('Under 2 days')], ['d7', msg('2 to 7 days')], ['d7p', msg('Over 7 days')]],
      of: (f) => {
        const days = (now - (timeOf(f.createdAt) ?? now)) / DAY;
        return days < 2 ? 'd2' : days < 7 ? 'd7' : 'd7p';
      },
    },
    sightingPlace: { title: msg('By district'), of: place, label: (id) => (id ? d.place(id) : t('Not recorded')) },
    alertType: {
      title: msg('Why'),
      order: ALERT_TYPES,
      of: (a) => (ALERT_TYPES.some(([id]) => id === a.type) ? a.type : 'formal'),
    },
    priority: { title: msg('Priority'), order: PRIORITY, of: (a) => a.priority },
    role: { title: msg('By role'), of: (u) => txt(u.role), label: (id) => roleLabel(id) || t('Not recorded') },
    userPlace: {
      title: msg('By district'),
      of: (u) => txt(u.jurisdiction?.district),
      label: (id) => (id ? d.place(id) : t('State level')),
    },
    institution: { title: msg('By institution'), of: (r) => txt(r.cciName), label: (id) => id || t('Not recorded') },
    review: { title: msg('Care review'), order: REVIEW_STATUS, of: (r) => r.reviewStatus },
  };
}

const KINDS = {
  active: {
    source: 'reports',
    explain: msg('Cases in {scope} whose status is Missing or Under review.'),
    pick: (rows) => rows.filter(isOpen),
    groups: ['missingFor', 'place', 'status', 'gender', 'age', 'photo', 'who'],
    sort: (a, b) => (timeOf(b.dateOfMissing) ?? 0) - (timeOf(a.dateOfMissing) ?? 0),
    sortNote: msg('Most recently missing first'),
    row: 'case',
    to: '/app/cases',
    toLabel: msg('Open in Cases & FIRs'),
    empty: msg('No case in {scope} is open.'),
  },
  photos: {
    source: 'reports',
    explain: msg('Open cases in {scope} whose photo is unlikely to find the person in a sighting: no photo, no face in it, a group photo, or a face too small or unclear.'),
    advice: PHOTO_ADVICE,
    pick: (rows) => rows.filter((r) => isOpen(r) && photoNeedOf(r)),
    groups: ['photo', 'place', 'missingFor'],
    sort: (a, b) => (timeOf(b.dateOfMissing) ?? 0) - (timeOf(a.dateOfMissing) ?? 0),
    sortNote: msg('Most recently missing first'),
    row: 'case',
    rowNote: (r) => PHOTO_NEED_LABEL[photoNeedOf(r)],
    to: '/app/cases',
    toLabel: msg('Open in Cases & FIRs'),
    empty: msg('No open case in {scope} needs a better photo.'),
  },
  reunited: {
    source: 'reports',
    explain: msg('Cases in {scope} marked found (a sighting confirmed, or a recovery recorded) or closed.'),
    pick: (rows) => rows.filter((r) => r.status === 'found' || r.status === 'closed'),
    groups: ['status', 'closure', 'place', 'gender', 'who'],
    sort: (a, b) => (timeOf(b.closedAt ?? b.updatedAt) ?? 0) - (timeOf(a.closedAt ?? a.updatedAt) ?? 0),
    sortNote: msg('Most recent first'),
    row: 'case',
    to: '/app/cases?status=found',
    toLabel: msg('Open in Cases & FIRs'),
    empty: msg('No case in {scope} has been marked found or closed yet. A case moves here when an officer confirms a sighting or records a recovery.'),
  },
  intakes: {
    source: 'reports',
    explain: msg('Reports from families and NGOs. Matching with sightings starts only after an officer verifies one.'),
    pick: (rows) => rows.filter((r) => r.status === 'intake_pending'),
    groups: ['waited', 'place', 'who'],
    sort: (a, b) => (timeOf(a.createdAt) ?? 0) - (timeOf(b.createdAt) ?? 0),
    sortNote: msg('Longest waiting first'),
    row: 'case',
    to: '/app/cases?status=intake_pending',
    toLabel: msg('Open in Cases & FIRs'),
    empty: msg('No report is waiting for verification.'),
  },
  sightings: {
    source: 'sightings',
    explain: msg('Photos sent by the public that no officer has decided on yet.'),
    pick: (rows) => rows.filter((f) => f.status === 'pending_review'),
    groups: ['hasMatch', 'sightingWait', 'sightingPlace'],
    sort: (a, b) => (timeOf(a.createdAt) ?? 0) - (timeOf(b.createdAt) ?? 0),
    sortNote: msg('Longest waiting first'),
    row: 'sighting',
    to: '/app/matches',
    toLabel: msg('Open in Matches'),
    empty: msg('No sighting is waiting for review.'),
  },
  alerts: {
    source: 'alerts',
    explain: msg('Cases open 30 days or more, or with no note for 14 days, counted from when the case was registered on Khozo; sightings waiting 2 days or more; family reports waiting more than 24 hours; and statutory records due.'),
    pick: (rows) => rows,
    groups: ['alertType', 'priority'],
    row: 'alert',
    to: '/app/cases',
    toLabel: msg('Open in Cases & FIRs'),
    empty: msg('Nothing is overdue.'),
  },
  network: {
    source: 'network',
    explain: msg('Officer and agency accounts in {scope}.'),
    pick: (rows) => rows,
    groups: ['role', 'userPlace'],
    sort: (a, b) => txt(a.name).localeCompare(txt(b.name)),
    row: 'user',
    to: '/app/network',
    toLabel: msg('Open the network'),
    empty: msg('No account in {scope} yet.'),
  },
  cci: {
    source: 'cci',
    explain: msg('Children recorded in a child care institution in {scope}.'),
    pick: (rows) => rows,
    groups: ['review', 'institution'],
    row: 'cci',
    to: '/app/cci-register',
    toLabel: msg('Open the CCI register'),
    empty: msg('No child in this list.'),
  },
};

function buildGroup(spec, rows, t) {
  const counts = new Map();
  for (const row of rows) {
    const key = spec.of(row) ?? '';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const buckets = spec.order
    ? spec.order.filter(([id]) => counts.get(id)).map(([id, label]) => ({ id, label: t(label), count: counts.get(id) }))
    : [...counts].map(([id, count]) => ({ id, label: spec.label ? spec.label(id) : id, count }))
      .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
  return { ...spec, buckets };
}

function Group({ group, active, onPick }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...group.buckets.map((b) => b.count));
  const shown = all ? group.buckets : group.buckets.slice(0, TOP);
  return (
    <section className="rounded-xl bg-gray-50/80 p-3 ring-1 ring-black/5">
      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">{t(group.title)}</h4>
      {group.note && <p className="mt-0.5 text-[11px] text-gray-500">{t(group.note)}</p>}
      <ul className="mt-2 space-y-1">
        {shown.map((b) => {
          const on = active === b.id;
          return (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => onPick(on ? null : b.id)}
                aria-pressed={on}
                className={`relative block w-full overflow-hidden rounded-lg px-2 py-1.5 text-left text-sm transition ${on ? 'bg-khozo-light ring-1 ring-khozo/50' : 'hover:bg-white'}`}
              >
                <span aria-hidden="true" className={`absolute inset-y-0 left-0 ${on ? 'bg-khozo/25' : 'bg-khozo/10'}`} style={{ width: `${(b.count / max) * 100}%` }} />
                <span className="relative flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-gray-700 first-letter:uppercase">{b.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-ink">{b.count.toLocaleString('en-IN')}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {group.buckets.length > TOP && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 px-2 text-xs font-semibold text-khozo-dark hover:underline">
          {all ? t('Show fewer') : t('Show all {n}', { n: group.buckets.length })}
        </button>
      )}
    </section>
  );
}

function CaseRow({ r, note }) {
  const t = useT();
  const d = useDisplay();
  const category = personCategoryOf(r);
  const where = stationOf(r) ? d(stationOf(r)) : d.places(r.district || r.districtText, r.state);
  const who = [genderLabel(txt(r.gender), category), txt(r.age) && t('age {n}', { n: txt(r.age) })].filter(Boolean).join(', ');
  return (
    <Link to={`/app/cases?id=${encodeURIComponent(r.id)}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-gray-50">
      <Avatar name={d(r.childName)} src={r.photoUrl} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold capitalize text-ink">{d(r.childName) || r.id}</span>
        <span className="block truncate text-xs text-gray-500">{[who, where].filter(Boolean).join(' · ') || r.id}</span>
        {note && <span className="block truncate text-xs font-semibold text-amber-700">{note}</span>}
      </span>
      <span className="shrink-0 text-right">
        <StatusBadge status={r.status} />
        <span className="mt-1 block text-[11px] text-gray-500">
          {r.status === 'intake_pending' ? timeAgo(r.createdAt) : fmtDate(r.dateOfMissing)}
        </span>
      </span>
    </Link>
  );
}

function SightingRow({ f }) {
  const t = useT();
  const d = useDisplay();
  const matched = f.matchedReport && typeof f.matchedReport === 'object' ? f.matchedReport : null;
  const photo = txt(f.photoUrl) || (txt(f.photoFile) ? `/api/reports/photo/${f.id}` : '');
  return (
    <Link to={`/app/matches?id=${encodeURIComponent(f.id)}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-gray-50">
      <Avatar name={t('Sighting')} src={photo} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{txt(f.geoAddress) || d(f.foundLocation) || t('Place not given')}</span>
        <span className="block truncate text-xs text-gray-500">
          {matched
            ? t('Possible match: {name} · {pct}%', { name: d(matched.childName) || txt(matched.id), pct: Math.round((Number(f.matchScore) || 0) * 100) })
            : t('No possible match yet')}
        </span>
      </span>
      <span className="shrink-0 text-xs text-gray-500">{timeAgo(f.createdAt)}</span>
    </Link>
  );
}

function AlertRow({ a }) {
  const t = useT();
  const to = a.reportId
    ? `/app/cases?id=${encodeURIComponent(a.reportId)}`
    : a.foundReportId ? `/app/matches?id=${encodeURIComponent(a.foundReportId)}` : '/app/cases';
  const priority = PRIORITY.find(([id]) => id === a.priority);
  return (
    <Link to={to} className="-mx-2 flex items-start justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-gray-50">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">
          {a.type === 'intake_overdue'
            ? t('Report {id} waiting {h} hours for verification', { id: txt(a.reportId), h: Number(a.ageHours) || 0 })
            : txt(a.title)}
        </span>
        <span className="block text-xs text-gray-500">{txt(a.detail)}</span>
      </span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${a.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
        {priority ? t(priority[1]) : txt(a.priority)}
      </span>
    </Link>
  );
}

function UserRow({ u }) {
  const d = useDisplay();
  const where = d.places(u.jurisdiction?.station, u.jurisdiction?.district, u.jurisdiction?.state);
  return (
    <Link to="/app/network" className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-gray-50">
      <Avatar name={txt(u.name)} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{txt(u.name)}</span>
        <span className="block truncate text-xs text-gray-500">{[roleLabel(u.role), txt(u.org), where].filter(Boolean).join(' · ')}</span>
      </span>
    </Link>
  );
}

function CciRow({ r }) {
  const t = useT();
  const d = useDisplay();
  const review = REVIEW_STATUS.find(([id]) => id === r.reviewStatus);
  return (
    <Link to={`/app/cases?id=${encodeURIComponent(r.reportId)}`} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-gray-50">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold capitalize text-ink">{d(r.childName) || txt(r.reportId)}</span>
        <span className="block truncate text-xs text-gray-500">{txt(r.cciName)}</span>
      </span>
      <span className="shrink-0 text-right text-xs">
        <span className={`block font-semibold ${r.reviewStatus === 'overdue' ? 'text-red-700' : 'text-gray-700'}`}>{review ? t(review[1]) : ''}</span>
        <span className="block text-gray-500">{fmtDate(r.nextReviewDate)}</span>
      </span>
    </Link>
  );
}

const ROWS = { case: CaseRow, sighting: SightingRow, alert: AlertRow, user: UserRow, cci: CciRow };
const ROW_PROP = { case: 'r', sighting: 'f', alert: 'a', user: 'u', cci: 'r' };

/**
 * The sheet. `detail` is { kind, filter?, label, value }; `load(source)`
 * resolves a list the page fetches on demand (and keeps); `lists` holds the
 * ones the Overview already has ({ alerts, network, cci }, null where that
 * request failed or was not made).
 */
export default function OverviewDetail({ detail, scope, load, lists, onClose }) {
  const t = useT();
  const d = useDisplay();
  const kind = KINDS[detail.kind];
  const [state, setState] = useState({ loading: true, rows: [], error: '' });
  const [attempt, setAttempt] = useState(0);
  const [pick, setPick] = useState(null); // { group, bucket }
  const [limit, setLimit] = useState(PAGE);
  useBackClose(true, onClose);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    const ready = kind.source in lists ? Promise.resolve(lists[kind.source]) : load(kind.source);
    ready
      .then((rows) => {
        if (!alive) return;
        if (rows == null) throw new Error(t('This list could not load.'));
        setState({ loading: false, rows: asList(rows).filter((row) => row && typeof row === 'object'), error: '' });
      })
      .catch((e) => alive && setState({ loading: false, rows: [], error: txt(e?.message) || t('This list could not load.') }));
    return () => { alive = false; };
  }, [detail.kind, attempt]);

  const now = Date.now();
  const picked = useMemo(() => {
    let rows = kind.pick(state.rows);
    if (detail.filter) rows = rows.filter(detail.filter);
    return kind.sort ? [...rows].sort(kind.sort) : rows;
  }, [state.rows, detail]);

  const groups = useMemo(() => {
    const specs = groupSpecs({ t, d, now, rows: picked });
    return kind.groups
      .map((id) => ({ id, ...buildGroup(specs[id], picked, t) }))
      // A sheet that already gives the advice does not repeat it in a group.
      .map((g) => (kind.advice && g.note === kind.advice ? { ...g, note: null } : g))
      .filter((g) => g.buckets.length > 0 && !(g.hideSingle && g.buckets.length < 2));
  }, [picked, t]);

  const pickedGroup = pick && groups.find((g) => g.id === pick.group);
  const listed = pickedGroup ? picked.filter((row) => (pickedGroup.of(row) ?? '') === pick.bucket) : picked;
  const pickedLabel = pickedGroup?.buckets.find((b) => b.id === pick.bucket)?.label;
  const Row = ROWS[kind.row];
  const prop = ROW_PROP[kind.row];

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/30" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={detail.label}
        className="animate-sheet-in flex h-full w-full max-w-xl flex-col bg-white shadow-xl sm:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-500">{detail.label}</p>
            <p className="text-3xl font-bold tracking-tight">{detail.value}</p>
            <p className="mt-1 text-xs text-gray-500">{t(kind.explain, { scope })}</p>
            {kind.advice && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200">{t(kind.advice)}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close')}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-gray-500 hover:bg-gray-100 hover:text-ink"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {state.loading && <p className="text-sm text-gray-400">{t('Loading…')}</p>}

          {!state.loading && state.error && (
            <div className="rounded-xl bg-red-50 p-4 ring-1 ring-red-100">
              <p className="text-sm text-red-800">{state.error}</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="btn-ghost mt-3 py-1.5 text-xs">{t('Try again')}</button>
            </div>
          )}

          {!state.loading && !state.error && picked.length === 0 && (
            <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-600 ring-1 ring-black/5">{t(kind.empty, { scope })}</p>
          )}

          {!state.loading && !state.error && picked.length > 0 && (
            <>
              {groups.length > 0 && (
                <>
                  <p className="mb-2 text-xs text-gray-500">{t('Tap a line to list only those records.')}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {groups.map((g) => (
                      <Group
                        key={g.id}
                        group={g}
                        active={pick?.group === g.id ? pick.bucket : undefined}
                        onPick={(bucket) => { setPick(bucket == null ? null : { group: g.id, bucket }); setLimit(PAGE); }}
                      />
                    ))}
                  </div>
                </>
              )}

              <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">
                  {listed.length === 1 ? t('1 record') : t('{n} records', { n: listed.length.toLocaleString('en-IN') })}
                  {kind.sortNote && <span className="font-normal text-gray-500"> · {t(kind.sortNote)}</span>}
                </h4>
                {pickedLabel != null && (
                  <button
                    type="button"
                    onClick={() => setPick(null)}
                    className="inline-flex items-center gap-1 rounded-full bg-khozo-light px-2.5 py-1 text-xs font-semibold text-khozo-dark ring-1 ring-khozo/30 hover:bg-khozo-light/70"
                  >
                    {t(pickedGroup.title)}: {pickedLabel}
                    <span aria-hidden="true">×</span>
                    <span className="sr-only">{t('Clear filter')}</span>
                  </button>
                )}
              </div>
              <ul className="mt-1 divide-y divide-black/5">
                {listed.slice(0, limit).map((row, i) => (
                  <li key={txt(row.id) || i}><Row {...{ [prop]: row }} note={kind.rowNote ? t(kind.rowNote(row)) : null} /></li>
                ))}
              </ul>
              {listed.length > limit && (
                <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="btn-ghost mt-3 w-full py-2 text-xs">
                  {t('Show {n} more', { n: Math.min(PAGE, listed.length - limit) })}
                </button>
              )}
            </>
          )}
        </div>

        <div className="safe-bottom border-t border-black/5 px-4 py-3 sm:px-6">
          <Link to={kind.to} className="btn-primary w-full text-center">{t(kind.toLabel)}</Link>
        </div>
      </div>
    </div>
  );
}
