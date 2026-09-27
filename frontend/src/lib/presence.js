// Connection status (the API's /presence, backend/src/helpers/presence.js).
//
// While signed in the app sends a heartbeat every 30 seconds, and one at once
// when the tab is hidden or shown or its owner goes idle, so others see them
// online, away or offline; and it reads everyone's status every 20 seconds
// for the dots beside names. One store for the whole app: the header, Chat and
// the Users page read it with usePresence().

import { useSyncExternalStore } from 'react';
import api from '../api';

export const PRESENCE_CHOICES = ['auto', 'busy', 'away', 'invisible'];
export const PRESENCE_COLORS = {
  online: '#22c55e', away: '#f59e0b', busy: '#ef4444', offline: '#9ca3af',
};
// What the chooser's "auto" and "invisible" look like to their owner.
export const CHOICE_STATE = {
  auto: 'online', busy: 'busy', away: 'away', invisible: 'offline',
};

const LIST_MS = 20 * 1000;
const IDLE_MS = 5 * 60 * 1000;

let snapshot = { people: {}, me: null, choice: 'auto' };
const listeners = new Set();
const set = (patch) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
};
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** { people: { [id]: { state, lastSeenAt, connected?, choice? } }, me, choice } */
export const usePresence = () => useSyncExternalStore(subscribe, () => snapshot);

let running = null; // { timers, cleanup }
let lastInput = Date.now();
let wasAway = false;

const away = () => document.hidden || Date.now() - lastInput > IDLE_MS;

const heartbeat = async () => {
  wasAway = away();
  try {
    const { data } = await api.post('/presence/heartbeat', { away: wasAway });
    set({ me: data.me });
  } catch {
    // The next one will do; a refused account is signed out by App's interceptor.
  }
};

export const refreshPresence = async () => {
  try {
    const { data } = await api.get('/presence');
    set({ people: data.people || {} });
  } catch {
    // The dots keep their last state until the next read.
  }
};

/** Start the heartbeat and the reading, for the account signed in (its chosen status is `choice`). */
export const startPresence = (choice = 'auto') => {
  if (running) return;
  set({ choice: PRESENCE_CHOICES.includes(choice) ? choice : 'auto' });
  heartbeat().then(refreshPresence);
  const onInput = () => {
    lastInput = Date.now();
    if (wasAway && !document.hidden) heartbeat();
  };
  const onVisibility = () => heartbeat();
  // Closing the tab: say so at once rather than waiting for the heartbeats to stop.
  const onPageHide = () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      fetch(`${api.defaults.baseURL}/presence/offline`, {
        method: 'POST', keepalive: true, headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Best effort: the heartbeats stopping says the same a minute later.
    }
  };
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  events.forEach((name) => window.addEventListener(name, onInput, { passive: true }));
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  const timers = [
    setInterval(heartbeat, 30 * 1000),
    setInterval(refreshPresence, LIST_MS),
    // Going idle is noticed here, without waiting for the next heartbeat.
    setInterval(() => { if (!wasAway && away()) heartbeat(); }, 30 * 1000),
  ];
  running = {
    timers,
    cleanup: () => {
      events.forEach((name) => window.removeEventListener(name, onInput));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    },
  };
};

/** Stop, and with `signOut` tell the server this account is offline now (before the token goes). */
export const stopPresence = ({ signOut = false } = {}) => {
  if (!running) return;
  running.timers.forEach(clearInterval);
  running.cleanup();
  running = null;
  // Only once, and with the token given here: sign-out removes it straight
  // after, and a blocked account's refusal signs it out again, which must not
  // send this again.
  const token = localStorage.getItem('token');
  if (signOut && token) {
    api.post('/presence/offline', null, { timeout: 3000, headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  set({ people: {}, me: null, choice: 'auto' });
};

/** Choose what others see: auto (online while the app is open), busy, away, or appear offline. */
export const choosePresence = async (choice) => {
  const { data } = await api.put('/presence/me', { status: choice });
  set({ choice: data.presence, me: data.me });
  refreshPresence();
};
