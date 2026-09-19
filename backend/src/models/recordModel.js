import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { getCategoryById } from './categoryModel.js';
import { escapeRegex, rankAiSearchRecords } from '../helpers/searchHelpers.js';

const recordSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  title: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  categoryId: { type: String, default: '', index: true },
  content: { type: String, default: '' },
  attempt: { type: String, default: '' },
  attachment: { type: String, default: '' },
  attachments: { type: [String], default: [] },
  ownerId: { type: String, required: true, index: true },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'records' });

export const Record = mongoose.models.Record || mongoose.model('Record', recordSchema);

const buildCategoryMatch = async (categoryId = '') => {
  if (!categoryId) {
    return null;
  }

  const selectedCategory = await getCategoryById(categoryId);
  if (!selectedCategory) {
    return null;
  }

  const categoryPath = selectedCategory.path || selectedCategory.name;
  const escapedPath = escapeRegex(categoryPath);

  return {
    $or: [
      { categoryId },
      { category: categoryPath },
      { category: { $regex: new RegExp(`^${escapedPath}(?:/|$)`, 'i') } },
    ],
  };
};

export const getRecords = async (ownerId, isAdmin, categoryId = '') => {
  const query = isAdmin ? {} : { ownerId };
  const categoryMatch = await buildCategoryMatch(categoryId);

  if (!categoryMatch) {
    return Record.find(query).sort({ createdAt: -1 });
  }

  return Record.find({ ...query, $and: [categoryMatch] }).sort({ createdAt: -1 });
};

export const createRecord = async (data) => Record.create({
  id: randomUUID(),
  ...data,
  createdAt: new Date(),
});

export const getRecordById = (id) => Record.findOne({ id });

export const searchRecords = async (ownerId, isAdmin, searchText = '', categoryId = '', mode = 'text', searchDateFrom = '', searchDateTo = '') => {
  const query = isAdmin ? {} : { ownerId };
  const trimmed = String(searchText || '').trim();
  const categoryMatch = await buildCategoryMatch(categoryId);
  const validDateFrom = /^\d{4}-\d{2}-\d{2}$/.test(searchDateFrom) ? searchDateFrom : '';
  const validDateTo = /^\d{4}-\d{2}-\d{2}$/.test(searchDateTo) ? searchDateTo : '';
  const dateToExclusive = validDateTo
    ? new Date(`${validDateTo}T00:00:00.000Z`)
    : null;
  if (dateToExclusive) dateToExclusive.setUTCDate(dateToExclusive.getUTCDate() + 1);
  const dateMatch = validDateFrom || validDateTo
    ? {
      createdAt: {
        ...(validDateFrom ? { $gte: new Date(`${validDateFrom}T00:00:00.000Z`) } : {}),
        ...(dateToExclusive ? { $lt: dateToExclusive } : {}),
      },
    }
    : null;

  if (!trimmed && !categoryMatch && !dateMatch) {
    return getRecords(ownerId, isAdmin);
  }

  const searchQuery = {
    ...query,
    ...((categoryMatch || dateMatch) ? { $and: [categoryMatch, dateMatch].filter(Boolean) } : {}),
  };

  if (!trimmed) {
    return Record.find(searchQuery).sort({ createdAt: -1 });
  }

  if (mode === 'ai') {
    const allRecords = await Record.find({ ...searchQuery }).sort({ createdAt: -1 });
    const rankedRecords = rankAiSearchRecords(
      allRecords.map((record) => (record.toObject ? record.toObject() : record)),
      trimmed,
    );

    if (rankedRecords.length > 0) {
      return rankedRecords;
    }

    const aiTerms = String(trimmed).split(/\s+/).filter(Boolean);
    const patterns = aiTerms.map((term) => new RegExp(escapeRegex(term), 'i'));

    return Record.find({
      ...searchQuery,
      $or: [
        { title: { $in: patterns } },
        { category: { $in: patterns } },
        { attempt: { $in: patterns } },
        { content: { $in: patterns } },
      ],
    }).sort({ createdAt: -1 });
  }

  const pattern = new RegExp(escapeRegex(trimmed), 'i');
  return Record.find({
    ...searchQuery,
    $or: [
      { title: pattern },
      { category: pattern },
      { attempt: pattern },
      { content: pattern },
    ],
  }).sort({ createdAt: -1 });
};
