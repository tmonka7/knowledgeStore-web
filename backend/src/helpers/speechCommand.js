// Speech to Command (Tools > AI > Speech to Command), with Moonshine.
//
// A command set (a dataset of kind "command", mlDatasets.js) lists commands and
// the phrases that say them, with recordings of people saying them. Speech is
// transcribed by Moonshine in command_worker.py, which stays loaded, and the
// transcript is matched to the closest phrase (command_common.match). A
// Moonshine model can be fine-tuned on a set's recordings (command_train.py);
// the trained model keeps a copy of its commands, so it recognises them
// without being told which set to use.
//
// Models are task "command": the base ones come from download_models.py
// (moonshine-tiny, moonshine-base, and the -ko/-ja/… ones for other languages).

import fs from 'node:fs/promises';
import path from 'node:path';
import { datasetFolder, getCommandSet } from './mlDatasets.js';
import { startTrainingJob } from './mlJobs.js';
import { createPythonWorker } from './pythonWorker.js';
import {
  JobError, clampNumber, deleteModel, deviceArgs, findModel, listModels,
} from './translationJobs.js';

export const TASK = 'command';
export const DEFAULT_THRESHOLD = 0.7;

const worker = createPythonWorker({
  script: 'command_worker.py',
  label: 'Speech to Command',
  env: { COMMAND_DEVICE: process.env.COMMAND_DEVICE || '' },
  idleMs: Math.max(60, Number(process.env.COMMAND_IDLE_SECONDS) || 600) * 1000,
  maxWaiting: Math.max(1, Number(process.env.COMMAND_MAX_QUEUE) || 16),
});

const primary = (code) => String(code || '').toLowerCase().split(/[-_]/)[0];
// Base models are named after their repository (moonshine-ai/moonshine-tiny); the page shows the model's own name.
const displayName = (model) => String(model.name || model.id).replace(/^moonshine-ai\//, '');

/** A trained model's own commands (commands.json), or null for a base model. */
const ownCommands = async (model) => {
  if (!model?.folder) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(model.folder, 'commands.json'), 'utf8'));
  } catch {
    return null;
  }
};

/**
 * The caller's command models: fine-tuned ones first, then the base Moonshine
 * models. A fine-tuned one carries the commands it was trained on.
 */
export const commandModels = async (ownerId) => {
  const models = await listModels(ownerId, TASK);
  const withCommands = await Promise.all(models.map(async (model) => {
    if (model.kind !== 'finetuned') return { model, commands: null };
    const own = await ownCommands(await findModel(ownerId, model.id, TASK).catch(() => ({ folder: '' })));
    return { model, commands: own?.commands || null };
  }));
  return withCommands
    .map(({ model, commands }) => ({
      commands,
      id: model.id,
      kind: model.kind,
      name: model.kind === 'base' ? displayName(model) : model.name,
      language: model.language || 'en',
      licence: model.licence || '',
      baseModel: model.baseModel,
      baseName: model.baseName,
      datasetId: model.datasetId,
      datasetName: model.datasetName,
      commandCount: model.commandCount,
      result: model.result,
      history: model.history || [],
      tfliteBytes: model.tfliteBytes || 0,
      ortBytes: model.ortBytes || 0,
      createdAt: model.createdAt,
    }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'finetuned' ? -1 : 1));
};

/**
 * Recognise the command in one WAV file. The commands are the chosen set's
 * (`datasetId`), else the trained model's own; a base model needs a set.
 */
export const recognizeCommand = async ({ ownerId, modelId, datasetId, audioPath, threshold }) => {
  const model = await findModel(ownerId, modelId, TASK);
  let commands;
  let language = model.language || 'en';
  let setName = '';
  let chosenThreshold = DEFAULT_THRESHOLD;
  if (datasetId) {
    const set = await getCommandSet(ownerId, datasetId);
    commands = set.commands;
    language = set.language || language;
    setName = set.name;
  } else {
    const own = await ownCommands(model);
    if (!own) throw new JobError('Choose a command set: this model has not been trained on one.');
    commands = own.commands;
    language = own.language || language;
    chosenThreshold = own.threshold || DEFAULT_THRESHOLD;
    setName = model.datasetName || '';
  }
  if (!commands?.length) throw new JobError('The command set has no commands yet.');
  if (threshold !== undefined && threshold !== '') chosenThreshold = clampNumber(threshold, DEFAULT_THRESHOLD, 0.3, 0.99);

  const result = await worker.request({
    model: model.folder, audio: audioPath, commands, threshold: chosenThreshold, language,
  }, 60 * 1000, 'Speech to Command is busy; try again in a moment.');
  const { id: _id, ok: _ok, ...answer } = result;
  return { ...answer, threshold: chosenThreshold, setName, modelName: model.name };
};

export const startCommandTraining = async ({ ownerId, datasetId, baseModelId, name, options = {} }) => {
  const set = await getCommandSet(ownerId, datasetId);
  if (!set.commands.length) throw new JobError('The command set has no commands.');
  if (set.clips.length < 2) throw new JobError(`The command set has ${set.clips.length} recordings; at least 2 are needed.`);
  const base = await findModel(ownerId, baseModelId, TASK);
  const baseLanguage = base.language || 'en';
  if (primary(baseLanguage) !== primary(set.language)) {
    const wanted = primary(set.language) === 'en' ? 'moonshine-tiny' : `moonshine-tiny-${primary(set.language)}`;
    throw new JobError(`${displayName(base)} understands "${baseLanguage}", but this command set is in "${set.language}". `
      + `Start from a Moonshine model for that language (download_models.py ${wanted}).`);
  }

  const epochs = Math.round(clampNumber(options.epochs, 10, 1, 200));
  const batchSize = Math.round(clampNumber(options.batchSize, 8, 1, 64));
  const learningRate = clampNumber(options.learningRate, 5e-5, 1e-7, 1e-3);
  const threshold = clampNumber(options.threshold, DEFAULT_THRESHOLD, 0.3, 0.99);
  const title = String(name || '').trim().slice(0, 120) || `${set.name} (${set.language})`;

  return startTrainingJob({
    ownerId,
    task: TASK,
    kind: 'train',
    title,
    script: 'command_train.py',
    args: [
      '--data', await datasetFolder(ownerId, 'command', datasetId),
      '--base-model', base.folder,
      '--language', set.language,
      '--epochs', String(epochs),
      '--batch-size', String(batchSize),
      '--learning-rate', String(learningRate),
      '--threshold', String(threshold),
      ...deviceArgs(options.device),
    ],
    details: { datasetName: set.name, baseModel: base.name, language: set.language, epochs, batchSize, learningRate },
    meta: {
      language: set.language,
      baseModel: base.id,
      baseName: displayName(base),
      datasetId: set.id,
      datasetName: set.name,
      commandCount: set.commands.length,
      options: { epochs, batchSize, learningRate, threshold },
    },
  });
};

export const deleteCommandModel = (ownerId, modelId) => deleteModel(ownerId, modelId, TASK);

/**
 * Start the worker, if it is not running, and say whether it can run. The
 * page calls this when Recognize opens: the worker takes several seconds to
 * start (importing transformers), which would otherwise be spent on the
 * first command said.
 */
export const commandEngine = async () => {
  try {
    const info = await worker.ready();
    return { ready: true, device: info.device || 'cpu' };
  } catch (error) {
    return { ready: false, message: error.message };
  }
};
