// Connection status (helpers/presence.js).

import { User } from '../models/userModel.js';
import { HEARTBEAT_SECONDS, PRESENCE_CHOICES, beat, leave, presenceOf } from '../helpers/presence.js';

/**
 * GET /presence — everyone's connection status, by account id:
 * { people: { [id]: { state, lastSeenAt } }, heartbeatSeconds }. Only
 * approved accounts, and nothing but the status: it is what a chat list or
 * the Users page shows beside a name.
 */
export const listPresence = async (req, res) => {
  const admin = req.currentUser.role === 'admin';
  const accounts = await User.find({ status: 'allowed' }, { id: 1, presence: 1, lastSeenAt: 1, _id: 0 }).lean();
  const people = {};
  for (const account of accounts) people[account.id] = presenceOf(account, { admin });
  res.json({ people, heartbeatSeconds: HEARTBEAT_SECONDS });
};

/**
 * POST /presence/heartbeat — { away }: the app is open (and whether its owner
 * is looking at it). Answers with the caller's own status, as others see it.
 */
export const heartbeat = async (req, res) => {
  beat(req.currentUser.id, { away: Boolean(req.body?.away) });
  res.json({ me: presenceOf(req.currentUser.toObject ? req.currentUser.toObject() : req.currentUser), heartbeatSeconds: HEARTBEAT_SECONDS });
};

/** PUT /presence/me — { status: auto | busy | away | invisible }: what others see. */
export const choosePresence = async (req, res) => {
  const choice = String(req.body?.status || '');
  if (!PRESENCE_CHOICES.includes(choice)) {
    return res.status(400).json({ message: `Status must be one of: ${PRESENCE_CHOICES.join(', ')}.` });
  }
  const account = req.currentUser;
  account.presence = choice;
  await account.save();
  beat(account.id);
  return res.json({ presence: choice, me: presenceOf(account.toObject ? account.toObject() : account) });
};

/** POST /presence/offline — the app is closing, or its owner is signing out. */
export const goOffline = async (req, res) => {
  leave(req.currentUser.id);
  res.json({ ok: true });
};
