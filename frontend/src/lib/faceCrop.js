/** Canvas helpers for turning a normalised crop rect into a stored face image. */

import { sourceSize } from './faceDetector';

export const clampRect = (rect) => {
  const width = Math.min(Math.max(rect.width, 0.05), 1);
  const height = Math.min(Math.max(rect.height, 0.05), 1);
  return {
    x: Math.min(Math.max(rect.x, 0), 1 - width),
    y: Math.min(Math.max(rect.y, 0), 1 - height),
    width,
    height,
  };
};

/** Grows a rect by `ratio` on every side, clamped to the frame. */
export const padRect = (rect, ratio = 0.35) => clampRect({
  x: rect.x - rect.width * ratio,
  y: rect.y - rect.height * ratio,
  width: rect.width * (1 + ratio * 2),
  height: rect.height * (1 + ratio * 2),
});

/**
 * Draws the normalised rect of `source` into a canvas, capped at `maxSize` on
 * the long edge so stored images stay small.
 */
export const cropToCanvas = (source, rect, maxSize = 512) => {
  const { width, height } = sourceSize(source);
  if (!width || !height) throw new Error('The image is not ready yet.');

  const safe = clampRect(rect);
  const sx = Math.round(safe.x * width);
  const sy = Math.round(safe.y * height);
  const sw = Math.max(1, Math.round(safe.width * width));
  const sh = Math.max(1, Math.round(safe.height * height));

  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));

  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
};

export const canvasToDataUrl = (canvas, quality = 0.86) => canvas.toDataURL('image/jpeg', quality);

/** Loads a File into an <img>, revoking the object URL either way. */
export const imageFromFile = (file) => new Promise((resolve, reject) => {
  const image = new Image();
  const url = URL.createObjectURL(file);
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('That file could not be read as an image.'));
  };
  image.src = url;
});

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

export const validateImageFile = (file) => {
  if (!file) return 'No file selected.';
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'Please choose a JPG, PNG or WEBP image.';
  if (file.size > 12 * 1024 * 1024) return 'That image is larger than 12 MB. Please choose a smaller file.';
  return '';
};
