import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

export const WALLET_TYPES = ['income', 'expense'];

/*
 * A wallet holds more than one currency at once, and the two are never added
 * together: there is no rate in this app, and inventing one would turn a
 * bookkeeping record into a guess. Every entry therefore carries the currency
 * it was recorded in, and every total is reported per currency.
 *
 * 'USD' is the default because entries written before this field existed were
 * all in one currency, and that is the one they were meant to be.
 */
export const WALLET_CURRENCIES = ['USD', 'REM'];
export const DEFAULT_WALLET_CURRENCY = 'USD';

// `date` is a 'YYYY-MM-DD' string for the same reason schedules are — an entry
// belongs to a calendar day in the owner's timezone, not to an instant, and a
// Date would drift across the month boundary in the charts.
const walletEntrySchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  ownerId: { type: String, required: true, index: true },
  type: { type: String, enum: WALLET_TYPES, required: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, enum: WALLET_CURRENCIES, default: DEFAULT_WALLET_CURRENCY },
  category: { type: String, default: 'Other', trim: true },
  note: { type: String, default: '', trim: true },
  method: { type: String, default: '', trim: true },
  date: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'wallet_entries' });

export const WalletEntry = mongoose.models.WalletEntry || mongoose.model('WalletEntry', walletEntrySchema);

// A wallet is personal, like a schedule: every query is scoped by ownerId so
// one account never sees another's figures, admin included.
export const getWalletEntries = (ownerId, { from = '', to = '', type = '', category = '', currency = '' } = {}) => {
  const filter = { ownerId };
  if (from || to) {
    filter.date = {
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: to } : {}),
    };
  }
  if (WALLET_TYPES.includes(type)) filter.type = type;
  if (category) filter.category = category;
  if (WALLET_CURRENCIES.includes(currency)) filter.currency = currency;

  return WalletEntry.find(filter).sort({ date: -1, createdAt: -1 });
};

export const getWalletEntryById = (ownerId, id) => WalletEntry.findOne({ ownerId, id });

export const createWalletEntry = (data) => WalletEntry.create({ id: randomUUID(), ...data });
