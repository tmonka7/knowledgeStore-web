// Datasets of files — images for YOLO, audio for Speech to Text — uploaded
// from the pages that label them, so the server can train on them.
//
// They live on disk, not in MongoDB: a YOLO dataset is easily gigabytes of
// images, and the training scripts read files anyway. Layout, per dataset:
//
//   datasets/yolo/<id>/ks-dataset.json          name, owner, classes, task
//   datasets/yolo/<id>/images/<relative path>    as picked in the browser
//   datasets/yolo/<id>/labels/<relative path>.txt   written from the page's labels
//
//   datasets/speech/<id>/ks-dataset.json        name, owner, language
//   datasets/speech/<id>/audio/<file name>.wav
//   datasets/speech/<id>/metadata.jsonl         {"audio": "audio/x.wav", "text": …}
//
//   datasets/voice/<id>/ks-dataset.json         name, owner, language, speaker, script
//   datasets/voice/<id>/audio/<line id>.wav      one recording per line of the script
//   datasets/voice/<id>/metadata.jsonl          as for speech, so training reads either
//
// Voice datasets (Text to Speech) are recorded on the page line by line
// rather than uploaded as a folder: each clip is sent as soon as it is
// recorded, and the script — the lines to read, recorded or not — is kept in
// ks-dataset.json. See saveVoiceScript.
//
//   datasets/command/<id>/ks-dataset.json       name, owner, language, commands, clips
//   datasets/command/<id>/audio/<clip id>.wav    recordings, recorded on the page like voice lines
//   datasets/command/<id>/metadata.jsonl        {"audio", "text", "command"} per recording
//
// Uploading is incremental: the page asks which files the server already has
// (by path and size) and sends only the rest, in batches, then sends the
// labels or transcripts last. Files the page no longer has are removed at that
// point, so the server copy mirrors the folder that was opened.
//
// Datasets are shared (helpers/datasetAccess.js): everyone who can open the
// tool sees them all, trains on them and adds to them. What someone other
// than the creator adds is recorded as theirs — meta.addedBy for uploaded
// files, recordedBy for voice lines, clip.by for command recordings — so they
// can change or remove it, and it is all they can change or remove. The
// creator and administrators manage the rest. Functions take a caller
// ({ id, admin }, or a bare user id for read-only use by jobs).

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JobError, PYTHON_DIR, exists } from './translationJobs.js';
import {
  asCaller, canChangeItem, canManage, describeOwner, describeOwners, requireManage,
} from './datasetAccess.js';

export const DATASETS_DIR = path.resolve(process.env.ML_DATASETS_DIR || path.join(PYTHON_DIR, 'datasets'));
const META_FILE = 'ks-dataset.json';
const SAFE_ID = /^[0-9a-f-]{36}$/;

export const DATASET_KINDS = {
  yolo: { folder: 'images', pattern: /\.(jpe?g|png|bmp|webp|tiff?)$/i, label: 'image' },
  speech: { folder: 'audio', pattern: /\.wav$/i, label: 'WAV file' },
  voice: { folder: 'audio', pattern: /\.wav$/i, label: 'WAV file' },
  command: { folder: 'audio', pattern: /\.wav$/i, label: 'WAV file' },
};

const rootOf = (kind) => path.join(DATASETS_DIR, kind);

const readMeta = async (folder) => {
  try {
    return JSON.parse(await fs.readFile(path.join(folder, META_FILE), 'utf8'));
  } catch {
    return null;
  }
};

const writeMeta = (folder, meta) => fs.writeFile(path.join(folder, META_FILE), JSON.stringify(meta, null, 2), 'utf8');

/**
 * A browser-supplied relative path, made safe to join under a dataset folder:
 * forward slashes, no empty, "." or ".." segments, no drive letters, and no
 * characters Windows refuses in file names.
 */
export const safeRelativePath = (value) => {
  const segments = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean);
  const bad = !segments.length || segments.length > 16 || segments.some((segment) => (
    segment === '.' || segment === '..' || /[<>:"|?*\u0000-\u001f]/.test(segment) || segment.length > 200
  ));
  if (bad) throw new JobError(`"${value}" is not a usable file path.`);
  return segments.join('/');
};

const walk = async (folder, prefix = '') => {
  let entries = [];
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return walk(path.join(folder, entry.name), relative);
    return [{ path: relative, size: (await fs.stat(path.join(folder, entry.name))).size }];
  }));
  return nested.flat();
};

/**
 * The dataset folder and its details. `access` is "read" (see it, train on
 * it, add to it — anyone who can open the tool) or "manage" (change what it
 * is, or delete it: its creator or an administrator).
 */
const locate = async (caller, kind, id, access = 'read') => {
  if (!DATASET_KINDS[kind] || !SAFE_ID.test(String(id || ''))) throw new JobError('Dataset not found.', 404);
  const folder = path.join(rootOf(kind), id);
  const meta = await readMeta(folder);
  if (!meta) throw new JobError('Dataset not found.', 404);
  if (access === 'manage') requireManage(caller, meta.ownerId);
  return { folder, meta };
};

/** What the page sees: everything but the record of who added which file. */
const publicMeta = ({ addedBy: _addedBy, recordedBy: _recordedBy, ...meta }) => meta;

/** Every dataset of `kind`, newest first, each saying who made it and whether the caller may manage it. */
export const listDatasets = async (caller, kind) => {
  let names = [];
  try {
    names = await fs.readdir(rootOf(kind));
  } catch {
    return [];
  }
  const metas = await Promise.all(names.filter((name) => SAFE_ID.test(name))
    .map((name) => readMeta(path.join(rootOf(kind), name))));
  return describeOwners(caller, metas
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(publicMeta));
};

export const createDataset = async (caller, kind, fields) => {
  const ownerId = asCaller(caller).id;
  if (!DATASET_KINDS[kind]) throw new JobError('Unknown dataset type.');
  const name = String(fields.name || '').trim().slice(0, 120);
  if (!name) throw new JobError('A dataset name is required.');
  const id = randomUUID();
  const folder = path.join(rootOf(kind), id);
  await fs.mkdir(path.join(folder, DATASET_KINDS[kind].folder), { recursive: true });
  const now = new Date().toISOString();
  const meta = { id, ownerId, kind, name, createdAt: now, updatedAt: now, fileCount: 0, bytes: 0, complete: false };
  await writeMeta(folder, meta);
  return publicMeta(meta);
};

/** The dataset, with every file the server holds (path and size). */
export const getDataset = async (caller, kind, id) => {
  const { folder, meta } = await locate(caller, kind, id);
  const files = await walk(path.join(folder, DATASET_KINDS[kind].folder));
  return { ...(await describeOwner(caller, publicMeta(meta))), files };
};

export const datasetFolder = async (caller, kind, id) => (await locate(caller, kind, id)).folder;

/** Who added each file, for files someone other than the creator uploaded. */
const addedByOf = (meta) => (meta.addedBy && typeof meta.addedBy === 'object' ? meta.addedBy : {});

/**
 * Move uploaded temp files into the dataset. `uploads` are multer files;
 * `paths` gives each one's relative path, in the same order. Someone other
 * than the creator adds files, and may replace only files they added.
 */
export const addFiles = async (caller, kind, id, uploads, paths) => {
  const { folder, meta } = await locate(caller, kind, id);
  const { folder: filesFolder, pattern, label } = DATASET_KINDS[kind];
  const who = asCaller(caller);
  const manager = canManage(who, meta.ownerId);
  try {
    if (!Array.isArray(paths) || paths.length !== uploads.length) {
      throw new JobError('Every uploaded file needs its path.');
    }
    const targets = paths.map((value) => {
      const relative = safeRelativePath(value);
      if (!pattern.test(relative)) throw new JobError(`${relative} is not a ${label}.`);
      return relative;
    });
    const addedBy = addedByOf(meta);
    if (!manager) {
      for (const relative of targets) {
        if (addedBy[relative] !== who.id && await exists(path.join(folder, filesFolder, ...relative.split('/')))) {
          throw new JobError(`${relative} is already in this dataset, added by someone else. Rename your file and try again.`, 409);
        }
      }
    }
    for (const [index, upload] of uploads.entries()) {
      const target = path.join(folder, filesFolder, ...targets[index].split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      // rename fails across drives (temp on C:, datasets on D:); copy then.
      await fs.rename(upload.path, target).catch(async () => {
        await fs.copyFile(upload.path, target);
      });
    }
    // The creator's own files carry no mark; anyone else's are recorded as theirs.
    if (!manager) {
      await writeMeta(folder, { ...meta, addedBy: { ...addedBy, ...Object.fromEntries(targets.map((file) => [file, who.id])) } });
    }
    return { saved: targets.length };
  } finally {
    await Promise.all(uploads.map((upload) => fs.rm(upload.path, { force: true })));
  }
};

/**
 * Remove files the page no longer has, so the server copy mirrors its folder.
 * With `only`, just the files it allows are candidates: someone other than
 * the creator mirrors only the files they added.
 */
const prune = async (folder, kind, keep, only = null) => {
  const filesFolder = path.join(folder, DATASET_KINDS[kind].folder);
  const wanted = new Set(keep);
  const present = await walk(filesFolder);
  const gone = present.filter((file) => !wanted.has(file.path) && (!only || only(file.path)));
  await Promise.all(gone.map((file) => fs.rm(path.join(filesFolder, ...file.path.split('/')), { force: true })));
  return gone.map((file) => file.path);
};

/**
 * The part of an upload's finishing step that depends on who sends it. The
 * creator's (or an administrator's) upload mirrors the page's folder. Anyone
 * else's removes only their own files the page no longer has, and may write
 * labels or transcripts only for files they added: `mayWrite(path)`.
 */
const contribution = async (caller, folder, kind, meta, keep) => {
  const who = asCaller(caller);
  const manager = canManage(who, meta.ownerId);
  const addedBy = { ...addedByOf(meta) };
  const only = manager ? null : (file) => addedBy[file] === who.id;
  if (Array.isArray(keep)) {
    for (const file of await prune(folder, kind, keep.map(safeRelativePath), only)) delete addedBy[file];
  }
  return { manager, addedBy, mayWrite: only || (() => true) };
};

const summarise = async (folder, kind) => {
  const files = await walk(path.join(folder, DATASET_KINDS[kind].folder));
  return { fileCount: files.length, bytes: files.reduce((total, file) => total + file.size, 0) };
};

/**
 * Finish a YOLO upload: classes, task, and one label text per image, as the
 * page's buildLabelFile writes it. An image with an empty label is a
 * background sample; an image with no entry at all is unlabelled and is left
 * out of training.
 */
export const saveYoloLabels = async (caller, id, { classes, task, labels, keep }) => {
  const { folder, meta } = await locate(caller, 'yolo', id);
  const names = (Array.isArray(classes) ? classes : []).map((name) => String(name).trim()).filter(Boolean);
  if (!names.length) throw new JobError('The dataset needs at least one class.');
  if (!['detect', 'segment'].includes(task)) throw new JobError('The task must be detect or segment.');
  if (!labels || typeof labels !== 'object') throw new JobError('Labels are missing.');
  // Class ids in the label lines are positions in the class list, so an
  // addition to someone else's dataset has to use the same list.
  if (!canManage(caller, meta.ownerId) && meta.complete && Array.isArray(meta.classes)) {
    if (meta.task && meta.task !== task) throw new JobError(`This is a ${meta.task} dataset; your labels are for ${task}.`);
    if (meta.classes.join('\n') !== names.join('\n')) {
      throw new JobError(`This dataset's classes are ${meta.classes.join(', ')}, in that order; label your images with the same classes to add them.`);
    }
  }

  const { manager, addedBy, mayWrite } = await contribution(caller, folder, 'yolo', meta, keep);
  const labelFile = (image) => path.join(folder, 'labels', ...`${image.replace(/\.[^./]+$/, '')}.txt`.split('/'));

  const labelsFolder = path.join(folder, 'labels');
  if (manager) {
    await fs.rm(labelsFolder, { recursive: true, force: true });
  } else {
    // Only the caller's own images are relabelled; their old labels go first,
    // and so do labels left by images the caller removed.
    const mine = Object.keys(addedByOf(meta)).filter((file) => addedByOf(meta)[file] === asCaller(caller).id);
    await Promise.all(mine.map((file) => fs.rm(labelFile(file), { force: true })));
  }
  for (const [image, text] of Object.entries(labels)) {
    const relative = safeRelativePath(image);
    if (!mayWrite(relative)) continue;
    if (!(await exists(path.join(folder, 'images', ...relative.split('/'))))) continue;
    const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    // Each line: a class id in range, then only numbers between 0 and 1.
    const valid = lines.every((line) => {
      const [classId, ...values] = line.split(/\s+/);
      return /^\d+$/.test(classId) && Number(classId) < names.length && values.length >= 4
        && values.every((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1);
    });
    if (!valid) throw new JobError(`The labels for ${relative} are not valid YOLO lines.`);
    const target = labelFile(relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  }
  const labelled = (await walk(labelsFolder)).length;

  const updated = {
    ...meta, addedBy, classes: manager ? names : meta.classes || names, task: manager ? task : meta.task || task,
    labelled, ...(await summarise(folder, 'yolo')), complete: true, updatedAt: new Date().toISOString(),
  };
  await writeMeta(folder, updated);
  return publicMeta(updated);
};

/** Finish a speech upload: the language and one transcript per clip. */
export const saveTranscripts = async (caller, id, { language, transcripts, keep }) => {
  const { folder, meta } = await locate(caller, 'speech', id);
  const code = String(language || '').trim();
  if (!/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(code)) throw new JobError('Pick the language spoken in the clips.');
  if (!transcripts || typeof transcripts !== 'object') throw new JobError('Transcripts are missing.');
  if (!canManage(caller, meta.ownerId) && meta.complete && meta.language && meta.language !== code) {
    throw new JobError(`This dataset is in "${meta.language}"; your clips are marked "${code}".`);
  }

  const { manager, addedBy, mayWrite } = await contribution(caller, folder, 'speech', meta, keep);

  // Someone else's addition keeps every transcript but those of their own clips.
  const lines = [];
  if (!manager) {
    let previous = [];
    try {
      previous = (await fs.readFile(path.join(folder, 'metadata.jsonl'), 'utf8')).split('\n').filter(Boolean);
    } catch { /* none yet */ }
    for (const line of previous) {
      try {
        const file = String(JSON.parse(line).audio || '').replace(/^audio\//, '');
        if (!mayWrite(file) && await exists(path.join(folder, 'audio', ...file.split('/')))) lines.push(line);
      } catch { /* a broken line is dropped */ }
    }
  }
  for (const [clip, text] of Object.entries(transcripts)) {
    const relative = safeRelativePath(clip);
    if (!mayWrite(relative)) continue;
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    if (!cleaned || !(await exists(path.join(folder, 'audio', ...relative.split('/'))))) continue;
    lines.push(JSON.stringify({ audio: `audio/${relative}`, text: cleaned }));
  }
  await fs.writeFile(path.join(folder, 'metadata.jsonl'), lines.length ? `${lines.join('\n')}\n` : '', 'utf8');

  const updated = {
    ...meta, addedBy, language: manager ? code : meta.language || code, transcribed: lines.length, ...(await summarise(folder, 'speech')), complete: true,
    updatedAt: new Date().toISOString(),
  };
  await writeMeta(folder, updated);
  return publicMeta(updated);
};

/*
 * Voice datasets (Text to Speech): a script of lines, each with an id, and a
 * recording per line as audio/<line id>.wav.
 */
const LINE_ID = /^[a-z0-9]{4,40}$/;
const MAX_LINES = 2000;
const MAX_LINE_CHARS = 500;
const MAX_CLIP_BYTES = 20 * 1024 * 1024;

/** Seconds of audio in a PCM WAV, from its header, or 0 if it cannot be read. */
const wavSeconds = async (file) => {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const header = Buffer.alloc(44);
    await handle.read(header, 0, 44, 0);
    const byteRate = header.readUInt32LE(28);
    const { size } = await handle.stat();
    return byteRate ? Math.round(((size - 44) / byteRate) * 10) / 10 : 0;
  } catch {
    return 0;
  } finally {
    await handle?.close();
  }
};

const cleanScript = (script) => {
  if (!Array.isArray(script)) throw new JobError('The script must be a list of lines.');
  if (script.length > MAX_LINES) throw new JobError(`A script may have at most ${MAX_LINES} lines.`);
  const seen = new Set();
  return script.map((line) => {
    const id = String(line?.id || '');
    if (!LINE_ID.test(id) || seen.has(id)) throw new JobError('Every line of the script needs its own id.');
    seen.add(id);
    return { id, text: String(line?.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_CHARS) };
  });
};

/**
 * Save a voice dataset's details and script, and bring the rest in line with
 * it: recordings of lines no longer in the script are deleted, and
 * metadata.jsonl lists every recorded line that has text. `fields` may hold
 * any of name, language, speaker and script; the rest are kept. Changing any
 * of them is for the dataset's creator or an administrator.
 */
export const saveVoiceScript = async (caller, id, fields = {}) => {
  const changes = ['name', 'language', 'speaker', 'script'].some((key) => fields[key] !== undefined);
  const { folder, meta } = await locate(caller, 'voice', id, changes ? 'manage' : 'read');
  return rewriteVoice(folder, meta, fields);
};

const rewriteVoice = async (folder, meta, fields = {}) => {
  const next = { ...meta };
  if (fields.name !== undefined) {
    next.name = String(fields.name || '').trim().slice(0, 120);
    if (!next.name) throw new JobError('A dataset name is required.');
  }
  if (fields.language !== undefined) {
    const code = String(fields.language || '').trim();
    if (!/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(code)) throw new JobError('Pick the language the lines are in.');
    next.language = code;
  }
  if (fields.speaker !== undefined) next.speaker = String(fields.speaker || '').trim().slice(0, 120);
  if (fields.script !== undefined) next.script = cleanScript(fields.script);
  next.script = next.script || [];

  const audioFolder = path.join(folder, 'audio');
  await prune(folder, 'voice', next.script.map((line) => `${line.id}.wav`));
  const lines = [];
  const recordedBy = {};
  let seconds = 0;
  let recorded = 0;
  for (const line of next.script) {
    const file = path.join(audioFolder, `${line.id}.wav`);
    if (!(await exists(file))) continue;
    if (next.recordedBy?.[line.id]) recordedBy[line.id] = next.recordedBy[line.id];
    recorded += 1;
    seconds += await wavSeconds(file);
    if (line.text) lines.push(JSON.stringify({ audio: `audio/${line.id}.wav`, text: line.text }));
  }
  await fs.writeFile(path.join(folder, 'metadata.jsonl'), lines.length ? `${lines.join('\n')}\n` : '', 'utf8');

  const updated = {
    ...next,
    recordedBy,
    lines: next.script.length,
    recorded,
    transcribed: lines.length,
    seconds: Math.round(seconds * 10) / 10,
    ...(await summarise(folder, 'voice')),
    complete: true,
    updatedAt: new Date().toISOString(),
  };
  await writeMeta(folder, updated);
  return publicMeta(updated);
};

/** A voice dataset for the list: everything but the script itself. */
export const voiceSummary = ({ script: _script, ...meta }) => meta;

export const createVoiceDataset = async (caller, fields = {}) => {
  const dataset = await createDataset(caller, 'voice', fields);
  try {
    return await saveVoiceScript(caller, dataset.id, {
      language: fields.language, speaker: fields.speaker, script: fields.script || [],
    });
  } catch (error) {
    await deleteDataset(caller, 'voice', dataset.id);
    throw error;
  }
};

/**
 * A voice dataset with the length of each line's recording (0: not
 * recorded), and whether the caller may record it again or delete it: a
 * line recorded by someone else is theirs.
 */
export const getVoiceDataset = async (caller, id) => {
  const { folder, meta } = await locate(caller, 'voice', id);
  const script = await Promise.all((meta.script || []).map(async (line) => {
    const file = path.join(folder, 'audio', `${line.id}.wav`);
    const seconds = (await exists(file)) ? await wavSeconds(file) : 0;
    return { ...line, seconds, canChange: !seconds || canChangeItem(caller, meta.ownerId, meta.recordedBy?.[line.id]) };
  }));
  return { ...(await describeOwner(caller, publicMeta(meta))), script };
};

const clipFile = (folder, lineId) => {
  if (!LINE_ID.test(String(lineId || ''))) throw new JobError('That line does not exist.', 404);
  return path.join(folder, 'audio', `${lineId}.wav`);
};

/**
 * Store (or replace) the recording of one line: `upload` is a multer file
 * holding a WAV. Anyone may record a line nobody has recorded; a recording
 * can be replaced by whoever made it, the creator or an administrator.
 */
export const saveVoiceClip = async (caller, id, lineId, upload) => {
  try {
    const { folder, meta } = await locate(caller, 'voice', id);
    if (!(meta.script || []).some((line) => line.id === lineId)) throw new JobError('That line does not exist.', 404);
    const taken = await exists(clipFile(folder, lineId));
    if (taken && !canChangeItem(caller, meta.ownerId, meta.recordedBy?.[lineId])) {
      throw new JobError('Someone else recorded this line; only they, the dataset\'s creator or an administrator can record it again.', 403);
    }
    if (!upload) throw new JobError('No recording was sent.');
    if (upload.size > MAX_CLIP_BYTES) throw new JobError('That recording is too long.');
    const handle = await fs.open(upload.path, 'r');
    const header = Buffer.alloc(12);
    await handle.read(header, 0, 12, 0);
    await handle.close();
    if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
      throw new JobError('The recording is not a WAV file.');
    }
    const target = clipFile(folder, lineId);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(upload.path, target);
    // The creator's recordings carry no mark; anyone else's are recorded as theirs.
    const who = asCaller(caller);
    const recordedBy = { ...(meta.recordedBy || {}) };
    if (who.id === meta.ownerId) delete recordedBy[lineId];
    else if (!taken || recordedBy[lineId]) recordedBy[lineId] = recordedBy[lineId] || who.id;
    await rewriteVoice(folder, { ...meta, recordedBy });
    return getVoiceDataset(caller, id);
  } finally {
    if (upload) await fs.rm(upload.path, { force: true });
  }
};

export const deleteVoiceClip = async (caller, id, lineId) => {
  const { folder, meta } = await locate(caller, 'voice', id);
  if (!canChangeItem(caller, meta.ownerId, meta.recordedBy?.[lineId])) {
    throw new JobError('Someone else recorded this line; only they, the dataset\'s creator or an administrator can delete it.', 403);
  }
  await fs.rm(clipFile(folder, lineId), { force: true });
  await rewriteVoice(folder, meta);
  return getVoiceDataset(caller, id);
};

/** The path of one line's recording, for streaming it back to the page. */
export const voiceClipPath = async (caller, id, lineId) => {
  const { folder } = await locate(caller, 'voice', id);
  const file = clipFile(folder, lineId);
  if (!(await exists(file))) throw new JobError('That line has not been recorded.', 404);
  return file;
};

/*
 * Command sets (Speech to Command): commands, each with the phrases that say
 * it, and recordings of people saying them — audio/<clip id>.wav, each
 * labelled with its command and the phrase spoken.
 */
const CLIP_ID = /^[a-z0-9]{4,40}$/;
const COMMAND_ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_COMMANDS = 200;
const MAX_PHRASES = 20;
const MAX_CLIPS = 5000;

const cleanCommands = (commands) => {
  if (!Array.isArray(commands)) throw new JobError('The commands must be a list.');
  if (commands.length > MAX_COMMANDS) throw new JobError(`A command set may have at most ${MAX_COMMANDS} commands.`);
  const seen = new Set();
  return commands.map((command) => {
    const id = String(command?.id || '');
    if (!COMMAND_ID.test(id) || seen.has(id)) throw new JobError('Every command needs its own id.');
    seen.add(id);
    const name = String(command?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name) throw new JobError('Every command needs a name.');
    const phrases = [...new Set((Array.isArray(command?.phrases) ? command.phrases : [])
      .map((phrase) => String(phrase || '').replace(/\s+/g, ' ').trim().slice(0, 200))
      .filter(Boolean))].slice(0, MAX_PHRASES);
    return { id, name, phrases: phrases.length ? phrases : [name] };
  });
};

/**
 * Save a command set's details and commands, and bring the rest in line:
 * recordings of commands no longer in the set are deleted, and metadata.jsonl
 * (what training reads) lists every recording that is left. Changing the
 * name, language or commands is for the set's creator or an administrator.
 */
export const saveCommandSet = async (caller, id, fields = {}) => {
  const changes = ['name', 'language', 'commands'].some((key) => fields[key] !== undefined);
  const { folder, meta } = await locate(caller, 'command', id, changes ? 'manage' : 'read');
  return rewriteCommands(folder, meta, fields);
};

const rewriteCommands = async (folder, meta, fields = {}) => {
  const next = { ...meta };
  if (fields.name !== undefined) {
    next.name = String(fields.name || '').trim().slice(0, 120);
    if (!next.name) throw new JobError('A name is required.');
  }
  if (fields.language !== undefined) {
    const code = String(fields.language || '').trim();
    if (!/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(code)) throw new JobError('Pick the language the commands are spoken in.');
    next.language = code;
  }
  if (fields.commands !== undefined) next.commands = cleanCommands(fields.commands);
  next.commands = next.commands || [];
  const known = new Set(next.commands.map((command) => command.id));
  next.clips = (fields.clips || next.clips || []).filter((clip) => known.has(clip.command));

  const audioFolder = path.join(folder, 'audio');
  await prune(folder, 'command', next.clips.map((clip) => `${clip.id}.wav`));
  const rows = [];
  const kept = [];
  let seconds = 0;
  for (const clip of next.clips) {
    const file = path.join(audioFolder, `${clip.id}.wav`);
    if (!(await exists(file))) continue;
    kept.push(clip);
    seconds += await wavSeconds(file);
    rows.push(JSON.stringify({ audio: `audio/${clip.id}.wav`, text: clip.text, command: clip.command }));
  }
  next.clips = kept;
  await fs.writeFile(path.join(folder, 'metadata.jsonl'), rows.length ? `${rows.join('\n')}\n` : '', 'utf8');

  const updated = {
    ...next,
    commandCount: next.commands.length,
    recorded: kept.length,
    transcribed: kept.length,
    seconds: Math.round(seconds * 10) / 10,
    ...(await summarise(folder, 'command')),
    complete: true,
    updatedAt: new Date().toISOString(),
  };
  await writeMeta(folder, updated);
  return publicMeta(updated);
};

/** A command set for a list: everything but its commands and recordings. */
export const commandSetSummary = ({ commands: _commands, clips: _clips, ...meta }) => meta;

export const createCommandSet = async (caller, fields = {}) => {
  const dataset = await createDataset(caller, 'command', fields);
  try {
    return await saveCommandSet(caller, dataset.id, { language: fields.language, commands: fields.commands || [] });
  } catch (error) {
    await deleteDataset(caller, 'command', dataset.id);
    throw error;
  }
};

/**
 * A command set with its commands, and its recordings with their lengths,
 * who made each (byName) and whether the caller may delete it.
 */
export const getCommandSet = async (caller, id) => {
  const { folder, meta } = await locate(caller, 'command', id);
  const described = await describeOwner(caller, publicMeta(meta));
  const names = new Map((await describeOwners(caller, [...new Set((meta.clips || []).map((clip) => clip.by || meta.ownerId))]
    .map((ownerId) => ({ ownerId })))).map((item) => [item.ownerId, item.ownerName]));
  const clips = await Promise.all((meta.clips || []).map(async (clip) => ({
    ...clip,
    seconds: await wavSeconds(path.join(folder, 'audio', `${clip.id}.wav`)),
    byName: names.get(clip.by || meta.ownerId) || '',
    canDelete: canChangeItem(caller, meta.ownerId, clip.by),
  })));
  return { ...described, commands: meta.commands || [], clips };
};

/** Add a recording of `command` saying `text`; `upload` is a multer file holding a WAV. Anyone may add one. */
export const addCommandClip = async (caller, id, { command, text }, upload) => {
  try {
    const { folder, meta } = await locate(caller, 'command', id);
    const target = (meta.commands || []).find((item) => item.id === command);
    if (!target) throw new JobError('That command is not in this set.', 404);
    if ((meta.clips || []).length >= MAX_CLIPS) throw new JobError(`A command set may hold at most ${MAX_CLIPS} recordings.`);
    const spoken = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200) || target.phrases[0];
    if (!upload) throw new JobError('No recording was sent.');
    if (upload.size > MAX_CLIP_BYTES) throw new JobError('That recording is too long.');
    const handle = await fs.open(upload.path, 'r');
    const header = Buffer.alloc(12);
    await handle.read(header, 0, 12, 0);
    await handle.close();
    if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
      throw new JobError('The recording is not a WAV file.');
    }
    const clipId = `${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const file = path.join(folder, 'audio', `${clipId}.wav`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.copyFile(upload.path, file);
    const who = asCaller(caller);
    const clip = { id: clipId, command, text: spoken, ...(who.id !== meta.ownerId ? { by: who.id } : {}) };
    await rewriteCommands(folder, meta, { clips: [...(meta.clips || []), clip] });
    return getCommandSet(caller, id);
  } finally {
    if (upload) await fs.rm(upload.path, { force: true });
  }
};

/** Delete a recording: whoever made it, the set's creator or an administrator. */
export const deleteCommandClip = async (caller, id, clipId) => {
  const { folder, meta } = await locate(caller, 'command', id);
  const clip = (meta.clips || []).find((item) => item.id === clipId);
  if (!CLIP_ID.test(String(clipId || '')) || !clip) throw new JobError('That recording does not exist.', 404);
  if (!canChangeItem(caller, meta.ownerId, clip.by)) {
    throw new JobError('Someone else made this recording; only they, the set\'s creator or an administrator can delete it.', 403);
  }
  await rewriteCommands(folder, meta, { clips: (meta.clips || []).filter((item) => item.id !== clipId) });
  return getCommandSet(caller, id);
};

/** The path of one recording, for playing it back. */
export const commandClipPath = async (caller, id, clipId) => {
  const { folder, meta } = await locate(caller, 'command', id);
  if (!CLIP_ID.test(String(clipId || '')) || !(meta.clips || []).some((clip) => clip.id === clipId)) {
    throw new JobError('That recording does not exist.', 404);
  }
  return path.join(folder, 'audio', `${clipId}.wav`);
};

/*
 * Changes to one dataset, one at a time: each rewrites its details (a command
 * set's list of recordings, who added which file), so two saved at once must
 * not both start from the same details. Now that datasets are shared, two
 * people can well add to one at the same moment.
 */
const commandLocks = new Map();
export const withDatasetLock = (id, work) => {
  const previous = commandLocks.get(id) || Promise.resolve();
  const next = previous.then(work, work);
  const settled = next.catch(() => {});
  commandLocks.set(id, settled);
  settled.then(() => { if (commandLocks.get(id) === settled) commandLocks.delete(id); });
  return next;
};
export const withCommandSetLock = withDatasetLock;

export const deleteDataset = async (caller, kind, id) => {
  const { folder } = await locate(caller, kind, id, 'manage');
  await fs.rm(folder, { recursive: true, force: true });
};

/** A file from the dataset to test an ONNX export on, if there is one. */
export const sampleFile = async (folder, kind) => {
  if (kind === 'speech' || kind === 'command') {
    try {
      const first = (await fs.readFile(path.join(folder, 'metadata.jsonl'), 'utf8')).split('\n').find(Boolean);
      return first ? path.join(folder, JSON.parse(first).audio) : null;
    } catch {
      return null;
    }
  }
  const labelled = await walk(path.join(folder, 'labels'));
  for (const label of labelled) {
    const stem = label.path.replace(/\.txt$/, '');
    for (const extension of ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.JPG', '.JPEG', '.PNG']) {
      const image = path.join(folder, 'images', ...`${stem}${extension}`.split('/'));
      if (await exists(image)) return image;
    }
  }
  return null;
};
