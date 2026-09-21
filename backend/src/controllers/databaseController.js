import fs from 'node:fs/promises';
import {
  addReplicaMember,
  backupPath,
  compactCollections,
  createBackup,
  deleteBackup,
  deleteOrphanUploads,
  describeBackup,
  dropAllCollections,
  findOrphanUploads,
  getCollectionCounts,
  getDatabaseStats,
  getReplicationStatus,
  initiateReplicaSet,
  listBackups,
  removeReplicaMember,
  restoreBackup,
  safeBackupName,
  syncModelIndexes,
} from '../helpers/databaseMaintenance.js';
import { ensureSeedCategories } from '../models/categoryModel.js';
import { ensureSuperuser } from '../models/userModel.js';
import {
  clearLogs,
  countLogs,
  getLogs,
  getOldestLogDate,
  writeLog,
} from '../models/activityLogModel.js';

const asPlain = (document) => (document?.toObject ? document.toObject() : document);

const actorOf = (req) => ({ id: req.user.sub, username: req.user.username });

/* ------------------------------------------------------------------ status */

export const getStatus = async (req, res) => {
  const [stats, collections, replication, uploads, logCount, oldestLog, backups] = await Promise.all([
    getDatabaseStats(),
    getCollectionCounts(),
    getReplicationStatus().catch((error) => ({ enabled: false, initialized: false, members: [], error: { message: error.message } })),
    findOrphanUploads(),
    countLogs(),
    getOldestLogDate(),
    listBackups(),
  ]);

  return res.json({
    database: stats,
    collections,
    replication,
    uploads: {
      totalFiles: uploads.totalFiles,
      totalBytes: uploads.totalBytes,
      referenced: uploads.referenced,
      orphanCount: uploads.orphans.length,
      orphanBytes: uploads.orphanBytes,
    },
    logs: { count: logCount, oldest: oldestLog },
    backups: {
      count: backups.length,
      totalBytes: backups.reduce((sum, backup) => sum + backup.size, 0),
      latest: backups[0] || null,
    },
  });
};

export const listActivityLogs = async (req, res) => {
  const logs = await getLogs({
    source: String(req.query.source || ''),
    level: String(req.query.level || ''),
    limit: req.query.limit,
  });

  return res.json({ logs: logs.map(asPlain), total: await countLogs() });
};

/* ---------------------------------------------------------- initialization */

const validateSuperuser = (superuser) => {
  if (!superuser || typeof superuser !== 'object') return 'Superuser details are required.';
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(String(superuser.username || ''))) {
    return 'Username must be 3-32 characters, letters, digits, dot, dash or underscore.';
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(superuser.email || ''))) {
    return 'A valid email address is required.';
  }
  if (String(superuser.password || '').length < 8) {
    return 'The superuser password must be at least 8 characters.';
  }
  return '';
};

/**
 * POST /database/initialize
 *
 * mode 'safe' (the default) only adds what is missing: model indexes, the
 * seed categories and a superuser. mode 'reset' drops every collection first
 * and therefore demands `confirm: 'RESET'` and a superuser to sign back in
 * with — a reset always takes a backup before it touches anything.
 */
export const initializeDatabase = async (req, res) => {
  const body = req.body || {};
  const mode = body.mode === 'reset' ? 'reset' : 'safe';
  const seedCategories = body.seedCategories !== false;
  const wantsSuperuser = Boolean(body.superuser) || mode === 'reset';

  if (mode === 'reset' && body.confirm !== 'RESET') {
    return res.status(400).json({ message: 'Type RESET to confirm dropping every collection.' });
  }
  if (wantsSuperuser) {
    const error = validateSuperuser(body.superuser);
    if (error) return res.status(400).json({ message: error });
  }

  const steps = [];

  if (mode === 'reset') {
    // Taken before the drop so a mistaken reset is still recoverable from the
    // Restoration tab rather than only from whatever the operator did last.
    const backup = await createBackup({ label: 'before-reset', actor: actorOf(req) });
    steps.push({ step: 'backup', detail: `Saved ${backup.name}`, backup });

    const dropped = await dropAllCollections();
    steps.push({ step: 'drop', detail: `Dropped ${dropped.length} collection(s)`, collections: dropped });
  }

  const indexes = await syncModelIndexes();
  steps.push({ step: 'indexes', detail: `Synced indexes for ${indexes.length} model(s)`, indexes });

  if (seedCategories) {
    const created = await ensureSeedCategories();
    steps.push({
      step: 'categories',
      detail: created.length ? `Created ${created.length} root categories` : 'Categories already present',
    });
  }

  let superuser = null;
  if (wantsSuperuser) {
    const result = await ensureSuperuser(body.superuser);
    superuser = { username: result.user.username, created: result.created };
    steps.push({
      step: 'superuser',
      detail: result.created
        ? `Created superuser ${result.user.username}`
        : `Promoted and reset the password for ${result.user.username}`,
    });
  }

  await writeLog({
    source: 'database',
    action: `initialize:${mode}`,
    message: steps.map((step) => step.detail).join('; '),
    actor: actorOf(req),
    meta: { mode, seedCategories, superuser },
  });

  return res.json({
    mode,
    steps,
    superuser,
    // A reset removes the account behind the caller's token, so the session
    // the request was made with is no longer valid.
    signOutRequired: mode === 'reset',
  });
};

/* ------------------------------------------------------------- restoration */

export const getBackups = async (req, res) => {
  return res.json({ backups: await listBackups() });
};

export const createDatabaseBackup = async (req, res) => {
  const backup = await createBackup({ label: 'manual', actor: actorOf(req) });

  await writeLog({
    source: 'database',
    action: 'backup:create',
    message: `Created backup ${backup.name}`,
    actor: actorOf(req),
    meta: { name: backup.name, size: backup.size },
  });

  return res.status(201).json({ backup });
};

export const inspectBackup = async (req, res) => {
  return res.json({ backup: await describeBackup(req.params.name) });
};

export const downloadBackup = async (req, res, next) => {
  try {
    const file = backupPath(req.params.name);
    await fs.access(file);
    return res.download(file, safeBackupName(req.params.name));
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ message: 'That backup no longer exists.' });
    return next(error);
  }
};

export const uploadBackup = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Attach a .json backup file.' });

  // Parsed once here so an unusable file is rejected on upload rather than
  // sitting in the list until someone tries to restore it.
  try {
    await describeBackup(req.file.filename);
  } catch (error) {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ message: error.message });
  }

  await writeLog({
    source: 'database',
    action: 'backup:upload',
    message: `Uploaded backup ${req.file.filename}`,
    actor: actorOf(req),
  });

  return res.status(201).json({ backup: { name: req.file.filename, size: req.file.size, createdAt: new Date() } });
};

export const restoreDatabaseBackup = async (req, res) => {
  const mode = req.body?.mode === 'merge' ? 'merge' : 'replace';
  const safety = mode === 'replace'
    ? await createBackup({ label: 'before-restore', actor: actorOf(req) })
    : null;

  const result = await restoreBackup(req.params.name, { mode });

  await writeLog({
    source: 'database',
    action: `restore:${mode}`,
    message: `Restored ${result.backup} (${result.collections.length} collections)`,
    actor: actorOf(req),
    meta: { safetyBackup: safety?.name || null, collections: result.collections },
  });

  return res.json({
    ...result,
    safetyBackup: safety,
    // Replacing the users collection invalidates the caller's own account id.
    signOutRequired: mode === 'replace',
  });
};

export const removeBackup = async (req, res, next) => {
  try {
    await deleteBackup(req.params.name);
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ message: 'That backup no longer exists.' });
    return next(error);
  }

  await writeLog({
    source: 'database',
    action: 'backup:delete',
    message: `Deleted backup ${safeBackupName(req.params.name)}`,
    actor: actorOf(req),
  });

  return res.json({ ok: true });
};

/* ------------------------------------------------------------- replication */

export const getReplication = async (req, res) => {
  return res.json({ replication: await getReplicationStatus() });
};

export const initiateReplication = async (req, res) => {
  const setName = String(req.body?.setName || '').trim();
  const members = (Array.isArray(req.body?.members) ? req.body.members : [])
    .map((host) => String(host || '').trim())
    .filter(Boolean);

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(setName)) {
    return res.status(400).json({ message: 'Replica set name must be 1-64 characters, letters, digits, dash or underscore.' });
  }
  if (!members.length) {
    return res.status(400).json({ message: 'List at least one member, as host:port.' });
  }

  const replication = await initiateReplicaSet({ setName, members });

  await writeLog({
    source: 'database',
    action: 'replication:initiate',
    message: `Initiated replica set ${setName} with ${members.length} member(s)`,
    actor: actorOf(req),
    meta: { setName, members },
  });

  return res.json({ replication });
};

export const addReplicationMember = async (req, res) => {
  const host = String(req.body?.host || '').trim();
  if (!/^[^\s:]+:\d{2,5}$/.test(host)) {
    return res.status(400).json({ message: 'Member must be given as host:port.' });
  }

  const replication = await addReplicaMember({
    host,
    priority: Number(req.body?.priority ?? 1),
    votes: Number(req.body?.votes ?? 1),
    arbiter: Boolean(req.body?.arbiter),
  });

  await writeLog({
    source: 'database',
    action: 'replication:add-member',
    message: `Added ${host} to the replica set`,
    actor: actorOf(req),
    meta: { host, arbiter: Boolean(req.body?.arbiter) },
  });

  return res.json({ replication });
};

export const removeReplicationMember = async (req, res) => {
  const host = String(req.body?.host || req.query?.host || '').trim();
  if (!host) return res.status(400).json({ message: 'Member host is required.' });

  const replication = await removeReplicaMember(host);

  await writeLog({
    source: 'database',
    action: 'replication:remove-member',
    message: `Removed ${host} from the replica set`,
    actor: actorOf(req),
    meta: { host },
  });

  return res.json({ replication });
};

/* ------------------------------------------------------------ optimisation */

export const getOptimizationReport = async (req, res) => {
  const [uploads, stats, logCount, oldestLog] = await Promise.all([
    findOrphanUploads(),
    getDatabaseStats(),
    countLogs(),
    getOldestLogDate(),
  ]);

  return res.json({
    uploads: {
      totalFiles: uploads.totalFiles,
      totalBytes: uploads.totalBytes,
      referenced: uploads.referenced,
      orphanBytes: uploads.orphanBytes,
      // Enough to show what would go without shipping a directory listing.
      orphans: uploads.orphans.slice(0, 200),
      orphanCount: uploads.orphans.length,
      recentCount: uploads.orphans.filter((file) => file.isRecent).length,
    },
    logs: { count: logCount, oldest: oldestLog },
    storage: stats,
  });
};

const OPTIMIZATION_TASKS = ['orphan-uploads', 'clear-logs', 'compact', 'sync-indexes'];

/**
 * POST /database/optimize
 *
 * Runs the selected maintenance tasks and reports each one separately — a
 * compact that a managed deployment refuses should not hide a successful
 * upload cleanup.
 */
export const runOptimization = async (req, res) => {
  const requested = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
  const tasks = requested.filter((task) => OPTIMIZATION_TASKS.includes(task));

  if (!tasks.length) {
    return res.status(400).json({ message: `Choose at least one task: ${OPTIMIZATION_TASKS.join(', ')}.` });
  }

  const results = [];

  if (tasks.includes('orphan-uploads')) {
    const result = await deleteOrphanUploads({ includeRecent: Boolean(req.body?.includeRecent) });
    results.push({
      task: 'orphan-uploads',
      detail: `Deleted ${result.deletedCount} unlinked file(s), freeing ${result.freedBytes} bytes`
        + (result.skippedCount ? `; skipped ${result.skippedCount} uploaded in the last hour` : ''),
      ...result,
    });
  }

  if (tasks.includes('clear-logs')) {
    const olderThanDays = Number(req.body?.olderThanDays ?? 0);
    const deletedCount = await clearLogs({ olderThanDays });
    results.push({
      task: 'clear-logs',
      detail: olderThanDays > 0
        ? `Deleted ${deletedCount} log entries older than ${olderThanDays} day(s)`
        : `Deleted all ${deletedCount} log entries`,
      deletedCount,
    });
  }

  if (tasks.includes('compact')) {
    const result = await compactCollections();
    results.push({
      task: 'compact',
      detail: `Compacted ${result.compacted.length} collection(s)`
        + (result.failed.length ? `; ${result.failed.length} refused` : ''),
      ...result,
    });
  }

  if (tasks.includes('sync-indexes')) {
    const indexes = await syncModelIndexes();
    const droppedCount = indexes.reduce((total, entry) => total + (entry.dropped?.length || 0), 0);
    results.push({
      task: 'sync-indexes',
      detail: `Checked ${indexes.length} model(s), dropped ${droppedCount} stale index(es)`,
      indexes,
    });
  }

  // Written after the tasks so "clear logs" does not immediately erase it.
  await writeLog({
    source: 'database',
    action: 'optimize',
    message: results.map((result) => result.detail).join('; '),
    actor: actorOf(req),
    meta: { tasks },
  });

  return res.json({ results });
};
