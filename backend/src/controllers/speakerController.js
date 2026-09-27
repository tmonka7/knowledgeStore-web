// Speaker recognition (ECAPA-TDNN) for Tools > AI > Speaker recognition.

import fs from 'node:fs/promises';
import {
  addSample, createSpeaker, deleteSample, deleteSpeaker, identify, listSpeakers, sampleAudio, speakerStatus,
  updateSpeaker,
} from '../helpers/speakerRecognition.js';
import { JobError } from '../helpers/translationJobs.js';

/** Run `work` on the uploaded clip, then remove it unless `work` moved it. */
const withClip = async (req, work) => {
  if (!req.file) throw new JobError('No audio was sent.');
  try {
    return await work(req.file);
  } finally {
    await fs.unlink(req.file.path).catch(() => {});
  }
};

export const status = async (req, res) => res.json(await speakerStatus(req.user.sub));
export const list = async (req, res) => res.json({ speakers: await listSpeakers(req.user.sub) });
export const create = async (req, res) => res.status(201).json({ speaker: await createSpeaker(req.user.sub, req.body || {}) });
export const update = async (req, res) => res.json({ speaker: await updateSpeaker(req.user.sub, req.params.id, req.body || {}) });
export const remove = async (req, res) => {
  await deleteSpeaker(req.user.sub, req.params.id);
  res.json({ ok: true });
};

/** POST …/speakers/:id/samples — multipart "audio" (16 kHz mono WAV) and "source". */
export const enroll = async (req, res) => res.status(201).json({
  speaker: await withClip(req, (file) => addSample(req.user.sub, req.params.id, file, req.body?.source)),
});

export const removeSample = async (req, res) => res.json({
  speaker: await deleteSample(req.user.sub, req.params.id, req.params.sampleId),
});

export const playSample = async (req, res, next) => {
  const file = await sampleAudio(req.user.sub, req.params.sampleId);
  res.type('audio/wav');
  res.sendFile(file, { headers: { 'Cache-Control': 'private, no-store' } }, (error) => {
    if (error && !res.headersSent) next(new JobError('That sample\'s audio is missing.', 404));
  });
};

/** POST …/identify — multipart "audio", optional "threshold" and "speakerId" (to verify one speaker). */
export const recognise = async (req, res) => res.json(await withClip(req, (file) => identify(req.user.sub, file, {
  threshold: req.body?.threshold,
  speakerId: req.body?.speakerId || undefined,
})));
