// Training, testing and ONNX export for the YOLO and Speech to Text tools.
//
// Built on the job runner and model store in translationJobs.js: the same
// one-heavy-job-at-a-time limit, progress events, ".partial" output renamed
// into place only on success, and one-use ONNX download links. Models are
// scoped by task — "detection" for YOLO, "speech" for Whisper — so each page
// sees only its own.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runProcess } from './pythonRunner.js';
import {
  JobError, MODELS_DIR, PYTHON_DIR, clampNumber, deleteModel, deviceArgs, findModel, listModels, pythonEnv, startJob,
} from './translationJobs.js';
import { datasetFolder, getDataset, sampleFile } from './mlDatasets.js';

const META_FILE = 'ks-model.json';
const TEST_TIMEOUT_MS = 5 * 60 * 1000;

const writeMeta = (folder, meta) => fs.writeFile(path.join(folder, META_FILE), JSON.stringify(meta, null, 2), 'utf8');

/** The "done" event of a one-shot script, or a JobError explaining why not. */
const runScript = async (args, input) => {
  const result = await runProcess(args, { cwd: PYTHON_DIR, env: pythonEnv(), timeoutMs: TEST_TIMEOUT_MS, input });
  if (result.spawnError) throw new JobError(result.spawnError, 503);
  const events = result.stdout.text.split(/\r?\n/).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const done = events.find((event) => event.event === 'done');
  if (done) return done;
  const failure = events.find((event) => event.event === 'error');
  const tail = result.stderr.text.trim().split(/\r?\n/).slice(-3).join('\n');
  throw new JobError(failure?.message || (result.timedOut ? 'That took too long.' : tail || 'The script failed.'), 500);
};

/**
 * A training job whose output folder is renamed into place, with `meta`
 * written beside the weights, only once the script succeeds.
 */
const startTrainingJob = async ({ ownerId, task, kind, title, script, args, details, meta }) => {
  const id = randomUUID();
  const root = path.join(MODELS_DIR, 'finetuned');
  const output = path.join(root, `${id}.partial`);
  await fs.mkdir(root, { recursive: true });

  return startJob({
    ownerId,
    task,
    kind,
    title,
    modelId: id,
    details,
    args: [script, ...args, '--output', output],
    finish: async (job) => {
      await writeMeta(output, {
        id,
        kind: 'finetuned',
        task,
        ownerId,
        name: title,
        ...meta,
        ...(job.result?.final ? { final: job.result.final } : {}),
        history: job.result?.history || [],
        result: job.result,
        createdAt: new Date().toISOString(),
      });
      await fs.rename(output, path.join(root, id));
    },
    cleanup: () => fs.rm(output, { recursive: true, force: true }),
  });
};

/** A file from the model's own dataset to test an export on, or null. */
const sampleFor = async (ownerId, task, model) => {
  if (!model.datasetId) return null;
  const area = task === 'detection' ? 'yolo' : 'speech';
  try {
    return await sampleFile(await datasetFolder(ownerId, area, model.datasetId), area);
  } catch {
    return null; // The dataset was deleted since; export untested.
  }
};

/** An ONNX export job for any model of `task`; tested on a dataset file when one is known. */
const startExportJob = async ({ ownerId, task, modelId, script, extraArgs = [] }) => {
  const model = await findModel(ownerId, modelId, task);
  const onnxRoot = path.join(MODELS_DIR, 'onnx');
  const output = path.join(onnxRoot, `${model.id}.partial`);
  await fs.mkdir(onnxRoot, { recursive: true });
  const sample = await sampleFor(ownerId, task, model);

  return startJob({
    ownerId,
    task,
    kind: 'onnx',
    title: `ONNX: ${model.name || model.id}`,
    modelId: model.id,
    details: {},
    args: [script, '--model', model.folder, '--output', output, ...extraArgs, ...(sample ? ['--sample', sample] : [])],
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

/** Run `work(paths)` on uploaded files moved to a temp folder, then remove them. */
const withTempFiles = async (uploads, extensionOf, work) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ks-test-'));
  try {
    const paths = [];
    for (const [index, upload] of uploads.entries()) {
      const target = path.join(folder, `${index}${extensionOf(upload)}`);
      await fs.rename(upload.path, target).catch(() => fs.copyFile(upload.path, target));
      paths.push(target);
    }
    return await work(paths);
  } finally {
    await Promise.all(uploads.map((upload) => fs.rm(upload.path, { force: true })));
    await fs.rm(folder, { recursive: true, force: true });
  }
};

/* ------------------------------------------------------------------- YOLO */

export const startYoloTraining = async ({ ownerId, datasetId, baseModelId, name, options = {} }) => {
  const dataset = await getDataset(ownerId, 'yolo', datasetId);
  if (!dataset.complete) throw new JobError('This dataset has not finished uploading. Save it to the server again.');
  if ((dataset.labelled || 0) < 2) throw new JobError(`The dataset has ${dataset.labelled || 0} labelled images; at least 2 are needed.`);
  const base = await findModel(ownerId, baseModelId, 'detection');
  const baseTask = base.yoloTask || base.result?.task || 'detect';
  if (baseTask !== dataset.task) {
    throw new JobError(`${base.name} is a ${baseTask} model, but this is a ${dataset.task} dataset.`);
  }

  const epochs = Math.round(clampNumber(options.epochs, 50, 1, 1000));
  const imgsz = Math.round(clampNumber(options.imgsz, 640, 160, 1920) / 32) * 32;
  const batchSize = Math.round(clampNumber(options.batchSize, 8, 1, 128));
  const title = String(name || '').trim().slice(0, 120) || `${dataset.name} (${dataset.task})`;

  return startTrainingJob({
    ownerId,
    task: 'detection',
    kind: 'train',
    title,
    script: 'yolo_train.py',
    args: [
      '--data', await datasetFolder(ownerId, 'yolo', datasetId),
      '--base-model', base.folder,
      '--epochs', String(epochs),
      '--imgsz', String(imgsz),
      '--batch-size', String(batchSize),
      ...deviceArgs(options.device),
    ],
    details: { datasetName: dataset.name, baseModel: base.name, epochs, imgsz, batchSize },
    meta: {
      yoloTask: dataset.task,
      classes: dataset.classes,
      imgsz,
      baseModel: base.id,
      baseName: base.name,
      datasetId: dataset.id,
      datasetName: dataset.name,
      options: { epochs, imgsz, batchSize },
    },
  });
};

export const startYoloExport = ({ ownerId, modelId }) => startExportJob({
  ownerId, task: 'detection', modelId, script: 'yolo_export.py',
});

export const yoloPredict = async ({ ownerId, modelId, uploads, confidence }) => {
  const model = await findModel(ownerId, modelId, 'detection');
  const conf = clampNumber(confidence, 0.25, 0.01, 0.99);
  return withTempFiles(uploads, (upload) => path.extname(upload.originalname || '').slice(0, 8) || '.jpg', (paths) => (
    runScript(['yolo_predict.py', '--model', model.folder, '--conf', String(conf),
      ...(model.imgsz ? ['--imgsz', String(model.imgsz)] : []), '--images', ...paths])
  ));
};

/* ----------------------------------------------------------------- speech */

export const startSpeechTraining = async ({ ownerId, datasetId, baseModelId, name, options = {} }) => {
  const dataset = await getDataset(ownerId, 'speech', datasetId);
  if (!dataset.complete) throw new JobError('This dataset has not finished uploading. Save it to the server again.');
  if ((dataset.transcribed || 0) < 2) {
    throw new JobError(`The dataset has ${dataset.transcribed || 0} transcribed clips; at least 2 are needed.`);
  }
  const base = await findModel(ownerId, baseModelId, 'speech');

  const epochs = Math.round(clampNumber(options.epochs, 5, 1, 100));
  const batchSize = Math.round(clampNumber(options.batchSize, 8, 1, 64));
  const learningRate = clampNumber(options.learningRate, 1e-5, 1e-7, 1e-3);
  const title = String(name || '').trim().slice(0, 120) || `${dataset.name} (${dataset.language})`;

  return startTrainingJob({
    ownerId,
    task: 'speech',
    kind: 'train',
    title,
    script: 'speech_train.py',
    args: [
      '--data', await datasetFolder(ownerId, 'speech', datasetId),
      '--language', dataset.language,
      '--base-model', base.folder,
      '--epochs', String(epochs),
      '--batch-size', String(batchSize),
      '--learning-rate', String(learningRate),
      ...deviceArgs(options.device),
    ],
    details: { datasetName: dataset.name, baseModel: base.name, language: dataset.language, epochs, batchSize, learningRate },
    meta: {
      language: dataset.language,
      baseModel: base.id,
      baseName: base.name,
      datasetId: dataset.id,
      datasetName: dataset.name,
      options: { epochs, batchSize, learningRate },
    },
  });
};

export const startSpeechExport = ({ ownerId, modelId }) => startExportJob({
  ownerId, task: 'speech', modelId, script: 'speech_export.py',
});

/*
 * whisper.cpp copies of Whisper models, for Voice recognition. A converted
 * model is a model of its own (task "recognition", owned by whoever converted
 * it, so it is listed in their Voice recognition tab) that remembers its
 * source in `ggmlOf`. One per source model and owner: converting again
 * replaces it.
 */
const GGML_FILE = 'ggml-model.bin';

const ggmlIdFor = (model, ownerId) => (model.kind === 'finetuned' ? `${model.id}.ggml` : `${model.id}.ggml-${ownerId}`);

/** { [source model id]: { id, bytes } } for the caller's converted models. */
export const ggmlCopies = async (ownerId) => {
  const copies = {};
  for (const model of await listModels(ownerId, 'recognition')) {
    if (model.ggmlOf) copies[model.ggmlOf] = { id: model.id, bytes: model.files?.[model.file] || 0 };
  }
  return copies;
};

/** Half precision only: whisper.cpp aborts on f32 convolution kernels (see speech_ggml.py). */
export const startSpeechGgml = async ({ ownerId, modelId }) => {
  const model = await findModel(ownerId, modelId, 'speech');
  const id = ggmlIdFor(model, ownerId);
  const root = path.join(MODELS_DIR, 'finetuned');
  const partial = path.join(root, `${id}.partial`);
  await fs.rm(partial, { recursive: true, force: true });
  await fs.mkdir(partial, { recursive: true });
  const sample = await sampleFor(ownerId, 'speech', model);

  return startJob({
    ownerId,
    task: 'speech',
    kind: 'ggml',
    title: `GGML: ${model.name || model.id}`,
    modelId: model.id,
    details: {},
    args: ['speech_ggml.py', '--model', model.folder, '--output', path.join(partial, GGML_FILE),
      ...(sample ? ['--sample', sample] : [])],
    finish: async (job) => {
      const bytes = (await fs.stat(path.join(partial, GGML_FILE))).size;
      await fs.writeFile(path.join(partial, 'ks-model.json'), JSON.stringify({
        id,
        kind: 'finetuned',
        ownerId,
        task: 'recognition',
        engine: 'whisper.cpp',
        name: `${model.name || model.id} (ggml)`,
        file: GGML_FILE,
        englishOnly: Boolean(job.result?.englishOnly),
        language: model.language || null,
        ggmlOf: model.id,
        precision: 'f16',
        files: { [GGML_FILE]: bytes },
        complete: true,
        createdAt: new Date().toISOString(),
      }, null, 2));
      const folder = path.join(root, id);
      await fs.rm(folder, { recursive: true, force: true });
      await fs.rename(partial, folder);
    },
    cleanup: async () => {
      await fs.rm(partial, { recursive: true, force: true });
    },
  });
};

/** The caller's ggml copy of a speech model, or a 404. */
const ggmlCopyOf = async (ownerId, modelId) => {
  const source = await findModel(ownerId, modelId, 'speech');
  try {
    return { source, copy: await findModel(ownerId, ggmlIdFor(source, ownerId), 'recognition') };
  } catch {
    throw new JobError('This model has not been converted to ggml yet.', 404);
  }
};

export const deleteSpeechGgml = async (ownerId, modelId) => {
  const { copy } = await ggmlCopyOf(ownerId, modelId);
  await deleteModel(ownerId, copy.id, 'recognition');
};

/** A deleted speech model takes its ggml copy with it. */
export const deleteSpeechModel = async (ownerId, modelId) => {
  const copy = await ggmlCopyOf(ownerId, modelId).then(({ copy: found }) => found, () => null);
  await deleteModel(ownerId, modelId, 'speech');
  if (copy) await deleteModel(ownerId, copy.id, 'recognition').catch(() => {});
};

// One-use links, as for the ONNX zips: the browser downloads the file natively.
const GGML_TICKET_MS = 60 * 1000;
const ggmlTickets = new Map();

export const createGgmlTicket = async (ownerId, modelId) => {
  const { source, copy } = await ggmlCopyOf(ownerId, modelId);
  const ticket = randomUUID();
  const slug = String(source.name || source.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'model';
  ggmlTickets.set(ticket, {
    path: path.join(copy.folder, copy.file || GGML_FILE),
    name: `ggml-${slug}.bin`,
    expires: Date.now() + GGML_TICKET_MS,
  });
  setTimeout(() => ggmlTickets.delete(ticket), GGML_TICKET_MS).unref?.();
  return ticket;
};

export const redeemGgmlTicket = (ticket) => {
  const entry = ggmlTickets.get(String(ticket || ''));
  ggmlTickets.delete(String(ticket || ''));
  if (!entry || entry.expires < Date.now()) throw new JobError('This download link has expired. Start the download again.', 410);
  return entry;
};

export const transcribe = async ({ ownerId, modelId, uploads, language }) => {
  const model = await findModel(ownerId, modelId, 'speech');
  const code = String(language || model.language || '').trim();
  if (code && !/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(code)) throw new JobError('That is not a language code.');
  return withTempFiles(uploads, () => '.wav', (paths) => (
    runScript(['speech_transcribe.py', '--model', model.folder, ...(code ? ['--language', code] : []), '--audio', ...paths])
  ));
};
