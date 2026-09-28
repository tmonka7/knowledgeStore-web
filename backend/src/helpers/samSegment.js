// SAM2 (Segment Anything 2) for the YOLO page's Labelling tab.
//
// backend/python/sam_worker.py stays running and answers two kinds of
// request about one image: "prompt" — the object at the points clicked (and
// not at the points marked as background) or inside a box — and "auto",
// every region it can find. Each answer is a list of regions, each an
// outline and a box as fractions of the image, which the page turns into
// polygons or boxes of the class being labelled.
//
// The images being labelled are on the person's computer, not the server:
// the page sends the one it is showing, scaled down to SAM2's own input size,
// with every request. The worker keeps the last few images' encodings by
// their bytes, so the second click on an image costs a small fraction of the
// first.
//
// The model is the first base model of task "sam" (download_models.py
// sam2.1_t, or _s/_b/_l).

import { createPythonWorker } from './pythonWorker.js';
import { JobError, findModel, listModels } from './translationJobs.js';

export const TASK = 'sam';
const MAX_POINTS = 32;

const worker = createPythonWorker({
  script: 'sam_worker.py',
  label: 'SAM2',
  idleMs: Math.max(60, Number(process.env.SAM_IDLE_SECONDS) || 600) * 1000,
  maxWaiting: Math.max(1, Number(process.env.SAM_MAX_QUEUE) || 8),
});

/** The SAM2 model on the server, with its folder, or null. */
const samModel = async () => {
  const model = (await listModels('', TASK)).find((item) => item.kind === 'base');
  return model ? findModel('', model.id, TASK) : null;
};

/**
 * Whether SAM2 can run here: { available, model } or { available: false, message }.
 * Starting the worker is left to the first request, so opening the page costs nothing.
 */
export const samStatus = async () => {
  const model = await samModel();
  if (!model) {
    return {
      available: false,
      message: 'SAM2 is not installed on the server. An administrator runs: python backend/python/download_models.py sam2.1_t',
    };
  }
  return { available: true, model: { id: model.id, name: model.name } };
};

const fraction = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new JobError('Points and boxes are fractions of the image, from 0 to 1.');
  return Math.min(1, Math.max(0, number));
};

/** Points [[x, y, 1 | 0], ...] and a box [x1, y1, x2, y2] from the request, checked. */
const readPrompt = (points, box) => {
  const cleanPoints = (Array.isArray(points) ? points : []).slice(0, MAX_POINTS).map((point) => {
    if (!Array.isArray(point) || point.length < 2) throw new JobError('A point is [x, y] or [x, y, label].');
    return [fraction(point[0]), fraction(point[1]), point[2] === 0 || point[2] === '0' ? 0 : 1];
  });
  let cleanBox = null;
  if (Array.isArray(box) && box.length === 4) {
    const [x1, y1, x2, y2] = box.map(fraction);
    cleanBox = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  }
  if (!cleanPoints.some((point) => point[2] === 1) && !cleanBox) {
    throw new JobError('Click on the object, or draw a box around it.');
  }
  return { points: cleanPoints, box: cleanBox };
};

/**
 * Regions in one image (`imagePath`, a temporary upload): mode "prompt" with
 * points and/or a box, or mode "auto". Resolves to { width, height, took, regions }.
 */
export const segmentImage = async ({ imagePath, mode, points, box, maxRegions }) => {
  const model = await samModel();
  if (!model) throw new JobError((await samStatus()).message, 503);
  const auto = mode === 'auto';
  const request = {
    model: model.folder,
    image: imagePath,
    mode: auto ? 'auto' : 'prompt',
    ...(auto
      ? { maxRegions: Math.round(Math.min(200, Math.max(1, Number(maxRegions) || 40))) }
      : readPrompt(points, box)),
  };
  // "auto" decodes up to a few hundred prompts: seconds on a GPU, up to half a minute on a CPU.
  const reply = await worker.request(request, (auto ? 180 : 60) * 1000,
    'SAM2 is busy with other images; try again in a moment.');
  const { id: _id, ok: _ok, ...result } = reply;
  return { ...result, model: model.name };
};
