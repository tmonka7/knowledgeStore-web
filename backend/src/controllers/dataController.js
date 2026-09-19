import { createRecord, getCategoryById, getRecordById, getRecords, searchRecords } from '../models/store.js';

export const listData = async (req, res) => {
  const categoryId = String(req.query.categoryId || '');
  const userRecords = await getRecords(req.user.sub, req.user.role === 'admin', categoryId);
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

  const userRecords = await searchRecords(req.user.sub, req.user.role === 'admin', searchText, categoryId, mode, searchDateFrom, searchDateTo);
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

  const uploadedFiles = Array.isArray(req.files) ? req.files : [];
  const attachments = uploadedFiles.map((file) => `/uploads/${file.filename}`);

  const newRecord = await createRecord({
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

  if (record.ownerId !== req.user.sub && req.user.role !== 'admin') {
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
  await record.save();

  return res.json({ record: record.toObject ? record.toObject() : record });
};

export const deleteData = async (req, res) => {
  const { id } = req.params;
  const record = await getRecordById(id);

  if (!record) {
    return res.status(404).json({ message: 'Record not found.' });
  }

  if (record.ownerId !== req.user.sub && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'You cannot delete this record.' });
  }

  await record.deleteOne();
  return res.json({ ok: true, message: 'Record removed.' });
};