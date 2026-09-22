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

/*
 * SVG is the odd one in: it has no pixels at all until something chooses a
 * size, so it is not decoded once and then scaled like the others. The markup
 * is re-rendered at whatever size is being asked for, which is what makes a
 * 16px icon and a 256px icon from the same file both come out sharp instead of
 * one of them being a resampled copy of the other.
 *
 * A browser also has no obligation to tell us how big an SVG "is". Firefox
 * reports nothing at all for a file that carries only a viewBox, so the size
 * is worked out from the markup here rather than read off the decoded image.
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

/** What a browser uses for an <img> that declares no size of its own. */
const SVG_FALLBACK = { width: 300, height: 150 };

export const isSvgFile = (file) => file?.type === 'image/svg+xml'
  || /\.svg$/i.test(file?.name || '');

/** A width/height attribute in px or with no unit; anything else is unusable. */
const svgLength = (value) => {
  const match = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(value || '');
  return match ? Number(match[1]) : 0;
};

/**
 * Reads an SVG and returns its natural size plus a way to render it at any
 * other one.
 *
 * The size comes from `width`/`height` when they are absolute, and from the
 * `viewBox` otherwise — a file carrying only a viewBox is completely ordinary,
 * and is exactly the case a browser declines to measure. A percentage counts
 * as absent, because a percentage of nothing is nothing.
 */
export const readSvg = async (file) => {
  const markup = await file.text();
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = parsed.documentElement;

  if (!root || root.nodeName === 'parsererror' || parsed.querySelector('parsererror')) {
    throw new Error('That file could not be read as SVG.');
  }

  const box = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const hasBox = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0;

  const width = svgLength(root.getAttribute('width')) || (hasBox ? box[2] : 0) || SVG_FALLBACK.width;
  const height = svgLength(root.getAttribute('height')) || (hasBox ? box[3] : 0) || SVG_FALLBACK.height;

  const renderAt = async (targetWidth, targetHeight) => {
    const clone = root.cloneNode(true);

    // Without a viewBox the drawing does not scale with the element: it is
    // handed a bigger canvas and sits in the corner of it at original size.
    if (!hasBox) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    clone.setAttribute('width', String(targetWidth));
    clone.setAttribute('height', String(targetHeight));
    clone.setAttribute('preserveAspectRatio', root.getAttribute('preserveAspectRatio') || 'xMidYMid meet');

    // An SVG lifted out of an HTML page often carries no xmlns, because inside
    // HTML it does not need one. Serialised back out and handed to an <img> it
    // does: without this the browser loads it as unknown XML and draws nothing.
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.src = url;

    try {
      // decode() rather than onload: it resolves only once there are pixels to
      // draw, so revoking the URL straight after cannot race the render.
      if (image.decode) await image.decode();
      else await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('That SVG could not be rendered. Check it for syntax errors or missing fonts.');
    }

    URL.revokeObjectURL(url);
    return image;
  };

  return { width, height, renderAt };
};

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

/*
 * `renderAt` is how a vector source gets a say in each size it is asked for.
 * A raster source has none, and falls back to scaling its one decoded image.
 */
const sourceAt = (image, renderAt, width, height) => (
  renderAt ? renderAt(width, height) : Promise.resolve(image)
);

const toIco = async (image, renderAt, requestedSize) => {
  const largest = Math.min(requestedSize, ICO_MAX);
  const sizes = ICO_SIZES.filter((size) => size <= largest);
  // Always emit something, even for a source smaller than the smallest preset.
  if (!sizes.length) sizes.push(largest);

  const entries = await Promise.all(sizes.map(async (size) => {
    // Every size is taken from the source, which for an SVG means each icon in
    // the file is drawn at its own resolution rather than downsampled from the
    // largest one. The difference is plainly visible at 16px.
    const drawn = await sourceAt(image, renderAt, size, size);
    const blob = await canvasToBlob(rasterise(drawn, size, size, null), 'image/png');
    return { size, bytes: new Uint8Array(await blob.arrayBuffer()) };
  }));

  return buildIco(entries);
};

const toGif = async (image, renderAt, width, height, background) => {
  // Lazily loaded, and by absolute URL from /public — @vite-ignore keeps the
  // bundler from trying to resolve it at build time.
  const { GIFEncoder, quantize, applyPalette } = await import(/* @vite-ignore */ GIFENC_URL);

  const drawn = await sourceAt(image, renderAt, width, height);
  const canvas = rasterise(drawn, width, height, background);
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
 * @param image        a loaded HTMLImageElement
 * @param renderAt     optional (w, h) => Promise<image>, for vector sources
 * @param format       one of IMAGE_FORMATS[].value
 * @param width/height target size in pixels
 * @param quality      0..1, JPG only
 * @param background   CSS colour to flatten onto; null keeps transparency
 * @returns {Promise<Blob>}
 */
export const convertImage = async ({
  image,
  renderAt = null,
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
      return canvasToBlob(
        rasterise(await sourceAt(image, renderAt, outWidth, outHeight), outWidth, outHeight, null),
        'image/png',
      );

    case 'jpg':
      // background is never null here: JPG cannot represent transparency.
      return canvasToBlob(
        rasterise(
          await sourceAt(image, renderAt, outWidth, outHeight),
          outWidth,
          outHeight,
          background || '#ffffff',
        ),
        'image/jpeg',
        quality,
      );

    case 'ico':
      // Icons are square by definition; the longer side decides the size.
      return toIco(image, renderAt, Math.max(outWidth, outHeight));

    case 'gif':
      return toGif(image, renderAt, outWidth, outHeight, background);

    default:
      throw new Error(`Unknown output format "${format}".`);
  }
};

/**
 * Decode a File into an HTMLImageElement, with its object URL for preview.
 *
 * An SVG also comes back with `renderAt`, which the converter uses in place of
 * scaling: the vector is re-drawn at each output size it is asked for.
 */
export const loadImageFile = async (file) => {
  if (isSvgFile(file)) {
    const { width, height, renderAt } = await readSvg(file);
    return {
      image: await renderAt(width, height),
      // The preview shows the original file, so the panel displays the vector
      // itself rather than a raster of it.
      url: URL.createObjectURL(file),
      width,
      height,
      renderAt,
      vector: true,
    };
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => resolve({
      image,
      url,
      width: image.naturalWidth,
      height: image.naturalHeight,
      renderAt: null,
      vector: false,
    });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be decoded as an image.'));
    };

    image.src = url;
  });
};
