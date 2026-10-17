import { useEffect, useRef, useState } from 'react';
import { useT } from './i18n.jsx';
import { copyText, trackUrl } from './myReports.js';

/**
 * Copy and share buttons for a sighting receipt number. Sharing uses the
 * phone's own share sheet (WhatsApp, SMS, a note to self) and sends the number
 * with a link that opens the tracking page with it filled in. Only the number
 * travels: nothing about the person who was seen.
 */
export default function ReceiptActions({ id, className = '', align = 'center' }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    if (await copyText(id)) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
    }
  };

  const share = async () => {
    try {
      await navigator.share({
        title: t('Khozo receipt'),
        text: t('My Khozo sighting receipt number is {id}. Check its status here:', { id }),
        url: trackUrl(id),
      });
    } catch {
      // Cancelled, or the share sheet is unavailable: nothing to do.
    }
  };

  return (
    <div className={`flex flex-wrap gap-2 ${align === 'start' ? 'justify-start' : 'justify-center'} ${className}`}>
      <button type="button" className="btn-ghost" onClick={copy}>
        <span aria-hidden="true">{copied ? '✓' : '⧉'}</span>
        <span role="status" aria-live="polite">{copied ? t('Copied') : t('Copy number')}</span>
      </button>
      {canShare && (
        <button type="button" className="btn-ghost" onClick={share}>
          <span aria-hidden="true">↗</span> {t('Share')}
        </button>
      )}
    </div>
  );
}
