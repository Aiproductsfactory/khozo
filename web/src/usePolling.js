import { useEffect, useRef } from 'react';

/**
 * Calls `fn` every `ms` while the page is on screen, and stops while it is not.
 *
 * Every console poll costs the Worker real work, and a tab left open behind
 * other windows, or overnight, kept paying it every few seconds for nobody: on
 * 20 Oct 2026 those polls were most of the requests the Free plan's CPU limit
 * cut off, many of them after midnight. The console raises no sound or desktop
 * notification, so a hidden tab has nothing to show the result to.
 *
 * Coming back to the tab refreshes at once if a poll is due, so an officer
 * returning to the console sees the current queue, and switching tabs quickly
 * does not set off a burst of requests.
 */
export function usePolling(fn, ms) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  }, [fn]);

  useEffect(() => {
    let timer = null;
    let lastRun = Date.now();
    const tick = () => {
      lastRun = Date.now();
      latest.current();
    };
    const start = () => {
      if (!timer) timer = setInterval(tick, ms);
    };
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) return stop();
      if (Date.now() - lastRun >= ms) tick();
      return start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms]);
}
