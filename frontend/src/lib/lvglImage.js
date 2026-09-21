/**
 * LVGL **v9** image → C array conversion, in the browser.
 *
 * Ported from scripts/LVGLImage.py in the lvgl repository, which is the
 * official converter for v9 and what lvgl.io/tools/imageconverter runs. The
 * older lv_img_conv project targets LVGL v8 and emits a completely different
 * file — `lv_img_dsc_t` with `LV_IMG_CF_*` constants, a `header.always_zero`
 * field, and true-colour data repeated behind `#if LV_COLOR_DEPTH` guards.
 * None of that compiles against v9, so none of it is produced here.
 *
 * v9 output instead declares `lv_image_dsc_t` with an explicit
 * `LV_COLOR_FORMAT_*`, a stride, and a single copy of the data.
 *
 * One deliberate difference from upstream: LVGLImage.py only accepts an
 * already-palettised PNG for the I1/I2/I4/I8 formats. A browser tool is handed
 * arbitrary images, so the palette is built here with gifenc (vendored at
 * /public/gifenc, imported lazily). The emitted bytes still match the v9
 * layout exactly.
 */

/** Values are the LVGL v9 `lv_color_format_t` enum, for the binary header. */
export const COLOR_FORMAT_VALUES = {
  L8: 0x06,
  I1: 0x07,
  I2: 0x08,
  I4: 0x09,
  I8: 0x0a,
  A1: 0x0b,
  A2: 0x0c,
  A4: 0x0d,
  A8: 0x0e,
  RGB888: 0x0f,
  ARGB8888: 0x10,
  XRGB8888: 0x11,
  RGB565: 0x12,
  ARGB8565: 0x13,
  RGB565A8: 0x14,
  AL88: 0x15,
  RGB565_SWAPPED: 0x1b,
};

const BITS_PER_PIXEL = {
  L8: 8,
  I1: 1,
  I2: 2,
  I4: 4,
  I8: 8,
  A1: 1,
  A2: 2,
  A4: 4,
  A8: 8,
  AL88: 16,
  ARGB8888: 32,
  XRGB8888: 32,
  RGB565: 16,
  RGB565_SWAPPED: 16,
  RGB565A8: 16, // the A8 plane is appended after the RGB565 plane
  ARGB8565: 24,
  RGB888: 24,
};

/** Palette entry count for the indexed formats. */
const PALETTE_SIZE = { I1: 2, I2: 4, I4: 16, I8: 256 };

const TRUE_COLOR = ['ARGB8888', 'XRGB8888', 'RGB888', 'RGB565', 'RGB565_SWAPPED', 'RGB565A8', 'ARGB8565'];
const ALPHA_ONLY = ['A1', 'A2', 'A4', 'A8'];
const INDEXED = ['I1', 'I2', 'I4', 'I8'];

/** Formats offered in the UI, grouped the way LVGL documents them. */
export const COLOR_FORMATS = [
  { value: 'ARGB8888', label: 'ARGB8888', group: 'True colour', hint: '32-bit with alpha. Largest, and the most faithful.' },
  { value: 'XRGB8888', label: 'XRGB8888', group: 'True colour', hint: '32-bit, alpha byte fixed at 0xFF. Flattened onto the background.' },
  { value: 'RGB888', label: 'RGB888', group: 'True colour', hint: '24-bit, no alpha. Flattened onto the background.' },
  { value: 'RGB565', label: 'RGB565', group: 'True colour', hint: '16-bit, no alpha. The usual choice for embedded displays.' },
  { value: 'RGB565_SWAPPED', label: 'RGB565 (byte-swapped)', group: 'True colour', hint: 'RGB565 with the two bytes swapped, for big-endian panels.' },
  { value: 'RGB565A8', label: 'RGB565A8', group: 'True colour', hint: '16-bit colour plus a separate 8-bit alpha plane.' },
  { value: 'ARGB8565', label: 'ARGB8565', group: 'True colour', hint: '24-bit: RGB565 plus an inline alpha byte.' },
  { value: 'L8', label: 'L8', group: 'Greyscale', hint: '8-bit luminance, no alpha.' },
  { value: 'AL88', label: 'AL88', group: 'Greyscale', hint: '8-bit luminance plus 8-bit alpha.' },
  { value: 'A8', label: 'A8', group: 'Alpha only', hint: 'Mask, 256 levels. Colour comes from the widget style.' },
  { value: 'A4', label: 'A4', group: 'Alpha only', hint: 'Mask, 16 levels.' },
  { value: 'A2', label: 'A2', group: 'Alpha only', hint: 'Mask, 4 levels.' },
  { value: 'A1', label: 'A1', group: 'Alpha only', hint: 'Mask, 2 levels. Smallest output.' },
  { value: 'I8', label: 'I8', group: 'Indexed', hint: '256-colour palette. Palette is built from the image.' },
  { value: 'I4', label: 'I4', group: 'Indexed', hint: '16-colour palette.' },
  { value: 'I2', label: 'I2', group: 'Indexed', hint: '4-colour palette.' },
  { value: 'I1', label: 'I1', group: 'Indexed', hint: '2-colour palette.' },
];

/** Formats that discard alpha, so the UI knows when to offer a background. */
export const FLATTENS_ALPHA = new Set(['XRGB8888', 'RGB888', 'RGB565', 'RGB565_SWAPPED', 'L8']);

/** Formats the ordered RGB565 dither applies to, matching upstream. */
export const SUPPORTS_DITHER = new Set(['RGB565', 'RGB565_SWAPPED', 'RGB565A8', 'ARGB8565']);

const GIFENC_URL = '/gifenc/gifenc.esm.js';

// 8x8 ordered-dither thresholds, copied verbatim from LVGLImage.py.
const RED_THRESH = [
  1, 7, 3, 5, 0, 8, 2, 6,
  7, 1, 5, 3, 8, 0, 6, 2,
  3, 5, 0, 8, 2, 6, 1, 7,
  5, 3, 8, 0, 6, 2, 7, 1,
  0, 8, 2, 6, 1, 7, 3, 5,
  8, 0, 6, 2, 7, 1, 5, 3,
  2, 6, 1, 7, 3, 5, 0, 8,
  6, 2, 7, 1, 5, 3, 8, 0,
];

const GREEN_THRESH = [
  1, 3, 2, 2, 3, 1, 2, 2,
  2, 2, 0, 4, 2, 2, 4, 0,
  3, 1, 2, 2, 1, 3, 2, 2,
  2, 2, 4, 0, 2, 2, 0, 4,
  1, 3, 2, 2, 3, 1, 2, 2,
  2, 2, 0, 4, 2, 2, 4, 0,
  3, 1, 2, 2, 1, 3, 2, 2,
  2, 2, 4, 0, 2, 2, 0, 4,
];

const BLUE_THRESH = [
  5, 3, 8, 0, 6, 2, 7, 1,
  3, 5, 0, 8, 2, 6, 1, 7,
  8, 0, 6, 2, 7, 1, 5, 3,
  0, 8, 2, 6, 1, 7, 3, 5,
  6, 2, 7, 1, 5, 3, 8, 0,
  2, 6, 1, 7, 3, 5, 0, 8,
  7, 1, 5, 3, 8, 0, 6, 2,
  1, 7, 3, 5, 0, 8, 2, 6,
];

/** Bytes per row. Indexed and alpha rows are padded to a byte boundary. */
export const strideFor = (width, format) => ((width * BITS_PER_PIXEL[format]) + 7) >> 3;

/**
 * Blend a pixel onto the background for formats with no alpha channel.
 * The `>> 8` (rather than `/ 255`) is upstream's, and is kept so output
 * matches LVGLImage.py byte for byte.
 */
const preMultiply = (r, g, b, a, background) => {
  const br = (background >> 16) & 0xff;
  const bg = (background >> 8) & 0xff;
  const bb = background & 0xff;
  return [
    (r * a + (255 - a) * br) >> 8,
    (g * a + (255 - a) * bg) >> 8,
    (b * a + (255 - a) * bb) >> 8,
  ];
};

const sRgbToLinear = (x) => (x < 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const linearToSRgb = (y) => (y <= 0.0031308 ? 12.92 * y : 1.055 * (y ** (1 / 2.4)) - 0.055);

/** BT.709 luminance, computed in linear light like upstream. */
const lumaByte = (r, g, b) => {
  const linear = 0.2126 * sRgbToLinear(r / 255)
    + 0.7152 * sRgbToLinear(g / 255)
    + 0.0722 * sRgbToLinear(b / 255);
  return Math.trunc(linearToSRgb(linear) * 255);
};

const rgb565 = (r, g, b) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);

/** Pack per-pixel values of `bpp` bits MSB-first, restarting each row. */
const packRows = (values, width, height, bpp) => {
  const stride = ((width * bpp) + 7) >> 3;
  const out = new Uint8Array(stride * height);
  const perByte = 8 / bpp;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = values[y * width + x];
      const byteIndex = y * stride + Math.floor(x / perByte);
      const shift = 8 - bpp - ((x % perByte) * bpp);
      out[byteIndex] |= (value << shift);
    }
  }

  return out;
};

const packTrueColour = (rgba, width, height, format, background, dither) => {
  const bpp = BITS_PER_PIXEL[format];
  const withAlphaPlane = format === 'RGB565A8';
  const body = new Uint8Array((width * height * bpp) / 8);
  const alphaPlane = withAlphaPlane ? new Uint8Array(width * height) : null;

  let offset = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      let r = rgba[source];
      let g = rgba[source + 1];
      let b = rgba[source + 2];
      const a = rgba[source + 3];

      if (withAlphaPlane) alphaPlane[y * width + x] = a;

      // Dither first, then pack — the order upstream uses.
      if (dither && SUPPORTS_DITHER.has(format)) {
        const cell = ((y & 7) << 3) + (x & 7);
        r = Math.min(r + RED_THRESH[cell], 0xff) & 0xf8;
        g = Math.min(g + GREEN_THRESH[cell], 0xff) & 0xfc;
        b = Math.min(b + BLUE_THRESH[cell], 0xff) & 0xf8;
      }

      // Only the alpha-less formats blend onto the background.
      if (FLATTENS_ALPHA.has(format)) {
        [r, g, b] = preMultiply(r, g, b, a, background);
      }

      switch (format) {
        case 'ARGB8888': {
          // uint32 little-endian of (a<<24)|(r<<16)|(g<<8)|b
          body[offset] = b;
          body[offset + 1] = g;
          body[offset + 2] = r;
          body[offset + 3] = a;
          offset += 4;
          break;
        }
        case 'XRGB8888': {
          body[offset] = b;
          body[offset + 1] = g;
          body[offset + 2] = r;
          body[offset + 3] = 0xff;
          offset += 4;
          break;
        }
        case 'RGB888': {
          body[offset] = b;
          body[offset + 1] = g;
          body[offset + 2] = r;
          offset += 3;
          break;
        }
        case 'RGB565':
        case 'RGB565A8': {
          const value = rgb565(r, g, b);
          body[offset] = value & 0xff;
          body[offset + 1] = (value >> 8) & 0xff;
          offset += 2;
          break;
        }
        case 'RGB565_SWAPPED': {
          const value = rgb565(r, g, b);
          body[offset] = (value >> 8) & 0xff;
          body[offset + 1] = value & 0xff;
          offset += 2;
          break;
        }
        case 'ARGB8565': {
          // uint24 little-endian of (a<<16)|rgb565
          const value = rgb565(r, g, b);
          body[offset] = value & 0xff;
          body[offset + 1] = (value >> 8) & 0xff;
          body[offset + 2] = a;
          offset += 3;
          break;
        }
        default:
          throw new Error(`"${format}" is not a true-colour format.`);
      }
    }
  }

  if (!withAlphaPlane) return body;

  const combined = new Uint8Array(body.length + alphaPlane.length);
  combined.set(body, 0);
  combined.set(alphaPlane, body.length);
  return combined;
};

const packAlphaOnly = (rgba, width, height, format) => {
  const count = width * height;

  if (format === 'A8') {
    const out = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) out[index] = rgba[index * 4 + 3];
    return out;
  }

  const bpp = BITS_PER_PIXEL[format];
  const shift = 8 - bpp;
  const mask = (1 << bpp) - 1;
  const values = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    values[index] = (rgba[index * 4 + 3] >> shift) & mask;
  }

  return packRows(values, width, height, bpp);
};

const packGreyscale = (rgba, width, height, format, background) => {
  const count = width * height;

  if (format === 'AL88') {
    // Low byte luminance, high byte alpha. No background blend upstream.
    const out = new Uint8Array(count * 2);
    for (let index = 0; index < count; index += 1) {
      const source = index * 4;
      out[index * 2] = lumaByte(rgba[source], rgba[source + 1], rgba[source + 2]);
      out[index * 2 + 1] = rgba[source + 3];
    }
    return out;
  }

  const out = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const source = index * 4;
    const [r, g, b] = preMultiply(
      rgba[source], rgba[source + 1], rgba[source + 2], rgba[source + 3], background,
    );
    out[index] = lumaByte(r, g, b);
  }
  return out;
};

/**
 * Palette plus packed indices.
 *
 * The palette is always padded to the format's full entry count, as upstream
 * does, because LVGL indexes into it by a fixed-width field. Each entry is a
 * little-endian uint32 of (a<<24)|(r<<16)|(g<<8)|b, so the bytes run B,G,R,A.
 */
const packIndexed = async (rgba, width, height, format) => {
  const { quantize, applyPalette } = await import(/* @vite-ignore */ GIFENC_URL);

  const entries = PALETTE_SIZE[format];
  // rgba4444 keeps an alpha channel through quantisation; LVGL palettes carry
  // alpha per entry, so it would be wrong to drop it here.
  const palette = quantize(rgba, entries, { format: 'rgba4444' });
  const indices = applyPalette(rgba, palette, 'rgba4444');

  const out = new Uint8Array(entries * 4 + strideFor(width, format) * height);

  for (let index = 0; index < entries; index += 1) {
    const colour = palette[index];
    const base = index * 4;
    if (colour) {
      out[base] = colour[2];
      out[base + 1] = colour[1];
      out[base + 2] = colour[0];
      out[base + 3] = colour[3] === undefined ? 0xff : colour[3];
    } else {
      // Upstream pads unused entries with transparent white.
      out[base] = 0xff;
      out[base + 1] = 0xff;
      out[base + 2] = 0xff;
      out[base + 3] = 0x00;
    }
  }

  out.set(packRows(indices, width, height, BITS_PER_PIXEL[format]), entries * 4);
  return out;
};

/** A C identifier, so the generated file always compiles. */
export const safeCName = (name, fallback = 'img') => {
  const cleaned = String(name || '').trim().replace(/[^a-zA-Z0-9_]/g, '_');
  if (!cleaned) return fallback;
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
};

/** Emit `0x..,` runs, breaking the line every `perRow` bytes. */
const writeBytes = (bytes, perRow) => {
  const chunks = [];
  const columns = perRow > 0 ? perRow : 16;

  for (let index = 0; index < bytes.length; index += 1) {
    if (index % columns === 0) chunks.push('\n    ');
    chunks.push(`0x${bytes[index].toString(16).padStart(2, '0')},`);
  }

  chunks.push('\n');
  return chunks.join('');
};

/**
 * Build the LVGL v9 C source for one image.
 *
 * @param imageData RGBA bytes from a canvas, length width*height*4
 * @param format    one of COLOR_FORMATS[].value
 * @param background 24-bit RGB used where a format has no alpha
 * @returns {Promise<{code: string, stride: number, dataSize: number}>}
 */
export const buildImageC = async ({
  imageData,
  width,
  height,
  format,
  outName,
  background = 0x000000,
  dither = false,
}) => {
  if (!BITS_PER_PIXEL[format]) throw new Error(`Unknown colour format "${format}".`);
  if (width > 0xffff || height > 0xffff) throw new Error('Width and height must each be below 65536.');

  const name = safeCName(outName);
  const stride = strideFor(width, format);

  let palette = null;
  let body;

  if (INDEXED.includes(format)) {
    const packed = await packIndexed(imageData, width, height, format);
    const paletteBytes = PALETTE_SIZE[format] * 4;
    palette = packed.subarray(0, paletteBytes);
    body = packed.subarray(paletteBytes);
  } else if (ALPHA_ONLY.includes(format)) {
    body = packAlphaOnly(imageData, width, height, format);
  } else if (format === 'L8' || format === 'AL88') {
    body = packGreyscale(imageData, width, height, format, background);
  } else if (TRUE_COLOR.includes(format)) {
    body = packTrueColour(imageData, width, height, format, background, dither);
  } else {
    throw new Error(`"${format}" is not supported.`);
  }

  const macro = `LV_ATTRIBUTE_${name.toUpperCase()}`;

  const header = `
#ifdef __has_include
    #if __has_include("lvgl.h")
        #if !defined(LV_LVGL_H_INCLUDE_SIMPLE) && !defined(LV_LVGL_H_INCLUDE_SYSTEM) && !defined(LV_BUILD_TEST)
            #define LV_LVGL_H_INCLUDE_SIMPLE
        #endif
    #endif
#endif

#if defined(LV_LVGL_H_INCLUDE_SIMPLE)
#include "lvgl.h"
#elif defined(LV_LVGL_H_INCLUDE_SYSTEM)
#include <lvgl.h>
#elif defined(LV_BUILD_TEST)
#include "../lvgl.h"
#else
#include "lvgl/lvgl.h"
#endif

#ifndef LV_ATTRIBUTE_MEM_ALIGN
#define LV_ATTRIBUTE_MEM_ALIGN
#endif

#ifndef ${macro}
#define ${macro}
#endif

static const
LV_ATTRIBUTE_MEM_ALIGN LV_ATTRIBUTE_LARGE_CONST ${macro}
uint8_t ${name}_map[] = {
`;

  // The palette is written 16 bytes to a line; pixel data one row per line.
  const bodyText = (palette ? writeBytes(palette, 16) : '') + writeBytes(body, stride);

  const footer = `
};

const lv_image_dsc_t ${name} = {
  .header = {
    .magic = LV_IMAGE_HEADER_MAGIC,
    .cf = LV_COLOR_FORMAT_${format},
    .flags = 0,
    .w = ${width},
    .h = ${height},
    .stride = ${stride},
    .reserved_2 = 0,
  },
  .data_size = sizeof(${name}_map),
  .data = ${name}_map,
  .reserved = NULL,
};
`;

  return {
    code: header + bodyText + footer,
    stride,
    dataSize: (palette ? palette.length : 0) + body.length,
  };
};
