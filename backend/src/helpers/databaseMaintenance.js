import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { Record } from '../models/recordModel.js';
import { Mail } from '../models/mailModel.js';

// mongoose re-exports the driver, and the driver re-exports BSON, so extended
// JSON is available without adding a dependency of our own. Canonical (rather
// than relaxed) mode is what keeps Date and ObjectId values round-trippable.
const { EJSON } = mongoose.mongo.BSON;

export const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
export const BACKUP_DIR = path.join(process.cwd(), 'backups');

// A file uploaded seconds ago may not be referenced yet — the record is saved
// after multer writes it, and a half-finished compose still holds its file.
// Orphans younger than this are reported but never deleted.
export const ORPHAN_GRACE_MS = 60 * 60 * 1000;

const INSERT_CHUNK = 500;

export const getDb = () => {
  const db = mongoose.connection?.db;
  if (!db || mongoose.connection.readyState !== 1) {
    const error = new Error('The database connection is not ready.');
    error.status = 503;
    throw error;
  }
  return db;
};

/* ------------------------------------------------------------------ status */

/** Collections as they exist on the server, not as the models declare them. */
export const listCollections = async () => {
  const db = getDb();
  const infos = await db.listCollections().toArray();
  return infos
    .filter((info) => info.type !== 'view' && !info.name.startsWith('system.'))
    .map((info) => info.name)
    .sort();
};

export const getCollectionCounts = async () => {
  const db = getDb();
  const names = await listCollections();
  return Promise.all(names.map(async (name) => ({
    name,
    documents: await db.collection(name).estimatedDocumentCount(),
  })));
};

export const getDatabaseStats = async () => {
  const db = getDb();
  const [stats, serverInfo] = await Promise.all([
    db.command({ dbStats: 1, scale: 1 }),
    db.admin().serverInfo().catch(() => ({})),
  ]);

  return {
    name: db.databaseName,
    host: mongoose.connection.host || '',
    port: mongoose.connection.port || null,
    mongoVersion: serverInfo.version || 'unknown',
    collections: stats.collections || 0,
    objects: stats.objects || 0,
    dataSize: stats.dataSize || 0,
    storageSize: stats.storageSize || 0,
    indexSize: stats.indexSize || 0,
  };
};

/* ----------------------------------------------------------------- uploads */

const toRelativeUpload = (value) => String(value || '')
  .replace(/^https?:\/\/[^/]+/i, '')
  .split('?')[0]
  .replace(/^\/+/, '')
  .replace(/^uploads\//, '')
  .trim();

/** Every upload path any document still points at. */
export const getReferencedUploads = async () => {
  const [records, mails] = await Promise.all([
    Record.find({}, { attachment: 1, attachments: 1 }).lean(),
    Mail.find({}, { attachment: 1 }).lean(),
  ]);

  const referenced = new Set();
  const add = (value) => {
    const relative = toRelativeUpload(value);
    if (relative) referenced.add(relative);
  };

  records.forEach((record) => {
    add(record.attachment);
    (record.attachments || []).forEach(add);
  });
  mails.forEach((mail) => add(mail.attachment));

  return referenced;
};

const walkUploads = async (directory = UPLOAD_DIR, prefix = '') => {
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walkUploads(absolute, relative));
      continue;
    }
    if (!entry.isFile()) continue;

    const stat = await fs.stat(absolute);
    files.push({ relative, absolute, size: stat.size, modifiedAt: stat.mtime });
  }
  return files;
};

/**
 * Files under uploads/ that no record or mail references any more, typically
 * left behind when a record was deleted or an upload was replaced.
 */
export const findOrphanUploads = async () => {
  const [files, referenced] = await Promise.all([walkUploads(), getReferencedUploads()]);
  const cutoff = Date.now() - ORPHAN_GRACE_MS;

  const orphans = files
    .filter((file) => !referenced.has(file.relative))
    .map((file) => ({
      path: file.relative,
      size: file.size,
      modifiedAt: file.modifiedAt,
      // Too new to be sure it is really unlinked, so it is listed but skipped.
      isRecent: file.modifiedAt.getTime() > cutoff,
    }))
    .sort((a, b) => b.size - a.size);

  return {
    totalFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    referenced: referenced.size,
    orphans,
    orphanBytes: orphans.reduce((sum, file) => sum + file.size, 0),
  };
};

export const deleteOrphanUploads = async ({ includeRecent = false } = {}) => {
  const report = await findOrphanUploads();
  const targets = report.orphans.filter((file) => includeRecent || !file.isRecent);
  const uploadRoot = path.resolve(UPLOAD_DIR);

  const deleted = [];
  const failed = [];
  for (const file of targets) {
    // Re-anchor on UPLOAD_DIR so a crafted name can never escape the folder.
    const absolute = path.resolve(uploadRoot, file.path);
    if (!absolute.startsWith(uploadRoot + path.sep)) {
      failed.push({ path: file.path, reason: 'Outside the uploads directory.' });
      continue;
    }
    try {
      await fs.unlink(absolute);
      deleted.push(file);
    } catch (error) {
      failed.push({ path: file.path, reason: error.message });
    }
  }

  return {
    deletedCount: deleted.length,
    freedBytes: deleted.reduce((sum, file) => sum + file.size, 0),
    skippedCount: report.orphans.length - targets.length,
    failed,
  };
};

/* ----------------------------------------------------------------- backups */

/** Rejects anything that is not a plain backup filename in BACKUP_DIR. */
export const safeBackupName = (value) => {
  const base = path.basename(String(value || ''));
  return /^[A-Za-z0-9._-]+\.json$/.test(base) ? base : '';
};

export const backupPath = (name) => {
  const safe = safeBackupName(name);
  if (!safe) {
    const error = new Error('That backup name is not valid.');
    error.status = 400;
    throw error;
  }
  return path.join(BACKUP_DIR, safe);
};

const timestampSlug = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export const listBackups = async () => {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });

  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile() || !safeBackupName(entry.name)) continue;
    const stat = await fs.stat(path.join(BACKUP_DIR, entry.name));
    backups.push({ name: entry.name, size: stat.size, createdAt: stat.mtime });
  }

  return backups.sort((a, b) => b.createdAt - a.createdAt);
};

/**
 * Dumps every collection to one extended-JSON file.
 *
 * The whole dump is held in memory before it is written, which suits a store
 * of this size and keeps the file a single valid JSON document; a database
 * large enough to strain that wants mongodump, not this page.
 */
export const createBackup = async ({ label = 'manual', actor = null } = {}) => {
  const db = getDb();
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  const names = await listCollections();
  const payload = { meta: {}, collections: {} };
  const summary = [];

  for (const name of names) {
    const documents = await db.collection(name).find({}).toArray();
    payload.collections[name] = documents;
    summary.push({ name, documents: documents.length });
  }

  payload.meta = {
    version: 1,
    label,
    database: db.databaseName,
    createdAt: new Date().toISOString(),
    createdBy: actor?.username || 'system',
    collections: summary,
  };

  const fileName = `${label}-${timestampSlug()}.json`;
  const file = path.join(BACKUP_DIR, fileName);
  await fs.writeFile(file, EJSON.stringify(payload, { relaxed: false }), 'utf8');
  const stat = await fs.stat(file);

  return { name: fileName, size: stat.size, createdAt: stat.mtime, collections: summary };
};

export const readBackup = async (name) => {
  const raw = await fs.readFile(backupPath(name), 'utf8');
  const parsed = EJSON.parse(raw, { relaxed: false });
  if (!parsed?.collections || typeof parsed.collections !== 'object') {
    const error = new Error('That file is not a Knowledge Store backup.');
    error.status = 400;
    throw error;
  }
  return parsed;
};

/** Meta plus per-collection counts, so the UI can show what a restore would do. */
export const describeBackup = async (name) => {
  const parsed = await readBackup(name);
  return {
    name: safeBackupName(name),
    meta: parsed.meta || null,
    collections: Object.entries(parsed.collections)
      .filter(([, documents]) => Array.isArray(documents))
      .map(([collection, documents]) => ({ name: collection, documents: documents.length })),
  };
};

const insertDocuments = async (collection, documents, tolerateDuplicates) => {
  let inserted = 0;
  let duplicates = 0;

  for (let index = 0; index < documents.length; index += INSERT_CHUNK) {
    const chunk = documents.slice(index, index + INSERT_CHUNK);
    try {
      const result = await collection.insertMany(chunk, { ordered: false });
      inserted += result.insertedCount ?? Object.keys(result.insertedIds || {}).length;
    } catch (error) {
      const writeErrors = error.writeErrors || error.result?.result?.writeErrors || [];
      const nonDuplicate = writeErrors.filter((writeError) => (writeError.code ?? writeError.err?.code) !== 11000);
      if (!tolerateDuplicates || !writeErrors.length || nonDuplicate.length) throw error;

      duplicates += writeErrors.length;
      inserted += chunk.length - writeErrors.length;
    }
  }

  return { inserted, duplicates };
};

/**
 * mode 'replace' empties each collection first — the backup becomes the whole
 * truth. mode 'merge' keeps what is there and skips documents whose _id or
 * unique key already exists.
 */
export const restoreBackup = async (name, { mode = 'replace' } = {}) => {
  const db = getDb();
  const parsed = await readBackup(name);
  const replace = mode !== 'merge';
  const results = [];

  for (const [collectionName, documents] of Object.entries(parsed.collections)) {
    if (!Array.isArray(documents)) continue;
    const collection = db.collection(collectionName);
    let removed = 0;

    if (replace) {
      const deletion = await collection.deleteMany({});
      removed = deletion.deletedCount || 0;
    }

    const { inserted, duplicates } = await insertDocuments(collection, documents, !replace);
    results.push({ name: collectionName, removed, inserted, duplicates });
  }

  return {
    mode: replace ? 'replace' : 'merge',
    backup: safeBackupName(name),
    meta: parsed.meta || null,
    collections: results,
  };
};

export const deleteBackup = async (name) => {
  await fs.unlink(backupPath(name));
};

/* ------------------------------------------------------------- replication */

const mapMember = (member) => ({
  id: member._id,
  name: member.name,
  state: member.stateStr,
  health: member.health,
  uptime: member.uptime,
  optimeDate: member.optimeDate || null,
  lastHeartbeat: member.lastHeartbeat || null,
  self: Boolean(member.self),
});

/**
 * Replication is a server-level feature: a standalone mongod has none, and
 * saying so plainly is more useful than an empty member list.
 */
export const getReplicationStatus = async () => {
  const admin = getDb().admin();

  let hello = {};
  try {
    hello = await admin.command({ hello: 1 });
  } catch (error) {
    hello = await admin.command({ isMaster: 1 }).catch(() => ({}));
  }

  const base = {
    setName: hello.setName || '',
    isWritablePrimary: Boolean(hello.isWritablePrimary ?? hello.ismaster),
    hosts: hello.hosts || [],
    me: hello.me || '',
  };

  if (!hello.setName) {
    return {
      ...base,
      enabled: false,
      initialized: false,
      members: [],
      hint: 'This server is running standalone. Restart mongod with --replSet <name> before a replica set can be initiated.',
    };
  }

  try {
    const [status, configWrapper] = await Promise.all([
      admin.command({ replSetGetStatus: 1 }),
      admin.command({ replSetGetConfig: 1 }).catch(() => ({})),
    ]);

    return {
      ...base,
      enabled: true,
      initialized: true,
      setName: status.set || base.setName,
      members: (status.members || []).map(mapMember),
      primary: (status.members || []).find((member) => member.stateStr === 'PRIMARY')?.name || '',
      configVersion: configWrapper.config?.version ?? null,
      date: status.date || null,
    };
  } catch (error) {
    // 94 NotYetInitialized: --replSet is set but rs.initiate() has not run yet.
    return {
      ...base,
      enabled: true,
      initialized: false,
      members: [],
      error: { code: error.code ?? null, codeName: error.codeName || '', message: error.message },
      hint: 'The server belongs to a replica set that has not been initiated yet.',
    };
  }
};

export const initiateReplicaSet = async ({ setName, members = [] }) => {
  const admin = getDb().admin();
  await admin.command({
    replSetInitiate: {
      _id: setName,
      members: members.map((host, index) => ({ _id: index, host })),
    },
  });
  return getReplicationStatus();
};

const reconfigure = async (mutate) => {
  const admin = getDb().admin();
  const { config } = await admin.command({ replSetGetConfig: 1 });
  const next = mutate({ ...config, members: [...(config.members || [])] });

  next.version = (config.version || 0) + 1;
  await admin.command({ replSetReconfig: next });
  return getReplicationStatus();
};

export const addReplicaMember = ({ host, priority = 1, votes = 1, arbiter = false }) => reconfigure((config) => {
  if (config.members.some((member) => member.host === host)) {
    const error = new Error(`${host} is already a member of this replica set.`);
    error.status = 400;
    throw error;
  }

  // Member ids are never reused within a config, so continue past the highest.
  const nextId = config.members.reduce((highest, member) => Math.max(highest, member._id), -1) + 1;
  config.members.push(arbiter
    ? { _id: nextId, host, arbiterOnly: true }
    : { _id: nextId, host, priority, votes });

  return config;
});

export const removeReplicaMember = (host) => reconfigure((config) => {
  const remaining = config.members.filter((member) => member.host !== host);
  if (remaining.length === config.members.length) {
    const error = new Error(`${host} is not a member of this replica set.`);
    error.status = 404;
    throw error;
  }
  if (!remaining.length) {
    const error = new Error('A replica set must keep at least one member.');
    error.status = 400;
    throw error;
  }

  config.members = remaining;
  return config;
});

/* ------------------------------------------------------------ optimisation */

/** Reclaims disk space a collection no longer uses. */
export const compactCollections = async () => {
  const db = getDb();
  const names = await listCollections();
  const compacted = [];
  const failed = [];

  for (const name of names) {
    try {
      await db.command({ compact: name });
      compacted.push(name);
    } catch (error) {
      // compact is unavailable through mongos and on some managed deployments.
      failed.push({ name, reason: error.message });
    }
  }

  return { compacted, failed };
};

/** Brings the server's indexes back in line with what the models declare. */
export const syncModelIndexes = async () => {
  const results = [];
  for (const modelName of mongoose.modelNames()) {
    try {
      const dropped = await mongoose.model(modelName).syncIndexes();
      results.push({ model: modelName, dropped: dropped || [] });
    } catch (error) {
      results.push({ model: modelName, error: error.message });
    }
  }
  return results;
};

/** Drops every non-system collection. Only ever called behind an explicit confirmation. */
export const dropAllCollections = async () => {
  const db = getDb();
  const names = await listCollections();
  const dropped = [];

  for (const name of names) {
    try {
      await db.collection(name).drop();
      dropped.push(name);
    } catch (error) {
      // 26 NamespaceNotFound: something else dropped it first; nothing to do.
      if (error.code !== 26) throw error;
    }
  }

  return dropped;
};
