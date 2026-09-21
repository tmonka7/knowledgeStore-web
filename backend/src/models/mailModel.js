import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

/*
 * Internal mail between accounts on this installation.
 *
 * The previous model gave every message a single `ownerId`, addressed `to` as
 * free text and filed everything it created under 'Draft' — so sending mail
 * wrote a note to yourself that no recipient could ever receive. It is
 * replaced rather than extended, for the same reason chat was: none of those
 * fields describe a message with two ends.
 *
 * One document per message, with a row per recipient, rather than a copy per
 * mailbox. That is what makes the open status answerable: the sender's copy
 * *is* the recipients' copy, so `readAt` on a recipient row is the same fact
 * the sender reads back as "opened at 14:12".
 */
const recipientSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  // Denormalised so a mailbox lists without a join, and still reads properly
  // after the account is deleted.
  name: { type: String, default: '' },
  // Null until they open it. This is the open tracking.
  readAt: { type: Date, default: null },
  // Removing a message from your own mailbox does not remove it from anyone
  // else's, so a delete is per person rather than a delete of the message.
  deletedAt: { type: Date, default: null },
}, { _id: false });

const mailSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  senderId: { type: String, required: true, index: true },
  senderName: { type: String, default: '' },
  subject: { type: String, default: '' },
  body: { type: String, default: '' },
  preview: { type: String, default: '' },
  recipients: { type: [recipientSchema], default: [] },
  // The ids again, flat, so "my inbox" is an indexed query.
  recipientIds: { type: [String], default: [], index: true },
  attachment: { type: String, default: '' },
  attachmentName: { type: String, default: '' },
  attachmentSize: { type: Number, default: 0 },
  // Set when a reply; the thread is not rebuilt from subject lines.
  replyToId: { type: String, default: '' },
  sentAt: { type: Date, default: Date.now, index: true },
  deletedBySender: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'mail_messages' });

export const Mail = mongoose.models.Mail || mongoose.model('Mail', mailSchema);

export const createMailMessage = (data) => Mail.create({ id: randomUUID(), ...data });

/** Messages addressed to this account that they have not deleted. */
export const getInbox = (userId) => Mail
  .find({ recipients: { $elemMatch: { userId, deletedAt: null } } })
  .sort({ sentAt: -1 });

/** Messages this account sent and has not deleted. */
export const getSent = (userId) => Mail
  .find({ senderId: userId, deletedBySender: false })
  .sort({ sentAt: -1 });

/**
 * One message, if this account is allowed to see it.
 *
 * Sender or recipient — there is no administrator bypass, for the same reason
 * chat has none: mail between two people is theirs.
 */
export const getMailFor = (userId, id) => Mail.findOne({
  id,
  $or: [{ senderId: userId }, { recipientIds: userId }],
});

export const countUnread = (userId) => Mail.countDocuments({
  recipients: { $elemMatch: { userId, readAt: null, deletedAt: null } },
});
