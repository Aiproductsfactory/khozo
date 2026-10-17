// Interface language: English, Gujarati, Hindi and Marathi.
//
// The English text is the key. `t('Report a missing child')` looks the string
// up in the active language's dictionary and falls back to the English when
// there is no translation, so an untranslated string degrades to readable
// English instead of a raw key, and wrapping a string never breaks a page.
//
// Dictionaries live in ./locales/<lang>/*.json, one file per area of the app,
// and are merged here. `npm run i18n:check` lists strings that are wrapped in
// t() but missing from a dictionary.
//
// Only the reader's language is downloaded: each language is its own chunk
// (vite.config.js), fetched before the first render (main.jsx awaits
// loadLanguage) and again when the reader switches. English needs nothing, so
// a phone on a slow network that reads English fetches no dictionary at all,
// and t() at module level still works: until a dictionary arrives it returns
// the English, exactly as it does for a string with no translation.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN', locale: 'en-IN' },
  { code: 'gu', label: 'ગુજરાતી', short: 'ગુ', locale: 'gu-IN' },
  { code: 'hi', label: 'हिन्दी', short: 'हि', locale: 'hi-IN' },
  { code: 'mr', label: 'मराठी', short: 'म', locale: 'mr-IN' },
];

const CODES = LANGUAGES.map((l) => l.code);
const STORAGE_KEY = 'khozo.lang';

const loaders = import.meta.glob('./locales/*/*.json', { import: 'default' });
const DICTS = { en: {} };
const pending = {};

/**
 * Fetches and merges one language's dictionaries. Resolves (never rejects)
 * once they are in, or once fetching failed — offline with nothing cached —
 * in which case the interface stays readable in English.
 */
export function loadLanguage(lang) {
  if (!CODES.includes(lang) || DICTS[lang]) return Promise.resolve();
  if (!pending[lang]) {
    const parts = Object.entries(loaders).filter(([file]) => file.split('/')[2] === lang);
    pending[lang] = Promise.all(parts.map(([, load]) => load()))
      .then((dicts) => {
        DICTS[lang] = Object.assign({}, ...dicts);
      })
      .catch(() => {
        delete pending[lang];
      });
  }
  return pending[lang];
}

function initialLanguage() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (CODES.includes(fromUrl)) return fromUrl;
  } catch {}
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (CODES.includes(saved)) return saved;
  } catch {}
  return 'en';
}

// Module-level so helpers outside components (fmtDate, label tables) can
// translate too. Components still call useT() so they re-render on a switch.
let current = initialLanguage();

/** The dictionary the first render needs; main.jsx waits for it. */
export const languageReady = loadLanguage(current);

function interpolate(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] != null ? String(vars[name]) : m));
}

export function t(text, vars) {
  if (text == null || text === '') return text;
  const translated = current === 'en' ? text : DICTS[current]?.[text];
  return interpolate(translated || text, vars);
}

// Marks a string for translation without translating it — for label tables
// and other constants built at import time. Translate at render with t(value).
export const msg = (text) => text;

export function currentLanguage() {
  return current;
}

export function currentLocale() {
  return LANGUAGES.find((l) => l.code === current)?.locale || 'en-IN';
}

const LanguageContext = createContext({ lang: current, setLang: () => {} });

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(current);

  const setLang = useCallback((next) => {
    if (!CODES.includes(next)) return;
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch {}
    // Switch once the words have arrived, so the page never shows half a
    // language. A failed fetch still switches; t() falls back to English.
    loadLanguage(next).then(() => {
      current = next;
      setLangState(next);
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** Returns t, and re-renders the calling component when the language changes. */
export function useT() {
  useContext(LanguageContext);
  return t;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

/**
 * Compact language picker. `light` is for dark or brand-coloured headers.
 * A native <select> because it is keyboard and screen-reader friendly for free
 * and opens the phone's own picker on mobile.
 */
export function LanguageSwitcher({ light = false, className = '' }) {
  const { lang, setLang } = useLanguage();
  return (
    <label className={`relative inline-flex items-center ${className}`}>
      <span className="sr-only">Language</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
        className={`pointer-events-none absolute left-2.5 ${light ? 'text-white/80' : 'text-gray-500'}`}>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
      </svg>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        className={`cursor-pointer appearance-none rounded-lg border py-1.5 pl-8 pr-3 text-sm font-medium outline-none focus:ring-2 focus:ring-khozo/40 ${
          light ? 'border-white/30 bg-white/10 text-white' : 'border-gray-200 bg-white text-ink'
        }`}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} className="text-ink">
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
