// Reusable UI atoms: brand logo, stat card, section heading, crash guard.
import { Component } from 'react';
import { Link } from 'react-router-dom';
import { msg, useLanguage, useT } from './i18n.jsx';

/**
 * What a reader sees where a part of the page failed to render. Translated,
 * with a way out, and nothing technical: the detail goes to the console.
 * `page` centres it on an otherwise empty screen (a public page's root).
 */
export function CrashNotice({ page = false, compact = false }) {
  const t = useT();
  const body = (
    <div
      role="alert"
      className={`rounded-xl bg-amber-50 text-amber-900 ring-1 ring-amber-200 ${compact ? 'px-3 py-2 text-xs' : 'p-5 text-sm'}`}
    >
      <p className="font-semibold">{t('This section could not be shown. Reload, or contact your administrator.')}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className={`mt-2 rounded-lg bg-white font-semibold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100 ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'}`}
      >
        {t('Reload')}
      </button>
    </div>
  );
  if (!page) return body;
  return <div className="grid min-h-screen place-items-center bg-gray-50 p-6"><div className="w-full max-w-md">{body}</div></div>;
}

/**
 * Shown while a page's code downloads (every route is loaded on demand, see
 * main.jsx). `page` fills the screen; inside the console it fills the content
 * area and leaves the navigation in place.
 */
export function PageLoading({ page = false }) {
  const t = useT();
  return (
    <div role="status" aria-live="polite" className={`grid place-items-center text-gray-500 ${page ? 'min-h-screen' : 'min-h-[40vh]'}`}>
      <span className="flex items-center gap-3 text-sm">
        <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-khozo/30 border-t-khozo" />
        {t('Loading…')}
      </span>
    </div>
  );
}

/**
 * Catches a render error below it and shows CrashNotice in its place, so one
 * malformed record blanks one card or one panel instead of the whole console.
 *
 * `resetKey` clears the error when it changes — the route, or the record being
 * shown — so moving on from the bad record brings the section back. `fallback`
 * replaces the notice (null hides the section silently, for chrome such as the
 * alert bell).
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept for whoever opens the console; the reader sees the notice.
    console.error('Khozo: a section failed to render', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return <CrashNotice page={this.props.page} compact={this.props.compact} />;
  }
}

// The name in the reader's own script. Hindi and Marathi share Devanagari.
const WORDMARK = {
  gu: { text: 'ખોઝો', lang: 'gu', font: "'Noto Sans Gujarati', 'Nirmala UI', 'Shruti', sans-serif" },
  hi: { text: 'खोज़ो', lang: 'hi', font: "'Noto Sans Devanagari', 'Nirmala UI', 'Mangal', sans-serif" },
  mr: { text: 'खोज़ो', lang: 'mr', font: "'Noto Sans Devanagari', 'Nirmala UI', 'Mangal', sans-serif" },
};

/**
 * `to` overrides where the logo goes. Inside the console it points at the
 * dashboard: clicking it used to sign an officer out of their workspace and
 * back to the public marketing page, which is not what a logo does in an
 * application.
 */
export function Logo({ light = false, className = '', to = '/' }) {
  const { lang } = useLanguage();
  const mark = WORDMARK[lang] || WORDMARK.hi;
  return (
    <Link to={to} className={`inline-flex items-center gap-2 ${className}`}>
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-khozo text-white shadow-sm">
        {/* waving hand glyph echoing the Khozo logo */}
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M12 2a1 1 0 0 1 1 1v7h1V4a1 1 0 1 1 2 0v6h1V6a1 1 0 1 1 2 0v8a7 7 0 0 1-7 7h-1a7 7 0 0 1-6.3-3.9L3 16.2A1.5 1.5 0 0 1 5.4 14.4L7 16V5a1 1 0 1 1 2 0v6h1V3a1 1 0 0 1 1-1z" />
        </svg>
      </span>
      {/*
        The name in both scripts, stacked. Khozo is being offered to an Indian
        Department and used by citizens who read Devanagari first; the English
        wordmark alone quietly says the platform is for someone else. The
        Devanagari face is named explicitly because the body stack has no
        Devanagari coverage — the browser would otherwise pick a fallback that
        does not match the Latin weight beside it.
      */}
      <span className="flex flex-col leading-none">
        <span className={`text-xl font-extrabold tracking-tight ${light ? 'text-white' : 'text-ink'}`}>
          KHOZO
        </span>
        <span
          lang={mark.lang}
          className={`mt-0.5 text-[13px] font-semibold tracking-tight ${light ? 'text-white/75' : 'text-khozo'}`}
          style={{ fontFamily: mark.font }}
        >
          {mark.text}
        </span>
      </span>
    </Link>
  );
}

// With `onClick` the whole card is a button that opens what the figure counts.
export function StatCard({ label, value, sub, accent = 'khozo', icon, onClick }) {
  const t = useT();
  const accents = {
    khozo: 'text-khozo bg-khozo-light',
    red: 'text-red-600 bg-red-50',
    amber: 'text-amber-600 bg-amber-50',
    blue: 'text-blue-600 bg-blue-50',
  };
  const body = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className="mt-1 text-3xl font-bold tracking-tight">{value}</p>
        {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
      </div>
      {/* On a phone two cards share a row, and the icon gives its room to the words. */}
      {icon && <span className={`hidden h-10 w-10 shrink-0 place-items-center rounded-xl text-lg sm:grid ${accents[accent]}`}>{icon}</span>}
    </div>
  );
  if (!onClick) return <div className="card p-4 sm:p-5">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="card group block w-full p-4 text-left transition hover:shadow-md hover:ring-1 hover:ring-khozo/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khozo sm:p-5"
    >
      {body}
      <span className="mt-2 block text-xs font-semibold text-khozo-dark opacity-70 group-hover:opacity-100">{t('View details')} ›</span>
    </button>
  );
}

export function SectionTitle({ kicker, title, children }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      {kicker && <p className="text-sm font-semibold uppercase tracking-widest text-khozo">{kicker}</p>}
      <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {children && <p className="mt-3 text-gray-500">{children}</p>}
    </div>
  );
}

/*
 * What a member of the public can do on Khozo, and nothing more. There is no
 * public gallery, appeal page or name search (shared/case-domain.js
 * isPublicAppeal): a citizen sends a sighting and tracks their own receipt, a
 * family tracks its own case by the Case ID it was given, and a parent who
 * registered a case logs in to see that case alone.
 */
const PUBLIC_ACTIONS = [
  { to: '/report', label: msg('Send a photo'), hint: msg('Seen someone who seems lost? Free, no login.'), primary: true },
  { to: '/track-sighting', label: msg('Track a report I made'), hint: msg('Use the receipt number you were given.') },
  { to: '/track-case', label: msg('Track my case'), hint: msg('Use the Case ID given when the case was registered.') },
  { to: '/login', label: msg('Parents: log in'), hint: msg('See the case you registered, and only that case.') },
];

export function PublicActions({ className = '' }) {
  const t = useT();
  return (
    <ul className={`grid gap-3 sm:grid-cols-2 ${className}`}>
      {PUBLIC_ACTIONS.map((action) => (
        <li key={action.to}>
          <Link
            to={action.to}
            className={`block h-full rounded-xl p-4 ring-1 transition ${
              action.primary
                ? 'bg-khozo text-white ring-khozo hover:bg-khozo-dark'
                : 'bg-white text-ink ring-black/5 hover:ring-khozo/40'
            }`}
          >
            <span className="block font-semibold">{t(action.label)}</span>
            <span className={`mt-1 block text-sm ${action.primary ? 'text-white/85' : 'text-gray-500'}`}>{t(action.hint)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
