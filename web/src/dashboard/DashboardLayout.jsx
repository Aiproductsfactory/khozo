import { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Logo } from '../components.jsx';
import { ROLE_LABELS, ROLE_TAGLINE, Avatar } from '../lib.jsx';
import { DASHBOARD_NAV } from './routes.js';
import NotificationBell from './NotificationBell.jsx';

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const [connected, setConnected] = useState(true);
  const dropdownRef = useRef(null);

  const items = DASHBOARD_NAV.filter((n) => n.roles.includes(user.role));

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="flex min-h-screen bg-[#f1f5f9] font-sans selection:bg-indigo-500 selection:text-white">
      {/* Premium Glassy Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-72 flex-col bg-white shadow-[4px_0_24px_rgba(0,0,0,0.02)] border-r border-slate-200/60 lg:flex z-30">
        <div className="px-6 py-6 flex items-center justify-between">
          <Logo />
          <div className="h-6 w-6 rounded-full bg-indigo-50 flex items-center justify-center border border-indigo-100">
            <div className="h-2 w-2 rounded-full bg-indigo-600 animate-pulse" />
          </div>
        </div>

        <div className="mx-4 mb-6 mt-2 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 p-4 shadow-lg shadow-indigo-600/20 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 -mr-4 -mt-4 w-24 h-24 rounded-full bg-white opacity-10 blur-xl"></div>
          <div className="flex items-center justify-between relative z-10">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-200">ACTIVE JURISDICTION</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 backdrop-blur-md px-2 py-0.5 text-[10px] font-bold text-white border border-white/30">
              Live AI
            </span>
          </div>
          <p className="mt-2 text-sm font-extrabold tracking-wide relative z-10 drop-shadow-sm">{ROLE_LABELS[user.role]}</p>
          <p className="text-xs text-indigo-200 mt-0.5 font-medium">{user.jurisdiction?.district || 'National Level'}</p>
        </div>

        {/* Navigation items with elegant hover states */}
        <nav className="flex-1 space-y-1.5 px-4 overflow-y-auto pb-6 scrollbar-hide">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-3.5 rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 group relative ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-md bg-indigo-600" />
                  )}
                  <span className={`w-5 text-center transition-transform duration-200 ${isActive ? 'scale-110 text-indigo-600' : 'group-hover:scale-110 group-hover:text-slate-700'}`}>
                    {n.icon === 'Test' ? '🧪' : n.icon === 'Chart' ? '📊' : n.icon === 'Search' ? '🔍' : n.icon === 'Add' ? '➕' : n.icon === 'Cases' ? '📁' : '🔹'}
                  </span>
                  {n.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col relative z-20">
        {/* Top Header with Glassmorphism */}
        <header className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-slate-200/50 bg-white/70 px-6 py-4 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-black tracking-tight text-slate-900 drop-shadow-sm">{ROLE_LABELS[user.role]} Console</h1>
            <p className="truncate text-sm font-medium text-slate-500 mt-0.5">{ROLE_TAGLINE[user.role]}</p>
          </div>

          <div className="flex items-center gap-5">
            {/*
              Reflects whether the last alert poll actually reached the API. It
              previously read "System Synced" unconditionally, which is the one
              thing a status indicator must never do.
            */}
            <div
              className={`hidden md:flex items-center gap-2 rounded-full px-3 py-1.5 border shadow-sm ${
                connected
                  ? 'bg-emerald-50 border-emerald-100'
                  : 'bg-amber-50 border-amber-100'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span className={`text-xs font-bold ${connected ? 'text-emerald-700' : 'text-amber-700'}`}>
                {connected ? 'Connected' : 'Reconnecting…'}
              </span>
            </div>

            <NotificationBell onConnectionChange={setConnected} />

            <div className="h-8 w-px bg-slate-200"></div>

            {/* PROMINENT LOGOUT BUTTON - Moved to Top Level Header */}
            <button
              onClick={() => {
                logout();
                nav('/');
              }}
              className="hidden sm:flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-600 border border-slate-200 shadow-sm hover:shadow-md hover:border-rose-200 hover:text-rose-600 transition-all duration-200 group"
            >
              <span className="group-hover:-translate-x-0.5 transition-transform">🚪</span>
              <span>Sign Out</span>
            </button>

            {/* Profile Menu Trigger */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="flex items-center gap-3 rounded-full bg-white p-1 pr-3 hover:bg-slate-50 border border-slate-200 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <Avatar name={user.name} size={36} />
                <div className="hidden text-left sm:block">
                  <p className="text-sm font-bold text-slate-900 leading-none">{user.name}</p>
                  <p className="text-[11px] font-semibold text-slate-500 mt-0.5 uppercase tracking-wide">{user.org || 'Khozo Admin'}</p>
                </div>
                <svg className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${profileOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Profile Dropdown */}
              {profileOpen && (
                <div className="absolute right-0 mt-3 w-64 rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-xl p-2 shadow-2xl z-50 animate-in fade-in slide-in-from-top-4 duration-200 origin-top-right">
                  <div className="p-3 bg-slate-50/50 rounded-xl mb-2">
                    <p className="text-sm font-bold text-slate-900">{user.name}</p>
                    <p className="text-xs text-slate-500 font-medium truncate">{user.email}</p>
                  </div>
                  
                  <div className="px-2 py-2 space-y-1">
                    <div className="flex justify-between items-center text-xs px-2 py-1.5 rounded-lg hover:bg-slate-50 transition-colors">
                      <span className="text-slate-500 font-medium">Security</span>
                      <span className="text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-md">Verified</span>
                    </div>
                  </div>

                  <div className="mt-2 border-t border-slate-100 pt-2 sm:hidden">
                    {/* Mobile Log out (visible only when header button is hidden) */}
                    <button
                      onClick={() => {
                        setProfileOpen(false);
                        logout();
                        nav('/');
                      }}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-100 transition-colors"
                    >
                      🚪 Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Mobile Horizontal Nav Bar (Glassy) */}
        <div className="flex gap-2 overflow-x-auto border-b border-slate-200 bg-white/80 backdrop-blur-md px-4 py-3 lg:hidden scrollbar-hide sticky top-[73px] z-30 supports-[backdrop-filter]:bg-white/60">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold transition-all shadow-sm ${
                  isActive ? 'bg-indigo-600 text-white border border-indigo-700' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </div>

        {/* Main Content Body */}
        <main className="flex-1 p-6 lg:p-10 max-w-full overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
