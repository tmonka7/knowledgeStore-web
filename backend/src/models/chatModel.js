import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

/*
 * Direct messages between two accounts.
 *
 * The previous model gave each conversation a single `ownerId` and stored
 * every message as `sender: 'me'`, so a "chat" was a private notepad that
 * nobody else could ever receive. A thread here belongs to both participants
 * and a message names its sender and its recipient, which is what makes it
 * reach the other person.
 *
 * Messages live in their own collection rather than inside the thread: a busy
 * thread would otherwise grow one document without bound, and every send would
 * rewrite the whole history.
 */
const threadSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  // Exactly two ids, always sorted, so a pair has one canonical thread no
  // matter which of the two opened it first.
  participantIds: { type: [String], required: true, index: true },
  lastMessageAt: { type: Date, default: Date.now },
  lastMessagePreview: { type: String, default: '' },
  lastMessageSenderId: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'chat_threads' });

const messageSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  threadId: { type: String, required: true, index: true },
  senderId: { type: String, required: true },
  recipientId: { type: String, required: true },
  body: { type: String, required: true },
  // Null until the recipient opens the thread; the unread badge counts these.
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now, index: true },
}, { collection: 'chat_messages' });

export const ChatThread = mongoose.models.ChatThread || mongoose.model('ChatThread', threadSchema);
export const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', messageSchema);

export const participantPair = (a, b) => [String(a), String(b)].sort();

export const getThreadsFor = (userId) => ChatThread
  .find({ participantIds: userId })
  .sort({ lastMessageAt: -1 });

/**
 * A thread is private to its two participants — administrators included.
 * Every read and write goes through this, so there is one place where that
 * rule can be checked.
 */
export const getThreadFor = (userId, threadId) => ChatThread
  .findOne({ id: threadId, participantIds: userId });

export const findOrCreateThread = async (userId, otherUserId) => {
  const participantIds = participantPair(userId, otherUserId);

  // $all with $size, rather than equality on the array, so the match cannot
  // depend on the stored order.
  const existing = await ChatThread.findOne({
    participantIds: { $all: participantIds, $size: 2 },
  });
  if (existing) return existing;

  return ChatThread.create({ id: randomUUID(), participantIds, lastMessageAt: new Date() });
};

export const createMessage = (data) => ChatMessage.create({ id: randomUUID(), ...data });

export const getMessages = (threadId, { after = null, limit = 200 } = {}) => ChatMessage
  .find({ threadId, ...(after ? { createdAt: { $gt: after } } : {}) })
  .sort({ createdAt: 1 })
  .limit(limit);

export const markThreadRead = (threadId, userId) => ChatMessage.updateMany(
  { threadId, recipientId: userId, readAt: null },
  { $set: { readAt: new Date() } },
);

/** Unread counts for every thread at once, so the list is one extra query. */
export const unreadCountsFor = async (userId) => {
  const rows = await ChatMessage.aggregate([
    { $match: { recipientId: userId, readAt: null } },
    { $group: { _id: '$threadId', count: { $sum: 1 } } },
  ]);

  return new Map(rows.map((row) => [row._id, row.count]));
};
