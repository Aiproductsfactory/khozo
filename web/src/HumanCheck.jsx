import { useEffect, useRef } from 'react';
import { HUMAN_CHECK_ACTION } from '../../shared/human-check.js';

/*
 * Cloudflare Turnstile on the public sighting form (shared/human-check.js).
 *
 * Renders nothing without a site key, which the server gives only when the
 * check is switched on. Most people never see it: "interaction-only" shows a
 * box only when Cloudflare needs one. A blocked script, a weak signal or an
 * old browser leaves the report to go without a token, never stopped: the
 * server accepts it and holds it to a tighter rate limit.
 *
 * A token is redeemed once. `resetKey` changing (after each send attempt)
 * asks the widget for a fresh one.
 */

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptLoading = null;

function loadTurnstile() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptLoading) {
    scriptLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')));
      script.onerror = () => {
        scriptLoading = null;
        reject(new Error('turnstile blocked'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptLoading;
}

export default function HumanCheck({ siteKey, onToken, resetKey = 0, className = '' }) {
  const box = useRef(null);
  const widget = useRef(null);
  const tokenTo = useRef(onToken);
  tokenTo.current = onToken;

  useEffect(() => {
    if (!siteKey) return undefined;
    let gone = false;
    loadTurnstile()
      .then((turnstile) => {
        if (gone || !box.current) return;
        widget.current = turnstile.render(box.current, {
          sitekey: siteKey,
          action: HUMAN_CHECK_ACTION,
          appearance: 'interaction-only',
          'refresh-expired': 'auto',
          callback: (token) => tokenTo.current(token),
          'expired-callback': () => tokenTo.current(''),
          'error-callback': () => tokenTo.current(''),
        });
      })
      .catch(() => {});
    return () => {
      gone = true;
      tokenTo.current('');
      if (widget.current != null) {
        try { window.turnstile?.remove(widget.current); } catch {}
        widget.current = null;
      }
    };
  }, [siteKey]);

  useEffect(() => {
    if (!resetKey || widget.current == null) return;
    tokenTo.current('');
    try { window.turnstile?.reset(widget.current); } catch {}
  }, [resetKey]);

  if (!siteKey) return null;
  return <div ref={box} className={className} />;
}
