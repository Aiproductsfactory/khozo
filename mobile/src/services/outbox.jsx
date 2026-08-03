import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { useAuth } from './auth';
import * as queue from './queue';

const OutboxContext = createContext(null);

/**
 * Owns the sighting outbox and decides when to drain it.
 *
 * Flush triggers: app start, regaining connectivity, returning to the
 * foreground, and an explicit "Retry now" from the user.
 */
export function OutboxProvider({ children }) {
  const { token } = useAuth();
  const [items, setItems] = useState([]);
  const [online, setOnline] = useState(true);
  const [flushing, setFlushing] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  // Read inside callbacks so listeners registered once always see fresh values.
  const tokenRef = useRef(token);
  const flushingRef = useRef(false);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    queue.loadQueue();
    return queue.subscribe(setItems);
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current) return null;
    flushingRef.current = true;
    setFlushing(true);
    try {
      const result = await queue.flush({ token: tokenRef.current });
      setLastResult({ ...result, at: Date.now() });
      return result;
    } finally {
      flushingRef.current = false;
      setFlushing(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      const reachable = Boolean(state.isConnected) && state.isInternetReachable !== false;
      setOnline(reachable);
      if (reachable) flush();
    });

    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') flush();
    });

    flush();

    return () => {
      unsubscribeNet();
      appStateSub.remove();
    };
  }, [flush]);

  const value = useMemo(
    () => ({
      items,
      pendingCount: items.filter((item) => !item.permanentError).length,
      blockedCount: items.filter((item) => item.permanentError).length,
      online,
      flushing,
      lastResult,
      flush,
      enqueue: queue.enqueue,
      discard: queue.discard,
      loadReceipts: queue.loadReceipts,
      rememberReceipt: queue.rememberReceipt,
    }),
    [items, online, flushing, lastResult, flush],
  );

  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

export function useOutbox() {
  const context = useContext(OutboxContext);
  if (!context) throw new Error('useOutbox must be used inside <OutboxProvider>');
  return context;
}
