// SAM2 on the YOLO Labelling tab (helpers/samSegment.js).

import fs from 'node:fs/promises';
import { samStatus, segmentImage } from '../helpers/samSegment.js';
import { JobError } from '../helpers/translationJobs.js';

/** GET /tools/yolo/sam/status — { available, model } or { available: false, message }. */
export const status = async (req, res) => res.json(await samStatus());

const parseJson = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    throw new JobError('The prompt is not valid JSON.');
  }
};

/**
 * POST /tools/yolo/sam — multipart "image" (the picture being labelled), and
 * mode "auto", or mode "prompt" with points (JSON [[x, y, 1|0], ...]) and/or
 * box (JSON [x1, y1, x2, y2]), all fractions of the image.
 */
export const segment = async (req, res) => {
  if (!req.file) throw new JobError('No image was sent.');
  try {
    res.json(await segmentImage({
      imagePath: req.file.path,
      mode: String(req.body?.mode || 'prompt'),
      points: parseJson(req.body?.points, []),
      box: parseJson(req.body?.box, null),
      maxRegions: req.body?.maxRegions,
    }));
  } finally {
    await fs.rm(req.file.path, { force: true });
  }
};
