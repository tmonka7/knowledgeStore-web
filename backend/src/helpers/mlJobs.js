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
  JobError, MODELS_DIR, PYTHON_DIR, clampNumber, findModel, pythonEnv, startJob,
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

/** An ONNX export job for any model of `task`; tested on a dataset file when one is known. */
const startExportJob = async ({ ownerId, task, modelId, script, extraArgs = [] }) => {
  const model = await findModel(ownerId, modelId, task);
  const onnxRoot = path.join(MODELS_DIR, 'onnx');
  const output = path.join(onnxRoot, `${model.id}.partial`);
  await fs.mkdir(onnxRoot, { recursive: true });

  let sample = null;
  if (model.datasetId) {
    try {
      sample = await sampleFile(await datasetFolder(ownerId, task === 'detection' ? 'yolo' : 'speech', model.datasetId),
        task === 'detection' ? 'yolo' : 'speech');
    } catch {
      sample = null; // The dataset was deleted since; export untested.
    }
  }

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

export const transcribe = async ({ ownerId, modelId, uploads, language }) => {
  const model = await findModel(ownerId, modelId, 'speech');
  const code = String(language || model.language || '').trim();
  if (code && !/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(code)) throw new JobError('That is not a language code.');
  return withTempFiles(uploads, () => '.wav', (paths) => (
    runScript(['speech_transcribe.py', '--model', model.folder, ...(code ? ['--language', code] : []), '--audio', ...paths])
  ));
};
