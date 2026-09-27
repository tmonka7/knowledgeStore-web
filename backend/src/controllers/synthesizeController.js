// Text to Speech (Supertonic) for Tools > AI > Text to Speech.

import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { synthesisStatus, synthesize } from '../helpers/textToSpeech.js';

/** GET /tools/speech/synthesize — the models and their voices, the languages, and whether the engine starts. */
export const synthesizeStatus = async (req, res) => {
  res.json(await synthesisStatus(req.user.sub));
};

/**
 * POST /tools/speech/synthesize — { modelId, text, language, voice, speed,
 * steps }; answers with the speech as audio/wav. X-Speech-Dropped lists the
 * characters the model has no sound for (URI-encoded), which were left out.
 */
export const synthesizeSpeech = async (req, res) => {
  const body = req.body || {};
  const result = await synthesize({
    ownerId: req.user.sub,
    modelId: String(body.modelId || ''),
    text: typeof body.text === 'string' ? body.text : '',
    language: body.language,
    voice: String(body.voice || ''),
    speed: body.speed,
    steps: body.steps,
  });
  const remove = () => fs.rm(result.file, { force: true }).catch(() => {});
  try {
    const { size } = await fs.stat(result.file);
    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': String(size),
      'Cache-Control': 'no-store',
      'X-Speech-Took': String(result.took ?? ''),
      'X-Speech-Voice': result.voice,
      'X-Speech-Dropped': encodeURIComponent(result.dropped),
    });
  } catch (error) {
    await remove();
    throw error;
  }
  const stream = createReadStream(result.file);
  res.on('close', remove);
  stream.on('error', (error) => res.destroy(error));
  stream.pipe(res);
};
