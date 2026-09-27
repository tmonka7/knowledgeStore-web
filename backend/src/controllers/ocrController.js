// Text recognition (PaddleOCR) for Tools > AI > OCR.

import fs from 'node:fs/promises';
import {
  cancelRecognition, getRecognition, ocrStatus, startRecognition,
} from '../helpers/ocr.js';
import { JobError } from '../helpers/translationJobs.js';

export const status = async (req, res) => res.json(await ocrStatus());

/**
 * POST /tools/ocr/recognize — multipart "image" (an image or a PDF), with
 * "language", "recognitionId", "detectionId", "rotated", "layout". Starts a job and
 * answers 202 with it; the job deletes the file when it ends.
 */
export const recognize = async (req, res) => {
  if (!req.file) throw new JobError('No image or PDF was sent.');
  try {
    const type = String(req.file.mimetype || '');
    const pdf = type === 'application/pdf';
    if (!pdf && !type.startsWith('image/')) throw new JobError('Send an image (PNG, JPEG, BMP or WebP) or a PDF.');
    const body = req.body || {};
    const job = await startRecognition(req.user.sub, req.file.path, {
      pdf,
      language: String(body.language || ''),
      recognitionId: body.recognitionId ? String(body.recognitionId) : '',
      detectionId: body.detectionId ? String(body.detectionId) : '',
      rotated: body.rotated === 'true' || body.rotated === '1',
      layout: body.layout !== 'false' && body.layout !== '0',
    });
    res.status(202).json({ job });
  } catch (error) {
    // Not started, so nothing else will remove it.
    await fs.unlink(req.file.path).catch(() => {});
    throw error;
  }
};

/** GET /tools/ocr/jobs/:id?from=N — the job, with the pages from N on. */
export const job = (req, res) => res.json({ job: getRecognition(req.user.sub, req.params.id, req.query.from) });

/** POST /tools/ocr/jobs/:id/cancel */
export const cancel = (req, res) => res.json({ job: cancelRecognition(req.user.sub, req.params.id) });
