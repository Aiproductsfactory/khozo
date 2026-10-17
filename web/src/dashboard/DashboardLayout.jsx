import { Suspense, useState, useRef, useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { ErrorBoundary, Logo, PageLoading } from '../components.jsx';
import { roleLabel, roleTagline, Avatar } from '../lib.jsx';
import { useT, LanguageSwitcher } from '../i18n.jsx';
import { DASHBOARD_BOTTOM_NAV, DASHBOARD_NAV, DASHBOARD_NAV_GROUPS } from './routes.js';
import NotificationBell from './NotificationBell.jsx';
import InstallPrompt from '../InstallPrompt.jsx';
import { useBackClose } from '../useBackClose.js';

/** Role and district, at the top of the sidebar and of the phone menu. */
function JurisdictionCard({ user }) {
  const t = useT();
  return (
    <div className="mx-4 mb-6 mt-2 shrink-0 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 p-4 shadow-lg shadow-indigo-600/20 text-white relative overflow-hidden">
      <div className="absolute top-0 right-0 -mr-4 -mt-4 w-24 h-24 rounded-full bg-white opacity-10 blur-xl"></div>
      <div className="flex items-center justify-between relative z-10">
        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-200">{t('ACTIVE JURISDICTION')}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 backdrop-blur-md px-2 py-0.5 text-[10px] font-bold text-white border border-white/30">
          {t('Live AI')}
        </span>
      </div>
      <p className="mt-2 text-sm font-extrabold tracking-wide relative z-10 drop-shadow-sm">{roleLabel(user.role)}</p>
      <p className="text-xs text-indigo-200 mt-0.5 font-medium">{user.jurisdiction?.district || t('National Level')}</p>
    </div>
  );
}

/** Every section the role can open, grouped. Shared by the sidebar and the phone menu. */
function NavGroups({ items }) {
  const t = useT();
  return DASHBOARD_NAV_GROUPS.map((group) => {
    const groupItems = items.filter((n) => n.group === group);
    if (!groupItems.length) return null;
    return (
      <div key={group} className="mb-5">
        <p className="px-4 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">{t(group)}</p>
        <div className="space-y-1">
          {groupItems.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `group relative flex min-h-11 items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors lg:min-h-0 ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-md bg-indigo-600" />
                  )}
                  <span className="w-5 shrink-0 text-center text-base leading-none">{n.icon}</span>
                  <span className="truncate">{t(n.label)}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </div>
    );
  });
}

export default function DashboardLayout() {
  const t = useT();
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connected, setConnected] = useState(true);
  const dropdownRef = useRef(null);
  const menuCloseRef = useRef(null);

  const items = DASHBOARD_NAV.filter((n) => n.roles.includes(user.role));
  // The phone's bottom bar: the role's four most used sections, then Menu.
  const bottomItems = DASHBOARD_BOTTOM_NAV
    .map((to) => items.find((n) => n.to === to))
    .filter(Boolean)
    .slice(0, 4);

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

  // The phone's Back button closes the menu rather than leaving the console.
  useBackClose(menuOpen, () => setMenuOpen(false));

  // Moving to another section closes the phone menu and the account menu.
  useEffect(() => {
    setMenuOpen(false);
    setProfileOpen(false);
  }, [pathname]);

  // While the phone menu is open the page behind it does not scroll, Escape
  // closes it, and focus starts on its close button.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    menuCloseRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const signOut = () => {
    setProfileOpen(false);
    setMenuOpen(false);
    logout();
    nav('/');
  };

  return (
    <div className="flex min-h-screen bg-[#f1f5f9] font-sans selection:bg-indigo-500 selection:text-white">
      {/* Premium Glassy Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-72 flex-col bg-white shadow-[4px_0_24px_rgba(0,0,0,0.02)] border-r border-slate-200/60 lg:flex z-30">
        <div className="px-6 py-6">
          <Logo to="/app" />
        </div>

        <JurisdictionCard user={user} />

        {/* Navigation items with elegant hover states */}
        <nav className="flex-1 overflow-y-auto px-4 pb-6 scrollbar-hide">
          <NavGroups items={items} />
        </nav>
      </aside>

      {/*
        The same navigation on a phone: a menu that slides in from the left,
        opened from the header or from the bottom bar. It replaces a strip of
        pills that scrolled sideways and hid most sections off screen.
      */}
      {menuOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label={t('Menu')}>
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenuOpen(false)} />
          <div className="animate-drawer-in absolute inset-y-0 left-0 flex w-[86vw] max-w-xs flex-col overflow-y-auto overscroll-contain bg-white shadow-2xl">
            <div className="flex items-center justify-between px-5 pb-3 pt-4">
              <Logo to="/app" />
              <button
                ref={menuCloseRef}
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label={t('Close menu')}
                className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <JurisdictionCard user={user} />
            <nav aria-label={t('Main navigation')} className="flex-1 px-3">
              <NavGroups items={items} />
            </nav>
            <div className="space-y-2 border-t border-slate-100 px-4 py-4">
              <InstallPrompt className="mb-2" />
              <LanguageSwitcher className="w-full [&>select]:min-h-11 [&>select]:w-full" />
              <Link
                to="/change-password"
                className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                <span aria-hidden="true">🔑</span> {t('Change password')}
              </Link>
              <button
                type="button"
                onClick={signOut}
                className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-rose-600 hover:bg-rose-50"
              >
                <span aria-hidden="true">🚪</span> {t('Sign out')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col relative z-20">
        {/* Top Header with Glassmorphism */}
        <header className="sticky top-0 z-40 flex items-center justify-between gap-2 border-b border-slate-200/50 bg-white/90 px-3 py-2 backdrop-blur-xl supports-[backdrop-filter]:bg-white/70 sm:gap-4 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              data-mobile-menu-button
              onClick={() => setMenuOpen(true)}
              aria-label={t('Menu')}
              aria-expanded={menuOpen}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-700 hover:bg-slate-100 lg:hidden"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-black tracking-tight text-slate-900 drop-shadow-sm sm:text-xl">
                {/* On a phone the role alone: "… Console" only pushed it into an ellipsis. */}
                <span className="sm:hidden">{roleLabel(user.role)}</span>
                <span className="hidden sm:inline">{t('{role} Console', { role: roleLabel(user.role) })}</span>
              </h1>
              <p className="mt-0.5 hidden truncate text-sm font-medium text-slate-500 sm:block">{roleTagline(user.role)}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-5">
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
                {connected ? t('Connected') : t('Reconnecting…')}
              </span>
            </div>
            {/* On a phone the dot alone says the same; the words are in the alert poll's title. */}
            {!connected && (
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500 md:hidden" role="status" aria-label={t('Reconnecting…')} title={t('Reconnecting…')} />
            )}

            {/* On a phone the language is chosen from the menu, where there is room. */}
            <div className="hidden sm:block">
              <LanguageSwitcher />
            </div>

            {/* A malformed alert hides the bell; it never takes the header with it. */}
            <ErrorBoundary fallback={null}>
              <NotificationBell onConnectionChange={setConnected} />
            </ErrorBoundary>

            <div className="hidden h-8 w-px bg-slate-200 sm:block"></div>

            {/*
              Sign out lives in the account menu, where it is conventional and
              where a mis-click cannot end an officer's session mid-task. It was
              a loose button in the header *and* a duplicate inside this menu.
            */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                aria-label={t('Account menu')}
                aria-expanded={profileOpen}
                className="flex items-center gap-2 rounded-full bg-white p-1 pr-2 hover:bg-slate-50 border border-slate-200 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/20 sm:gap-3 sm:pr-3"
              >
                <Avatar name={user.name} size={34} />
                <div className="hidden text-left sm:block">
                  <p className="text-sm font-bold text-slate-900 leading-none">{user.name}</p>
                  <p className="text-[11px] font-semibold text-slate-500 mt-0.5 uppercase tracking-wide">{user.org || t('Khozo Admin')}</p>
                </div>
                <svg className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${profileOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Profile Dropdown */}
              {profileOpen && (
                <div className="absolute right-0 mt-3 w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-xl p-2 shadow-2xl z-50 animate-in fade-in slide-in-from-top-4 duration-200 origin-top-right">
                  <div className="p-3 bg-slate-50/50 rounded-xl mb-2">
                    <p className="text-sm font-bold text-slate-900">{user.name}</p>
                    <p className="text-xs text-slate-500 font-medium truncate">{user.email}</p>
                  </div>

                  {/*
                    Role and jurisdiction, which is what an officer actually
                    needs to confirm about their own session. This read
                    "Security: Verified" — a green badge asserting nothing.
                  */}
                  <div className="space-y-1 px-2 py-1 text-xs">
                    <div className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5">
                      <span className="font-medium text-slate-500">{t('Role')}</span>
                      <span className="truncate font-semibold text-slate-700">{roleLabel(user.role)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5">
                      <span className="font-medium text-slate-500">{t('Jurisdiction')}</span>
                      <span className="truncate font-semibold text-slate-700">
                        {[user.jurisdiction?.station, user.jurisdiction?.district, user.jurisdiction?.state]
                          .filter(Boolean)
                          .join(', ') || t('National')}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                    <Link
                      to="/change-password"
                      onClick={() => setProfileOpen(false)}
                      className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 sm:min-h-0"
                    >
                      <span>🔑</span> {t('Change password')}
                    </Link>
                    <button
                      onClick={signOut}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      <span>🚪</span> {t('Sign out')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Content Body. The bottom padding clears the phone's bottom bar. */}
        <main className="min-w-0 max-w-full flex-1 px-4 pb-28 pt-4 sm:px-6 sm:pt-6 lg:p-10">
          {/*
            One section failing to render shows a notice here, inside the
            console, and the sidebar stays usable. Moving to another section
            clears it.
          */}
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>

        {/* The phone's bottom bar: the role's most used sections, then the full menu. */}
        <nav
          aria-label={t('Main navigation')}
          className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur lg:hidden"
        >
          {/* Each item as wide as its label needs, sharing what is left: a long
              Gujarati word gets room from a short one beside it. */}
          <div className="mx-auto flex max-w-xl">
            {bottomItems.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `flex min-h-14 min-w-0 flex-auto flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-xs font-semibold ${
                    isActive ? 'text-indigo-700' : 'text-slate-500'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span aria-hidden="true" className={`grid h-7 w-12 place-items-center rounded-full text-lg leading-none ${isActive ? 'bg-indigo-100' : ''}`}>{n.icon}</span>
                    <span className="max-w-full truncate leading-tight">{t(n.short || n.label)}</span>
                  </>
                )}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-expanded={menuOpen}
              className="flex min-h-14 min-w-0 flex-auto flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-xs font-semibold text-slate-500"
            >
              <span aria-hidden="true" className="grid h-7 w-12 place-items-center rounded-full">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </span>
              <span className="max-w-full truncate leading-tight">{t('Menu')}</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
