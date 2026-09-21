import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

export const LOG_LEVELS = ['info', 'warn', 'error'];

/**
 * Application log, stored in the database rather than a file so the
 * Database Management page can show and clear it without shell access.
 *
 * Nothing here is authoritative — it is a trail of maintenance actions, which
 * is exactly why "clear logs" is a safe optimisation task.
 */
const activityLogSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  level: { type: String, enum: LOG_LEVELS, default: 'info' },
  source: { type: String, default: 'system', index: true },
  action: { type: String, required: true, trim: true },
  message: { type: String, default: '' },
  actorId: { type: String, default: '' },
  actorName: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true },
}, { collection: 'activity_logs' });

export const ActivityLog = mongoose.models.ActivityLog || mongoose.model('ActivityLog', activityLogSchema);

/**
 * Logging must never be the reason a request fails, so a write failure is
 * reported to the console and swallowed.
 */
export const writeLog = async ({ level = 'info', source = 'system', action, message = '', actor = null, meta = {} }) => {
  try {
    return await ActivityLog.create({
      id: randomUUID(),
      level: LOG_LEVELS.includes(level) ? level : 'info',
      source,
      action,
      message,
      actorId: actor?.id || actor?.sub || '',
      actorName: actor?.username || actor?.fullName || '',
      meta,
    });
  } catch (error) {
    console.error('Unable to write activity log:', error.message);
    return null;
  }
};

export const getLogs = ({ source = '', level = '', limit = 100 } = {}) => {
  const filter = {};
  if (source) filter.source = source;
  if (LOG_LEVELS.includes(level)) filter.level = level;
  return ActivityLog.find(filter).sort({ createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 100, 1), 500));
};

export const countLogs = (filter = {}) => ActivityLog.countDocuments(filter);

export const getOldestLogDate = async () => {
  const oldest = await ActivityLog.findOne().sort({ createdAt: 1 }).select('createdAt');
  return oldest?.createdAt || null;
};

/** `olderThanDays: 0` clears everything; anything higher keeps recent entries. */
export const clearLogs = async ({ olderThanDays = 0 } = {}) => {
  const days = Math.max(0, Number(olderThanDays) || 0);
  const filter = days > 0
    ? { createdAt: { $lt: new Date(Date.now() - days * 86400000) } }
    : {};
  const result = await ActivityLog.deleteMany(filter);
  return result.deletedCount || 0;
};
