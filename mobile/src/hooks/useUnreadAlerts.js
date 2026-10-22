import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { officerApi } from '../services/api';
import { useAuth } from '../services/auth';
import { PUSHED_KINDS, configureAlerts, ensureAlertPermission, presentAlert } from '../services/alerts';

const POLL_MS = 20000;
// With push set up, the alerts that must ring arrive by push the moment they
// are raised, and every poll costs the server CPU it has little of.
const POLL_MS_WITH_PUSH = 60000;
const LAST_SEEN_KEY = 'khozo.alerts.lastSeenTs';

/**
 * Polls this officer's alerts, raises a device notification for each new one,
 * and returns the unread count for the tab badge.
 *
 * Two rules keep it from becoming noise, which is the only way an alert stops
 * working:
 *
 *   * The first poll after launch sets a baseline and announces nothing.
 *     Otherwise opening the app would fire one notification per unread alert.
 *   * The newest timestamp already announced is persisted, so a restart does
 *     not re-announce what the officer has already been told.
 */
export function useUnreadAlerts() {
  const { token, canReviewSightings, push } = useAuth();
  const pushed = push?.status === 'registered';
  const [unread, setUnread] = useState(0);
  const lastSeenTs = useRef(0);
  const baselineSet = useRef(false);

  useEffect(() => {
    if (!token || !canReviewSightings) {
      setUnread(0);
      return undefined;
    }

    let alive = true;
    baselineSet.current = false;

    const start = async () => {
      await configureAlerts().catch(() => {});
      await ensureAlertPermission().catch(() => {});
      const stored = await AsyncStorage.getItem(LAST_SEEN_KEY).catch(() => null);
      lastSeenTs.current = Number(stored) || 0;
    };

    const poll = async () => {
      try {
        const data = await officerApi.notifications(token);
        if (!alive) return;

        setUnread(data?.unread || 0);
        const rows = data?.notifications || [];
        const newest = rows.reduce((max, row) => Math.max(max, Number(row.ts) || 0), 0);

        if (!baselineSet.current) {
          // First poll of this session: adopt whatever is already there without
          // announcing it.
          baselineSet.current = true;
          lastSeenTs.current = Math.max(lastSeenTs.current, newest);
          await AsyncStorage.setItem(LAST_SEEN_KEY, String(lastSeenTs.current)).catch(() => {});
          return;
        }

        // A station alert this phone was already pushed is not raised twice.
        const fresh = rows
          .filter((row) => (Number(row.ts) || 0) > lastSeenTs.current && !row.readAt)
          .filter((row) => !(pushed && PUSHED_KINDS.has(row.kind)))
          .sort((a, b) => a.ts - b.ts);

        for (const row of fresh) {
          // eslint-disable-next-line no-await-in-loop
          await presentAlert({
            title: row.title,
            body: row.body,
            scope: row.scope || {},
            priority: row.priority,
            kind: row.kind,
          });
        }

        if (newest > lastSeenTs.current) {
          lastSeenTs.current = newest;
          await AsyncStorage.setItem(LAST_SEEN_KEY, String(newest)).catch(() => {});
        }
      } catch {
        // Keep the last known count rather than flashing the badge away on a
        // dropped request.
      }
    };

    start().then(poll);
    const timer = setInterval(poll, pushed ? POLL_MS_WITH_PUSH : POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token, canReviewSightings, pushed]);

  return unread;
}
