/*
 * SAM2 (Segment Anything 2) for the YOLO Labelling tab: the server outlines
 * the object at a click or in a box, or finds every region in the image
 * (backend/src/helpers/samSegment.js).
 *
 * The images being labelled stay on this computer, so each request carries
 * the one on screen. SAM2 looks at 1024 pixels at most, so the image is
 * scaled to that first — a phone photo goes from megabytes to a couple of
 * hundred kilobytes — and the scaled copy is kept per file, so every click on
 * an image sends the same bytes and the server can reuse its encoding of it.
 * Coordinates are fractions of the image either way, so scaling changes none.
 */
import api from '../api';

const MAX_SIDE = 1024;
const scaled = new WeakMap();

const newId = () => (window.crypto?.randomUUID
  ? window.crypto.randomUUID()
  : `s${Date.now()}${Math.random().toString(16).slice(2, 8)}`);

/** The image as a JPEG no larger than SAM2's input, made once per file. */
export const samImage = (file) => {
  if (!scaled.has(file)) {
    scaled.set(file, (async () => {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be prepared.'))), 'image/jpeg', 0.92);
      });
    })());
    // A failure is not kept: the next try starts again.
    scaled.get(file).catch(() => scaled.delete(file));
  }
  return scaled.get(file);
};

export const samStatus = async () => (await api.get('/tools/yolo/sam/status')).data;

/**
 * Regions in `file`: { mode: 'auto' } for every region, or { points: [[x, y, 1|0]], box: [x1, y1, x2, y2] }
 * for one object. Resolves to { regions: [{ box: [x, y, w, h], polygon, score, area }], took, model }.
 */
export const samSegment = async (file, { mode = 'prompt', points, box } = {}) => {
  const form = new FormData();
  form.append('image', await samImage(file), 'image.jpg');
  form.append('mode', mode);
  if (points) form.append('points', JSON.stringify(points));
  if (box) form.append('box', JSON.stringify(box));
  return (await api.post('/tools/yolo/sam', form, { timeout: 200 * 1000 })).data;
};

/**
 * A region as a shape of the labelling tool: a polygon for segmentation, a
 * box for detection. `auto` marks one found by "Detect regions" and not yet
 * looked at.
 */
export const regionToShape = (region, shapeKind, classId, auto = false) => {
  const [x, y, w, h] = region.box;
  const shape = shapeKind === 'polygon'
    ? { id: newId(), type: 'polygon', classId, points: region.polygon }
    : { id: newId(), type: 'box', classId, x, y, w, h };
  return auto ? { ...shape, auto: true } : shape;
};
