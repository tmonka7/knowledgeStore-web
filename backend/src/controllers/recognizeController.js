// Voice recognition (whisper.cpp) for Tools > AI > Speech to Text.

import fs from 'node:fs/promises';
import { recognitionStatus, recognize } from '../helpers/whisperCpp.js';
import { JobError } from '../helpers/translationJobs.js';

/** GET /tools/speech/recognize — the ggml models on the server, and whether the engine starts. */
export const recognizeStatus = async (req, res) => {
  res.json(await recognitionStatus(req.user.sub));
};

/**
 * POST /tools/speech/recognize — multipart "audio" (16 kHz mono WAV, made by
 * the page from the microphone or a file), with modelId, language, translate,
 * prompt and seconds (the clip's length, for the time limit).
 */
export const recognizeSpeech = async (req, res) => {
  if (!req.file) throw new JobError('No audio was sent.');
  try {
    res.json(await recognize({
      ownerId: req.user.sub,
      modelId: String(req.body?.modelId || ''),
      audioPath: req.file.path,
      language: req.body?.language,
      translate: req.body?.translate === 'true' || req.body?.translate === '1',
      prompt: req.body?.prompt,
      audioSeconds: Number(req.body?.seconds),
    }));
  } finally {
    await fs.unlink(req.file.path).catch(() => {});
  }
};
