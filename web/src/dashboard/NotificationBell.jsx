import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { timeAgo } from '../lib.jsx';

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
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const nav = useNavigate();

  const load = useCallback(async () => {
    try {
      const data = await api.get('/dashboard/notifications');
      setItems(data.notifications || []);
      setUnread(data.unread || 0);
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
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `${unread} unread alerts` : 'Alerts'}
        className="relative rounded-full p-2.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all duration-200 focus:outline-none ring-2 ring-transparent focus:ring-indigo-100"
      >
        <span className="text-lg leading-none">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-bold text-slate-900">Alerts</p>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs font-semibold text-indigo-600 hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-slate-400">
                No alerts yet. You will be notified here the moment a child is reported spotted.
              </p>
            )}
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => openAlert(item)}
                className={`flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50 ${
                  item.readAt ? 'opacity-60' : ''
                }`}
              >
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    item.priority === 'high' ? 'bg-rose-500' : item.readAt ? 'bg-slate-300' : 'bg-indigo-500'
                  }`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">{item.title}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{item.body}</span>
                  <span className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                    {timeAgo(item.ts)}
                    {item.inJurisdiction && (
                      <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-600">
                        Your jurisdiction
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
