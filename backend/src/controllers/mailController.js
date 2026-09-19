import { randomUUID } from 'node:crypto';
import { Mail } from '../models/mailModel.js';

const normalizeMail = (mail) => ({
  ...mail,
  timeLabel: new Date(mail.sentAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }),
});

const buildMailFilter = (user) => (user.role === 'admin' ? {} : { ownerId: user.sub });

export const listInbox = async (req, res) => {
  try {
    const mails = await Mail.find(buildMailFilter(req.user)).sort({ sentAt: -1 });
    return res.json({ mails: mails.map(normalizeMail) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load inbox.' });
  }
};

export const getMail = async (req, res) => {
  const { mailId } = req.params;

  try {
    const mail = await Mail.findOne({ id: mailId, ...buildMailFilter(req.user) });

    if (!mail) {
      return res.status(404).json({ message: 'Mail not found.' });
    }

    if (mail.unread) {
      mail.unread = false;
      await mail.save();
    }

    return res.json({ mail: normalizeMail(mail.toObject()) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load mail.' });
  }
};

export const createMail = async (req, res) => {
  const from = String(req.body?.from || '').trim() || 'admin@knowledge.store';
  const to = String(req.body?.to || '').trim() || 'team@knowledge.store';
  const subject = String(req.body?.subject || '').trim() || 'New message';
  const body = String(req.body?.body || '').trim() || 'No message provided.';
  const attachment = req.file ? `/uploads/mail/${req.file.filename}` : '';

  try {
    const mail = await Mail.create({
      id: `mail-${randomUUID()}`,
      ownerId: req.user.sub,
      from,
      to,
      subject,
      preview: body.replace(/<[^>]+>/g, '').slice(0, 90),
      body: attachment
        ? `${body}<p><a href="${attachment}" target="_blank" rel="noreferrer">Attachment: ${req.file.originalname}</a></p>`
        : body,
      attachment,
      attachmentName: req.file ? req.file.originalname : '',
      sentAt: new Date(),
      unread: false,
      category: 'Draft',
    });

    return res.status(201).json({ mail: normalizeMail(mail.toObject()) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to save mail.' });
  }
};

export const deleteMail = async (req, res) => {
  const { mailId } = req.params;

  try {
    const mail = await Mail.findOneAndDelete({ id: mailId, ...buildMailFilter(req.user) });

    if (!mail) {
      return res.status(404).json({ message: 'Mail not found.' });
    }

    return res.json({ ok: true, mail: normalizeMail(mail.toObject()), message: 'Mail deleted.' });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to delete mail.' });
  }
};
