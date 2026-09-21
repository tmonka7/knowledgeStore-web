import {
  ChatMessage,
  createMessage,
  findOrCreateThread,
  getMessages,
  getThreadFor,
  getThreadsFor,
  markThreadRead,
  unreadCountsFor,
} from '../models/chatModel.js';
import { User, getUserById } from '../models/userModel.js';

const MESSAGE_LIMIT = 2000;
const SEARCH_LIMIT = 20;

const asPlain = (document) => (document?.toObject ? document.toObject() : document);

const publicUser = (user) => (user ? {
  id: user.id,
  fullName: user.fullName,
  username: user.username,
  email: user.email,
  role: user.role,
  faceImage: user.faceImage || null,
} : null);

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /chat/users?q=
 *
 * Who you can start a chat with. Everyone but yourself, matched on name,
 * username or email — the full user list is admin-only, and messaging a
 * colleague should not require that.
 */
export const searchUsers = async (req, res) => {
  const query = String(req.query.q || '').trim();
  const filter = { id: { $ne: req.user.sub } };

  if (query) {
    const pattern = new RegExp(escapeRegex(query), 'i');
    filter.$or = [{ fullName: pattern }, { username: pattern }, { email: pattern }];
  }

  const users = await User.find(filter)
    .select('+faceImage')
    .sort({ fullName: 1 })
    .limit(SEARCH_LIMIT);

  return res.json({ users: users.map(publicUser) });
};

const describeThread = (thread, otherUser, unread) => ({
  id: thread.id,
  user: publicUser(otherUser),
  lastMessageAt: thread.lastMessageAt,
  lastMessagePreview: thread.lastMessagePreview,
  lastMessageSenderId: thread.lastMessageSenderId,
  unread,
});

export const listThreads = async (req, res) => {
  const me = req.user.sub;
  const threads = await getThreadsFor(me);

  const otherIds = threads.map((thread) => thread.participantIds.find((id) => id !== me)).filter(Boolean);
  const [users, unreadCounts] = await Promise.all([
    User.find({ id: { $in: otherIds } }).select('+faceImage'),
    unreadCountsFor(me),
  ]);

  const userById = new Map(users.map((user) => [user.id, user]));

  return res.json({
    threads: threads
      // A thread whose other participant has been deleted is skipped rather
      // than listed as a chat with nobody.
      .map((thread) => {
        const otherId = thread.participantIds.find((id) => id !== me);
        const otherUser = userById.get(otherId);
        return otherUser ? describeThread(thread, otherUser, unreadCounts.get(thread.id) || 0) : null;
      })
      .filter(Boolean),
  });
};

/**
 * POST /chat/threads  { userId }
 *
 * Opens the conversation with that person, creating it the first time. It is
 * idempotent, so selecting the same person twice does not make two threads.
 */
export const openThread = async (req, res) => {
  const otherUserId = String(req.body?.userId || '').trim();
  if (!otherUserId) return res.status(400).json({ message: 'Choose someone to message.' });
  if (otherUserId === req.user.sub) return res.status(400).json({ message: 'You cannot message yourself.' });

  const otherUser = await getUserById(otherUserId);
  if (!otherUser) return res.status(404).json({ message: 'That user no longer exists.' });

  const thread = await findOrCreateThread(req.user.sub, otherUserId);
  return res.json({ thread: describeThread(thread, otherUser, 0) });
};

/**
 * GET /chat/threads/:threadId/messages?after=<ISO date>
 *
 * Without `after` the whole history; with it, only what has arrived since —
 * which is what the open thread polls with, so a quiet chat costs one small
 * empty response every few seconds.
 *
 * Fetching also marks the incoming messages read: you are looking at them.
 */
export const listMessages = async (req, res) => {
  const thread = await getThreadFor(req.user.sub, req.params.threadId);
  if (!thread) return res.status(404).json({ message: 'Conversation not found.' });

  const after = req.query.after ? new Date(String(req.query.after)) : null;
  if (after && Number.isNaN(after.getTime())) {
    return res.status(400).json({ message: 'after must be an ISO date.' });
  }

  const messages = await getMessages(thread.id, { after, limit: MESSAGE_LIMIT });
  await markThreadRead(thread.id, req.user.sub);

  return res.json({
    messages: messages.map((item) => ({
      ...asPlain(item),
      // Which side of the thread a bubble sits on is the server's answer, so
      // the browser never has to compare ids to decide.
      mine: item.senderId === req.user.sub,
    })),
  });
};

export const sendMessage = async (req, res) => {
  const thread = await getThreadFor(req.user.sub, req.params.threadId);
  if (!thread) return res.status(404).json({ message: 'Conversation not found.' });

  const body = String(req.body?.body ?? req.body?.text ?? '').trim();
  if (!body) return res.status(400).json({ message: 'A message cannot be empty.' });
  if (body.length > 4000) return res.status(400).json({ message: 'That message is too long.' });

  const recipientId = thread.participantIds.find((id) => id !== req.user.sub);
  const created = await createMessage({
    threadId: thread.id,
    senderId: req.user.sub,
    recipientId,
    body,
  });

  // The preview on the thread list is denormalised so listing conversations
  // does not have to look up the last message of each one.
  thread.lastMessageAt = created.createdAt;
  thread.lastMessagePreview = body.slice(0, 120);
  thread.lastMessageSenderId = req.user.sub;
  await thread.save();

  return res.status(201).json({ message: { ...asPlain(created), mine: true } });
};

export const markRead = async (req, res) => {
  const thread = await getThreadFor(req.user.sub, req.params.threadId);
  if (!thread) return res.status(404).json({ message: 'Conversation not found.' });

  const result = await markThreadRead(thread.id, req.user.sub);
  return res.json({ ok: true, updated: result.modifiedCount || 0 });
};

/** Total unread across every thread — the number the chat badge shows. */
export const unreadTotal = async (req, res) => {
  const total = await ChatMessage.countDocuments({ recipientId: req.user.sub, readAt: null });
  return res.json({ unread: total });
};
