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
// Uploading is incremental: the page asks which files the server already has
// (by path and size) and sends only the rest, in batches, then sends the
// labels or transcripts last. Files the page no longer has are removed at that
// point, so the server copy mirrors the folder that was opened.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JobError, PYTHON_DIR, exists } from './translationJobs.js';

export const DATASETS_DIR = path.resolve(process.env.ML_DATASETS_DIR || path.join(PYTHON_DIR, 'datasets'));
const META_FILE = 'ks-dataset.json';
const SAFE_ID = /^[0-9a-f-]{36}$/;

export const DATASET_KINDS = {
  yolo: { folder: 'images', pattern: /\.(jpe?g|png|bmp|webp|tiff?)$/i, label: 'image' },
  speech: { folder: 'audio', pattern: /\.wav$/i, label: 'WAV file' },
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

/** The dataset folder, after checking it exists and belongs to ownerId. */
const locate = async (ownerId, kind, id) => {
  if (!DATASET_KINDS[kind] || !SAFE_ID.test(String(id || ''))) throw new JobError('Dataset not found.', 404);
  const folder = path.join(rootOf(kind), id);
  const meta = await readMeta(folder);
  if (!meta || meta.ownerId !== ownerId) throw new JobError('Dataset not found.', 404);
  return { folder, meta };
};

const publicMeta = ({ ownerId: _owner, ...meta }) => meta;

export const listDatasets = async (ownerId, kind) => {
  let names = [];
  try {
    names = await fs.readdir(rootOf(kind));
  } catch {
    return [];
  }
  const metas = await Promise.all(names.filter((name) => SAFE_ID.test(name))
    .map((name) => readMeta(path.join(rootOf(kind), name))));
  return metas
    .filter((meta) => meta && meta.ownerId === ownerId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(publicMeta);
};

export const createDataset = async (ownerId, kind, fields) => {
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
export const getDataset = async (ownerId, kind, id) => {
  const { folder, meta } = await locate(ownerId, kind, id);
  const files = await walk(path.join(folder, DATASET_KINDS[kind].folder));
  return { ...publicMeta(meta), files };
};

export const datasetFolder = async (ownerId, kind, id) => (await locate(ownerId, kind, id)).folder;

/**
 * Move uploaded temp files into the dataset. `uploads` are multer files;
 * `paths` gives each one's relative path, in the same order.
 */
export const addFiles = async (ownerId, kind, id, uploads, paths) => {
  const { folder } = await locate(ownerId, kind, id);
  const { folder: filesFolder, pattern, label } = DATASET_KINDS[kind];
  try {
    if (!Array.isArray(paths) || paths.length !== uploads.length) {
      throw new JobError('Every uploaded file needs its path.');
    }
    const targets = paths.map((value) => {
      const relative = safeRelativePath(value);
      if (!pattern.test(relative)) throw new JobError(`${relative} is not a ${label}.`);
      return relative;
    });
    for (const [index, upload] of uploads.entries()) {
      const target = path.join(folder, filesFolder, ...targets[index].split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      // rename fails across drives (temp on C:, datasets on D:); copy then.
      await fs.rename(upload.path, target).catch(async () => {
        await fs.copyFile(upload.path, target);
      });
    }
    return { saved: targets.length };
  } finally {
    await Promise.all(uploads.map((upload) => fs.rm(upload.path, { force: true })));
  }
};

/** Remove files the page no longer has, so the server copy mirrors its folder. */
const prune = async (folder, kind, keep) => {
  const filesFolder = path.join(folder, DATASET_KINDS[kind].folder);
  const wanted = new Set(keep);
  const present = await walk(filesFolder);
  await Promise.all(present
    .filter((file) => !wanted.has(file.path))
    .map((file) => fs.rm(path.join(filesFolder, ...file.path.split('/')), { force: true })));
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
export const saveYoloLabels = async (ownerId, id, { classes, task, labels, keep }) => {
  const { folder, meta } = await locate(ownerId, 'yolo', id);
  const names = (Array.isArray(classes) ? classes : []).map((name) => String(name).trim()).filter(Boolean);
  if (!names.length) throw new JobError('The dataset needs at least one class.');
  if (!['detect', 'segment'].includes(task)) throw new JobError('The task must be detect or segment.');
  if (!labels || typeof labels !== 'object') throw new JobError('Labels are missing.');

  if (Array.isArray(keep)) await prune(folder, 'yolo', keep.map(safeRelativePath));

  const labelsFolder = path.join(folder, 'labels');
  await fs.rm(labelsFolder, { recursive: true, force: true });
  let labelled = 0;
  for (const [image, text] of Object.entries(labels)) {
    const relative = safeRelativePath(image);
    if (!(await exists(path.join(folder, 'images', ...relative.split('/'))))) continue;
    const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    // Each line: a class id in range, then only numbers between 0 and 1.
    const valid = lines.every((line) => {
      const [classId, ...values] = line.split(/\s+/);
      return /^\d+$/.test(classId) && Number(classId) < names.length && values.length >= 4
        && values.every((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1);
    });
    if (!valid) throw new JobError(`The labels for ${relative} are not valid YOLO lines.`);
    const target = path.join(labelsFolder, ...`${relative.replace(/\.[^./]+$/, '')}.txt`.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
    labelled += 1;
  }

  const updated = {
    ...meta, classes: names, task, labelled, ...(await summarise(folder, 'yolo')), complete: true,
    updatedAt: new Date().toISOString(),
  };
  await writeMeta(folder, updated);
  return publicMeta(updated);
};

/** Finish a speech upload: the language and one transcript per clip. */
export const saveTranscripts = async (ownerId, id, { language, transcripts, keep }) => {
  const { folder, meta } = await locate(ownerId, 'speech', id);
  const code = String(language || '').trim();
  if (!/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(code)) throw new JobError('Pick the language spoken in the clips.');
  if (!transcripts || typeof transcripts !== 'object') throw new JobError('Transcripts are missing.');

  if (Array.isArray(keep)) await prune(folder, 'speech', keep.map(safeRelativePath));

  const lines = [];
  for (const [clip, text] of Object.entries(transcripts)) {
    const relative = safeRelativePath(clip);
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    if (!cleaned || !(await exists(path.join(folder, 'audio', ...relative.split('/'))))) continue;
    lines.push(JSON.stringify({ audio: `audio/${relative}`, text: cleaned }));
  }
  await fs.writeFile(path.join(folder, 'metadata.jsonl'), lines.length ? `${lines.join('\n')}\n` : '', 'utf8');

  const updated = {
    ...meta, language: code, transcribed: lines.length, ...(await summarise(folder, 'speech')), complete: true,
    updatedAt: new Date().toISOString(),
  };
  await writeMeta(folder, updated);
  return publicMeta(updated);
};

export const deleteDataset = async (ownerId, kind, id) => {
  const { folder } = await locate(ownerId, kind, id);
  await fs.rm(folder, { recursive: true, force: true });
};

/** A file from the dataset to test an ONNX export on, if there is one. */
export const sampleFile = async (folder, kind) => {
  if (kind === 'speech') {
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
