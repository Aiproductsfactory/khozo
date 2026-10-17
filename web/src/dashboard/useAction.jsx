// One way to run an officer's action, so none of them fails silently.
//
// Every button in the case drawer and the review queues posts to the API. Most
// of them used to `await api.post(...)` with nothing around it: a refusal from
// the server became an unhandled rejection, the button did nothing visible,
// and the officer could not tell a saved record from a lost one. Each action
// now runs through run(): while it is in flight every action button is
// disabled and "Working…" shows beside it; a failure shows the server's reason
// inline beside the button (through t(), so a translated sentence is shown
// translated and any other falls back to its English); a success shows a short
// confirmation in a toast, which stays on screen when the panel or card that
// held the button goes away because the record moved on.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { msg, useT } from '../i18n.jsx';

const IDLE = { id: '', pending: false, error: '', success: '' };
const FALLBACK_ERROR = msg('The action could not be completed. Try again.');
const OFFLINE_ERROR = msg('Could not reach the server. Check the connection and try again.');

function errorText(error) {
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  // An answer from the API (api.js sets `status`): its reason is the message.
  if (error?.status != null) return message || FALLBACK_ERROR;
  // fetch() rejects with a TypeError when the request never reached the API.
  if (error instanceof TypeError && /fetch|network|load failed/i.test(message)) return OFFLINE_ERROR;
  // Anything else is a fault in this page, not something to show an officer.
  console.error('Khozo: an action failed', error);
  return FALLBACK_ERROR;
}

/**
 * const action = useAction();
 * action.run('close-case', async () => { ... }, msg('Case closed.'));
 * <button disabled={action.pending}>…</button>
 * <ActionMessage action={action} id="close-case" />   // pending + error, inline
 * <ActionToast action={action} />                      // success, once per page
 *
 * Resolves to { ok: true, result } or { ok: false, error }; it never throws.
 */
export function useAction() {
  const [state, setState] = useState(IDLE);

  // A confirmation is not a record: it fades after a few seconds. An error
  // stays until the next action, so it cannot be missed.
  useEffect(() => {
    if (!state.success) return undefined;
    const timer = setTimeout(() => setState((s) => (s.success ? { ...s, success: '' } : s)), 6000);
    return () => clearTimeout(timer);
  }, [state.success]);

  const run = useCallback(async (id, fn, success = '') => {
    setState({ id, pending: true, error: '', success: '' });
    try {
      const result = await fn();
      setState({ id, pending: false, error: '', success });
      return { ok: true, result };
    } catch (error) {
      setState({ id, pending: false, error: errorText(error), success: '' });
      return { ok: false, error };
    }
  }, []);

  /** Shows a failure that happened outside run(), with the same look. */
  const fail = useCallback((id, error) => {
    setState({ id, pending: false, error: errorText(error), success: '' });
  }, []);

  const clear = useCallback(() => setState(IDLE), []);

  /** Shows a confirmation for something that finished outside run(). */
  const announce = useCallback((success) => setState({ ...IDLE, success }), []);

  return useMemo(
    () => ({
      run,
      fail,
      clear,
      announce,
      pending: state.pending,
      busy: (id) => state.pending && state.id === id,
      error: (id) => (state.id === id ? state.error : ''),
      lastSuccess: state.success,
    }),
    [run, fail, clear, announce, state]
  );
}

/** The pending note or the error for one action, or nothing. */
export function ActionMessage({ action, id, className = '' }) {
  const t = useT();
  if (action.busy(id)) {
    return <p role="status" className={`mt-2 text-xs font-medium text-slate-500 ${className}`}>{t('Working…')}</p>;
  }
  const error = action.error(id);
  if (error) {
    return (
      <p role="alert" className={`mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-100 ${className}`}>
        {t(error)}
      </p>
    );
  }
  return null;
}

/** The confirmation of whichever action last succeeded on this page. */
export function ActionToast({ action }) {
  const t = useT();
  const success = action.lastSuccess;
  if (!success) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[90] flex justify-center px-4 lg:bottom-4">
      <p
        role="status"
        className="pointer-events-auto max-w-lg rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-xl"
      >
        {t(success)}
      </p>
    </div>
  );
}
