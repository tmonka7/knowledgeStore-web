import {
  countUnread,
  createMailMessage,
  getInbox,
  getMailFor,
  getSent,
} from '../models/mailModel.js';
import { User, getUserById } from '../models/userModel.js';

const MAX_SUBJECT = 200;
const MAX_BODY = 200_000;
const MAX_RECIPIENTS = 50;

const asPlain = (document) => (document?.toObject ? document.toObject() : document);

const timeLabel = (value) => new Date(value).toLocaleString([], {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * A message as one mailbox sees it.
 *
 * `folder` says which side the caller is on, and the open tracking is shaped
 * for each: a recipient gets `unread` — whether *they* have opened it — while
 * the sender gets `openedCount` and the per-recipient `readAt`, which is the
 * whole point of storing one document instead of a copy per mailbox.
 */
const describeMail = (mail, userId) => {
  const plain = asPlain(mail);
  const mine = plain.senderId === userId;
  const me = (plain.recipients || []).find((person) => person.userId === userId);

  return {
    id: plain.id,
    senderId: plain.senderId,
    senderName: plain.senderName,
    subject: plain.subject,
    body: plain.body,
    preview: plain.preview,
    attachment: plain.attachment,
    attachmentName: plain.attachmentName,
    attachmentSize: plain.attachmentSize,
    replyToId: plain.replyToId,
    sentAt: plain.sentAt,
    timeLabel: timeLabel(plain.sentAt),
    folder: mine ? 'sent' : 'inbox',
    recipients: (plain.recipients || []).map((person) => ({
      userId: person.userId,
      name: person.name,
      readAt: person.readAt,
    })),
    recipientNames: (plain.recipients || []).map((person) => person.name).filter(Boolean),
    openedCount: (plain.recipients || []).filter((person) => person.readAt).length,
    // Only meaningful in an inbox; a sender has read their own message by
    // definition, so it is never shown as unread to them.
    unread: Boolean(me) && !me.readAt,
    readAt: me?.readAt || null,
  };
};

export const listMail = async (req, res) => {
  const me = req.user.sub;
  const folder = String(req.query.folder || 'inbox').toLowerCase() === 'sent' ? 'sent' : 'inbox';

  const [mails, unread] = await Promise.all([
    folder === 'sent' ? getSent(me) : getInbox(me),
    countUnread(me),
  ]);

  return res.json({ folder, unread, mails: mails.map((mail) => describeMail(mail, me)) });
};

/**
 * GET /mail/:mailId
 *
 * Reading a message is what marks it open, and the stamp is written once: a
 * second read must not move the time the sender is shown.
 */
export const getMail = async (req, res) => {
  const me = req.user.sub;
  const mail = await getMailFor(me, req.params.mailId);
  if (!mail) return res.status(404).json({ message: 'Mail not found.' });

  const recipient = mail.recipients.find((person) => person.userId === me);
  if (recipient && !recipient.readAt) {
    recipient.readAt = new Date();
    await mail.save();
  }

  return res.json({ mail: describeMail(mail, me) });
};

export const unreadCount = async (req, res) => {
  const unread = await countUnread(req.user.sub);
  return res.json({ unread });
};

const readRecipientIds = (body = {}) => {
  let raw = body.to;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return [];
    if (text.startsWith('[')) {
      try {
        raw = JSON.parse(text);
      } catch (error) {
        return null;
      }
    } else raw = text.split(',');
  }
  if (!Array.isArray(raw)) return null;

  return [...new Set(raw.map((value) => String(value).trim()).filter(Boolean))];
};

/**
 * POST /mail  (multipart)
 *
 * `to` is a list of account ids, not an address: this mail never leaves the
 * installation, so a typed address would be a message with nowhere to go —
 * which is exactly what the previous version produced.
 */
export const createMail = async (req, res) => {
  const me = req.user.sub;
  const recipientIds = readRecipientIds(req.body);

  if (recipientIds === null) {
    return res.status(400).json({ message: 'Recipients must be a list of users.' });
  }
  if (!recipientIds.length) {
    return res.status(400).json({ message: 'Choose at least one recipient.' });
  }
  if (recipientIds.length > MAX_RECIPIENTS) {
    return res.status(400).json({ message: `A message can go to at most ${MAX_RECIPIENTS} people.` });
  }

  const subject = String(req.body?.subject || '').trim().slice(0, MAX_SUBJECT);
  const body = String(req.body?.body || '').slice(0, MAX_BODY);
  if (!subject) return res.status(400).json({ message: 'A message needs a subject.' });
  if (!body.replace(/<[^>]*>/g, '').trim() && !req.file) {
    return res.status(400).json({ message: 'A message needs something in it.' });
  }

  // Addressed to accounts that exist, so a mistyped id is refused rather than
  // silently producing a message nobody can open.
  const people = await User.find({ id: { $in: recipientIds } }, { id: 1, fullName: 1, username: 1 });
  if (people.length !== recipientIds.length) {
    return res.status(400).json({ message: 'One of those recipients no longer exists.' });
  }

  const sender = await getUserById(me);
  const created = await createMailMessage({
    senderId: me,
    senderName: sender?.fullName || req.user.username || '',
    subject,
    body,
    preview: body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120),
    recipients: people.map((person) => ({
      userId: person.id,
      name: person.fullName || person.username,
      readAt: null,
      deletedAt: null,
    })),
    recipientIds: people.map((person) => person.id),
    attachment: req.file ? `/uploads/mail/${req.file.filename}` : '',
    attachmentName: req.file ? req.file.originalname : '',
    attachmentSize: req.file ? req.file.size : 0,
    replyToId: String(req.body?.replyToId || '').trim(),
    sentAt: new Date(),
  });

  return res.status(201).json({ mail: describeMail(created, me) });
};

/**
 * DELETE /mail/:mailId
 *
 * Removes the message from the caller's own mailbox only. The document goes
 * when nobody is holding it any more, which is also what keeps its attachment
 * from being collected while someone can still open it.
 */
export const deleteMail = async (req, res) => {
  const me = req.user.sub;
  const mail = await getMailFor(me, req.params.mailId);
  if (!mail) return res.status(404).json({ message: 'Mail not found.' });

  if (mail.senderId === me) mail.deletedBySender = true;
  mail.recipients.forEach((person) => {
    if (person.userId === me && !person.deletedAt) person.deletedAt = new Date();
  });

  const heldBySomeone = !mail.deletedBySender
    || mail.recipients.some((person) => !person.deletedAt);

  if (heldBySomeone) {
    await mail.save();
  } else {
    await mail.deleteOne();
  }

  return res.json({ ok: true, message: 'Mail deleted.' });
};
