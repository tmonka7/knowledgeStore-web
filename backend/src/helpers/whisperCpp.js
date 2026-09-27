// Voice recognition with whisper.cpp for Tools > AI > Speech to Text.
//
// One long-running Python worker (backend/python/whisper_cpp_worker.py) keeps
// the ggml models loaded, so a spoken phrase is recognised in well under a
// second instead of paying for a model load each time. See pythonWorker.js
// for how it is started, queued, restarted and stopped when idle.

import path from 'node:path';
import { createPythonWorker } from './pythonWorker.js';
import { JobError, findModel, listModels } from './translationJobs.js';

export const TASK = 'recognition';

const worker = createPythonWorker({
  script: 'whisper_cpp_worker.py',
  label: 'Voice recognition',
  env: { WHISPER_CPP_THREADS: process.env.WHISPER_CPP_THREADS || '' },
  idleMs: Math.max(60, Number(process.env.WHISPER_CPP_IDLE_SECONDS) || 600) * 1000,
  maxWaiting: Math.max(1, Number(process.env.WHISPER_CPP_MAX_QUEUE) || 8),
});

/** The whisper.cpp models on the server (downloaded with download_models.py ggml-tiny …). */
export const recognitionModels = async (ownerId) => (await listModels(ownerId, TASK)).map((model) => ({
  id: model.id,
  name: model.name,
  englishOnly: Boolean(model.englishOnly),
  bytes: Object.values(model.files || {}).reduce((sum, size) => sum + size, 0),
}));

/** Whether recognition can run: models present, and the worker starts. */
export const recognitionStatus = async (ownerId) => {
  const models = await recognitionModels(ownerId);
  let engine = { ok: true, message: '' };
  if (models.length) {
    try {
      const info = await worker.ready();
      engine = { ok: true, message: '', threads: info.threads };
    } catch (error) {
      engine = { ok: false, message: error.message };
    }
  }
  return { models, engine };
};

/**
 * Recognise the speech in a WAV file (16 kHz mono PCM from the page).
 * `prompt` is the text said just before, which helps continuity when a long
 * dictation arrives phrase by phrase.
 */
export const recognize = async ({ ownerId, modelId, audioPath, language, translate, prompt, audioSeconds }) => {
  const model = await findModel(ownerId, modelId, TASK);
  const lang = String(language || 'auto').toLowerCase();
  if (!/^(auto|[a-z]{2,3})$/.test(lang)) throw new JobError('Unknown language.');
  if (model.englishOnly && lang !== 'auto' && lang !== 'en') {
    throw new JobError(`${model.name} understands English only; choose a multilingual model for "${lang}".`);
  }

  // Roughly: a long file may need a few times its own length on a slow CPU.
  const timeoutMs = Math.max(60, (Number(audioSeconds) || 600) * 3) * 1000;
  try {
    const result = await worker.request({
      model: path.join(model.folder, model.file || `${model.id}.bin`),
      audio: audioPath,
      language: model.englishOnly ? 'en' : lang,
      translate: Boolean(translate) && !model.englishOnly,
      prompt: String(prompt || '').slice(-400),
    }, timeoutMs, 'Voice recognition is busy; try again in a moment.');
    return { ...result, model: model.id };
  } catch (error) {
    // The worker's own reason ("not a PCM WAV file …") reads better with context.
    if (error.status === 400 && !/^Recognition failed/.test(error.message)) error.message = `Recognition failed: ${error.message}`;
    throw error;
  }
};
