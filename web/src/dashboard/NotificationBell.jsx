import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { asList, timeAgo, txt } from '../lib.jsx';
import { useT } from '../i18n.jsx';

const POLL_MS = 20000;

/**
 * Live alert inbox for the signed-in officer.
 *
 * Every authority account is notified the moment a child is spotted, so this is
 * where a public report becomes someone's responsibility. It polls rather than
 * holding a socket open: the Worker runtime is request-scoped, and a twenty
 * second inbox refresh is well inside the window that matters for a sighting
 * that still has to be read, judged and acted on by a person.
 *
 * `onConnectionChange` reports whether the last poll reached the API, so the
 * header can say so honestly instead of always claiming to be connected.
 */
export default function NotificationBell({ onConnectionChange }) {
  const t = useT();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const nav = useNavigate();

  const load = useCallback(async () => {
    try {
      const data = await api.get('/dashboard/notifications');
      // A malformed alert is dropped here rather than rendered.
      setItems(asList(data?.notifications).filter((n) => n && typeof n === 'object'));
      setUnread(Number(data?.unread) || 0);
      onConnectionChange?.(true);
    } catch {
      onConnectionChange?.(false);
    }
  }, [onConnectionChange]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    function onClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const markAllRead = async () => {
    try {
      await api.post('/dashboard/notifications/read', {});
      setUnread(0);
      setItems((rows) => rows.map((r) => ({ ...r, readAt: r.readAt || Date.now() })));
    } catch {
      // The badge corrects itself on the next poll.
    }
  };

  // An alert is about one record, so it opens that record. Landing on a list of
  // twenty-five and expecting the officer to find the new one is how the report
  // that prompted the alert gets lost.
  const openAlert = (item) => {
    setOpen(false);
    // Matches renders only sightings that carry a matched case. Sending an
    // unmatched sighting's alert there lands the officer on an empty page while
    // the record sits on Sightings. Alerts raised before this shipped carry no
    // `matched` flag; those keep the old destination.
    if (item.scope?.foundReportId) {
      const page = item.scope.matched === false ? '/app/sightings' : '/app/matches';
      nav(`${page}?id=${encodeURIComponent(item.scope.foundReportId)}`);
    }
    else if (item.scope?.reportId) nav(`/app/cases?id=${encodeURIComponent(item.scope.reportId)}`);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        data-notification-bell
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={unread === 1 ? t('1 unread alert') : unread ? t('{n} unread alerts', { n: unread }) : t('Alerts')}
        className="relative grid h-10 w-10 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-khozo/40 sm:h-11 sm:w-11"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" /><path d="M10 20a2.2 2.2 0 0 0 4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        /*
          On a phone the inbox spans the screen under the header: anchored to
          the bell, a 24rem panel ran off the left edge.
        */
        <div className="fixed inset-x-2 top-16 z-50 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96 sm:max-w-[calc(100vw-2rem)]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 sm:py-3">
            <p className="text-sm font-bold text-slate-900">{t('Alerts')}</p>
            {unread > 0 && (
              <button onClick={markAllRead} className="px-2 text-xs font-semibold text-khozo-dark hover:underline">
                {t('Mark all read')}
              </button>
            )}
          </div>

          <div className="max-h-[calc(100dvh-10rem)] overflow-y-auto overscroll-contain sm:max-h-96">
            {items.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-slate-400">
                {t('No alerts yet. You will be notified here the moment a child is reported spotted.')}
              </p>
            )}
            {items.map((item, i) => (
              <button
                key={txt(item.id) || i}
                onClick={() => openAlert(item)}
                className={`flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50 ${
                  item.readAt ? 'opacity-60' : ''
                }`}
              >
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    item.priority === 'high' ? 'bg-rose-500' : item.readAt ? 'bg-slate-300' : 'bg-khozo'
                  }`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">{txt(item.title)}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{txt(item.body)}</span>
                  <span className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                    {timeAgo(item.ts)}
                    {item.inJurisdiction && (
                      <span className="rounded-full bg-khozo-light px-1.5 py-0.5 font-semibold text-khozo-dark">
                        {t('Your area')}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
