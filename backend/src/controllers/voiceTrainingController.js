// Train voice (Text to Speech): the API the page's Train voice tab uses,
// shaped like the YOLO and Speech to Text areas (/models, /datasets, /train,
// /jobs, /devices) so it shares their components.

import fs from 'node:fs/promises';
import {
  TASK, deleteVoice, scoreAgainstVoice, startVoiceTraining, trainedVoices, trainingDatasets,
} from '../helpers/voiceTraining.js';
import {
  createVoiceDataset, deleteDataset, deleteVoiceClip, getVoiceDataset, listDatasets, saveVoiceClip, saveVoiceScript,
  voiceClipPath, voiceSummary,
} from '../helpers/mlDatasets.js';
import {
  JobError, cancelJob, getJob, listJobs, probeDevices,
} from '../helpers/translationJobs.js';

export const listVoices = async (req, res) => res.json({ models: await trainedVoices(req.user.sub) });
/** GET /tools/voice/training-datasets — voice datasets and Speech to Text datasets, for Train voice. */
export const listTrainingDatasets = async (req, res) => res.json({ datasets: await trainingDatasets(req.user.sub) });

/*
 * Voice datasets — the Datasets tab: a script of lines and a recording of
 * each, made on the page. Personal, like Speech to Text datasets, and managed
 * with the page ('text-to-speech:view'); training on one needs ':train'.
 */
export const listVoiceDatasets = async (req, res) => res.json({
  datasets: (await listDatasets(req.user.sub, 'voice')).map(voiceSummary),
});
/** POST /tools/voice/datasets — { name, language, speaker, script: [{ id, text }] }. */
export const createVoiceDatasetRecord = async (req, res) => res.status(201).json({
  dataset: await createVoiceDataset(req.user.sub, req.body || {}),
});
export const getVoiceDatasetRecord = async (req, res) => res.json({ dataset: await getVoiceDataset(req.user.sub, req.params.id) });
/** PUT /tools/voice/datasets/:id — any of { name, language, speaker, script }. Recordings of removed lines go. */
export const updateVoiceDataset = async (req, res) => {
  await saveVoiceScript(req.user.sub, req.params.id, req.body || {});
  res.json({ dataset: await getVoiceDataset(req.user.sub, req.params.id) });
};
export const deleteVoiceDataset = async (req, res) => {
  await deleteDataset(req.user.sub, 'voice', req.params.id);
  res.json({ ok: true });
};
/** PUT /tools/voice/datasets/:id/clips/:line — multipart "audio", a WAV: the recording of that line. */
export const putVoiceClip = async (req, res) => res.json({
  dataset: await saveVoiceClip(req.user.sub, req.params.id, req.params.line, req.file),
});
export const removeVoiceClip = async (req, res) => res.json({
  dataset: await deleteVoiceClip(req.user.sub, req.params.id, req.params.line),
});
export const getVoiceClip = async (req, res) => {
  res.type('audio/wav');
  res.sendFile(await voiceClipPath(req.user.sub, req.params.id, req.params.line));
};

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
