import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

const mailSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  ownerId: { type: String, required: true, index: true },
  from: { type: String, default: '' },
  to: { type: String, default: '' },
  subject: { type: String, default: '' },
  preview: { type: String, default: '' },
  body: { type: String, default: '' },
  attachment: { type: String, default: '' },
  attachmentName: { type: String, default: '' },
  sentAt: { type: Date, default: Date.now },
  unread: { type: Boolean, default: false },
  category: { type: String, default: 'Inbox' },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'mail_inbox' });

export const Mail = mongoose.models.Mail || mongoose.model('Mail', mailSchema);
