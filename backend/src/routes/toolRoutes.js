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
import { mlHandlers } from '../controllers/mlController.js';
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
}

export default router;
