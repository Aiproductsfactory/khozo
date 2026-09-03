// Reusable UI atoms: brand logo, stat card, section heading.
import { Link } from 'react-router-dom';

/**
 * `to` overrides where the logo goes. Inside the console it points at the
 * dashboard: clicking it used to sign an officer out of their workspace and
 * back to the public marketing page, which is not what a logo does in an
 * application.
 */
export function Logo({ light = false, className = '', to = '/' }) {
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
          lang="hi"
          className={`mt-0.5 text-[13px] font-semibold tracking-tight ${light ? 'text-white/75' : 'text-khozo'}`}
          style={{ fontFamily: "'Noto Sans Devanagari', 'Nirmala UI', 'Mangal', sans-serif" }}
        >
          खोज़ो
        </span>
      </span>
    </Link>
  );
}

export function StatCard({ label, value, sub, accent = 'khozo', icon }) {
  const accents = {
    khozo: 'text-khozo bg-khozo-light',
    red: 'text-red-600 bg-red-50',
    amber: 'text-amber-600 bg-amber-50',
    blue: 'text-blue-600 bg-blue-50',
  };
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight">{value}</p>
          {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
        </div>
        {icon && <span className={`grid h-10 w-10 place-items-center rounded-xl text-lg ${accents[accent]}`}>{icon}</span>}
      </div>
    </div>
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
