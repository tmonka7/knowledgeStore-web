import {
  createContact,
  getContactById,
  getContacts,
} from '../models/contactModel.js';

const MAX_PHONES = 10;
const PHONE_PATTERN = /^[+()\d\s.-]{5,32}$/;

/** A contact saved before it could hold several numbers has only `phone`: show it as the one entry. */
const withPhones = (contact) => ({
  ...contact,
  phones: contact.phones?.length ? contact.phones : contact.phone ? [{ label: '', number: contact.phone }] : [],
});

const asPlain = (document) => withPhones(document?.toObject ? document.toObject() : document);

/** The numbers sent — `phones` [{ label, number }], or a lone `phone` from an older client — blanks dropped. */
const phoneFields = (body) => {
  const list = Array.isArray(body.phones)
    ? body.phones.map((entry) => ({
      label: String(entry?.label || '').trim().slice(0, 40),
      number: String(entry?.number || '').trim(),
    }))
    : [{ label: '', number: String(body.phone || '').trim() }];
  const phones = list.filter((entry) => entry.number);
  return { phones, phone: phones[0]?.number || '' };
};

const contactFields = (body = {}) => ({
  fullName: String(body.fullName || '').trim(),
  email: String(body.email || '').trim(),
  ...phoneFields(body),
  company: String(body.company || '').trim(),
  jobTitle: String(body.jobTitle || '').trim(),
  group: String(body.group || '').trim() || 'General',
  tags: Array.isArray(body.tags)
    ? [...new Set(body.tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 12)
    : [],
  notes: String(body.notes || '').trim(),
  favourite: Boolean(body.favourite),
});

const validate = (contact) => {
  if (!contact.fullName) return 'A name is required.';
  // Email and phone are both optional — a contact may be only one of the two —
  // but a value that is present has to look like the thing it claims to be.
  if (contact.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) {
    return 'Enter a valid email address, or leave it empty.';
  }
  if (contact.phones.length > MAX_PHONES) return `A contact can have at most ${MAX_PHONES} phone numbers.`;
  const invalid = contact.phones.find((entry) => !PHONE_PATTERN.test(entry.number));
  if (invalid) return `"${invalid.number}" is not a valid phone number.`;
  return '';
};

export const listContacts = async (req, res) => {
  const contacts = await getContacts(req.user.sub, { group: String(req.query.group || '').trim() });
  return res.json({ contacts: contacts.map(asPlain) });
};

export const createContactRecord = async (req, res) => {
  const fields = contactFields(req.body);
  const error = validate(fields);
  if (error) return res.status(400).json({ message: error });

  const created = await createContact({ ...fields, ownerId: req.user.sub });
  return res.status(201).json({ contact: asPlain(created) });
};

export const updateContact = async (req, res) => {
  const existing = await getContactById(req.user.sub, req.params.id);
  if (!existing) return res.status(404).json({ message: 'Contact not found.' });

  const fields = contactFields(req.body);
  const error = validate(fields);
  if (error) return res.status(400).json({ message: error });

  Object.assign(existing, fields, { updatedAt: new Date() });
  await existing.save();

  return res.json({ contact: asPlain(existing) });
};

/**
 * PATCH /contacts/:id/favourite
 *
 * Separate from the update route so starring a contact from the list does not
 * have to send — and therefore cannot accidentally overwrite — every field.
 */
export const setFavourite = async (req, res) => {
  const existing = await getContactById(req.user.sub, req.params.id);
  if (!existing) return res.status(404).json({ message: 'Contact not found.' });

  existing.favourite = Boolean(req.body?.favourite);
  existing.updatedAt = new Date();
  await existing.save();

  return res.json({ contact: asPlain(existing) });
};

export const deleteContact = async (req, res) => {
  const existing = await getContactById(req.user.sub, req.params.id);
  if (!existing) return res.status(404).json({ message: 'Contact not found.' });

  await existing.deleteOne();
  return res.json({ ok: true });
};
