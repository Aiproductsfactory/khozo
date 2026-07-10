import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Logo } from '../components.jsx';
import { ROLE_LABELS, ROLE_TAGLINE, Avatar } from '../lib.jsx';
import { DASHBOARD_NAV } from './routes.js';

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const items = DASHBOARD_NAV.filter((n) => n.roles.includes(user.role));

  return (
    <div className="flex min-h-screen bg-[#f6f8f5]">
      <aside className="sticky top-0 hidden h-screen w-64 flex-col border-r border-black/5 bg-ink text-gray-300 lg:flex">
        <div className="px-5 py-5"><Logo light /></div>
        <div className="mx-3 mb-2 rounded-xl bg-white/5 px-3 py-2.5">
          <p className="text-xs text-gray-400">Signed in as</p>
          <p className="truncate text-sm font-semibold text-white">{ROLE_LABELS[user.role]}</p>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-khozo text-white' : 'hover:bg-white/10'
                }`
              }
            >
              <span className="w-12 text-xs font-semibold uppercase tracking-wide text-current/70">{n.icon}</span> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <button onClick={() => { logout(); nav('/'); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-300 hover:bg-white/10">
            <span>Exit</span> Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-black/5 bg-white/80 px-6 py-3.5 backdrop-blur">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold">{ROLE_LABELS[user.role]} dashboard</h1>
            <p className="truncate text-xs text-gray-500">{ROLE_TAGLINE[user.role]}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight">{user.name}</p>
              <p className="text-xs text-gray-500">{user.org || user.email}</p>
            </div>
            <Avatar name={user.name} size={38} />
          </div>
        </header>

        <div className="flex gap-1 overflow-x-auto border-b border-black/5 bg-white px-3 py-2 lg:hidden">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ${isActive ? 'bg-khozo text-white' : 'text-gray-600'}`}>
              {n.label}
            </NavLink>
          ))}
        </div>

        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
