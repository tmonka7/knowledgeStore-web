// Text to Speech with Supertonic (Supertone, ONNX) for Tools > AI > Text to Speech.
//
// One long-running Python worker (backend/python/tts_worker.py) keeps the
// model loaded, so a sentence is spoken in about a second instead of paying
// for a model load each time. See pythonWorker.js for how it is started,
// queued, restarted and stopped when idle.
//
// A request reads at most MAX_CHARS characters. The page sends longer text a
// part at a time, so the first part plays while the rest is read, it can show
// how far it has got, and stopping it is just not sending the next part.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPythonWorker } from './pythonWorker.js';
import { JobError, findModel, listModels } from './translationJobs.js';

export const TASK = 'synthesis';

/** The languages Supertonic 3 reads (its reference code's list; Chinese is not among them). */
export const TTS_LANGUAGES = [
  'en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu',
  'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi',
];
export const MAX_CHARS = Math.min(20000, Math.max(200, Number(process.env.TTS_MAX_CHARS) || 2000));
// Denoising steps: 8 is Supertone's default; the page offers 4 (fast), 8 and 16 (best).
const STEPS = [4, 8, 16];

const worker = createPythonWorker({
  script: 'tts_worker.py',
  label: 'Text to Speech',
  env: { TTS_THREADS: process.env.TTS_THREADS || '' },
  idleMs: Math.max(60, Number(process.env.TTS_IDLE_SECONDS) || 600) * 1000,
  maxWaiting: Math.max(1, Number(process.env.TTS_MAX_QUEUE) || 8),
});

/** A model's voices: the voice_styles/<name>.json files in its folder. */
const voicesOf = async (folder) => {
  try {
    return (await fs.readdir(path.join(folder, 'voice_styles')))
      .filter((name) => /^[A-Za-z0-9_-]{1,40}\.json$/.test(name))
      .map((name) => name.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
};

/** The Supertonic models on the server (downloaded with download_models.py supertonic-3). */
export const synthesisModels = async (ownerId) => Promise.all((await listModels(ownerId, TASK)).map(async (model) => {
  const { folder } = await findModel(ownerId, model.id, TASK);
  return {
    id: model.id,
    name: model.name,
    voices: await voicesOf(folder),
    bytes: Object.values(model.files || {}).reduce((sum, size) => sum + size, 0),
  };
}));

/** Whether speech can be made: models present, and the worker starts. */
export const synthesisStatus = async (ownerId) => {
  const models = await synthesisModels(ownerId);
  let engine = { ok: true, message: '' };
  if (models.length) {
    try {
      await worker.ready();
    } catch (error) {
      engine = { ok: false, message: error.message };
    }
  }
  return { models, engine, languages: TTS_LANGUAGES, steps: STEPS, maxChars: MAX_CHARS };
};

/**
 * Speak `text` into a WAV file (44.1 kHz, 16-bit mono). Resolves to
 * { file, seconds, took, dropped }; the caller sends the file and deletes it.
 */
export const synthesize = async ({ ownerId, modelId, text, language, voice, speed, steps }) => {
  const model = await findModel(ownerId, modelId, TASK);
  const words = String(text || '').trim();
  if (!words) throw new JobError('There is no text to read.');
  if (words.length > MAX_CHARS) throw new JobError(`Send at most ${MAX_CHARS} characters at a time.`);
  const lang = String(language || 'en').toLowerCase();
  if (!TTS_LANGUAGES.includes(lang)) throw new JobError(`Supertonic does not read "${lang}".`);
  const voices = await voicesOf(model.folder);
  const chosenVoice = voices.includes(voice) ? voice : voices[0];
  if (!chosenVoice) throw new JobError(`${model.name} has no voices (voice_styles is empty); download it again.`);
  const chosenSteps = STEPS.includes(Number(steps)) ? Number(steps) : 8;
  const chosenSpeed = Math.min(2, Math.max(0.5, Number(speed) || 1.05));

  const file = path.join(os.tmpdir(), `tts-${randomUUID()}.wav`);
  // About 0.4 s of work per second of speech at 8 steps, and 15 characters a
  // second of speech; the first request also loads the model.
  const timeoutMs = (60 + Math.ceil(words.length * 0.1 * (chosenSteps / 8))) * 1000;
  try {
    const result = await worker.request({
      model: model.folder,
      text: words,
      language: lang,
      voice: chosenVoice,
      speed: chosenSpeed,
      steps: chosenSteps,
      out: file,
    }, timeoutMs, 'Text to Speech is busy; try again in a moment.');
    return { file, seconds: result.seconds, took: result.took, dropped: result.dropped || '', voice: chosenVoice };
  } catch (error) {
    await fs.rm(file, { force: true });
    if (error.status === 400 && !/^Speech failed/.test(error.message)) error.message = `Speech failed: ${error.message}`;
    throw error;
  }
};
