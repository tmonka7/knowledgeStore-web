// Train voice (Text to Speech): the API the page's Train voice tab uses,
// shaped like the YOLO and Speech to Text areas (/models, /datasets, /train,
// /jobs, /devices) so it shares their components.

import fs from 'node:fs/promises';
import {
  TASK, deleteVoice, scoreAgainstVoice, startVoiceTraining, trainedVoices, voiceDatasets,
} from '../helpers/voiceTraining.js';
import {
  JobError, cancelJob, getJob, listJobs, probeDevices,
} from '../helpers/translationJobs.js';

export const listVoices = async (req, res) => res.json({ models: await trainedVoices(req.user.sub) });
export const listVoiceDatasets = async (req, res) => res.json({ datasets: await voiceDatasets(req.user.sub) });

export const removeVoice = async (req, res) => {
  await deleteVoice(req.user.sub, req.params.id);
  res.json({ ok: true });
};

/** POST /tools/voice/train — { datasetId, baseModelId: 'auto' | 'F1' …, name, options: { steps, learningRate, device } }. */
export const trainVoice = async (req, res) => {
  const job = await startVoiceTraining({
    ownerId: req.user.sub,
    datasetId: String(req.body?.datasetId || ''),
    baseModelId: String(req.body?.baseModelId || 'auto'),
    name: req.body?.name,
    options: req.body?.options || {},
  });
  res.status(202).json({ job });
};

/** POST /tools/voice/models/:id/score — multipart "audio" (a WAV): how much it sounds like the voice's recordings. */
export const scoreVoice = async (req, res) => {
  if (!req.file) throw new JobError('No audio was sent.');
  try {
    res.json(await scoreAgainstVoice(req.user.sub, req.params.id, req.file.path));
  } finally {
    await fs.rm(req.file.path, { force: true });
  }
};

export const voiceDevices = async (req, res) => res.json(await probeDevices({ refresh: req.query.refresh === '1' }));
export const listVoiceJobs = (req, res) => res.json({ jobs: listJobs(req.user.sub, TASK) });
export const getVoiceJob = (req, res) => res.json({ job: getJob(req.user.sub, req.params.id, TASK) });
export const cancelVoiceJob = (req, res) => res.json({ job: cancelJob(req.user.sub, req.params.id, TASK) });
