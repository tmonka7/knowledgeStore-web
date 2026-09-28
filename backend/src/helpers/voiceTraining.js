// Training voices for Text to Speech (Supertonic), for Tools > AI > Text to Speech > Train voice.
//
// Supertonic's models cannot be fine-tuned (they are released as ONNX only),
// but a voice can be trained: tts_train_voice.py learns a voice style that
// sounds like the speaker of a voice dataset (recorded on the page's Datasets
// tab) or of a Speech to Text dataset. A trained voice is a
// model of its own, task "voice", owned by whoever trained it: a folder with
// voice.json (used like the model's own F1 … M5) and target.json (the
// recordings' voiceprint, which a test scores speech against).
//
// Jobs, devices and the model store are the ones YOLO and Speech to Text use.

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  datasetFolder, getDataset, listDatasets, voiceSummary,
} from './mlDatasets.js';
import { startTrainingJob } from './mlJobs.js';
import { baseSpeakerModel, baseVoiceprint } from './speakerRecognition.js';
import { TASK as SYNTHESIS, TTS_LANGUAGES } from './textToSpeech.js';
import {
  JobError, clampNumber, deleteModel, deviceArgs, findModel, listModels,
} from './translationJobs.js';

export const TASK = 'voice';

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

/** The caller's trained voices, newest first, with what the page shows of each. */
export const trainedVoices = async (ownerId) => (await listModels(ownerId, TASK)).map((model) => ({
  id: model.id,
  kind: model.kind,
  name: model.name,
  language: model.language,
  baseVoice: model.result?.baseVoice || model.baseVoice,
  synthesisModel: model.synthesisModel,
  datasetName: model.datasetName,
  similarityBefore: model.result?.similarityBefore ?? null,
  similarityAfter: model.result?.similarityAfter ?? null,
  consistency: model.result?.consistency ?? null,
  speechSeconds: model.result?.speechSeconds ?? null,
  history: model.history || [],
  createdAt: model.createdAt,
}));

/** A trained voice of the caller, with the path of its voice.json. */
export const findVoice = async (ownerId, voiceId) => {
  const model = await findModel(ownerId, voiceId, TASK);
  return { ...model, voiceFile: path.join(model.folder, 'voice.json') };
};

const supported = (dataset) => TTS_LANGUAGES.includes(String(dataset.language || '').toLowerCase().split(/[-_]/)[0]);

/**
 * Every dataset a voice can be trained on (all are shared): voice datasets
 * (source "voice"), then Speech to Text datasets (source "speech").
 */
export const trainingDatasets = async (ownerId) => [
  ...(await listDatasets(ownerId, 'voice')).map((dataset) => ({ ...voiceSummary(dataset), source: 'voice', supported: supported(dataset) })),
  ...(await listDatasets(ownerId, 'speech')).map((dataset) => ({ ...dataset, source: 'speech', supported: supported(dataset) })),
];

/** Which store a dataset id is in: a voice dataset, else a Speech to Text one. */
const findTrainingDataset = async (ownerId, datasetId) => {
  try {
    return { kind: 'voice', dataset: await getDataset(ownerId, 'voice', datasetId) };
  } catch {
    return { kind: 'speech', dataset: await getDataset(ownerId, 'speech', datasetId) };
  }
};

export const startVoiceTraining = async ({ ownerId, datasetId, baseModelId, name, options = {} }) => {
  const { kind, dataset } = await findTrainingDataset(ownerId, datasetId);
  if (!dataset.complete) throw new JobError('This dataset has not finished uploading. Save it to the server again.');
  if ((dataset.transcribed || 0) < 1) {
    throw new JobError(kind === 'voice' ? 'Record at least one line of the dataset first.' : 'The dataset has no transcribed clips.');
  }
  const language = String(dataset.language || '').toLowerCase().split(/[-_]/)[0];
  if (!TTS_LANGUAGES.includes(language)) {
    throw new JobError(`Supertonic cannot read "${dataset.language}", the language of this dataset.`);
  }
  const synthesis = (await listModels(ownerId, SYNTHESIS)).find((model) => model.kind === 'base');
  if (!synthesis) throw new JobError('Supertonic is not installed. Run: python backend/python/download_models.py supertonic-3', 503);
  const ecapa = await baseSpeakerModel();
  if (!ecapa) {
    throw new JobError('The speaker model is needed to compare voices. Run: python backend/python/download_models.py ecapa', 503);
  }
  const model = await findModel(ownerId, synthesis.id, SYNTHESIS);
  const ecapaModel = await findModel('', ecapa.id, 'speaker');

  const baseVoice = /^(auto|[A-Za-z0-9_-]{1,40})$/.test(String(baseModelId || 'auto')) ? String(baseModelId || 'auto') : 'auto';
  const steps = Math.round(clampNumber(options.steps, 300, 20, 5000));
  const learningRate = clampNumber(options.learningRate, 0.003, 1e-4, 0.05);
  const title = String(name || '').trim().slice(0, 120) || `${dataset.name} (${language})`;

  return startTrainingJob({
    ownerId,
    task: TASK,
    kind: 'train',
    title,
    script: 'tts_train_voice.py',
    args: [
      '--data', await datasetFolder(ownerId, kind, datasetId),
      '--language', language,
      '--model', model.folder,
      '--ecapa', ecapaModel.folder,
      '--base-voice', baseVoice,
      '--steps', String(steps),
      '--learning-rate', String(learningRate),
      ...deviceArgs(options.device),
    ],
    details: { datasetName: dataset.name, language, baseVoice, steps, learningRate },
    meta: {
      language,
      baseVoice,
      synthesisModel: model.id,
      datasetId: dataset.id,
      datasetName: dataset.name,
      datasetSource: kind,
      options: { steps, learningRate },
    },
  });
};

export const deleteVoice = async (ownerId, voiceId) => deleteModel(ownerId, voiceId, TASK);

/**
 * How much a clip sounds like the recordings a voice was trained on: the
 * cosine similarity of their voiceprints, 1 for the same voice. Recordings of
 * one person score about 0.6–0.9 against each other; different people, near 0.
 */
export const scoreAgainstVoice = async (ownerId, voiceId, audioPath) => {
  const voice = await findModel(ownerId, voiceId, TASK);
  const target = (await readJson(path.join(voice.folder, 'target.json'))).embedding;
  const { embedding, speechSeconds } = await baseVoiceprint(audioPath);
  const norm = (vector) => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  const dot = embedding.reduce((sum, value, index) => sum + value * target[index], 0);
  return { similarity: Math.round((dot / norm(embedding) / norm(target)) * 1000) / 1000, speechSeconds };
};
