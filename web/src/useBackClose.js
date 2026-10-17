import { useEffect, useRef } from 'react';

// Each open overlay gets a number; a later (stacked) one has a larger number.
let counter = 0;

/**
 * Lets the phone's Back button close a sheet, menu or dialog instead of
 * leaving the page under it — what anyone who uses an Android phone expects.
 *
 * While `open`, one history entry is added on top of the current page (same
 * URL, so the router sees no navigation). Back removes it and calls `onClose`.
 * Closing from the page itself (×, Cancel, a save) removes that entry again,
 * so the next Back leaves the page as usual. Overlays stack: Back closes the
 * dialog on top and leaves the sheet under it open.
 */
export function useBackClose(open, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const mine = ++counter;
    try {
      window.history.pushState({ ...(window.history.state || {}), khozoOverlay: mine }, '');
    } catch {
      // History unavailable: the overlay still closes from its own buttons.
      return undefined;
    }
    let popped = false;
    const onPop = (event) => {
      const at = Number(event.state?.khozoOverlay) || 0;
      if (at < mine) {
        popped = true;
        closeRef.current?.();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (popped) return;
      // Deferred: in development React mounts effects twice, and the second
      // mount has already pushed its own entry by the time this runs.
      setTimeout(() => {
        try {
          if (window.history.state?.khozoOverlay === mine) window.history.back();
        } catch {}
      }, 0);
    };
  }, [open]);
}
