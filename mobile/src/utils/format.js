/** Presentation helpers shared across screens. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now" / "3 h ago" / "12 Mar 2026" */
export function relativeTime(value) {
  if (!value) return '—';
  const time = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(time)) return '—';
  const diff = Date.now() - time;
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} d ago`;
  return formatDate(time);
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(typeof value === 'number' ? value : value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(typeof value === 'number' ? value : value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDate(date)}, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export function joinPlace(...parts) {
  return parts.filter(Boolean).join(', ') || 'Location under review';
}

/** Maps a report/sighting status to a label + badge tone. */
export function statusMeta(status) {
  const map = {
    missing: { label: 'Missing', tone: 'danger' },
    under_review: { label: 'Under review', tone: 'warning' },
    intake_pending: { label: 'Intake pending', tone: 'warning' },
    found: { label: 'Found', tone: 'success' },
    closed: { label: 'Closed', tone: 'neutral' },

    pending_review: { label: 'Police review pending', tone: 'warning' },
    no_match: { label: 'Queued for CWC', tone: 'info' },
    matched: { label: 'Reviewed — matched', tone: 'success' },
    rejected: { label: 'Closed by reviewer', tone: 'neutral' },
    referred_cwc: { label: 'Referred to CWC', tone: 'info' },
    cwc_followup_complete: { label: 'CWC follow-up done', tone: 'success' },
    formalized_case: { label: 'Formal case opened', tone: 'primary' },
  };
  return map[status] || { label: String(status || 'Unknown').replace(/_/g, ' '), tone: 'neutral' };
}

/**
 * Confidence band for a match score.
 *
 * Deliberately banded rather than shown as a raw percentage: a two-decimal
 * "98.24% match" implies a precision the pipeline does not have, and reviewers
 * anchor on it. Officers see the number too, but framed as a band.
 */
export function matchBand(score) {
  const value = Number(score) || 0;
  // Bands follow measured Aarakshak behaviour on real photographs: the same
  // person scores 0.48-0.86, different people score below 0.07. The wide gap is
  // why 0.45 reads as strong and anything under 0.25 is treated as noise.
  if (value >= 0.45) return { label: 'Strong candidate', tone: 'danger', percent: Math.round(value * 100) };
  if (value >= 0.25) return { label: 'Possible candidate', tone: 'warning', percent: Math.round(value * 100) };
  if (value > 0) return { label: 'Weak signal', tone: 'neutral', percent: Math.round(value * 100) };
  return { label: 'No candidate', tone: 'neutral', percent: 0 };
}

/** Age band string, e.g. "7-9". Never shows an exact age for public results. */
export function ageBandLabel(band, fallbackAge) {
  if (band) return `${band} yrs`;
  if (fallbackAge != null) return `${fallbackAge} yrs`;
  return 'Age unknown';
}

export function initialsOf(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?';
}
