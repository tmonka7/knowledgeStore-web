import {
  WALLET_TYPES,
  createWalletEntry,
  getWalletEntries,
  getWalletEntryById,
} from '../models/walletModel.js';
import { writeLog } from '../models/activityLogModel.js';

const DEFAULT_MONTHS = 6;
const TOP_CATEGORIES = 8;

const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

const asPlain = (document) => (document?.toObject ? document.toObject() : document);

// Money is rounded to cents on the way in, so the totals the charts add up are
// the same figures that were stored rather than a drifting float sum.
const toAmount = (value) => Math.round((Number(value) || 0) * 100) / 100;

const entryFields = (body = {}) => ({
  type: String(body.type || '').toLowerCase(),
  amount: toAmount(body.amount),
  category: String(body.category || '').trim() || 'Other',
  note: String(body.note || '').trim(),
  method: String(body.method || '').trim(),
  date: String(body.date || '').trim(),
});

const validate = (entry) => {
  if (!WALLET_TYPES.includes(entry.type)) return `Type must be one of ${WALLET_TYPES.join(', ')}.`;
  if (!Number.isFinite(entry.amount) || entry.amount <= 0) return 'Amount must be greater than zero.';
  if (!isDateKey(entry.date)) return 'Date must be in YYYY-MM-DD format.';
  if (entry.category.length > 40) return 'Category must be 40 characters or fewer.';
  return '';
};

const readFilters = (query = {}) => ({
  from: isDateKey(query.from) ? query.from : '',
  to: isDateKey(query.to) ? query.to : '',
  type: WALLET_TYPES.includes(String(query.type || '')) ? String(query.type) : '',
  category: String(query.category || '').trim(),
});

export const listEntries = async (req, res) => {
  const entries = await getWalletEntries(req.user.sub, readFilters(req.query));
  return res.json({ entries: entries.map(asPlain) });
};

export const createEntry = async (req, res) => {
  const entry = entryFields(req.body);
  const error = validate(entry);
  if (error) return res.status(400).json({ message: error });

  const created = await createWalletEntry({ ...entry, ownerId: req.user.sub });

  await writeLog({
    source: 'wallet',
    action: `entry:${entry.type}`,
    message: `Recorded ${entry.type} of ${entry.amount} (${entry.category})`,
    actor: { id: req.user.sub, username: req.user.username },
  });

  return res.status(201).json({ entry: asPlain(created) });
};

export const updateEntry = async (req, res) => {
  const existing = await getWalletEntryById(req.user.sub, req.params.id);
  if (!existing) return res.status(404).json({ message: 'Entry not found.' });

  const updates = entryFields(req.body);
  const error = validate(updates);
  if (error) return res.status(400).json({ message: error });

  Object.assign(existing, updates);
  await existing.save();

  return res.json({ entry: asPlain(existing) });
};

export const deleteEntry = async (req, res) => {
  const existing = await getWalletEntryById(req.user.sub, req.params.id);
  if (!existing) return res.status(404).json({ message: 'Entry not found.' });

  await existing.deleteOne();
  return res.json({ ok: true });
};

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const monthLabel = (key) => {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'short' });
};

/**
 * GET /wallet/summary?months=6&from=&to=
 *
 * The statistics are added up here rather than in the browser so the totals,
 * the monthly bars and the category breakdown can never disagree with each
 * other, and so a filtered view still reports on the same rows it lists.
 */
export const getSummary = async (req, res) => {
  const months = Math.min(Math.max(Number(req.query.months) || DEFAULT_MONTHS, 1), 24);
  const filters = readFilters(req.query);
  const entries = (await getWalletEntries(req.user.sub, filters)).map(asPlain);

  const totals = entries.reduce((accumulator, entry) => {
    accumulator[entry.type] = toAmount(accumulator[entry.type] + entry.amount);
    return accumulator;
  }, { income: 0, expense: 0 });

  // Seeded with an empty slot per month so a quiet month keeps its place on
  // the axis instead of collapsing the series.
  const series = new Map();
  const now = new Date();
  for (let index = months - 1; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const key = monthKey(date);
    series.set(key, { key, label: monthLabel(key), income: 0, expense: 0, net: 0 });
  }

  entries.forEach((entry) => {
    const key = String(entry.date).slice(0, 7);
    const slot = series.get(key);
    if (!slot) return;
    slot[entry.type] = toAmount(slot[entry.type] + entry.amount);
    slot.net = toAmount(slot.income - slot.expense);
  });

  const byCategory = (type) => {
    const counts = new Map();
    entries
      .filter((entry) => entry.type === type)
      .forEach((entry) => {
        const current = counts.get(entry.category) || { category: entry.category, total: 0, count: 0 };
        current.total = toAmount(current.total + entry.amount);
        current.count += 1;
        counts.set(entry.category, current);
      });

    return [...counts.values()].sort((a, b) => b.total - a.total).slice(0, TOP_CATEGORIES);
  };

  return res.json({
    range: { months, ...filters },
    totals: {
      income: totals.income,
      expense: totals.expense,
      balance: toAmount(totals.income - totals.expense),
      entries: entries.length,
    },
    monthly: [...series.values()],
    categories: { income: byCategory('income'), expense: byCategory('expense') },
  });
};
