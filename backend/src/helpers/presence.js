// Connection status: who has the app open right now, and what they chose to show.
//
// The app sends a heartbeat every 30 seconds while it is open, and one at once
// when its tab is hidden or shown again or its owner goes idle. An account is
// connected while its last heartbeat is recent, and "away" when the app said
// its owner is not looking at it. What others see can be overridden by the
// status the owner chose: busy, away, or appear offline (invisible).
//
// Kept in memory: after a restart everybody reads as offline until their next
// heartbeat, seconds later. The last time an account was seen is also written
// to it, at most once a minute, so "last seen" survives a restart.

import { User } from '../models/userModel.js';

export const PRESENCE_CHOICES = ['auto', 'busy', 'away', 'invisible'];
export const HEARTBEAT_SECONDS = 30;
// Two heartbeats missed, and a little slack for a slow network.
const CONNECTED_MS = (HEARTBEAT_SECONDS * 2 + 15) * 1000;
const SAVE_MS = 60 * 1000;

/** userId -> { at, away, savedAt } */
const seen = new Map();

const save = (userId, at) => User.updateOne({ id: userId }, { $set: { lastSeenAt: new Date(at) } }).catch(() => {});

/** Record a heartbeat from an account's open app. */
export const beat = (userId, { away = false } = {}) => {
  const now = Date.now();
  const entry = seen.get(userId) || { savedAt: 0 };
  entry.at = now;
  entry.away = Boolean(away);
  seen.set(userId, entry);
  if (now - entry.savedAt >= SAVE_MS) {
    entry.savedAt = now;
    save(userId, now);
  }
};

/** The account closed the app or signed out, or was blocked: offline from now. */
export const leave = (userId) => {
  const entry = seen.get(userId);
  seen.delete(userId);
  if (entry?.at) save(userId, entry.at);
};

export const isConnected = (userId) => {
  const entry = seen.get(userId);
  return Boolean(entry && Date.now() - entry.at < CONNECTED_MS);
};

/**
 * What a viewer sees of an account: { state, lastSeenAt } where state is
 * online, away, busy or offline. Appearing offline hides the last-seen time
 * too. An administrator also sees `connected`, the truth behind a chosen
 * status, since blocking someone is about whether they are really there.
 */
export const presenceOf = (account, { admin = false } = {}) => {
  const entry = seen.get(account.id);
  const connected = isConnected(account.id);
  const choice = PRESENCE_CHOICES.includes(account.presence) ? account.presence : 'auto';
  let state = 'offline';
  if (connected && choice !== 'invisible') {
    if (choice === 'busy') state = 'busy';
    else if (choice === 'away' || entry.away) state = 'away';
    else state = 'online';
  }
  const lastSeen = connected ? new Date(entry.at) : account.lastSeenAt || null;
  const shown = {
    state,
    lastSeenAt: choice === 'invisible' && !admin ? null : lastSeen,
  };
  if (admin) Object.assign(shown, { connected, choice });
  return shown;
};

/** Forget accounts that stopped sending heartbeats long ago, so the map does not grow for ever. */
const sweep = setInterval(() => {
  const cutoff = Date.now() - CONNECTED_MS * 4;
  for (const [userId, entry] of seen) {
    if (entry.at < cutoff) leave(userId);
  }
}, 5 * 60 * 1000);
sweep.unref?.();
