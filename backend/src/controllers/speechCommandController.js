// Speech to Command: the API under /tools/command, shaped like the Speech to
// Text area (/models, /datasets, /train, /jobs, /devices) so the page shares
// its components. Command sets are the datasets.

import fs from 'node:fs/promises';
import {
  addCommandClip, commandClipPath, commandSetSummary, createCommandSet, deleteCommandClip, deleteDataset,
  getCommandSet, listDatasets, saveCommandSet, withCommandSetLock,
} from '../helpers/mlDatasets.js';
import {
  TASK, commandEngine, commandModels, deleteCommandModel, recognizeCommand, startCommandTraining,
} from '../helpers/speechCommand.js';
import {
  JobError, cancelJob, createDownloadTicket, getJob, listJobs, probeDevices,
} from '../helpers/translationJobs.js';
import { startTfliteExport } from '../helpers/mlJobs.js';

/** GET /tools/command/status — starts the recogniser if needed: { ready, device } or { ready: false, message }. */
export const status = async (req, res) => res.json(await commandEngine());

export const listModels = async (req, res) => res.json({ models: await commandModels(req.user.sub) });

export const removeModel = async (req, res) => {
  await deleteCommandModel(req.user.sub, req.params.id);
  res.json({ ok: true });
};

/** POST /tools/command/recognize — multipart "audio" (a WAV), modelId, and datasetId for a base model; threshold optional. */
export const recognize = async (req, res) => {
  if (!req.file) throw new JobError('No audio was sent.');
  try {
    res.json(await recognizeCommand({
      ownerId: req.user.sub,
      modelId: String(req.body?.modelId || ''),
      datasetId: String(req.body?.datasetId || ''),
      threshold: req.body?.threshold,
      audioPath: req.file.path,
    }));
  } finally {
    await fs.rm(req.file.path, { force: true });
  }
};

/* ---------------------------------------------------------- command sets */

export const listSets = async (req, res) => res.json({
  datasets: (await listDatasets(req.user.sub, 'command')).map(commandSetSummary),
});

/** POST /tools/command/datasets — { name, language, commands: [{ id, name, phrases }] }. */
export const createSet = async (req, res) => res.status(201).json({ dataset: await createCommandSet(req.user.sub, req.body || {}) });

export const getSet = async (req, res) => res.json({ dataset: await getCommandSet(req.user.sub, req.params.id) });

/** PUT /tools/command/datasets/:id — any of { name, language, commands }. Recordings of removed commands go. */
export const updateSet = async (req, res) => {
  const { name, language, commands } = req.body || {};
  await withCommandSetLock(req.params.id, () => saveCommandSet(req.user.sub, req.params.id, { name, language, commands }));
  res.json({ dataset: await getCommandSet(req.user.sub, req.params.id) });
};

export const deleteSet = async (req, res) => {
  await withCommandSetLock(req.params.id, () => deleteDataset(req.user.sub, 'command', req.params.id));
  res.json({ ok: true });
};

/** POST /tools/command/datasets/:id/clips — multipart "audio" (a WAV), command, text (the phrase said). */
export const addClip = async (req, res) => res.status(201).json({
  dataset: await withCommandSetLock(req.params.id, () => addCommandClip(
    req.user.sub, req.params.id, { command: String(req.body?.command || ''), text: req.body?.text }, req.file,
  )),
});

export const removeClip = async (req, res) => res.json({
  dataset: await withCommandSetLock(req.params.id, () => deleteCommandClip(req.user.sub, req.params.id, req.params.clip)),
});

export const getClip = async (req, res) => {
  res.type('audio/wav');
  res.sendFile(await commandClipPath(req.user.sub, req.params.id, req.params.clip));
};

/* ---------------------------------------------------------------- training */

/** POST /tools/command/train — { datasetId, baseModelId, name, options: { epochs, batchSize, learningRate, threshold, device } }. */
export const train = async (req, res) => {
  const job = await startCommandTraining({
    ownerId: req.user.sub,
    datasetId: String(req.body?.datasetId || ''),
    baseModelId: String(req.body?.baseModelId || ''),
    name: req.body?.name,
    options: req.body?.options || {},
  });
  res.status(202).json({ job });
};

/** POST /tools/command/models/:id/tflite — a TFLite export job (Moonshine's encoder and decoder). */
export const exportTflite = async (req, res) => res.status(202).json({
  job: await startTfliteExport({ ownerId: req.user.sub, task: TASK, modelId: req.params.id, kind: 'moonshine' }),
});

/** POST /tools/command/models/:id/tflite/link — a one-use, one-minute URL for the zip. */
export const tfliteLink = async (req, res) => {
  const ticket = await createDownloadTicket(req.user.sub, req.params.id, TASK, 'tflite');
  res.json({ path: `/tools/transformers/onnx-download/${ticket}` });
};

export const devices = async (req, res) => res.json(await probeDevices({ refresh: req.query.refresh === '1' }));
export const jobs = (req, res) => res.json({ jobs: listJobs(req.user.sub, TASK) });
export const job = (req, res) => res.json({ job: getJob(req.user.sub, req.params.id, TASK) });
export const cancel = (req, res) => res.json({ job: cancelJob(req.user.sub, req.params.id, TASK) });
