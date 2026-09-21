/**
 * Image format conversion, entirely in the browser.
 *
 * JPG and PNG are native canvas encoders. ICO and GIF are not — no browser can
 * encode either — so:
 *
 *   ICO  is assembled here. The container is a short header around one or more
 *        embedded PNGs, which Windows has accepted since Vista.
 *   GIF  uses gifenc (MIT), vendored at /public/gifenc and imported lazily, so
 *        its 9 KB only loads when someone actually picks GIF.
 *
 * Video is not handled here; it goes to the API, which has ffmpeg.
 */

export const IMAGE_FORMATS = [
  { value: 'png', label: 'PNG', extension: 'png', mime: 'image/png', hint: 'Lossless, keeps transparency.' },
  { value: 'jpg', label: 'JPG', extension: 'jpg', mime: 'image/jpeg', hint: 'Lossy, no transparency — flattened onto the background colour.' },
  { value: 'ico', label: 'ICO', extension: 'ico', mime: 'image/x-icon', hint: 'Windows icon. Packs every standard size up to 256px into one file.' },
  { value: 'gif', label: 'GIF', extension: 'gif', mime: 'image/gif', hint: '256 colours, 1-bit transparency.' },
];

/** The sizes a favicon or app icon is actually asked for. */
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

/** ICO stores each side in one byte, and encodes 256 as 0. */
const ICO_MAX = 256;

const GIFENC_URL = '/gifenc/gifenc.esm.js';

/** Draw `image` into a fresh canvas at the given size, optionally flattened. */
const rasterise = (image, width, height, background) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (background) {
    // JPG has no alpha; without this, transparent pixels come out black.
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas;
};

const canvasToBlob = (canvas, mime, quality) => new Promise((resolve, reject) => {
  canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error(`This browser could not encode ${mime}.`))),
    mime,
    quality,
  );
});

/** True when any pixel is not fully opaque. */
const hasTransparency = (rgba) => {
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] < 255) return true;
  }
  return false;
};

/**
 * Wrap already-encoded PNGs in an ICO container.
 *
 * Layout: a 6-byte ICONDIR, then one 16-byte ICONDIRENTRY per image, then the
 * PNG payloads. Each entry points at its payload by absolute file offset.
 */
const buildIco = (entries) => {
  const headerSize = 6 + entries.length * 16;
  const totalSize = entries.reduce((sum, entry) => sum + entry.bytes.byteLength, headerSize);

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const output = new Uint8Array(buffer);

  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // 1 = icon (2 would be cursor)
  view.setUint16(4, entries.length, true);

  let offset = headerSize;
  entries.forEach((entry, index) => {
    const base = 6 + index * 16;
    // 256 does not fit in a byte and is written as 0 by convention.
    view.setUint8(base + 0, entry.size >= ICO_MAX ? 0 : entry.size);
    view.setUint8(base + 1, entry.size >= ICO_MAX ? 0 : entry.size);
    view.setUint8(base + 2, 0); // palette size; 0 for true colour
    view.setUint8(base + 3, 0); // reserved
    view.setUint16(base + 4, 1, true); // colour planes
    view.setUint16(base + 6, 32, true); // bits per pixel
    view.setUint32(base + 8, entry.bytes.byteLength, true);
    view.setUint32(base + 12, offset, true);

    output.set(entry.bytes, offset);
    offset += entry.bytes.byteLength;
  });

  return new Blob([buffer], { type: 'image/x-icon' });
};

const toIco = async (image, requestedSize) => {
  const largest = Math.min(requestedSize, ICO_MAX);
  const sizes = ICO_SIZES.filter((size) => size <= largest);
  // Always emit something, even for a source smaller than the smallest preset.
  if (!sizes.length) sizes.push(largest);

  const entries = await Promise.all(sizes.map(async (size) => {
    const blob = await canvasToBlob(rasterise(image, size, size, null), 'image/png');
    return { size, bytes: new Uint8Array(await blob.arrayBuffer()) };
  }));

  return buildIco(entries);
};

const toGif = async (image, width, height, background) => {
  // Lazily loaded, and by absolute URL from /public — @vite-ignore keeps the
  // bundler from trying to resolve it at build time.
  const { GIFEncoder, quantize, applyPalette } = await import(/* @vite-ignore */ GIFENC_URL);

  const canvas = rasterise(image, width, height, background);
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);

  // GIF carries 1-bit transparency, which needs a palette format that keeps an
  // alpha channel. Opaque images use the tighter rgb565 palette instead.
  const transparent = !background && hasTransparency(data);
  const format = transparent ? 'rgba4444' : 'rgb565';

  const palette = quantize(data, 256, { format });
  const index = applyPalette(data, palette, format);

  const encoder = GIFEncoder();
  encoder.writeFrame(index, width, height, { palette, transparent });
  encoder.finish();

  return new Blob([encoder.bytes()], { type: 'image/gif' });
};

/**
 * Convert a decoded image to one of IMAGE_FORMATS.
 *
 * @param image       a loaded HTMLImageElement
 * @param format      one of IMAGE_FORMATS[].value
 * @param width/height target size in pixels
 * @param quality     0..1, JPG only
 * @param background  CSS colour to flatten onto; null keeps transparency
 * @returns {Promise<Blob>}
 */
export const convertImage = async ({
  image,
  format,
  width,
  height,
  quality = 0.92,
  background = '#ffffff',
}) => {
  const outWidth = Math.max(1, Math.round(width));
  const outHeight = Math.max(1, Math.round(height));

  switch (format) {
    case 'png':
      return canvasToBlob(rasterise(image, outWidth, outHeight, null), 'image/png');

    case 'jpg':
      // background is never null here: JPG cannot represent transparency.
      return canvasToBlob(
        rasterise(image, outWidth, outHeight, background || '#ffffff'),
        'image/jpeg',
        quality,
      );

    case 'ico':
      // Icons are square by definition; the longer side decides the size.
      return toIco(image, Math.max(outWidth, outHeight));

    case 'gif':
      return toGif(image, outWidth, outHeight, background);

    default:
      throw new Error(`Unknown output format "${format}".`);
  }
};

/** Decode a File into an HTMLImageElement, with its object URL for preview. */
export const loadImageFile = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();

  image.onload = () => resolve({ image, url, width: image.naturalWidth, height: image.naturalHeight });
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('That file could not be decoded as an image.'));
  };

  image.src = url;
});
