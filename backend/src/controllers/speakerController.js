// Speaker recognition (ECAPA-TDNN) for Tools > AI > Speaker recognition.

import fs from 'node:fs/promises';
import {
  TASK, addSample, createSpeaker, deleteSample, deleteSpeaker, identify, listSpeakers, sampleAudio, speakerModels,
  speakerStatus, startSpeakerExport, startSpeakerTfliteExport, updateSpeaker,
} from '../helpers/speakerRecognition.js';
import {
  JobError, cancelJob, createDownloadTicket, getJob, listJobs,
} from '../helpers/translationJobs.js';
import { callerOf } from '../helpers/datasetAccess.js';

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
// Speakers are shared by everyone who can open the page (helpers/datasetAccess.js).
export const list = async (req, res) => res.json({ speakers: await listSpeakers(callerOf(req)) });
export const create = async (req, res) => res.status(201).json({ speaker: await createSpeaker(callerOf(req), req.body || {}) });
export const update = async (req, res) => res.json({ speaker: await updateSpeaker(callerOf(req), req.params.id, req.body || {}) });
export const remove = async (req, res) => {
  await deleteSpeaker(callerOf(req), req.params.id);
  res.json({ ok: true });
};

/** POST …/speakers/:id/samples — multipart "audio" (16 kHz mono WAV) and "source". */
export const enroll = async (req, res) => res.status(201).json({
  speaker: await withClip(req, (file) => addSample(callerOf(req), req.params.id, file, req.body?.source)),
});

export const removeSample = async (req, res) => res.json({
  speaker: await deleteSample(callerOf(req), req.params.id, req.params.sampleId),
});

export const playSample = async (req, res, next) => {
  const file = await sampleAudio(callerOf(req), req.params.sampleId);
  res.type('audio/wav');
  res.sendFile(file, { headers: { 'Cache-Control': 'private, no-store' } }, (error) => {
    if (error && !res.headersSent) next(new JobError('That sample\'s audio is missing.', 404));
  });
};

/**
 * POST …/identify — multipart "audio", optional "threshold", "speakerId" (to
 * verify one speaker) and "modelId" (to test a model other than the current one).
 */
export const recognise = async (req, res) => res.json(await withClip(req, (file) => identify(callerOf(req), file, {
  threshold: req.body?.threshold,
  speakerId: req.body?.speakerId || undefined,
  modelId: req.body?.modelId || undefined,
})));

/* ONNX export of a speaker model: the same job and download flow as the Train tabs. */

export const models = async (req, res) => res.json({ models: await speakerModels(req.user.sub) });

export const exportOnnx = async (req, res) => res.status(202).json({
  job: await startSpeakerExport({ ownerId: req.user.sub, modelId: req.params.id }),
});

export const exportTflite = async (req, res) => res.status(202).json({
  job: await startSpeakerTfliteExport({ ownerId: req.user.sub, modelId: req.params.id }),
});

/** POST …/models/:id/tflite/link — a one-use, one-minute URL for the zip. */
export const tfliteLink = async (req, res) => {
  const ticket = await createDownloadTicket(req.user.sub, req.params.id, TASK, 'tflite');
  res.json({ path: `/tools/transformers/onnx-download/${ticket}` });
};

/** POST …/models/:id/onnx/link — a one-use, one-minute URL for the zip. */
export const onnxLink = async (req, res) => {
  const ticket = await createDownloadTicket(req.user.sub, req.params.id, TASK);
  res.json({ path: `/tools/transformers/onnx-download/${ticket}` });
};

export const jobs = (req, res) => res.json({ jobs: listJobs(req.user.sub, TASK) });
export const job = (req, res) => res.json({ job: getJob(req.user.sub, req.params.id, TASK) });
export const cancel = (req, res) => res.json({ job: cancelJob(req.user.sub, req.params.id, TASK) });
