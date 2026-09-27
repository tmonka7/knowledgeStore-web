import express from 'express';
import multer from 'multer';
import os from 'node:os';
import { convertFont, fontCapabilities } from '../controllers/lvglController.js';
import {
  cancelConvertJob, convertCapabilities, convertedFile, createConvertJob, deleteConvertJob, getConvertJob, listConvertJobs,
} from '../controllers/convertController.js';
import { MAX_UPLOAD_MB } from '../helpers/mediaConvert.js';
import {
  cancelTranslationJob,
  createTranslationDatasetRecord,
  deleteTranslationDataset,
  deleteTranslationModel,
  downloadOnnx,
  exportTranslationModel,
  getTranslationDataset,
  getTranslationJob,
  listTranslationDatasets,
  listTranslationJobs,
  listTranslationModels,
  onnxDownloadLink,
  pythonCapabilities,
  runTranslationScript,
  trainTranslationModel,
  trainingDevices,
  translateWithModel,
  updateTranslationDataset,
} from '../controllers/transformersController.js';
import { ggmlHandlers, mlHandlers } from '../controllers/mlController.js';
import { recognizeSpeech, recognizeStatus } from '../controllers/recognizeController.js';
import { synthesizeSpeech, synthesizeStatus } from '../controllers/synthesizeController.js';
import * as voiceTraining from '../controllers/voiceTrainingController.js';
import * as speechCommand from '../controllers/speechCommandController.js';
import * as speaker from '../controllers/speakerController.js';
import * as ocr from '../controllers/ocrController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';
import { asyncRoute } from '../helpers/asyncRoute.js';

const router = express.Router();

// A source font is converted and discarded within the request, so it never
// needs to touch disk.
const fontUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
});

// Audio and video are the opposite: files are far too large to hold in
// memory, and ffmpeg wants a path to read anyway. The conversion job deletes
// the upload once it has finished with it.
const mediaUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
});

router.get('/tools/lvgl/capabilities', requireAuth, requirePermission('lvgl-tool:view'), fontCapabilities);
router.post(
  '/tools/lvgl/font',
  requireAuth,
  requirePermission('lvgl-tool:view'),
  fontUpload.single('font'),
  convertFont,
);

const convertView = [requireAuth, requirePermission('convert-tool:view')];
router.get('/tools/convert/capabilities', ...convertView, asyncRoute(convertCapabilities));
router.get('/tools/convert/jobs', ...convertView, asyncRoute(listConvertJobs));
router.post('/tools/convert/jobs', ...convertView, mediaUpload.single('file'), asyncRoute(createConvertJob));
router.get('/tools/convert/jobs/:id', ...convertView, asyncRoute(getConvertJob));
router.post('/tools/convert/jobs/:id/cancel', ...convertView, asyncRoute(cancelConvertJob));
router.delete('/tools/convert/jobs/:id', ...convertView, asyncRoute(deleteConvertJob));
// No auth middleware: the page's <video>/<audio> player and the download link
// are plain browser requests without the Authorization header. The token, an
// unguessable 48-hex string given only to the job's owner, grants access, and
// dies with the job.
router.get('/tools/convert/files/:token', convertedFile);

// Translation datasets are personal, like the YOLO and TTS drafts, so the
// page's own permission covers managing them. Running Python does not: it
// executes code on this host, and needs 'transformers:execute' as well.
const transformersView = [requireAuth, requirePermission('transformers:view')];
router.get('/tools/transformers/datasets', ...transformersView, asyncRoute(listTranslationDatasets));
router.post('/tools/transformers/datasets', ...transformersView, asyncRoute(createTranslationDatasetRecord));
router.get('/tools/transformers/datasets/:id', ...transformersView, asyncRoute(getTranslationDataset));
router.put('/tools/transformers/datasets/:id', ...transformersView, asyncRoute(updateTranslationDataset));
router.delete('/tools/transformers/datasets/:id', ...transformersView, asyncRoute(deleteTranslationDataset));
router.get(
  '/tools/transformers/python',
  ...transformersView,
  requirePermission('transformers:execute'),
  asyncRoute(pythonCapabilities),
);
router.post(
  '/tools/transformers/run',
  ...transformersView,
  requirePermission('transformers:execute'),
  asyncRoute(runTranslationScript),
);

// Fine-tuning, ONNX export and test translation with the offline models.
const transformersTrain = [...transformersView, requirePermission('transformers:train')];
router.get('/tools/transformers/models', ...transformersTrain, asyncRoute(listTranslationModels));
router.delete('/tools/transformers/models/:id', ...transformersTrain, asyncRoute(deleteTranslationModel));
router.post('/tools/transformers/models/:id/onnx', ...transformersTrain, asyncRoute(exportTranslationModel));
router.post('/tools/transformers/models/:id/onnx/link', ...transformersTrain, asyncRoute(onnxDownloadLink));
// No auth middleware: this is followed by a plain browser navigation, which
// cannot send the Authorization header. The single-use ticket in the URL,
// issued above to an authorised caller, is what grants access.
router.get('/tools/transformers/onnx-download/:ticket', asyncRoute(downloadOnnx));
router.post('/tools/transformers/train', ...transformersTrain, asyncRoute(trainTranslationModel));
router.post('/tools/transformers/translate', ...transformersTrain, asyncRoute(translateWithModel));
router.get('/tools/transformers/devices', ...transformersTrain, asyncRoute(trainingDevices));
router.get('/tools/transformers/jobs', ...transformersTrain, asyncRoute(listTranslationJobs));
router.get('/tools/transformers/jobs/:id', ...transformersTrain, asyncRoute(getTranslationJob));
router.post('/tools/transformers/jobs/:id/cancel', ...transformersTrain, asyncRoute(cancelTranslationJob));

/*
 * Voice recognition with whisper.cpp (ggml models). Part of using the Speech
 * to Text page, so 'tts:view' is enough; the worker takes one request at a
 * time and turns the rest away once its queue is full. 64 MB of 16 kHz mono
 * WAV is about 35 minutes of speech.
 */
const recognizeUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 64 * 1024 * 1024, files: 1 } });
const speechView = [requireAuth, requirePermission('tts:view')];
router.get('/tools/speech/recognize', ...speechView, asyncRoute(recognizeStatus));
router.post('/tools/speech/recognize', ...speechView, recognizeUpload.single('audio'), asyncRoute(recognizeSpeech));

/*
 * Text to Speech (Supertonic). Its own page and permission,
 * 'text-to-speech:view'. Nothing is kept: the WAV is written, sent and
 * deleted within the request. The text comes as JSON, within the 3 MB limit.
 */
const synthesisView = [requireAuth, requirePermission('text-to-speech:view')];
router.get('/tools/speech/synthesize', ...synthesisView, asyncRoute(synthesizeStatus));
router.post('/tools/speech/synthesize', ...synthesisView, asyncRoute(synthesizeSpeech));

/*
 * Train voice: a Supertonic voice learned from a Speech to Text dataset of
 * someone's recordings. It copies a person's voice and ties up the server
 * for a while, so it needs 'text-to-speech:train', which is not in the
 * defaults. Datasets are read here, never changed: they are made and managed
 * on the Speech to Text page. Trained voices are private to their owner.
 */
const voiceTrain = [...synthesisView, requirePermission('text-to-speech:train')];
const voiceClipUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

// Voice datasets (the Datasets tab): recorded line by line, personal, and
// managed with the page like Speech to Text datasets.
router.get('/tools/voice/datasets', ...synthesisView, asyncRoute(voiceTraining.listVoiceDatasets));
router.post('/tools/voice/datasets', ...synthesisView, asyncRoute(voiceTraining.createVoiceDatasetRecord));
router.get('/tools/voice/datasets/:id', ...synthesisView, asyncRoute(voiceTraining.getVoiceDatasetRecord));
router.put('/tools/voice/datasets/:id', ...synthesisView, asyncRoute(voiceTraining.updateVoiceDataset));
router.delete('/tools/voice/datasets/:id', ...synthesisView, asyncRoute(voiceTraining.deleteVoiceDataset));
router.get('/tools/voice/datasets/:id/clips/:line', ...synthesisView, asyncRoute(voiceTraining.getVoiceClip));
router.put('/tools/voice/datasets/:id/clips/:line', ...synthesisView, voiceClipUpload.single('audio'), asyncRoute(voiceTraining.putVoiceClip));
router.delete('/tools/voice/datasets/:id/clips/:line', ...synthesisView, asyncRoute(voiceTraining.removeVoiceClip));

const scoreUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 32 * 1024 * 1024, files: 1 } });
router.get('/tools/voice/models', ...voiceTrain, asyncRoute(voiceTraining.listVoices));
router.delete('/tools/voice/models/:id', ...voiceTrain, asyncRoute(voiceTraining.removeVoice));
router.post('/tools/voice/models/:id/score', ...voiceTrain, scoreUpload.single('audio'), asyncRoute(voiceTraining.scoreVoice));
router.get('/tools/voice/training-datasets', ...voiceTrain, asyncRoute(voiceTraining.listTrainingDatasets));
router.post('/tools/voice/train', ...voiceTrain, asyncRoute(voiceTraining.trainVoice));
router.get('/tools/voice/devices', ...voiceTrain, asyncRoute(voiceTraining.voiceDevices));
router.get('/tools/voice/jobs', ...voiceTrain, asyncRoute(voiceTraining.listVoiceJobs));
router.get('/tools/voice/jobs/:id', ...voiceTrain, asyncRoute(voiceTraining.getVoiceJob));
router.post('/tools/voice/jobs/:id/cancel', ...voiceTrain, asyncRoute(voiceTraining.cancelVoiceJob));

/*
 * Speech to Command (Moonshine): recognising commands and keeping your own
 * command sets come with the page ('speech-command:view'); fine-tuning a model
 * ties up the server and needs 'speech-command:train'. Sets and trained
 * models are private to their owner.
 */
const commandView = [requireAuth, requirePermission('speech-command:view')];
const commandTrain = [...commandView, requirePermission('speech-command:train')];
const commandUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
router.get('/tools/command/status', ...commandView, asyncRoute(speechCommand.status));
router.get('/tools/command/models', ...commandView, asyncRoute(speechCommand.listModels));
router.post('/tools/command/recognize', ...commandView, commandUpload.single('audio'), asyncRoute(speechCommand.recognize));
router.get('/tools/command/datasets', ...commandView, asyncRoute(speechCommand.listSets));
router.post('/tools/command/datasets', ...commandView, asyncRoute(speechCommand.createSet));
router.get('/tools/command/datasets/:id', ...commandView, asyncRoute(speechCommand.getSet));
router.put('/tools/command/datasets/:id', ...commandView, asyncRoute(speechCommand.updateSet));
router.delete('/tools/command/datasets/:id', ...commandView, asyncRoute(speechCommand.deleteSet));
router.post('/tools/command/datasets/:id/clips', ...commandView, commandUpload.single('audio'), asyncRoute(speechCommand.addClip));
router.get('/tools/command/datasets/:id/clips/:clip', ...commandView, asyncRoute(speechCommand.getClip));
router.delete('/tools/command/datasets/:id/clips/:clip', ...commandView, asyncRoute(speechCommand.removeClip));
router.delete('/tools/command/models/:id', ...commandTrain, asyncRoute(speechCommand.removeModel));
router.post('/tools/command/train', ...commandTrain, asyncRoute(speechCommand.train));
router.get('/tools/command/devices', ...commandTrain, asyncRoute(speechCommand.devices));
router.get('/tools/command/jobs', ...commandTrain, asyncRoute(speechCommand.jobs));
router.get('/tools/command/jobs/:id', ...commandTrain, asyncRoute(speechCommand.job));
router.post('/tools/command/jobs/:id/cancel', ...commandTrain, asyncRoute(speechCommand.cancel));

/*
 * Speaker recognition (ECAPA-TDNN). Voiceprints are biometric data, so the
 * page has its own permission, 'speaker:view', which is not in the defaults.
 * Speakers are private to the account that enrolled them.
 */
const speakerView = [requireAuth, requirePermission('speaker:view')];
const speakerUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 16 * 1024 * 1024, files: 1 } });
router.get('/tools/speaker/status', ...speakerView, asyncRoute(speaker.status));
router.get('/tools/speaker/speakers', ...speakerView, asyncRoute(speaker.list));
router.post('/tools/speaker/speakers', ...speakerView, asyncRoute(speaker.create));
router.patch('/tools/speaker/speakers/:id', ...speakerView, asyncRoute(speaker.update));
router.delete('/tools/speaker/speakers/:id', ...speakerView, asyncRoute(speaker.remove));
router.post('/tools/speaker/speakers/:id/samples', ...speakerView, speakerUpload.single('audio'), asyncRoute(speaker.enroll));
router.delete('/tools/speaker/speakers/:id/samples/:sampleId', ...speakerView, asyncRoute(speaker.removeSample));
router.get('/tools/speaker/samples/:sampleId/audio', ...speakerView, asyncRoute(speaker.playSample));
router.post('/tools/speaker/identify', ...speakerView, speakerUpload.single('audio'), asyncRoute(speaker.recognise));
router.get('/tools/speaker/models', ...speakerView, asyncRoute(speaker.models));
router.post('/tools/speaker/models/:id/onnx', ...speakerView, asyncRoute(speaker.exportOnnx));
router.post('/tools/speaker/models/:id/onnx/link', ...speakerView, asyncRoute(speaker.onnxLink));
router.get('/tools/speaker/jobs', ...speakerView, asyncRoute(speaker.jobs));
router.get('/tools/speaker/jobs/:id', ...speakerView, asyncRoute(speaker.job));
router.post('/tools/speaker/jobs/:id/cancel', ...speakerView, asyncRoute(speaker.cancel));

/*
 * OCR (PaddleOCR). The image or PDF is read and deleted within the request;
 * nothing is kept. 50 MB is a large photograph or a long scanned PDF.
 */
const ocrView = [requireAuth, requirePermission('ocr:view')];
const ocrUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
router.get('/tools/ocr/status', ...ocrView, asyncRoute(ocr.status));
router.post('/tools/ocr/recognize', ...ocrView, ocrUpload.single('image'), asyncRoute(ocr.recognize));
router.get('/tools/ocr/jobs/:id', ...ocrView, asyncRoute(ocr.job));
router.post('/tools/ocr/jobs/:id/cancel', ...ocrView, asyncRoute(ocr.cancel));

/*
 * YOLO and Speech to Text: the same shape as the Transformers routes above,
 * with uploaded files instead of text rows. Managing your own datasets comes
 * with the page ('yolo:view' / 'tts:view'); training, testing and export tie
 * up the server and need 'yolo:train' / 'tts:train'.
 */
const DATASET_UPLOAD_LIMITS = {
  yolo: { fileSize: 50 * 1024 * 1024, files: 64 },
  speech: { fileSize: 200 * 1024 * 1024, files: 64 },
};

for (const [area, permission] of [['yolo', 'yolo'], ['speech', 'tts']]) {
  const handlers = mlHandlers(area);
  const view = [requireAuth, requirePermission(`${permission}:view`)];
  const train = [...view, requirePermission(`${permission}:train`)];
  const upload = multer({ dest: os.tmpdir(), limits: DATASET_UPLOAD_LIMITS[area] });
  const base = `/tools/${area}`;

  router.get(`${base}/datasets`, ...view, asyncRoute(handlers.listDatasets));
  router.post(`${base}/datasets`, ...view, asyncRoute(handlers.createDataset));
  router.get(`${base}/datasets/:id`, ...view, asyncRoute(handlers.getDataset));
  router.delete(`${base}/datasets/:id`, ...view, asyncRoute(handlers.deleteDataset));
  router.post(`${base}/datasets/:id/files`, ...view, upload.array('files'), asyncRoute(handlers.addFiles));
  router.put(`${base}/datasets/:id/${area === 'yolo' ? 'labels' : 'transcripts'}`, ...view, asyncRoute(handlers.finishDataset));

  router.get(`${base}/models`, ...train, asyncRoute(handlers.listModels));
  router.delete(`${base}/models/:id`, ...train, asyncRoute(handlers.deleteModel));
  router.post(`${base}/models/:id/onnx`, ...train, asyncRoute(handlers.exportOnnx));
  router.post(`${base}/models/:id/onnx/link`, ...train, asyncRoute(handlers.onnxLink));
  router.post(`${base}/train`, ...train, asyncRoute(handlers.train));
  router.post(`${base}/test`, ...train, upload.array('files', 8), asyncRoute(handlers.test));
  router.get(`${base}/devices`, ...train, asyncRoute(handlers.devices));
  router.get(`${base}/jobs`, ...train, asyncRoute(handlers.listJobs));
  router.get(`${base}/jobs/:id`, ...train, asyncRoute(handlers.getJob));
  router.post(`${base}/jobs/:id/cancel`, ...train, asyncRoute(handlers.cancelJob));

  if (area === 'speech') {
    // whisper.cpp (ggml-*.bin) copies of speech models, for Voice recognition.
    router.post(`${base}/models/:id/ggml`, ...train, asyncRoute(ggmlHandlers.convert));
    router.post(`${base}/models/:id/ggml/link`, ...train, asyncRoute(ggmlHandlers.link));
    router.delete(`${base}/models/:id/ggml`, ...train, asyncRoute(ggmlHandlers.remove));
    router.get(`${base}/ggml-download/:ticket`, asyncRoute(ggmlHandlers.download));
  }
}

export default router;
