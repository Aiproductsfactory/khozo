// The frame every public page shares: one header with the same links and a
// menu on a phone, the emergency numbers within one tap on every page, one
// footer, the safe way to spread the word, and the page's title and search
// description.
//
// Each public page used to build its own header — some with a "Submit
// sighting" button, some with only "Home", none with a menu on a phone — so
// a family who landed on /track-case from WhatsApp had no way to find the
// guidance or the help desks without going back to the home page first.
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { Logo } from './components.jsx';
import { LANGUAGES, LanguageSwitcher, msg, useLanguage, useT } from './i18n.jsx';
import { useBackClose } from './useBackClose.js';

const SITE = 'https://khozo.org';

/* ------------------------------------------------------------------ icons */

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const PublicIcon = {
  camera: (p) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...stroke} {...p}>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" />
    </svg>
  ),
  arrow: (p) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...stroke} strokeWidth={2} {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  phone: (p) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...stroke} {...p}>
      <path d="M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z" />
    </svg>
  ),
  menu: (p) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...stroke} strokeWidth={2} {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  ),
  close: (p) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...stroke} strokeWidth={2} {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  check: (p) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...stroke} strokeWidth={2.2} {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  ),
  shield: (p) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...stroke} {...p}>
      <path d="M12 3l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6l7-3z" /><path d="m9 12 2 2 4-4" />
    </svg>
  ),
  share: (p) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...stroke} {...p}>
      <circle cx="18" cy="5.5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="18.5" r="2.5" />
      <path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1" />
    </svg>
  ),
  copy: (p) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...stroke} {...p}>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" /><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
    </svg>
  ),
  whatsapp: (p) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.8-1.3A9.5 9.5 0 1 0 12 2.5zm0 17.2a7.7 7.7 0 0 1-3.9-1.1l-.3-.2-2.8.8.8-2.7-.2-.3A7.7 7.7 0 1 1 12 19.7zm4.3-5.8c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.3 6.3 0 0 1-3.1-2.7c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.7-1.7c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11.2 11.2 0 0 0 4.3 3.8c1.6.7 2.2.7 3 .6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z" />
    </svg>
  ),
};

/* ------------------------------------------------------------- page meta */

const DEFAULT_TITLE = msg('Khozo — Help a missing child return home');

function setMeta(selector, create, value) {
  let el = document.head.querySelector(selector);
  if (value == null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(el.tagName === 'LINK' ? 'href' : 'content', value);
}

/**
 * The page's title, search description, canonical address and language
 * alternates, in the reader's language. Search engines that run the page see
 * these; WhatsApp and other link previews read the static card in index.html,
 * which on purpose never names a person (worker/index.js).
 *
 * `noindex` keeps a page out of search results: the console, sign-in, and the
 * old /child/* case links, which must never be found by searching a name.
 */
export function usePageMeta({ title, description, noindex = false } = {}) {
  const t = useT();
  const { lang } = useLanguage();
  const { pathname } = useLocation();
  const fullTitle = title ? `${t(title)} · Khozo` : t(DEFAULT_TITLE);
  const desc = description ? t(description) : null;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = fullTitle;
    if (desc) setMeta('meta[name="description"]', () => Object.assign(document.createElement('meta'), { name: 'description' }), desc);
    setMeta('meta[name="robots"]', () => Object.assign(document.createElement('meta'), { name: 'robots' }), noindex ? 'noindex, nofollow' : null);
    const path = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
    const href = (code) => `${SITE}${path}${code === 'en' ? '' : `?lang=${code}`}`;
    setMeta('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), noindex ? null : href(lang));
    for (const l of [...LANGUAGES.map((x) => x.code), 'x-default']) {
      const code = l === 'x-default' ? 'en' : l;
      setMeta(
        `link[rel="alternate"][hreflang="${l}"]`,
        () => Object.assign(document.createElement('link'), { rel: 'alternate', hreflang: l }),
        noindex ? null : href(code),
      );
    }
  }, [fullTitle, desc, noindex, pathname, lang]);
}

/* --------------------------------------------------------------- header */

// Reporting is the green button beside these, so it is not a link here too.
const NAV = [
  { to: '/track-sighting', label: msg('Track a report') },
  { to: '/track-case', label: msg('Track a case') },
  { to: '/services', label: msg('Find help') },
];

// The phone menu: every public task, said as what it does.
const MENU = [
  { to: '/track-sighting', label: msg('Track a report I made'), hint: msg('Use the receipt number you were given.') },
  { to: '/track-case', label: msg('Track my case'), hint: msg('Use the Case ID given when the case was registered.') },
  { to: '/#families', label: msg('Someone in my family is missing'), hint: msg('What to do now, and how to register them.') },
  { to: '/services', label: msg('Find help nearby'), hint: msg('Police, child-welfare and legal-aid desks for your district.') },
  { to: '/grievance', label: msg('Raise a grievance'), hint: msg('A complaint about how a case or report was handled.') },
];

export const EMERGENCY = [
  { number: '112', label: msg('Police emergency') },
  { number: '1098', label: msg('Childline') },
  { number: '181', label: msg('Women helpline') },
];

/** The three numbers to call before anything else, as tap-to-call buttons. */
export function EmergencyCalls({ className = '', tone = 'light' }) {
  const t = useT();
  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`}>
      {EMERGENCY.map(({ number, label }) => (
        <a
          key={number}
          href={`tel:${number}`}
          className={`flex flex-col items-center justify-center rounded-xl px-2 py-2.5 text-center transition-colors ${
            tone === 'dark'
              ? 'bg-white/10 text-white hover:bg-white/15'
              : 'bg-white text-ink ring-1 ring-black/10 hover:ring-red-300'
          }`}
        >
          <span className="text-xl font-extrabold leading-none tabular-nums">{number}</span>
          <span className={`mt-1 text-xs font-medium leading-tight ${tone === 'dark' ? 'text-white/70' : 'text-gray-500'}`}>{t(label)}</span>
        </a>
      ))}
    </div>
  );
}

export function PublicHeader() {
  const t = useT();
  const { user } = useAuth() || {};
  const { pathname, hash } = useLocation();
  const [open, setOpen] = useState(false);
  const closeRef = useRef(null);

  useBackClose(open, () => setOpen(false));
  useEffect(() => setOpen(false), [pathname, hash]);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onReport = pathname === '/report';

  return (
    <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-white/90 backdrop-blur-md supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
        <Logo />
        <nav aria-label={t('Main navigation')} className="hidden items-center gap-0.5 lg:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-gray-100 text-ink' : 'text-gray-600 hover:bg-gray-50 hover:text-ink'
                }`
              }
            >
              {t(item.label)}
            </NavLink>
          ))}
        </nav>
        <div className="flex min-w-0 items-center gap-2">
          <LanguageSwitcher className="shrink-0" />
          {user ? (
            <Link to="/app" className="hidden text-sm font-semibold text-khozo-dark hover:underline lg:inline">{t('Dashboard')}</Link>
          ) : (
            <Link to="/login" className="hidden whitespace-nowrap text-sm font-semibold text-gray-600 hover:text-ink lg:inline">{t('Officer log in')}</Link>
          )}
          {!onReport && (
            <Link to="/report" className="btn-primary hidden sm:inline-flex">
              <PublicIcon.camera className="h-4 w-4 shrink-0" /> {t('Send a photo')}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-label={t('Menu')}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-gray-700 hover:bg-gray-100 lg:hidden"
          >
            <PublicIcon.menu className="h-[22px] w-[22px]" />
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label={t('Menu')}>
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="animate-drawer-in-right absolute inset-y-0 right-0 flex w-[88vw] max-w-sm flex-col overflow-y-auto overscroll-contain bg-white shadow-2xl">
            <div className="flex items-center justify-between px-5 pb-2 pt-3">
              <Logo />
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('Close menu')}
                className="grid h-11 w-11 place-items-center rounded-xl text-gray-500 hover:bg-gray-100"
              >
                <PublicIcon.close className="h-[22px] w-[22px]" />
              </button>
            </div>
            <div className="px-5 pt-2">
              <Link to="/report" className="btn-primary w-full">
                <PublicIcon.camera className="h-5 w-5 shrink-0" /> {t('Send a photo')}
              </Link>
            </div>
            <nav aria-label={t('Main navigation')} className="mt-3 flex-1 px-3">
              <ul>
                {MENU.map((item) => (
                  <li key={item.to}>
                    <Link to={item.to} className="block rounded-xl px-3 py-3 hover:bg-gray-50">
                      <span className="block font-semibold text-ink">{t(item.label)}</span>
                      <span className="mt-0.5 block text-sm text-gray-500">{t(item.hint)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="border-t border-black/5 px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-wider text-red-700">{t('Immediate danger')}</p>
              <EmergencyCalls className="mt-2" />
            </div>
            <div className="border-t border-black/5 px-5 py-3">
              {user ? (
                <Link to="/app" className="flex min-h-11 items-center text-sm font-semibold text-khozo-dark">{t('Dashboard')}</Link>
              ) : (
                <Link to="/login" className="flex min-h-11 items-center text-sm font-semibold text-gray-600">{t('Officer log in')}</Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

/* --------------------------------------------------------------- footer */

const FOOTER_LINKS = [
  { to: '/report', label: msg('Report a sighting') },
  { to: '/track-sighting', label: msg('Track a report') },
  { to: '/track-case', label: msg('Track a case') },
  { to: '/services', label: msg('Find help nearby') },
  { to: '/#families', label: msg('If someone is missing') },
  { to: '/bulletins', label: msg('How we protect privacy') },
  { to: '/grievance', label: msg('Raise a grievance') },
  { to: '/privacy', label: msg('Privacy policy') },
  { to: '/login', label: msg('Officer log in') },
];

function rich(text, parts) {
  return text.split(/\{(\w+)\}/g).map((piece, i) => (i % 2 ? <span key={i}>{parts[piece] ?? `{${piece}}`}</span> : piece));
}

export function PublicFooter() {
  const t = useT();
  return (
    <footer className="bg-ink text-gray-400">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <Logo light />
          <p className="mt-4 max-w-sm text-sm leading-relaxed">
            {rich(t('An initiative of {aegis} and {factory}, under AI for Social Good.'), {
              aegis: <span className="font-semibold text-white">Aegis School of Data Science &amp; AI</span>,
              factory: (
                <a href="https://aiproductsfactory.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-white underline hover:text-lime-300">
                  AI Products factory
                </a>
              ),
            })}
          </p>
          <p className="mt-6 text-xs font-bold uppercase tracking-wider text-lime-300">{t('Immediate danger')}</p>
          <EmergencyCalls tone="dark" className="mt-2 max-w-sm" />
        </div>
        <nav aria-label={t('Footer')} className="grid grid-cols-2 content-start gap-x-6 text-sm sm:grid-cols-3">
          {FOOTER_LINKS.map((item) => (
            <Link key={item.to} to={item.to} className="flex min-h-11 items-center hover:text-white sm:min-h-9">
              {t(item.label)}
            </Link>
          ))}
        </nav>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-5 py-5 text-xs">
          khozo.org · © {new Date().getFullYear()} · {t('Khozo is free. Nobody from Khozo will ever ask you for money.')}
        </p>
      </div>
    </footer>
  );
}

/* ---------------------------------------------------------------- share */

/**
 * Spreading the word without spreading a face. What is shared is the habit —
 * "seen someone lost? send a photo here" — and the address of the report form,
 * never a person: a photo of a child posted to a group can reach the person
 * they were taken from, and the share card itself names no one (index.html).
 */
export function ShareKhozo({ className = '', compact = false }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : SITE;
  const url = `${origin}/report`;
  const text = t('If you see a child, woman or anyone who seems lost, send a photo to Khozo. It is free, needs no login, and a police officer checks every report before anyone is contacted: {url}', { url });
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={className}>
      {!compact && (
        <>
          <h2 id="share-title" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t('Share Khozo, not a photo')}</h2>
          <p className="mt-3 max-w-2xl text-gray-600">
            {t('Please do not post photos of a child or person you think is missing on WhatsApp groups or social media. It can lead the wrong people to them. Send the photo to Khozo, where only officers see it — and share this link so more people know where to send theirs.')}
          </p>
        </>
      )}
      <div className={`flex flex-wrap gap-2 ${compact ? '' : 'mt-6'}`}>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn inline-flex bg-[#1f7a4d] text-white hover:bg-[#186440]"
        >
          <PublicIcon.whatsapp className="h-5 w-5 shrink-0" /> {t('Share on WhatsApp')}
        </a>
        {canShare && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => navigator.share({ title: 'Khozo', text, url }).catch(() => {})}
          >
            <PublicIcon.share className="h-4 w-4 shrink-0" /> {t('Share')}
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={copy} aria-live="polite">
          {copied ? <PublicIcon.check className="h-4 w-4 shrink-0 text-khozo" /> : <PublicIcon.copy className="h-4 w-4 shrink-0" />}
          {copied ? t('Link copied') : t('Copy link')}
        </button>
      </div>
    </div>
  );
}
