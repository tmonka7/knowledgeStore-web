// Text recognition (OCR) for Tools > AI > OCR, with PaddleOCR's PP-OCRv5.
//
// backend/python/ocr_worker.py keeps the models loaded between requests. The
// models are the ones download_models.py fetches (`paddleocr`, and optionally
// `paddleocr-server`), each a folder in models/base marked task "ocr" with its
// role in the pipeline: "det" finds the lines of text, "rec" reads them, and
// "textline" turns upside-down lines the right way up. A recognition model
// reads a set of languages; the page picks one by language. "layout" finds a
// page's titles, tables and figures and "table" rebuilds each table, so the
// page can be shown as it was laid out.
//
// The page reads a file as a job (startRecognition): the worker sends each
// page as soon as it is read, the job collects them, and the page polls for
// the ones it does not have yet — so a long PDF shows its progress and its
// first pages while the rest are read, and can be cancelled.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createPythonWorker } from './pythonWorker.js';
import { JobError, findModel, listModels } from './translationJobs.js';

export const TASK = 'ocr';

/** The languages the page offers, and the order it offers them in. */
export const OCR_LANGUAGES = ['en', 'zh', 'ko', 'ja', 'ru'];

const worker = createPythonWorker({
  script: 'ocr_worker.py',
  label: 'OCR',
  // The worker sees only the variables it is given (see childEnv).
  env: {
    OCR_ENGINE: process.env.OCR_ENGINE || '',
    OCR_LAYOUT_THREADS: process.env.OCR_LAYOUT_THREADS || '',
    OCR_MKLDNN: process.env.OCR_MKLDNN || '',
  },
  idleMs: Math.max(60, Number(process.env.OCR_IDLE_SECONDS) || 600) * 1000,
  maxWaiting: Math.max(1, Number(process.env.OCR_MAX_QUEUE) || 16),
});

// The worker loads PaddlePaddle after saying it is ready, so the first
// request after a start waits for that too: minutes on a slow server.
const REQUEST_MS = Math.max(60, Number(process.env.OCR_REQUEST_SECONDS) || 300) * 1000;
// A PDF is read page by page: only its first OCR_MAX_PAGES pages, each given
// up to OCR_PAGE_SECONDS on top of the request's own time.
export const MAX_PAGES = Math.min(500, Math.max(1, Number(process.env.OCR_MAX_PAGES) || 30));
const PAGE_MS = Math.max(5, Number(process.env.OCR_PAGE_SECONDS) || 60) * 1000;

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
  const mobileFirst = (a, b) => (a.variant === 'server') - (b.variant === 'server');
  const detection = byRole('det').sort(mobileFirst);
  return {
    detection, recognition, textline: byRole('textline'), layout: byRole('layout').sort(mobileFirst), table: byRole('table'), languages,
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
  return { installed, engine, maxPages: MAX_PAGES, ...models };
};

const pick = async (id, role) => {
  const model = await findModel('', String(id), TASK);
  if (model.ocrRole !== role) throw new JobError('That model cannot be used for this step.', 400);
  return model;
};

/**
 * Read the text in an image, or in each page of a PDF (`pdf`). `language`
 * picks the recognition model unless `recognitionId` names one;
 * `detectionId` defaults to the mobile detector; `rotated` adds the
 * text-line orientation classifier; `layout` (on unless false, when the
 * server has the models) also finds titles, tables and figures. The result
 * has one entry in `pages` per page read; a PDF's pages carry a preview image
 * to draw the boxes on.
 *
 * `onStart({ total, pageCount })` and `onPage(page, done, total)` report
 * progress; `id` and `isCancelled` let a job cancel the request.
 */
const runRecognition = async (filePath, {
  language, recognitionId, detectionId, rotated, pdf = false, layout: withLayout = true,
} = {}, {
  id, onStart, onPage, isCancelled,
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
  const layout = withLayout && models.layout.length ? await pick(models.layout[0].id, 'layout') : null;
  const table = layout && models.table.length ? await pick(models.table[0].id, 'table') : null;

  const pages = [];
  const result = await worker.request({
    image: filePath,
    pdf,
    maxPages: MAX_PAGES,
    det: det.folder,
    rec: rec.folder,
    textline: textline?.folder || null,
    layout: layout?.folder || null,
    table: table?.folder || null,
  }, pdf ? REQUEST_MS + MAX_PAGES * PAGE_MS : REQUEST_MS, 'OCR is busy; try again in a moment.', {
    id,
    isCancelled,
    onProgress: (message) => {
      if (message.page) {
        pages.push(message.page);
        onPage?.(message.page, message.done, message.total);
      } else {
        onStart?.({ total: message.total, pageCount: message.pageCount });
      }
    },
  });
  return {
    pages,
    pageCount: result.pageCount || 1,
    took: result.took,
    language: code,
    models: {
      detection: det.id, recognition: rec.id, textline: textline?.id || null, layout: layout?.id || null, table: table?.id || null,
    },
  };
};

/** Read a file and wait for all of it; see runRecognition. */
export const recognizeText = (filePath, options = {}) => runRecognition(filePath, options);

/* --------------------------------------------------------------------- jobs */

// Finished jobs are kept this long for the page to collect the last pages.
const KEEP_FINISHED_MS = 10 * 60 * 1000;
const jobs = new Map();

const pruneJobs = () => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && now - job.finishedAt > KEEP_FINISHED_MS) jobs.delete(id);
  }
};

/** A job as the page sees it, with the pages from `from` on (those it lacks). */
const publicJob = (job, from = 0) => ({
  id: job.id,
  status: job.status,
  pdf: job.pdf,
  done: job.done,
  total: job.total,
  pageCount: job.pageCount,
  from,
  pages: job.pages.slice(from),
  error: job.error,
  took: job.took,
  language: job.language,
  models: job.models,
});

const ownJob = (ownerId, id) => {
  const job = jobs.get(String(id || ''));
  if (!job || job.ownerId !== ownerId) throw new JobError('That OCR job was not found. It may have finished long ago.', 404);
  return job;
};

/**
 * Start reading an uploaded file; it is deleted when the job ends. Throws at
 * once for what can be checked up front (no models, an unknown model), and
 * refuses a second job while the account has one running.
 */
export const startRecognition = async (ownerId, filePath, options = {}) => {
  pruneJobs();
  if ([...jobs.values()].some((job) => job.ownerId === ownerId && job.status === 'running')) {
    throw new JobError('You are already reading a file. Wait for it to finish, or cancel it.', 429);
  }
  const models = await ocrModels();
  if (!models.detection.length || !models.recognition.length) {
    throw new JobError('No OCR models on the server. An administrator runs: python backend/python/download_models.py paddleocr', 503);
  }
  const job = {
    id: randomUUID(),
    ownerId,
    status: 'running',
    pdf: Boolean(options.pdf),
    done: 0,
    total: options.pdf ? null : 1,
    pageCount: options.pdf ? null : 1,
    pages: [],
    error: '',
    took: null,
    language: OCR_LANGUAGES.includes(options.language) ? options.language : 'en',
    models: null,
    finishedAt: 0,
  };
  jobs.set(job.id, job);

  const running = () => job.status === 'running';
  runRecognition(filePath, options, {
    id: job.id,
    isCancelled: () => !running(),
    onStart: ({ total, pageCount }) => {
      if (running()) Object.assign(job, { total, pageCount });
    },
    onPage: (page, done) => {
      if (!running()) return;
      job.pages.push(page);
      job.done = done;
    },
  }).then((result) => {
    if (!running()) return;
    Object.assign(job, { status: 'succeeded', took: result.took, models: result.models });
  }, (error) => {
    if (!running()) return;
    Object.assign(job, { status: 'failed', error: error.message });
  }).finally(() => {
    job.finishedAt = Date.now();
    fs.unlink(filePath).catch(() => {});
  });
  return publicJob(job);
};

export const getRecognition = (ownerId, id, from = 0) => publicJob(ownJob(ownerId, id), Math.max(0, Number(from) || 0));

/** Stop a job: at once for the page, after the page being read for the worker. */
export const cancelRecognition = (ownerId, id) => {
  const job = ownJob(ownerId, id);
  if (job.status === 'running') {
    Object.assign(job, { status: 'cancelled', finishedAt: Date.now() });
    worker.notify({ cancel: job.id });
  }
  return publicJob(job, job.pages.length);
};
