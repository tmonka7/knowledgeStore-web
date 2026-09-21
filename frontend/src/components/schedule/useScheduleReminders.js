import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api';

/**
 * Day-before reminders for schedules.
 *
 * Polls the API for anything falling tomorrow and surfaces it two ways: as a
 * count for the header bell, and — once the viewer has granted permission — as
 * a desktop notification.
 *
 * The browser's own date is sent up rather than trusting the server's: the
 * reminder should follow the calendar of whoever is looking at it.
 */

const POLL_INTERVAL = 10 * 60 * 1000;
const SEEN_KEY = 'schedule-reminders-seen';

/** Local calendar date, not UTC — toISOString() would roll over at the wrong hour. */
export const localDateKey = (date = new Date()) => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

/**
 * Occurrences already toasted, so a reminder fires once rather than on every
 * poll and every reload. Keyed by schedule and date, so a repeating schedule
 * still reminds on each occurrence.
 */
const readSeen = () => {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    // Private mode, cleared storage, or a corrupt value: start clean.
    return new Set();
  }
};

const writeSeen = (seen, keepFrom) => {
  try {
    // Drop keys for dates already past so this cannot grow without bound.
    const kept = [...seen].filter((key) => key.slice(-10) >= keepFrom);
    localStorage.setItem(SEEN_KEY, JSON.stringify(kept));
  } catch {
    // Storage being unavailable only costs us de-duplication.
  }
};

export default function useScheduleReminders({ enabled }) {
  const [reminders, setReminders] = useState([]);
  const [permission, setPermission] = useState(
    notificationsSupported() ? Notification.permission : 'unsupported',
  );
  const seenRef = useRef(null);

  if (seenRef.current === null) seenRef.current = readSeen();

  const toast = useCallback((occurrences, today) => {
    if (!notificationsSupported() || Notification.permission !== 'granted') return;

    const seen = seenRef.current;
    let added = false;

    for (const occurrence of occurrences) {
      const key = `${occurrence.scheduleId}:${occurrence.date}`;
      if (seen.has(key)) continue;

      try {
        // eslint-disable-next-line no-new
        new Notification('Tomorrow: ' + occurrence.title, {
          body: `${occurrence.date} at ${occurrence.time}${occurrence.notes ? ` — ${occurrence.notes}` : ''}`,
          tag: key, // collapses duplicates if the OS still has one on screen
        });
      } catch {
        // Some browsers throw for constructed notifications; the in-app list
        // is the fallback and still shows everything.
      }

      seen.add(key);
      added = true;
    }

    if (added) writeSeen(seen, today);
  }, []);

  const refresh = useCallback(async () => {
    const today = localDateKey();
    try {
      const { data } = await api.get('/schedules/upcoming', { params: { today } });
      const occurrences = data?.occurrences || [];
      setReminders(occurrences);
      toast(occurrences, today);
    } catch {
      // A failed poll should not clear what is already on screen.
    }
  }, [toast]);

  useEffect(() => {
    if (!enabled) {
      setReminders([]);
      return undefined;
    }

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  /**
   * Must be called from a user gesture: browsers reject permission prompts
   * that are not tied to a click.
   */
  const requestPermission = useCallback(async () => {
    if (!notificationsSupported()) return 'unsupported';

    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') refresh();
    return result;
  }, [refresh]);

  return { reminders, permission, requestPermission, refresh };
}
