// Speaker recognition for Tools > AI > Speaker recognition.
//
// backend/python/speaker_worker.py turns a clip into an ECAPA-TDNN voiceprint
// (192 numbers). Everything else happens here: speakers and their samples'
// voiceprints are kept in MongoDB (models/speakerModel.js), the samples' audio
// on disk, and a clip is compared with each speaker by cosine similarity to
// the average of that speaker's voiceprints.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Speaker } from '../models/speakerModel.js';
import { DATASETS_DIR } from './mlDatasets.js';
import { startExportJob, startTfliteExport } from './mlJobs.js';
import { createPythonWorker } from './pythonWorker.js';
import { JobError, findModel, listModels } from './translationJobs.js';

export const TASK = 'speaker';
export const DEFAULT_THRESHOLD = 0.35;
const MAX_SPEAKERS = 500;
const MAX_SAMPLES = 20;
const AUDIO_DIR = path.join(DATASETS_DIR, 'speakers');

const worker = createPythonWorker({
  script: 'speaker_worker.py',
  label: 'Speaker recognition',
  idleMs: Math.max(60, Number(process.env.SPEAKER_IDLE_SECONDS) || 600) * 1000,
  maxWaiting: Math.max(1, Number(process.env.SPEAKER_MAX_QUEUE) || 16),
});

/* ------------------------------------------------------------------ vectors */

const unit = (vector) => {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
};

const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);

/** The direction all of a speaker's samples share: the mean of their unit vectors. */
const centroid = (vectors) => {
  const units = vectors.map(unit);
  return unit(units[0].map((_, index) => units.reduce((sum, vector) => sum + vector[index], 0) / units.length));
};

/* -------------------------------------------------------------------- model */

/** The ECAPA model on the server, or null (download_models.py ecapa). */
const currentModel = async (ownerId) => (await listModels(ownerId, TASK))[0] || null;

/** The model with its folder (a listing leaves that out). */
const requireModel = async (ownerId) => {
  const model = await currentModel(ownerId);
  if (!model) {
    throw new JobError('No speaker model on the server. An administrator runs: python backend/python/download_models.py ecapa', 503);
  }
  return findModel(ownerId, model.id, TASK);
};

/** A model picked by id (to test or compare one), else the current one. */
const pickModel = (ownerId, modelId) => (modelId ? findModel(ownerId, String(modelId), TASK) : requireModel(ownerId));

export const speakerStatus = async (ownerId) => {
  const models = await listModels(ownerId, TASK);
  const model = models[0] || null;
  let engine = { ok: true, message: '' };
  if (model) {
    try {
      await worker.ready();
    } catch (error) {
      engine = { ok: false, message: error.message };
    }
  }
  return {
    model: model ? { id: model.id, name: model.name, architecture: model.architecture || 'ECAPA-TDNN' } : null,
    // Every speaker model this account may use; the first enrolls, any can be tested.
    models: models.map((item) => ({ id: item.id, name: item.name, kind: item.kind, baseModel: item.baseModel || null })),
    engine,
    defaultThreshold: DEFAULT_THRESHOLD,
    maxSamples: MAX_SAMPLES,
  };
};

/*
 * For voice sign-in (helpers/voiceLogin.js), which has no account to scope a
 * model by: the downloaded base model, the same one enrolment uses.
 */
export const baseSpeakerModel = async () => (await listModels('', TASK)).find((model) => model.kind === 'base') || null;

/** A voiceprint of one clip made with the base model: { embedding, seconds, speechSeconds, model }. */
export const baseVoiceprint = async (audioPath) => {
  const model = await baseSpeakerModel();
  if (!model) throw new JobError('Voice sign-in is not available: the speaker model is not installed on the server.', 503);
  return embed('', audioPath, await findModel('', model.id, TASK));
};

/** Cosine similarity of a clip's voiceprint to the centroid of a speaker's. */
export const voiceSimilarity = (clip, embeddings) => dot(unit(clip), centroid(embeddings));

/** The speaker models this account may use, each with the size of its ONNX export (0 if none). */
export const speakerModels = (ownerId) => listModels(ownerId, TASK);

/** The caller's voice sample with the most speech, to test an ONNX export on; null if none. */
const exportSample = async (ownerId) => {
  const samples = (await Speaker.find({ ownerId })).flatMap((speaker) => speaker.samples)
    .sort((a, b) => (b.speechSeconds || 0) - (a.speechSeconds || 0));
  for (const sample of samples) {
    const file = audioPath(ownerId, sample.id);
    if (await fs.stat(file).then(() => true, () => false)) return file;
  }
  return null;
};

/** Export a speaker model to TFLite (tflite_export.py), tested on the same sample as ONNX. */
export const startSpeakerTfliteExport = async ({ ownerId, modelId }) => startTfliteExport({
  ownerId, task: TASK, modelId, kind: 'speaker', sample: await exportSample(ownerId),
});

/** Export a speaker model to ONNX (speaker_export.py): a job, like the other exports. */
export const startSpeakerExport = async ({ ownerId, modelId }) => startExportJob({
  ownerId, task: TASK, modelId, script: 'speaker_export.py', sample: await exportSample(ownerId),
});

/** A clip's voiceprint: { embedding, seconds, speechSeconds, model }. */
const embed = async (ownerId, audioPath, chosen = null) => {
  const model = chosen || await requireModel(ownerId);
  const result = await worker.request({ model: model.folder, audio: audioPath }, 120 * 1000,
    'Speaker recognition is busy; try again in a moment.');
  return { ...result, model: model.id };
};

/* ----------------------------------------------------------------- speakers */

const SAFE_OWNER = /^[A-Za-z0-9_-]{1,64}$/;
const audioFolder = (ownerId) => {
  if (!SAFE_OWNER.test(String(ownerId))) throw new JobError('Unexpected account id.', 400);
  return path.join(AUDIO_DIR, ownerId);
};
const audioPath = (ownerId, sampleId) => path.join(audioFolder(ownerId), `${sampleId}.wav`);

/** Across drives rename fails (EXDEV): copy, then remove. */
const moveFile = async (from, to) => {
  try {
    await fs.rename(from, to);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fs.copyFile(from, to);
    await fs.unlink(from);
  }
};

const publicSpeaker = (speaker, modelId) => ({
  id: speaker.id,
  name: speaker.name,
  note: speaker.note,
  createdAt: speaker.createdAt,
  updatedAt: speaker.updatedAt,
  speechSeconds: speaker.samples.reduce((sum, sample) => sum + (sample.speechSeconds || 0), 0),
  samples: speaker.samples.map((sample) => ({
    id: sample.id,
    seconds: sample.seconds,
    speechSeconds: sample.speechSeconds,
    source: sample.source,
    createdAt: sample.createdAt,
    // A sample made by another model cannot be compared until it is re-recorded.
    current: sample.model === modelId,
  })),
});

const ownSpeaker = async (ownerId, id) => {
  const speaker = await Speaker.findOne({ ownerId, id: String(id || '') });
  if (!speaker) throw new JobError('Speaker not found.', 404);
  return speaker;
};

const cleanName = (value) => {
  const name = String(value || '').trim().slice(0, 120);
  if (!name) throw new JobError('Give the speaker a name.');
  return name;
};

export const listSpeakers = async (ownerId) => {
  const model = await currentModel(ownerId);
  const speakers = await Speaker.find({ ownerId }).sort({ name: 1 });
  return speakers.map((speaker) => publicSpeaker(speaker, model?.id));
};

export const createSpeaker = async (ownerId, { name, note }) => {
  if (await Speaker.countDocuments({ ownerId }) >= MAX_SPEAKERS) {
    throw new JobError(`You can enroll at most ${MAX_SPEAKERS} speakers.`);
  }
  const speaker = await Speaker.create({ id: randomUUID(), ownerId, name: cleanName(name), note: String(note || '').slice(0, 500) });
  return publicSpeaker(speaker, (await currentModel(ownerId))?.id);
};

export const updateSpeaker = async (ownerId, id, { name, note }) => {
  const speaker = await ownSpeaker(ownerId, id);
  if (name !== undefined) speaker.name = cleanName(name);
  if (note !== undefined) speaker.note = String(note || '').slice(0, 500);
  speaker.updatedAt = new Date();
  await speaker.save();
  return publicSpeaker(speaker, (await currentModel(ownerId))?.id);
};

export const deleteSpeaker = async (ownerId, id) => {
  const speaker = await ownSpeaker(ownerId, id);
  await Promise.all(speaker.samples.map((sample) => fs.unlink(audioPath(ownerId, sample.id)).catch(() => {})));
  await Speaker.deleteOne({ ownerId, id: speaker.id });
};

/** Enroll one voice sample (a 16 kHz mono WAV from the page). */
export const addSample = async (ownerId, speakerId, upload, source) => {
  const speaker = await ownSpeaker(ownerId, speakerId);
  if (speaker.samples.length >= MAX_SAMPLES) {
    throw new JobError(`A speaker can have at most ${MAX_SAMPLES} samples; delete one first.`);
  }
  const print = await embed(ownerId, upload.path);
  if (print.speechSeconds < 1) {
    throw new JobError(`Only ${print.speechSeconds.toFixed(1)} s of speech was heard. Record a few seconds of normal talking.`);
  }
  const sample = {
    id: randomUUID(),
    embedding: print.embedding,
    model: print.model,
    seconds: print.seconds,
    speechSeconds: print.speechSeconds,
    source: String(source || '').slice(0, 200),
    createdAt: new Date(),
  };
  await fs.mkdir(audioFolder(ownerId), { recursive: true });
  await moveFile(upload.path, audioPath(ownerId, sample.id));
  speaker.samples.push(sample);
  speaker.updatedAt = new Date();
  await speaker.save();
  return publicSpeaker(speaker, print.model);
};

export const deleteSample = async (ownerId, speakerId, sampleId) => {
  const speaker = await ownSpeaker(ownerId, speakerId);
  const before = speaker.samples.length;
  speaker.samples = speaker.samples.filter((sample) => sample.id !== sampleId);
  if (speaker.samples.length === before) throw new JobError('Sample not found.', 404);
  speaker.updatedAt = new Date();
  await speaker.save();
  await fs.unlink(audioPath(ownerId, sampleId)).catch(() => {});
  return publicSpeaker(speaker, (await currentModel(ownerId))?.id);
};

/** The WAV of one of the caller's samples, for the page's player. */
export const sampleAudio = async (ownerId, sampleId) => {
  const speaker = await Speaker.findOne({ ownerId, 'samples.id': String(sampleId || '') });
  if (!speaker) throw new JobError('Sample not found.', 404);
  return audioPath(ownerId, String(sampleId));
};

/**
 * Who is speaking in a clip: every enrolled speaker (or just `speakerId`, to
 * verify one) scored by cosine similarity, best first. `match` is the best
 * one when it reaches the threshold.
 */
/*
 * Voiceprints of stored samples made with a model other than the one that
 * enrolled them, for testing or comparing models. Sample ids are never
 * reused, so an entry can only go stale by being unused; the oldest go first.
 */
const otherPrints = new Map();
const MAX_OTHER_PRINTS = 4000;

const sampleVectors = async (ownerId, speaker, model) => {
  const vectors = [];
  for (const sample of speaker.samples) {
    if (sample.model === model.id) {
      vectors.push(sample.embedding);
      continue;
    }
    const key = `${model.id}:${sample.id}`;
    if (!otherPrints.has(key)) {
      try {
        otherPrints.set(key, (await embed(ownerId, audioPath(ownerId, sample.id), model)).embedding);
      } catch {
        continue; // Audio gone or unusable with this model: the other samples still count.
      }
      if (otherPrints.size > MAX_OTHER_PRINTS) otherPrints.delete(otherPrints.keys().next().value);
    }
    vectors.push(otherPrints.get(key));
  }
  return vectors;
};

export const identify = async (ownerId, upload, { threshold, speakerId, modelId } = {}) => {
  const limit = Number.isFinite(Number(threshold)) && threshold !== '' && threshold != null
    ? Math.min(1, Math.max(0, Number(threshold)))
    : DEFAULT_THRESHOLD;
  const filter = speakerId ? { ownerId, id: String(speakerId) } : { ownerId };
  const speakers = await Speaker.find(filter);
  if (speakerId && !speakers.length) throw new JobError('Speaker not found.', 404);

  const model = await pickModel(ownerId, modelId);
  const print = await embed(ownerId, upload.path, model);
  const clip = unit(print.embedding);
  const scored = [];
  for (const speaker of speakers) scored.push({ speaker, vectors: await sampleVectors(ownerId, speaker, model) });
  const results = scored
    .map(({ speaker, vectors }) => {
      if (!vectors.length) return null;
      return {
        speakerId: speaker.id,
        name: speaker.name,
        score: Number(dot(clip, centroid(vectors)).toFixed(4)),
        best: Number(Math.max(...vectors.map((vector) => dot(clip, unit(vector)))).toFixed(4)),
        samples: vectors.length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const top = results[0];
  return {
    model: { id: model.id, name: model.name, kind: model.kind },
    seconds: print.seconds,
    speechSeconds: print.speechSeconds,
    took: print.took,
    threshold: limit,
    results,
    match: top && top.score >= limit ? { ...top, margin: Number((top.score - (results[1]?.score ?? 0)).toFixed(4)) } : null,
  };
};

/** An account is being deleted: its speakers, and every voice sample's audio, go with it. */
export const purgeSpeakers = async (ownerId) => {
  await Speaker.deleteMany({ ownerId });
  await fs.rm(audioFolder(ownerId), { recursive: true, force: true }).catch(() => {});
};
