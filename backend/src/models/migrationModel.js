import mongoose from 'mongoose';

/*
 * A marker per one-off task, so it runs once and not on every boot.
 *
 * The alternative — re-applying a backfill each time the server starts —
 * quietly undoes anything an administrator changed afterwards. A grant that
 * was revoked on purpose must stay revoked.
 */
const migrationSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  appliedAt: { type: Date, default: Date.now },
  note: { type: String, default: '' },
}, { collection: 'app_migrations' });

export const Migration = mongoose.models.Migration || mongoose.model('Migration', migrationSchema);

/**
 * Runs `task` the first time only. Returns what happened, so the caller can
 * log it; a failure leaves no marker, so the next boot tries again.
 */
export const runOnce = async (id, note, task) => {
  const existing = await Migration.findOne({ id });
  if (existing) return { id, applied: false };

  const result = await task();
  await Migration.create({ id, note, appliedAt: new Date() });
  return { id, applied: true, result };
};
