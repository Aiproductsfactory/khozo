import { useEffect, useState } from 'react';

import { officerApi } from '../services/api';
import { useAuth } from '../services/auth';

const POLL_MS = 20000;

/**
 * Unread alert count for the tab badge.
 *
 * Polled rather than pushed: reaching a locked phone needs an FCM credential
 * the project does not hold yet, and an officer with the app open is the case
 * this has to serve correctly first.
 */
export function useUnreadAlerts() {
  const { token, canReviewSightings } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!token || !canReviewSightings) {
      setUnread(0);
      return undefined;
    }
    let alive = true;
    const load = async () => {
      try {
        const data = await officerApi.notifications(token);
        if (alive) setUnread(data?.unread || 0);
      } catch {
        // Keep the last known count rather than flashing the badge away.
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token, canReviewSightings]);

  return unread;
}
