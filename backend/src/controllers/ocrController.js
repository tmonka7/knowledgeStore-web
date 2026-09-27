// Text recognition (PaddleOCR) for Tools > AI > OCR.

import fs from 'node:fs/promises';
import { ocrStatus, recognizeText } from '../helpers/ocr.js';
import { JobError } from '../helpers/translationJobs.js';

export const status = async (req, res) => res.json(await ocrStatus());

/** POST /tools/ocr/recognize — multipart "image", with "language", "recognitionId", "detectionId", "rotated". */
export const recognize = async (req, res) => {
  if (!req.file) throw new JobError('No image was sent.');
  try {
    if (!String(req.file.mimetype || '').startsWith('image/')) throw new JobError('Send an image (PNG, JPEG, BMP or WebP).');
    const body = req.body || {};
    res.json(await recognizeText(req.file.path, {
      language: String(body.language || ''),
      recognitionId: body.recognitionId ? String(body.recognitionId) : '',
      detectionId: body.detectionId ? String(body.detectionId) : '',
      rotated: body.rotated === 'true' || body.rotated === '1',
    }));
  } finally {
    await fs.unlink(req.file.path).catch(() => {});
  }
};
