import { useEffect, useState } from 'react';
import { useT } from './i18n.jsx';
import { getInstallState, promptInstall, subscribeInstall } from './pwa.js';

/*
 * An inline "install this app" card. It shows only when installing is
 * possible and useful:
 *
 *   - Chrome, Edge and Samsung Internet on Android (and desktop Chrome) offer
 *     their install dialog; the card's Install button opens it.
 *   - iPhone and iPad Safari have no dialog; the card says where the menu
 *     item is.
 *
 * It shows nothing when Khozo is already running as an installed app, once
 * the reader has said "not now" (remembered on this device), and on browsers
 * that cannot install. Several cards on screen at once agree with each other.
 */

const DISMISS_KEY = 'khozo.installHint.dismissed';
const dismissListeners = new Set();

function wasDismissed() {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1');
  } catch {}
  for (const fn of dismissListeners) {
    try { fn(true); } catch {}
  }
}

function isStandalone() {
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (window.matchMedia?.('(display-mode: fullscreen)').matches) return true;
    return window.navigator.standalone === true;
  } catch {
    return false;
  }
}

// iPhone or iPad Safari (iPadOS presents itself as a Mac with a touch screen).
// Other iOS browsers and in-app browsers (WhatsApp, Instagram, Facebook) put
// Add to Home Screen elsewhere or not at all, so they get no hint.
function isIosSafari() {
  try {
    const ua = window.navigator.userAgent || '';
    const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1);
    if (!ios) return false;
    return /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|FBAN|FBAV|Instagram|Line\/|WhatsApp/i.test(ua);
  } catch {
    return false;
  }
}

export default function InstallPrompt({ className = '' }) {
  const t = useT();
  const [install, setInstall] = useState(getInstallState);
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [standalone] = useState(isStandalone);
  const [ios] = useState(isIosSafari);

  useEffect(() => {
    const unsubscribe = subscribeInstall(setInstall);
    dismissListeners.add(setDismissed);
    return () => {
      unsubscribe();
      dismissListeners.delete(setDismissed);
    };
  }, []);

  if (standalone || install.installed || dismissed) return null;
  const mode = install.canPrompt ? 'prompt' : ios ? 'ios' : null;
  if (!mode) return null;

  const onInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === 'dismissed') rememberDismissed();
  };

  return (
    <div
      role="region"
      aria-label={t('Install Khozo')}
      className={`flex items-start gap-3 rounded-2xl border border-khozo/25 bg-khozo-light p-3 text-ink ${className}`}
    >
      <img src="/icons/icon-192.png" alt="" width="40" height="40" className="mt-0.5 h-10 w-10 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        {mode === 'prompt' ? (
          <>
            <p className="font-semibold text-khozo-dark">{t('Install Khozo on this phone')}</p>
            <p className="mt-0.5 text-sm text-gray-700">{t('Opens like an app and keeps working on a weak signal.')}</p>
            <button
              type="button"
              onClick={onInstall}
              className="mt-2 inline-flex min-h-11 items-center justify-center rounded-xl bg-khozo px-5 text-sm font-semibold text-white transition-colors hover:bg-khozo-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-khozo/50 focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              {t('Install')}
            </button>
          </>
        ) : (
          <p className="pt-2 text-sm text-gray-800">
            {t('Install Khozo: tap Share, then Add to Home Screen.')}
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="ml-1 inline-block align-text-bottom text-khozo-dark"
            >
              <path d="M12 3v12M8 7l4-4 4 4" />
              <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
            </svg>
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={rememberDismissed}
        aria-label={t('Not now')}
        title={t('Not now')}
        className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-2xl leading-none text-gray-500 hover:bg-white/70 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-khozo/50"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
