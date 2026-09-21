import { RECORD_VISIBILITIES, createRecord, getCategoryById, getRecordById, getRecords, searchRecords } from '../models/store.js';

const MAX_SHARE_TARGETS = 200;

/**
 * Who a record is shared with, as the form sends it.
 *
 * The record forms are multipart, because they carry files, so everything
 * arrives as a string: `sharedWith` is sent as JSON. A comma-separated list
 * and a repeated field are both accepted too, since that is what a plain
 * client would send.
 *
 * Returns { values, error }. An absent `visibility` means "leave it alone",
 * so an update that does not mention sharing cannot silently widen a record.
 */
const readSharing = (body = {}) => {
  if (body.visibility === undefined && body.sharedWith === undefined) {
    return { values: {}, error: '' };
  }

  const visibility = String(body.visibility || 'everyone').toLowerCase();
  if (!RECORD_VISIBILITIES.includes(visibility)) {
    return { values: {}, error: `Visibility must be one of ${RECORD_VISIBILITIES.join(', ')}.` };
  }

  // Shared with everyone means the list is meaningless; it is cleared rather
  // than kept, so a record can never claim both answers at once.
  if (visibility === 'everyone') {
    return { values: { visibility, sharedWith: [] }, error: '' };
  }

  let raw = body.sharedWith;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) raw = [];
    else if (text.startsWith('[')) {
      try {
        raw = JSON.parse(text);
      } catch (error) {
        return { values: {}, error: 'sharedWith is not a valid list of users.' };
      }
    } else raw = text.split(',');
  }

  if (!Array.isArray(raw)) {
    return { values: {}, error: 'sharedWith must be a list of user ids.' };
  }

  const sharedWith = [...new Set(raw.map((value) => String(value).trim()).filter(Boolean))];
  if (sharedWith.length > MAX_SHARE_TARGETS) {
    return { values: {}, error: `A record can be shared with at most ${MAX_SHARE_TARGETS} people.` };
  }

  return { values: { visibility, sharedWith }, error: '' };
};

/**
 * Whether this caller is an administrator, read from the account rather than
 * from the token.
 *
 * `requirePermission` has already loaded the current record onto the request,
 * so this costs nothing — and unlike `req.user.role` it is not a snapshot
 * taken when the token was issued. With records now shared selectively, a
 * demoted administrator keeping the bypass until their token expired would be
 * a real leak, and a promoted user not getting it would look like a bug.
 */
const isAdminRequest = (req) => req.currentUser?.role === 'admin';

export const listData = async (req, res) => {
  const categoryId = String(req.query.categoryId || '');
  const userRecords = await getRecords(req.user.sub, isAdminRequest(req), categoryId);
  return res.json({ data: userRecords.map((record) => record.toObject ? record.toObject() : record) });
};

export const searchData = async (req, res) => {
  const searchText = String(req.query.q || '');
  const categoryId = String(req.query.categoryId || '');
  const mode = String(req.query.mode || 'text').toLowerCase();
  const searchDateFrom = String(req.query.dateFrom || '');
  const searchDateTo = String(req.query.dateTo || '');

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if ((searchDateFrom && !datePattern.test(searchDateFrom)) || (searchDateTo && !datePattern.test(searchDateTo))) {
    return res.status(400).json({ message: 'dateFrom and dateTo must use YYYY-MM-DD format.' });
  }

  if (searchDateFrom && searchDateTo && searchDateFrom > searchDateTo) {
    return res.status(400).json({ message: 'dateFrom cannot be later than dateTo.' });
  }

  const userRecords = await searchRecords(req.user.sub, isAdminRequest(req), searchText, categoryId, mode, searchDateFrom, searchDateTo);
  return res.json({ data: userRecords.map((record) => record.toObject ? record.toObject() : record) });
};

export const createData = async (req, res) => {
  const { title, category, categoryId, content, attempt } = req.body || {};

  if (!title || (!category && !categoryId) || !content) {
    return res.status(400).json({ message: 'Title, category, and content are required.' });
  }

  let categoryName = String(category || '').trim();
  let selectedCategoryId = String(categoryId || '').trim();

  if (selectedCategoryId) {
    const selectedCategory = await getCategoryById(selectedCategoryId);
    if (!selectedCategory) {
      return res.status(400).json({ message: 'Selected category does not exist.' });
    }
    categoryName = selectedCategory.path || selectedCategory.name;
  }

  const { values: sharing, error: sharingError } = readSharing(req.body);
  if (sharingError) {
    return res.status(400).json({ message: sharingError });
  }

  const uploadedFiles = Array.isArray(req.files) ? req.files : [];
  const attachments = uploadedFiles.map((file) => `/uploads/${file.filename}`);

  const newRecord = await createRecord({
    // Defaulted here as well as in the schema, so a record created by a client
    // that knows nothing about sharing is readable by everyone rather than
    // arriving without the field.
    visibility: 'everyone',
    sharedWith: [],
    ...sharing,
    title,
    category: categoryName,
    categoryId: selectedCategoryId,
    content,
    attempt: attempt || '',
    attachment: attachments[0] || '',
    attachments,
    ownerId: req.user.sub,
  });

  return res.status(201).json({ record: newRecord.toObject ? newRecord.toObject() : newRecord });
};

export const updateData = async (req, res) => {
  const { id } = req.params;
  const record = await getRecordById(id);

  if (!record) {
    return res.status(404).json({ message: 'Record not found.' });
  }

  // Sharing grants reading, never writing: editing stays with the owner and
  // with administrators, whoever the record has been shared with.
  if (record.ownerId !== req.user.sub && !isAdminRequest(req)) {
    return res.status(403).json({ message: 'You cannot edit this record.' });
  }

  const { title, category, categoryId, content, attempt } = req.body || {};
  let nextCategoryName = category ? String(category).trim() : record.category;
  let nextCategoryId = categoryId ? String(categoryId).trim() : record.categoryId || '';

  if (nextCategoryId) {
    const selectedCategory = await getCategoryById(nextCategoryId);
    if (!selectedCategory) {
      return res.status(400).json({ message: 'Selected category does not exist.' });
    }
    nextCategoryName = selectedCategory.path || selectedCategory.name;
  } else if (nextCategoryName) {
    nextCategoryName = nextCategoryName;
  }

  const uploadedFiles = Array.isArray(req.files) ? req.files : [];
  if (uploadedFiles.length > 0) {
    const nextAttachments = uploadedFiles.map((file) => `/uploads/${file.filename}`);
    record.attachment = nextAttachments[0] || '';
    record.attachments = nextAttachments;
  }

  record.title = title || record.title;
  record.category = nextCategoryName || record.category;
  record.categoryId = nextCategoryId;
  record.content = content || record.content;
  record.attempt = typeof attempt === 'string' ? attempt : record.attempt;

  // Only the owner and administrators reach this handler at all, so deciding
  // who may change the sharing has already happened above.
  const { values: sharing, error: sharingError } = readSharing(req.body);
  if (sharingError) {
    return res.status(400).json({ message: sharingError });
  }
  Object.assign(record, sharing);

  await record.save();

  return res.json({ record: record.toObject ? record.toObject() : record });
};

export const deleteData = async (req, res) => {
  const { id } = req.params;
  const record = await getRecordById(id);

  if (!record) {
    return res.status(404).json({ message: 'Record not found.' });
  }

  if (record.ownerId !== req.user.sub && !isAdminRequest(req)) {
    return res.status(403).json({ message: 'You cannot delete this record.' });
  }

  await record.deleteOne();
  return res.json({ ok: true, message: 'Record removed.' });
};