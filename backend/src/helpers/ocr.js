// Text recognition (OCR) for Tools > AI > OCR, with PaddleOCR's PP-OCRv5.
//
// backend/python/ocr_worker.py keeps the models loaded between requests. The
// models are the ones download_models.py fetches (`paddleocr`, and optionally
// `paddleocr-server`), each a folder in models/base marked task "ocr" with its
// role in the pipeline: "det" finds the lines of text, "rec" reads them, and
// "textline" turns upside-down lines the right way up. A recognition model
// reads a set of languages; the page picks one by language.

import { createPythonWorker } from './pythonWorker.js';
import { JobError, findModel, listModels } from './translationJobs.js';

export const TASK = 'ocr';

/** The languages the page offers, and the order it offers them in. */
export const OCR_LANGUAGES = ['en', 'zh', 'ko', 'ja', 'ru'];

const worker = createPythonWorker({
  script: 'ocr_worker.py',
  label: 'OCR',
  idleMs: Math.max(60, Number(process.env.OCR_IDLE_SECONDS) || 600) * 1000,
  maxWaiting: Math.max(1, Number(process.env.OCR_MAX_QUEUE) || 16),
});

// The worker loads PaddlePaddle after saying it is ready, so the first
// request after a start waits for that too: minutes on a slow server.
const REQUEST_MS = Math.max(60, Number(process.env.OCR_REQUEST_SECONDS) || 300) * 1000;

const publicModel = (model) => ({
  id: model.id,
  name: model.id,
  role: model.ocrRole,
  variant: model.variant || null,
  languages: model.languages || [],
});

/*
 * The models on the server, by role. A recognition model made for one
 * language is preferred for it over one that also reads it (the English
 * model over the Chinese one, which reads English too), and a server model
 * over a mobile one.
 */
const ocrModels = async () => {
  const models = (await listModels('', TASK)).filter((model) => model.kind === 'base').map(publicModel);
  const rank = (model, language) => (model.languages[0] === language ? 0 : 2) + (model.variant === 'server' ? 0 : 1);
  const byRole = (role) => models.filter((model) => model.role === role);
  const recognition = byRole('rec');
  const languages = OCR_LANGUAGES.map((code) => {
    const readers = recognition.filter((model) => model.languages.includes(code))
      .sort((a, b) => rank(a, code) - rank(b, code));
    return { code, models: readers.map((model) => model.id), default: readers[0]?.id || null };
  });
  const detection = byRole('det').sort((a, b) => (a.variant === 'server') - (b.variant === 'server'));
  return {
    detection, recognition, textline: byRole('textline'), languages,
  };
};

export const ocrStatus = async () => {
  const models = await ocrModels();
  const installed = models.detection.length > 0 && models.recognition.length > 0;
  let engine = { ok: true, message: '' };
  if (installed) {
    try {
      const info = await worker.ready();
      engine = { ok: true, message: '', paddle: info.paddle, paddleocr: info.paddleocr };
    } catch (error) {
      engine = { ok: false, message: error.message };
    }
  }
  return { installed, engine, ...models };
};

const pick = async (id, role) => {
  const model = await findModel('', String(id), TASK);
  if (model.ocrRole !== role) throw new JobError('That model cannot be used for this step.', 400);
  return model;
};

/**
 * Read the text in one image. `language` picks the recognition model unless
 * `recognitionId` names one; `detectionId` defaults to the mobile detector;
 * `rotated` adds the text-line orientation classifier.
 */
export const recognizeText = async (imagePath, {
  language, recognitionId, detectionId, rotated,
} = {}) => {
  const models = await ocrModels();
  if (!models.detection.length || !models.recognition.length) {
    throw new JobError('No OCR models on the server. An administrator runs: python backend/python/download_models.py paddleocr', 503);
  }
  const code = OCR_LANGUAGES.includes(language) ? language : 'en';
  const recId = recognitionId || models.languages.find((item) => item.code === code)?.default;
  if (!recId) throw new JobError(`No OCR model on the server reads ${code}.`, 400);
  const rec = await pick(recId, 'rec');
  const det = await pick(detectionId || models.detection[0].id, 'det');
  const textline = rotated && models.textline.length ? await pick(models.textline[0].id, 'textline') : null;

  const result = await worker.request({
    image: imagePath, det: det.folder, rec: rec.folder, textline: textline?.folder || null,
  }, REQUEST_MS, 'OCR is busy; try again in a moment.');
  return {
    lines: result.lines || [],
    width: result.width,
    height: result.height,
    took: result.took,
    language: code,
    models: { detection: det.id, recognition: rec.id, textline: textline?.id || null },
  };
};
