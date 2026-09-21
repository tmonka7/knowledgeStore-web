import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

// Contacts are personal, like the wallet and the schedule: every query is
// scoped by ownerId, so one account never sees another's address book.
const contactSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  ownerId: { type: String, required: true, index: true },
  fullName: { type: String, required: true, trim: true },
  email: { type: String, default: '', trim: true },
  phone: { type: String, default: '', trim: true },
  company: { type: String, default: '', trim: true },
  jobTitle: { type: String, default: '', trim: true },
  group: { type: String, default: 'General', trim: true },
  tags: { type: [String], default: [] },
  notes: { type: String, default: '', trim: true },
  favourite: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'contacts' });

export const Contact = mongoose.models.Contact || mongoose.model('Contact', contactSchema);

// Favourites first, then alphabetically — the order an address book is read in.
export const getContacts = (ownerId, { group = '' } = {}) => Contact
  .find({ ownerId, ...(group ? { group } : {}) })
  .sort({ favourite: -1, fullName: 1 });

export const getContactById = (ownerId, id) => Contact.findOne({ ownerId, id });

export const createContact = (data) => Contact.create({ id: randomUUID(), ...data });
