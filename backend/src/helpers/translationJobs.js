// Offline translation models and the long-running jobs that make them, for
// Tools > AI > Transformers.
//
// The Python in backend/python does the work; this module starts it, reads
// its JSON-lines progress, and keeps the state the page polls. The folder on
// disk is the source of truth for models:
//
//   models/base/<name>/        downloaded by download_models.py (read-only here)
//   models/finetuned/<uuid>/   written by train.py, owned by one account
//   models/onnx/<model id>/    written by export_onnx.py, plus <model id>.zip
//
// Each model folder carries a ks-model.json describing it. Jobs themselves
// live in memory: a restart forgets them, but not the models they produced —
// output is written to a ".partial" folder and only renamed into place once
// the job succeeds, so an interrupted run never shows up as a model.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON_BIN, childEnv, runProcess } from './pythonRunner.js';

export const PYTHON_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../python');
export const MODELS_DIR = path.resolve(process.env.TRANSLATION_MODELS_DIR || path.join(PYTHON_DIR, 'models'));
const META_FILE = 'ks-model.json';

// Training takes the whole CPU (or GPU); two at once only makes both slower.
const MAX_JOBS = Math.max(1, Number(process.env.TRANSLATION_MAX_JOBS) || 1);
const JOB_TIMEOUT_MS = Math.max(60000, Number(process.env.TRANSLATION_JOB_TIMEOUT_MS) || 12 * 60 * 60 * 1000);
const TRANSLATE_TIMEOUT_MS = 5 * 60 * 1000;
const LOG_LINES = 200;
const KEEP_FINISHED_JOBS = 20;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class JobError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const pythonEnv = () => childEnv({
  TRANSLATION_MODELS_DIR: MODELS_DIR,
  HF_HUB_OFFLINE: '1',
  TRANSFORMERS_OFFLINE: '1',
});

/* ------------------------------------------------------------------ models */

export const readMeta = async (folder) => {
  try {
    return JSON.parse(await fs.readFile(path.join(folder, META_FILE), 'utf8'));
  } catch {
    return null;
  }
};

export const exists = (target) => fs.access(target).then(() => true, () => false);

/*
 * One models folder serves three tools. ks-model.json says which a model
 * belongs to: "translation" (the default, as models downloaded before the
 * field existed are all translation models), "detection" for YOLO, and
 * "speech" for Whisper. Every lookup is scoped to one task, so the YOLO page
 * can never list, train on or delete a translation model, and so on.
 */
const taskOf = (meta) => meta.task || 'translation';

const listKind = async (kind) => {
  const root = path.join(MODELS_DIR, kind);
  let names = [];
  try {
    names = await fs.readdir(root);
  } catch {
    return [];
  }
  const models = await Promise.all(names
    .filter((name) => SAFE_ID.test(name) && !name.endsWith('.partial') && !name.endsWith('.downloading'))
    .map(async (name) => {
      const meta = await readMeta(path.join(root, name));
      if (!meta || (kind === 'base' && !meta.complete)) return null;
      const onnxZip = path.join(MODELS_DIR, 'onnx', `${name}.zip`);
      const onnx = await exists(onnxZip) ? (await fs.stat(onnxZip)).size : 0;
      return { ...meta, id: name, kind, onnxBytes: onnx };
    }));
  return models.filter(Boolean);
};

/** Base models are shared; fine-tuned ones are listed to their owner only. */
export const listModels = async (ownerId, task = 'translation') => {
  const [base, finetuned] = await Promise.all([listKind('base'), listKind('finetuned')]);
  return [
    ...base.filter((model) => taskOf(model) === task),
    ...finetuned
      .filter((model) => model.ownerId === ownerId && taskOf(model) === task)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  ].map(({ ownerId: _owner, ...model }) => model);
};

/** Resolves a model id the caller may use for `task`, or throws. */
export const findModel = async (ownerId, id, task = 'translation') => {
  if (!SAFE_ID.test(String(id || ''))) throw new JobError('Unknown model.', 404);
  for (const kind of ['finetuned', 'base']) {
    const folder = path.join(MODELS_DIR, kind, id);
    const meta = await readMeta(folder);
    if (!meta) continue;
    if (kind === 'finetuned' && meta.ownerId !== ownerId) break;
    if (taskOf(meta) !== task) break;
    return { ...meta, id, kind, folder };
  }
  throw new JobError('Unknown model.', 404);
};

export const deleteModel = async (ownerId, id, task = 'translation') => {
  const model = await findModel(ownerId, id, task);
  if (model.kind !== 'finetuned') throw new JobError('Downloaded base models are removed on the server, not here.', 403);
  if ([...jobs.values()].some((job) => job.status === 'running' && job.modelId === id)) {
    throw new JobError('That model is being exported. Wait for it to finish.', 409);
  }
  await fs.rm(model.folder, { recursive: true, force: true });
  await fs.rm(path.join(MODELS_DIR, 'onnx', id), { recursive: true, force: true });
  await fs.rm(path.join(MODELS_DIR, 'onnx', `${id}.zip`), { force: true });
};

export const onnxArchive = async (ownerId, id, task = 'translation') => {
  const model = await findModel(ownerId, id, task);
  const archive = path.join(MODELS_DIR, 'onnx', `${model.id}.zip`);
  if (!await exists(archive)) throw new JobError('This model has not been exported to ONNX yet.', 404);
  return { model, stream: createReadStream(archive), size: (await fs.stat(archive)).size };
};

/*
 * ONNX zips run to a gigabyte or more. Fetched through the API client (for its
 * Authorization header) the browser would hold all of it in memory as a blob,
 * so instead the page asks for a one-use ticket and lets the browser download
 * the file natively from a URL carrying it.
 */
const DOWNLOAD_TICKET_MS = 60 * 1000;
const downloadTickets = new Map();

export const createDownloadTicket = async (ownerId, id, task = 'translation') => {
  await onnxArchive(ownerId, id, task).then(({ stream }) => stream.destroy());
  const ticket = randomUUID();
  downloadTickets.set(ticket, { ownerId, id, task, expires: Date.now() + DOWNLOAD_TICKET_MS });
  setTimeout(() => downloadTickets.delete(ticket), DOWNLOAD_TICKET_MS).unref?.();
  return ticket;
};

export const redeemDownloadTicket = async (ticket) => {
  const entry = downloadTickets.get(String(ticket || ''));
  downloadTickets.delete(String(ticket || ''));
  if (!entry || entry.expires < Date.now()) throw new JobError('This download link has expired. Start the download again.', 410);
  return onnxArchive(entry.ownerId, entry.id, entry.task);
};

/* -------------------------------------------------------------------- jobs */

const jobs = new Map();

const publicJob = (job) => {
  const { child, ownerId, timer, ...rest } = job;
  return rest;
};

/** The caller's jobs for one tool ("translation", "detection" or "speech"). */
export const listJobs = (ownerId, task = 'translation') => [...jobs.values()]
  .filter((job) => job.ownerId === ownerId && job.task === task)
  .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  .map(publicJob);

export const getJob = (ownerId, id, task = 'translation') => {
  const job = jobs.get(id);
  if (!job || job.ownerId !== ownerId || job.task !== task) throw new JobError('Unknown job.', 404);
  return publicJob(job);
};

const pruneJobs = () => {
  const finished = [...jobs.values()]
    .filter((job) => job.status !== 'running')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  while (finished.length > KEEP_FINISHED_JOBS) jobs.delete(finished.shift().id);
};

const pushLog = (job, line) => {
  if (!line.trim()) return;
  job.log.push(line.length > 2000 ? `${line.slice(0, 2000)}…` : line);
  if (job.log.length > LOG_LINES) job.log.splice(0, job.log.length - LOG_LINES);
};

/** Apply one {"event": ...} line from a script to the job's state. */
const applyEvent = (job, { event: type, ...event }) => {
  switch (type) {
    case 'status':
      job.message = event.message;
      Object.assign(job.details, event);
      break;
    case 'start':
      job.progress = { step: 0, totalSteps: event.totalSteps, epoch: 0, epochs: event.epochs };
      break;
    case 'progress':
      job.progress = { ...job.progress, ...event };
      job.message = `Epoch ${event.epoch}, step ${event.step} of ${event.totalSteps}`;
      break;
    case 'epoch':
      job.history.push(event);
      break;
    case 'samples':
      job.samples = event.samples;
      break;
    case 'done':
      job.result = event;
      break;
    case 'error':
      job.error = event.message;
      break;
    default:
      break;
  }
};

const lineReader = (stream, onLine) => {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (text) => {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    lines.forEach(onLine);
  });
  stream.on('end', () => { if (buffer) onLine(buffer); });
};

/**
 * Start a script as a job. `finish(job)` runs after a clean exit and may throw
 * to fail the job; `cleanup(job)` runs whatever the outcome.
 */
export const startJob = ({
  ownerId, task = 'translation', kind, title, args, modelId = null, details = {}, finish, cleanup,
}) => {
  const running = [...jobs.values()].filter((job) => job.status === 'running');
  if (running.some((job) => job.ownerId === ownerId)) {
    throw new JobError('You already have a training or export job running.', 429);
  }
  if (running.length >= MAX_JOBS) {
    throw new JobError('The server is busy with another training or export job. Try again when it finishes.', 429);
  }

  const job = {
    id: randomUUID(),
    ownerId,
    task,
    kind,
    title,
    modelId,
    status: 'running',
    message: 'Starting',
    details,
    progress: null,
    history: [],
    samples: [],
    result: null,
    error: '',
    log: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  pruneJobs();

  // 'error' and 'close' can both fire for one process; only the first counts.
  let settled = false;
  const settle = async (status, error = '') => {
    if (settled) return;
    settled = true;
    clearTimeout(job.timer);
    try {
      if (status === 'succeeded') await finish?.(job);
    } catch (failure) {
      status = 'failed';
      error = failure.message;
    }
    await cleanup?.(job).catch(() => {});
    job.status = status;
    job.error = job.error || error;
    job.finishedAt = new Date().toISOString();
    job.message = status === 'succeeded' ? 'Finished' : status === 'cancelled' ? 'Cancelled' : 'Failed';
  };

  let child;
  try {
    child = spawn(PYTHON_BIN, args, {
      cwd: PYTHON_DIR, env: pythonEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    settle('failed', error.message);
    return publicJob(job);
  }
  job.child = child;

  lineReader(child.stdout, (line) => {
    try {
      const event = JSON.parse(line);
      if (event && typeof event.event === 'string') {
        applyEvent(job, event);
        return;
      }
    } catch {
      /* Not an event: a plain print, kept in the log. */
    }
    pushLog(job, line);
  });
  lineReader(child.stderr, (line) => pushLog(job, line));

  job.timer = setTimeout(() => {
    job.error = `Stopped after ${Math.round(JOB_TIMEOUT_MS / 60000)} minutes (TRANSLATION_JOB_TIMEOUT_MS).`;
    child.kill('SIGKILL');
  }, JOB_TIMEOUT_MS);

  child.on('error', (error) => settle('failed', error.code === 'ENOENT'
    ? `"${PYTHON_BIN}" was not found on the server. Set PYTHON_BIN.`
    : error.message));
  child.on('close', (code) => {
    if (job.cancelled) settle('cancelled');
    else if (code === 0 && !job.error) settle('succeeded');
    else settle('failed', job.error || `The script exited with code ${code}. See the log.`);
  });

  return publicJob(job);
};

export const cancelJob = (ownerId, id, task = 'translation') => {
  const job = jobs.get(id);
  if (!job || job.ownerId !== ownerId || job.task !== task) throw new JobError('Unknown job.', 404);
  if (job.status === 'running') {
    job.cancelled = true;
    job.child?.kill('SIGKILL');
  }
  return publicJob(job);
};

/* --------------------------------------------------------------- training */

// Mirrors LANGUAGE_ALIASES in backend/python/ks_common.py.
const LANGUAGE_ALIASES = { jp: 'ja', jpn: 'ja', kor: 'ko', zho: 'zh', chi: 'zh', eng: 'en', spa: 'es' };

/** A dataset code ("ko", "zh-Hans", "jp") as a multilingual model names it ("ko"). */
const modelLanguage = (code) => {
  const primary = String(code).split(/[-_]/)[0].toLowerCase();
  return LANGUAGE_ALIASES[primary] || primary;
};

/** Whether `model` can translate source -> target at all. */
const supportsPair = (model, source, target) => {
  if (model.multilingual) {
    const languages = model.languages || [];
    // An empty list means the download could not read it; let Python decide.
    return !languages.length || [source, target].every((code) => languages.includes(modelLanguage(code)));
  }
  return true;
};

export const clampNumber = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export const startTraining = async ({ ownerId, dataset, source, target, baseModelId, name, options = {} }) => {
  const base = await findModel(ownerId, baseModelId);
  if (!supportsPair(base, source, target)) {
    throw new JobError(`${base.name || base.id} does not support ${source}→${target}.`);
  }
  const languages = dataset.languages || [];
  if (!languages.includes(source) || !languages.includes(target) || source === target) {
    throw new JobError('Pick two different languages from the dataset.');
  }
  const complete = dataset.rows.filter((row) => row.texts?.[source]?.trim() && row.texts?.[target]?.trim()).length;
  if (complete < 2) throw new JobError(`The dataset has ${complete} complete ${source}→${target} pairs; at least 2 are needed.`);

  const epochs = Math.round(clampNumber(options.epochs, 3, 1, 50));
  const batchSize = Math.round(clampNumber(options.batchSize, 8, 1, 128));
  const learningRate = clampNumber(options.learningRate, 5e-5, 1e-7, 1e-2);
  const maxLength = Math.round(clampNumber(options.maxLength, 128, 16, 512));

  const id = randomUUID();
  const finetunedRoot = path.join(MODELS_DIR, 'finetuned');
  const output = path.join(finetunedRoot, `${id}.partial`);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ks-train-'));
  const datasetPath = path.join(workDir, 'dataset.jsonl');
  await fs.mkdir(finetunedRoot, { recursive: true });
  await fs.writeFile(datasetPath, dataset.rows.map((row) => JSON.stringify({ translation: row.texts })).join('\n'), 'utf8');

  const modelName = String(name || '').trim().slice(0, 120) || `${dataset.name} ${source}→${target}`;

  return startJob({
    ownerId,
    kind: 'train',
    title: modelName,
    modelId: id,
    details: { datasetId: dataset.id, datasetName: dataset.name, source, target, baseModel: base.name || base.id, epochs, batchSize, learningRate },
    args: [
      'train.py',
      '--dataset', datasetPath,
      '--source', source,
      '--target', target,
      '--base-model', base.folder,
      '--output', output,
      '--epochs', String(epochs),
      '--batch-size', String(batchSize),
      '--learning-rate', String(learningRate),
      '--max-length', String(maxLength),
    ],
    finish: async (job) => {
      await fs.writeFile(path.join(output, META_FILE), JSON.stringify({
        id,
        kind: 'finetuned',
        name: modelName,
        ownerId,
        source,
        target,
        baseModel: base.id,
        baseName: base.name || base.id,
        // Still an M2M100 underneath: exports and tests need to know.
        multilingual: Boolean(base.multilingual),
        datasetId: dataset.id,
        datasetName: dataset.name,
        options: { epochs, batchSize, learningRate, maxLength },
        history: job.result?.history || [],
        trainPairs: job.result?.trainPairs,
        validationPairs: job.result?.validationPairs,
        seconds: job.result?.seconds,
        device: job.result?.device,
        createdAt: new Date().toISOString(),
      }, null, 2), 'utf8');
      await fs.rename(output, path.join(finetunedRoot, id));
    },
    // After a success `output` has already been renamed away, so this only
    // ever removes a failed or cancelled run's leftovers.
    cleanup: async () => {
      await fs.rm(workDir, { recursive: true, force: true });
      await fs.rm(output, { recursive: true, force: true });
    },
  });
};

/* ------------------------------------------------------------------- onnx */

export const startOnnxExport = async ({ ownerId, modelId }) => {
  const model = await findModel(ownerId, modelId);
  const onnxRoot = path.join(MODELS_DIR, 'onnx');
  const output = path.join(onnxRoot, `${model.id}.partial`);
  await fs.mkdir(onnxRoot, { recursive: true });

  return startJob({
    ownerId,
    kind: 'onnx',
    title: `ONNX: ${model.name || model.id}`,
    modelId: model.id,
    details: { source: model.source, target: model.target },
    args: ['export_onnx.py', '--model', model.folder, '--output', output],
    finish: async () => {
      const folder = path.join(onnxRoot, model.id);
      await fs.rm(folder, { recursive: true, force: true });
      await fs.rm(path.join(onnxRoot, `${model.id}.zip`), { force: true });
      await fs.rename(output, folder);
      await fs.rename(`${output}.zip`, path.join(onnxRoot, `${model.id}.zip`));
    },
    cleanup: async () => {
      await fs.rm(output, { recursive: true, force: true });
      await fs.rm(`${output}.zip`, { force: true });
    },
  });
};

/* -------------------------------------------------------------- translate */

export const translateTexts = async ({ ownerId, modelId, texts, source, target }) => {
  const model = await findModel(ownerId, modelId);
  // A multilingual base model is told the direction; every other model has
  // one of its own, recorded in its ks-model.json.
  const from = String(source || model.source || '');
  const to = String(target || model.target || '');
  if (model.multilingual && (!from || !to)) throw new JobError('Pick the languages to translate between.');
  if (!supportsPair(model, from, to)) throw new JobError(`${model.name || model.id} does not support ${from}→${to}.`);
  const languageArgs = from && to ? ['--source', from, '--target', to] : [];
  const result = await runProcess(['translate.py', '--model', model.folder, ...languageArgs], {
    cwd: PYTHON_DIR,
    env: pythonEnv(),
    timeoutMs: TRANSLATE_TIMEOUT_MS,
    input: JSON.stringify({ texts }),
  });
  if (result.spawnError) throw new JobError(result.spawnError, 503);

  const events = result.stdout.text.split(/\r?\n/).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const done = events.find((event) => event.event === 'done');
  if (done) return { translations: done.translations, seconds: done.seconds, device: done.device };

  const failure = events.find((event) => event.event === 'error');
  const tail = result.stderr.text.trim().split(/\r?\n/).slice(-3).join('\n');
  throw new JobError(failure?.message || (result.timedOut ? 'Translation took too long.' : tail || 'Translation failed.'), 500);
};
