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
import { expiryFrom } from '../helpers/chatRetention.js';

const MESSAGE_LIMIT = 2000;
const SEARCH_LIMIT = 20;

const asPlain = (document) => (document?.toObject ? document.toObject() : document);

/**
 * What the thread list shows for its most recent message. A file with no note
 * has no text to preview, so the file's name stands in for it.
 */
const previewOf = (body, attachment) => {
  if (body) return body.slice(0, 120);
  return attachment ? `📎 ${attachment.name}`.slice(0, 120) : '';
};

/**
 * One message as the browser sees it.
 *
 * `mine` is decided here so a bubble never has to compare ids to know which
 * side it belongs on, and `expired` says plainly that the file behind an
 * attachment has been deleted — the name, already tagged, stays either way.
 */
const describeMessage = (item, me) => {
  const plain = asPlain(item);
  return {
    ...plain,
    mine: plain.senderId === me,
    attachment: plain.attachment
      ? { ...plain.attachment, expired: Boolean(plain.attachment.deletedAt) }
      : null,
  };
};

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

  return res.json({ messages: messages.map((item) => describeMessage(item, req.user.sub)) });
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

  await touchThread(thread, created, body, null, req.user.sub);

  return res.status(201).json({ message: describeMessage(created, req.user.sub) });
};

/** The denormalised preview on the thread list, so listing is one query. */
const touchThread = async (thread, created, body, attachment, senderId) => {
  thread.lastMessageAt = created.createdAt;
  thread.lastMessagePreview = previewOf(body, attachment);
  thread.lastMessageSenderId = senderId;
  await thread.save();
};

/**
 * POST /chat/threads/:threadId/attachments  (multipart: file, optional body)
 *
 * A file is sent as a message of its own, not as a property of an existing
 * one: it belongs in the conversation in the order it was sent, and it has to
 * survive the file behind it being deleted a week later.
 *
 * multer has already written the upload by the time this runs, so a rejection
 * here leaves a file nothing points at — which is exactly what the Database
 * Management cleanup collects.
 */
export const sendAttachment = async (req, res) => {
  const thread = await getThreadFor(req.user.sub, req.params.threadId);
  if (!thread) return res.status(404).json({ message: 'Conversation not found.' });

  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Choose a file to send.' });

  const body = String(req.body?.body ?? '').trim().slice(0, 4000);
  const recipientId = thread.participantIds.find((id) => id !== req.user.sub);

  const attachment = {
    // The original name is the label and the download name; on disk the file
    // carries a generated one, so two people sending 'log.txt' never collide.
    name: file.originalname,
    path: `/uploads/chat/${file.filename}`,
    size: file.size,
    mimeType: file.mimetype,
    // Set once, here: the week runs from the upload, not from the sweep.
    expiresAt: expiryFrom(),
    deletedAt: null,
  };

  const created = await createMessage({
    threadId: thread.id,
    senderId: req.user.sub,
    recipientId,
    body,
    attachment,
  });

  await touchThread(thread, created, body, attachment, req.user.sub);

  return res.status(201).json({ message: describeMessage(created, req.user.sub) });
};

export const markRead = async (req, res) => {
  const thread = await getThreadFor(req.user.sub, req.params.threadId);
  if (!thread) return res.status(404).json({ message: 'Conversation not found.' });

  const result = await markThreadRead(thread.id, req.user.sub);
  return res.json({ ok: true, updated: result.modifiedCount || 0 });
};

const RECENT_LIMIT_MAX = 20;

/**
 * GET /chat/recent?limit=5
 *
 * What the message icon in the header shows: the newest messages addressed to
 * you, and the unread total, in one request — the header polls this every few
 * seconds and a second round trip for the badge would double that for nothing.
 *
 * Only incoming messages: the header is a notification surface, and your own
 * messages are not news to you.
 */
export const recentMessages = async (req, res) => {
  const me = req.user.sub;
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), RECENT_LIMIT_MAX);

  const [messages, unread] = await Promise.all([
    ChatMessage.find({ recipientId: me }).sort({ createdAt: -1 }).limit(limit),
    ChatMessage.countDocuments({ recipientId: me, readAt: null }),
  ]);

  const senderIds = [...new Set(messages.map((item) => item.senderId))];
  const senders = await User.find({ id: { $in: senderIds } }, { id: 1, fullName: 1, username: 1 });
  const nameById = new Map(senders.map((user) => [user.id, user.fullName || user.username]));

  return res.json({
    unread,
    messages: messages.map((item) => ({
      id: item.id,
      threadId: item.threadId,
      senderId: item.senderId,
      // A sender whose account has since been deleted still has a message.
      senderName: nameById.get(item.senderId) || 'Unknown',
      preview: previewOf(item.body, item.attachment),
      createdAt: item.createdAt,
      unread: !item.readAt,
    })),
  });
};
