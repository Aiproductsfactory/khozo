// Shared formatting + small presentational helpers.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { currentLocale, msg, t, useT } from './i18n.jsx';
import { txt } from './safeText.js';

export { txt, txtList, asList } from './safeText.js';

export const ROLE_LABELS = {
  super_admin: msg('Super Admin'),
  admin: msg('Admin (ACP)'),
  police: msg('Police Station'),
  sjpu: msg('Special Juvenile Police Unit'),
  ahtu: msg('Anti Human Trafficking Unit'),
  dcrb: msg('District Crime Records Bureau'),
  dlsa: msg('District Legal Services Authority'),
  cwc: msg('Child Welfare Committee'),
  dcpu: msg('DCPU'),
  rpf: msg('Railway Protection Force'),
  cci: msg('Child Care Institution'),
  saa: msg('Specialised Adoption Agency'),
  jjb: msg('Juvenile Justice Board'),
  state_nodal: msg('State Nodal Officer'),
  sara: msg('State Adoption Resource Agency'),
  crime_bureau: msg('Crime Records Bureau'),
  parent: msg('Parent / Public'),
  ngo: msg('NGO'),
};

export const ROLE_TAGLINE = {
  super_admin: msg('State Govt / Police Commissioner'),
  admin: msg('Asst. Commissioner of Police - jurisdiction view'),
  police: msg('Police Station - register FIRs and confirm matches'),
  sjpu: msg('Special Juvenile Police Unit - child-friendly police response and FIR coordination'),
  ahtu: msg('Anti Human Trafficking Unit - trafficking-risk investigation and rescue coordination'),
  dcrb: msg('District crime records bureau - district records linkage and alerts'),
  dlsa: msg('District Legal Services Authority - legal aid, compensation, and court-support follow-up'),
  cwc: msg('Child Welfare Committee - review sightings and child-protection referrals'),
  dcpu: msg('District Child Protection Unit - monitor child-protection cases'),
  rpf: msg('Railway Protection Force - review railway-area sightings'),
  cci: msg('Child Care Institution - intake and care oversight for children in shelter'),
  saa: msg('Specialised Adoption Agency - adoption follow-up and CARINGS coordination'),
  jjb: msg('Juvenile Justice Board - district oversight for child-protection cases'),
  state_nodal: msg('State child-protection nodal officer - statewide monitoring'),
  sara: msg('State Adoption Resource Agency - statewide adoption oversight and SAA coordination'),
  crime_bureau: msg('Crime records bureau - statewide missing-child records oversight'),
  parent: msg('Report your missing child and track its status'),
  ngo: msg('Assist the community - report and register children'),
};

/**
 * Who a case or sighting is about. Mirrors shared/case-domain.js: a record
 * without `personCategory` predates the field and is a child.
 */
export const PERSON_CATEGORY_OPTIONS = [
  { id: 'child', label: msg('Child') },
  { id: 'woman', label: msg('Woman') },
  { id: 'adult', label: msg('Adult person') },
];

const MISSING_LABELS = {
  child: msg('Missing child'),
  woman: msg('Missing woman'),
  adult: msg('Missing person'),
};

export function personCategoryOf(record) {
  const value = record?.personCategory;
  return value === 'woman' || value === 'adult' ? value : 'child';
}

export function isAdultCategory(category) {
  return category === 'woman' || category === 'adult';
}

export function isAdultCase(record) {
  return isAdultCategory(personCategoryOf(record));
}

export function categoryLabel(category) {
  const option = PERSON_CATEGORY_OPTIONS.find((o) => o.id === category) || PERSON_CATEGORY_OPTIONS[0];
  return t(option.label);
}

/** "Missing child" / "Missing woman" / "Missing person". */
export function missingLabel(category) {
  return t(MISSING_LABELS[category] || MISSING_LABELS.child);
}

/**
 * Gender as a reader would say it. For a child the existing translations of
 * Male/Female read as boy/girl; an adult is a man or a woman.
 */
export function genderLabel(gender, category) {
  if (!gender || typeof gender !== 'string') return '';
  if (isAdultCategory(category)) {
    if (gender === 'Male') return t('Man');
    if (gender === 'Female') return t('Woman');
  }
  return t(gender);
}

const CATEGORY_BADGE = {
  child: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  woman: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  adult: 'bg-violet-50 text-violet-700 ring-violet-600/20',
};

export function CategoryBadge({ category, className = '' }) {
  useT();
  const key = CATEGORY_BADGE[category] ? category : 'child';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${CATEGORY_BADGE[key]} ${className}`}>
      {categoryLabel(key)}
    </span>
  );
}

/** Translated role name; ROLE_LABELS itself stays English for lookups and exports. */
export function roleLabel(role) {
  return ROLE_LABELS[role] ? t(ROLE_LABELS[role]) : txt(role);
}

export function roleTagline(role) {
  return ROLE_TAGLINE[role] ? t(ROLE_TAGLINE[role]) : '';
}

export function fmtDate(d) {
  if (!d) return '-';
  const date = d instanceof Date ? d : typeof d === 'number' || typeof d === 'string' ? new Date(d) : new Date(NaN);
  if (!Number.isFinite(date.getTime())) return '-';
  return date.toLocaleDateString(currentLocale(), { day: '2-digit', month: 'short', year: 'numeric' });
}

export function timeAgo(ts) {
  // Sightings carry ISO strings, activity carries epoch milliseconds; either
  // reads. Anything unparseable shows nothing rather than "NaNd ago".
  const when = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (!ts || !Number.isFinite(when)) return '';
  const s = Math.max(0, Math.floor((Date.now() - when) / 1000));
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n}m ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n}h ago', { n: Math.floor(s / 3600) });
  return t('{n}d ago', { n: Math.floor(s / 86400) });
}

export function StatusBadge({ status }) {
  useT();
  const map = {
    missing: 'bg-red-50 text-red-700 ring-red-600/20',
    intake_pending: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    under_review: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    found: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    closed: 'bg-slate-100 text-slate-700 ring-slate-500/20',
    pending_review: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    matched: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    referred_cwc: 'bg-blue-50 text-blue-700 ring-blue-600/20',
    cwc_followup_complete: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    formalized_case: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    rejected: 'bg-gray-100 text-gray-600 ring-gray-500/20',
    no_match: 'bg-gray-100 text-gray-600 ring-gray-500/20',
  };
  const label = {
    missing: msg('Missing'),
    intake_pending: msg('Intake pending'),
    under_review: msg('Under review'),
    found: msg('Found / Reunited'),
    closed: msg('Closed'),
    pending_review: msg('Pending review'),
    matched: msg('Matched'),
    referred_cwc: msg('Referred 1098/CWC'),
    cwc_followup_complete: msg('CWC follow-up complete'),
    formalized_case: msg('Formal intake opened'),
    rejected: msg('Rejected'),
    no_match: msg('No match'),
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${map[status] || map.no_match}`}>
      {label[status] ? t(label[status]) : txt(status)}
    </span>
  );
}

// Deterministic avatar colour for a child without a photo.
export function Avatar({ name: rawName, src: rawSrc, size = 40 }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const name = txt(rawName);
  const src = txt(rawSrc);
  const initials = (name || '?').split(' ').map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();
  const hue = [...(name || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  useEffect(() => {
    if (!src || src.startsWith('data:')) {
      setObjectUrl(null);
      return undefined;
    }
    let alive = true;
    let nextUrl = null;
    const apiPath = src.startsWith('/api') ? src.slice(4) : src;
    api.blob(apiPath)
      .then((blob) => {
        if (!alive) return;
        nextUrl = URL.createObjectURL(blob);
        setObjectUrl(nextUrl);
      })
      .catch(() => {
        if (alive) setObjectUrl(null);
      });
    return () => {
      alive = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [src]);
  if (src) {
    const resolvedSrc = src.startsWith('data:') ? src : objectUrl;
    if (resolvedSrc) return <img src={resolvedSrc} alt={name} className="rounded-lg object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <div
      className="grid place-items-center rounded-lg font-semibold text-white"
      style={{ width: size, height: size, background: `hsl(${hue} 45% 55%)`, fontSize: Math.max(14, size * 0.36) }}
    >
      {initials}
    </div>
  );
}

export function ProtectedImage({ src: rawSrc, alt, className, style, fallback }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const src = txt(rawSrc);

  useEffect(() => {
    if (!src) {
      setObjectUrl(null);
      return undefined;
    }
    if (src.startsWith('data:')) {
      setObjectUrl(src);
      return undefined;
    }
    let alive = true;
    let nextUrl = null;
    const apiPath = src.startsWith('/api') ? src.slice(4) : src;
    api.blob(apiPath)
      .then((blob) => {
        if (!alive) return;
        nextUrl = URL.createObjectURL(blob);
        setObjectUrl(nextUrl);
      })
      .catch(() => {
        if (alive) setObjectUrl(null);
      });
    return () => {
      alive = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [src]);

  if (!objectUrl) {
    return fallback || null;
  }

  return <img src={objectUrl} alt={alt || ''} className={className} style={style} />;
}


/**
 * A phone number shown so it can be tapped to call. The number reads exactly
 * as stored; only the dialled form drops spaces and dashes. Something that is
 * not a dialable number (a masked "98xxxxxx10", a dash) stays plain text.
 */
export function PhoneLink({ phone, className = '' }) {
  useT();
  const shown = txt(phone);
  if (!shown) return null;
  const dial = shown.replace(/[^\d+]/g, '');
  if (/x/i.test(shown) || dial.replace(/\D/g, '').length < 3) return <span className={className}>{shown}</span>;
  return (
    <a
      href={`tel:${dial}`}
      aria-label={t('Call {phone}', { phone: shown })}
      className={`whitespace-nowrap font-medium text-khozo-dark underline decoration-dotted underline-offset-2 hover:text-khozo ${className}`}
    >
      {shown}
    </a>
  );
}

/** Coordinates as numbers, or null when a record has none worth mapping. */
export function coordsOf(record) {
  if (!record || record.lat == null || record.lng == null || record.lat === '' || record.lng === '') return null;
  const lat = Number(record.lat);
  const lng = Number(record.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * "Open in Maps" for a record with coordinates: on a phone it opens the maps
 * app with a pin, so an officer can drive to where a child was seen.
 */
export function MapsLink({ lat, lng, className = '' }) {
  useT();
  const at = coordsOf({ lat, lng });
  if (!at) return null;
  return (
    <a
      href={`https://www.google.com/maps?q=${at.lat},${at.lng}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-sky-50 px-3 text-sm font-semibold text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100 ${className}`}
    >
      <span aria-hidden="true">📍</span>
      {t('Open in Maps')}
    </a>
  );
}
