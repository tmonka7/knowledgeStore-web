import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

/*
 * Parallel-text datasets for the Tools > AI > Transformers page.
 *
 * One row is one sentence in every language the dataset declares, stored as a
 * map of language code to text — the shape Hugging Face's translation datasets
 * use, so export and the Python runner hand it on without reshaping. Datasets
 * are personal, like contacts: every query is scoped by ownerId.
 */
const rowSchema = new mongoose.Schema({
  id: { type: String, required: true },
  texts: { type: Map, of: String, default: {} },
}, { _id: false });

const translationDatasetSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  ownerId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  // Order matters: the first language is the source, the rest are targets.
  languages: { type: [String], default: [] },
  rows: { type: [rowSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'translationDatasets' });

export const TranslationDataset = mongoose.models.TranslationDataset
  || mongoose.model('TranslationDataset', translationDatasetSchema);

/** The list view never needs the rows themselves, only how many there are. */
export const getTranslationDatasetSummaries = (ownerId) => TranslationDataset.aggregate([
  { $match: { ownerId } },
  { $sort: { updatedAt: -1 } },
  {
    $project: {
      _id: 0, id: 1, name: 1, languages: 1, createdAt: 1, updatedAt: 1, rowCount: { $size: '$rows' },
    },
  },
]);

export const getTranslationDatasetById = (ownerId, id) => TranslationDataset.findOne({ ownerId, id });

export const createTranslationDataset = (data) => TranslationDataset.create({ id: randomUUID(), ...data });
