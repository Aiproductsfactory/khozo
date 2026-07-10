// Reusable UI atoms: brand logo, stat card, section heading.
import { Link } from 'react-router-dom';

export function Logo({ light = false, className = '' }) {
  return (
    <Link to="/" className={`inline-flex items-center gap-2 ${className}`}>
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-khozo text-white shadow-sm">
        {/* waving hand glyph echoing the Khozo logo */}
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M12 2a1 1 0 0 1 1 1v7h1V4a1 1 0 1 1 2 0v6h1V6a1 1 0 1 1 2 0v8a7 7 0 0 1-7 7h-1a7 7 0 0 1-6.3-3.9L3 16.2A1.5 1.5 0 0 1 5.4 14.4L7 16V5a1 1 0 1 1 2 0v6h1V3a1 1 0 0 1 1-1z" />
        </svg>
      </span>
      <span className={`text-xl font-extrabold tracking-tight ${light ? 'text-white' : 'text-ink'}`}>
        KHOZO
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
