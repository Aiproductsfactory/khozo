// Shared formatting + small presentational helpers.
import { useEffect, useState } from 'react';
import { api } from './api.js';

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin (ACP)',
  police: 'Police Station',
  sjpu: 'Special Juvenile Police Unit',
  ahtu: 'Anti Human Trafficking Unit',
  dcrb: 'District Crime Records Bureau',
  dlsa: 'District Legal Services Authority',
  cwc: 'Child Welfare Committee',
  dcpu: 'DCPU',
  rpf: 'Railway Protection Force',
  cci: 'Child Care Institution',
  saa: 'Specialised Adoption Agency',
  jjb: 'Juvenile Justice Board',
  state_nodal: 'State Nodal Officer',
  sara: 'State Adoption Resource Agency',
  crime_bureau: 'Crime Records Bureau',
  parent: 'Parent / Public',
  ngo: 'NGO',
};

export const ROLE_TAGLINE = {
  super_admin: 'Government of India / State Govt / Police Commissioner',
  admin: 'Asst. Commissioner of Police - jurisdiction view',
  police: 'Police Station - register FIRs and confirm matches',
  sjpu: 'Special Juvenile Police Unit - child-friendly police response and FIR coordination',
  ahtu: 'Anti Human Trafficking Unit - trafficking-risk investigation and rescue coordination',
  dcrb: 'District crime records bureau - district records linkage and alerts',
  dlsa: 'District Legal Services Authority - legal aid, compensation, and court-support follow-up',
  cwc: 'Child Welfare Committee - review sightings and child-protection referrals',
  dcpu: 'District Child Protection Unit - monitor child-protection cases',
  rpf: 'Railway Protection Force - review railway-area sightings',
  cci: 'Child Care Institution - intake and care oversight for children in shelter',
  saa: 'Specialised Adoption Agency - adoption follow-up and CARINGS coordination',
  jjb: 'Juvenile Justice Board - district oversight for child-protection cases',
  state_nodal: 'State child-protection nodal officer - statewide monitoring',
  sara: 'State Adoption Resource Agency - statewide adoption oversight and SAA coordination',
  crime_bureau: 'Crime records bureau - statewide missing-child records oversight',
  parent: 'Report your missing child and track its status',
  ngo: 'Assist the community - report and register children',
};

export function fmtDate(d) {
  if (!d) return '-';
  const date = typeof d === 'number' ? new Date(d) : new Date(d);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function StatusBadge({ status }) {
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
    missing: 'Missing',
    intake_pending: 'Intake pending',
    under_review: 'Under review',
    found: 'Found / Reunited',
    closed: 'Closed',
    pending_review: 'Pending review',
    matched: 'Matched',
    referred_cwc: 'Referred 1098/CWC',
    cwc_followup_complete: 'CWC follow-up complete',
    formalized_case: 'Formal intake opened',
    rejected: 'Rejected',
    no_match: 'No match',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${map[status] || map.no_match}`}>
      {label[status] || status}
    </span>
  );
}

// Deterministic avatar colour for a child without a photo.
export function Avatar({ name, src, size = 40 }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const initials = (name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
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
      style={{ width: size, height: size, background: `hsl(${hue} 45% 55%)`, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
}
