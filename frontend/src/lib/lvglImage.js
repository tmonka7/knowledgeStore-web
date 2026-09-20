/**
 * LVGL image → C array conversion, in the browser.
 *
 * This is a direct port of the converter in lvgl/lv_img_conv (the library
 * behind lvgl.io/tools/imageconverter), kept deliberately close to the
 * original so the two stay comparable: the pixel packing, the Floyd-Steinberg
 * dithering, the PHP-style rounding and the emitted C text all match upstream,
 * and output should be byte-identical to the official tool.
 *
 * It is ported rather than imported because the published lv_img_conv package
 * ships TypeScript sources and depends on the native `canvas` module. A
 * browser already has a canvas, so decoding happens there and only the packing
 * logic is needed here.
 *
 * Not implemented: the CF_INDEXED_* formats, which need the image-q palette
 * quantiser, and the CF_RAW_* passthroughs. buildImageC() rejects them rather
 * than emitting a plausible-looking but wrong palette.
 */

export const IMAGE_MODE = {
  ICF_TRUE_COLOR_332: 0,
  ICF_TRUE_COLOR_565: 1,
  ICF_TRUE_COLOR_565_SWAP: 2,
  ICF_TRUE_COLOR_888: 3,
  CF_ALPHA_1_BIT: 4,
  CF_ALPHA_2_BIT: 5,
  CF_ALPHA_4_BIT: 6,
  CF_ALPHA_8_BIT: 7,
  CF_TRUE_COLOR: 100,
  CF_TRUE_COLOR_ALPHA: 101,
  CF_TRUE_COLOR_CHROMA: 102,
};

/** The formats offered in the UI, in the order upstream lists them. */
export const COLOR_FORMATS = [
  { value: 'CF_TRUE_COLOR', label: 'True color', hint: 'RGB, no transparency. Emits all four LV_COLOR_DEPTH variants.' },
  { value: 'CF_TRUE_COLOR_ALPHA', label: 'True color with alpha', hint: 'RGB plus a per-pixel alpha byte.' },
  { value: 'CF_TRUE_COLOR_CHROMA', label: 'True color chroma keyed', hint: 'RGB where LVGL treats the chroma key colour as transparent.' },
  { value: 'CF_ALPHA_1_BIT', label: 'Alpha 1 bit', hint: 'Mask only, 2 levels. Smallest output.' },
  { value: 'CF_ALPHA_2_BIT', label: 'Alpha 2 bit', hint: 'Mask only, 4 levels.' },
  { value: 'CF_ALPHA_4_BIT', label: 'Alpha 4 bit', hint: 'Mask only, 16 levels.' },
  { value: 'CF_ALPHA_8_BIT', label: 'Alpha 8 bit', hint: 'Mask only, 256 levels.' },
];

const TRUE_COLOR_MODES = new Set([
  IMAGE_MODE.CF_TRUE_COLOR,
  IMAGE_MODE.CF_TRUE_COLOR_ALPHA,
  IMAGE_MODE.CF_TRUE_COLOR_CHROMA,
]);

const ALPHA_MODES = new Set([
  IMAGE_MODE.CF_ALPHA_1_BIT,
  IMAGE_MODE.CF_ALPHA_2_BIT,
  IMAGE_MODE.CF_ALPHA_4_BIT,
  IMAGE_MODE.CF_ALPHA_8_BIT,
]);

/** PHP round(): halves go away from zero, unlike JS Math.round. */
const phpRound = (value) => (value < 0 ? -Math.round(-value) : Math.round(value));

/** PHP round() with PHP_ROUND_HALF_DOWN: halves go toward zero. */
const phpRoundHalfDown = (value) => (value < 0 ? -Math.ceil(-value - 0.5) : Math.ceil(value - 0.5));

/** Quantise an 8-bit channel down to `bits`, keeping it in 0..255 space. */
const classifyPixel = (value, bits) => {
  const step = 1 << (8 - bits);
  const quantised = phpRoundHalfDown(value / step) * step;
  return quantised < 0 ? 0 : quantised;
};

const hex2 = (value) => `0x${Number(value || 0).toString(16).padStart(2, '0')}`;

/**
 * Port of lv_img_conv's Converter. One instance handles one colour format;
 * true-colour output runs four of them, one per LV_COLOR_DEPTH variant.
 */
class Converter {
  constructor(width, height, imageData, alpha, { cf, dith = false, swapEndian = false }) {
    this.w = width;
    this.h = height;
    this.imageData = imageData;
    this.alpha = alpha;
    this.cf = cf;
    this.dith = dith;
    this.swapEndian = swapEndian;
    this.dOut = [];

    this.rAct = 0;
    this.gAct = 0;
    this.bAct = 0;
    this.rNerr = 0;
    this.gNerr = 0;
    this.bNerr = 0;

    // Error diffusion needs one slot either side of the row.
    this.rEarr = [];
    this.gEarr = [];
    this.bEarr = [];
    if (this.dith) {
      for (let index = 0; index < this.w + 2; index += 1) {
        this.rEarr[index] = 0;
        this.gEarr[index] = 0;
        this.bEarr[index] = 0;
      }
    }
  }

  dithReset() {
    if (this.dith) {
      this.rNerr = 0;
      this.gNerr = 0;
      this.bNerr = 0;
    }
  }

  /** Quantise one pixel, spreading the error to its neighbours when dithering. */
  dithNext(r, g, b, x) {
    if (!this.dith) {
      this.quantise(r, g, b);
      return;
    }

    this.rAct = r + this.rNerr + this.rEarr[x + 1];
    this.rEarr[x + 1] = 0;
    this.gAct = g + this.gNerr + this.gEarr[x + 1];
    this.gEarr[x + 1] = 0;
    this.bAct = b + this.bNerr + this.bEarr[x + 1];
    this.bEarr[x + 1] = 0;

    this.quantise(this.rAct, this.gAct, this.bAct);

    this.rNerr = phpRound((7 * (r - this.rAct)) / 16);
    this.gNerr = phpRound((7 * (g - this.gAct)) / 16);
    this.bNerr = phpRound((7 * (b - this.bAct)) / 16);

    this.rEarr[x] += phpRound((3 * this.rNerr) / 16);
    this.gEarr[x] += phpRound((3 * this.gNerr) / 16);
    this.bEarr[x] += phpRound((3 * this.bNerr) / 16);

    this.rEarr[x + 1] += phpRound((5 * this.rNerr) / 16);
    this.gEarr[x + 1] += phpRound((5 * this.gNerr) / 16);
    this.bEarr[x + 1] += phpRound((5 * this.bNerr) / 16);

    this.rEarr[x + 2] += phpRound(this.rNerr / 16);
    this.gEarr[x + 2] += phpRound(this.gNerr / 16);
    this.bEarr[x + 2] += phpRound(this.bNerr / 16);
  }

  /** Clamps match upstream exactly: they cap at the top representable value. */
  quantise(r, g, b) {
    if (this.cf === IMAGE_MODE.ICF_TRUE_COLOR_332) {
      this.rAct = Math.min(classifyPixel(r, 3), 0xe0);
      this.gAct = Math.min(classifyPixel(g, 3), 0xe0);
      this.bAct = Math.min(classifyPixel(b, 2), 0xc0);
    } else if (this.cf === IMAGE_MODE.ICF_TRUE_COLOR_565 || this.cf === IMAGE_MODE.ICF_TRUE_COLOR_565_SWAP) {
      this.rAct = Math.min(classifyPixel(r, 5), 0xf8);
      this.gAct = Math.min(classifyPixel(g, 6), 0xfc);
      this.bAct = Math.min(classifyPixel(b, 5), 0xf8);
    } else if (this.cf === IMAGE_MODE.ICF_TRUE_COLOR_888) {
      this.rAct = Math.min(classifyPixel(r, 8), 0xff);
      this.gAct = Math.min(classifyPixel(g, 8), 0xff);
      this.bAct = Math.min(classifyPixel(b, 8), 0xff);
    }
  }

  convPx(x, y) {
    const start = ((y * this.w) + x) * 4;
    const a = this.alpha ? this.imageData[start + 3] : 0xff;
    const r = this.imageData[start];
    const g = this.imageData[start + 1];
    const b = this.imageData[start + 2];

    if (this.cf <= IMAGE_MODE.ICF_TRUE_COLOR_888) this.dithNext(r, g, b, x);

    if (this.cf === IMAGE_MODE.ICF_TRUE_COLOR_332) {
      this.dOut.push(this.rAct | (this.gAct >> 3) | (this.bAct >> 6));
      if (this.alpha) this.dOut.push(a);
    } else if (this.cf === IMAGE_MODE.ICF_TRUE_COLOR_565) {
      const c16 = (this.rAct << 8) | (this.gAct << 3) | (this.bAct >> 3);
      this.dOut.push(c16 & 0xff, (c16 >> 8) & 0xff);
      if (this.alpha) this.dOut.push(a);
    } else if (this.cf === IMAGE_MODE.ICF_TRUE_COLOR_565_SWAP) {
      const c16 = (this.rAct << 8) | (this.gAct << 3) | (this.bAct >> 3);
      this.dOut.push((c16 >> 8) & 0xff, c16 & 0xff);
      if (this.alpha) this.dOut.push(a);
    } else if (this.cf === IMAGE_MODE.ICF_TRUE_COLOR_888) {
      this.dOut.push(this.bAct, this.gAct, this.rAct, a);
    } else if (this.cf === IMAGE_MODE.CF_ALPHA_1_BIT) {
      let stride = this.w >> 3;
      if (this.w & 0x07) stride += 1;
      const p = stride * y + (x >> 3);
      if (this.dOut[p] === undefined) this.dOut[p] = 0;
      if (a > 0x80) this.dOut[p] |= 1 << (7 - (x & 0x7));
    } else if (this.cf === IMAGE_MODE.CF_ALPHA_2_BIT) {
      let stride = this.w >> 2;
      if (this.w & 0x03) stride += 1;
      const p = stride * y + (x >> 2);
      if (this.dOut[p] === undefined) this.dOut[p] = 0;
      this.dOut[p] |= (a >> 6) << (6 - ((x & 0x3) * 2));
    } else if (this.cf === IMAGE_MODE.CF_ALPHA_4_BIT) {
      let stride = this.w >> 1;
      if (this.w & 0x01) stride += 1;
      const p = stride * y + (x >> 1);
      if (this.dOut[p] === undefined) this.dOut[p] = 0;
      this.dOut[p] |= (a >> 4) << (4 - ((x & 0x1) * 4));
    } else if (this.cf === IMAGE_MODE.CF_ALPHA_8_BIT) {
      this.dOut[this.w * y + x] = a;
    }
  }

  convert() {
    for (let y = 0; y < this.h; y += 1) {
      this.dithReset();
      for (let x = 0; x < this.w; x += 1) {
        this.convPx(x, y);
      }
    }
    return this.formatToCArray();
  }

  formatToCArray() {
    let out = '';

    if (this.cf === IMAGE_MODE.ICF_TRUE_COLOR_332) {
      out += '\n#if LV_COLOR_DEPTH == 1 || LV_COLOR_DEPTH == 8';
      out += this.alpha
        ? '\n  /*Pixel format: Alpha 8 bit, Red: 3 bit, Green: 3 bit, Blue: 2 bit*/'
        : '\n  /*Pixel format: Red: 3 bit, Green: 3 bit, Blue: 2 bit*/';
    } else if (this.cf === IMAGE_MODE.ICF_TRUE_COLOR_565) {
      out += '\n#if LV_COLOR_DEPTH == 16 && LV_COLOR_16_SWAP == 0';
      out += this.alpha
        ? '\n  /*Pixel format: Alpha 8 bit, Red: 5 bit, Green: 6 bit, Blue: 5 bit*/'
        : '\n  /*Pixel format: Red: 5 bit, Green: 6 bit, Blue: 5 bit*/';
    } else if (this.cf === IMAGE_MODE.ICF_TRUE_COLOR_565_SWAP) {
      out += '\n#if LV_COLOR_DEPTH == 16 && LV_COLOR_16_SWAP != 0';
      out += this.alpha
        ? '\n  /*Pixel format: Alpha 8 bit, Red: 5 bit, Green: 6 bit, Blue: 5 bit  BUT the 2  color bytes are swapped*/'
        : '\n  /*Pixel format: Red: 5 bit, Green: 6 bit, Blue: 5 bit BUT the 2 bytes are swapped*/';
    } else if (this.cf === IMAGE_MODE.ICF_TRUE_COLOR_888) {
      out += '\n#if LV_COLOR_DEPTH == 32';
      if (!this.alpha) out += '\n  /*Pixel format: Fix 0xFF: 8 bit, Red: 8 bit, Green: 8 bit, Blue: 8 bit*/';
    }

    // Upstream pushes a sentinel so the row loop never reads past the end. It
    // is also counted by data_size below; both behaviours are kept so output
    // matches the official converter byte for byte.
    this.dOut.push(0);

    let i = 0;
    for (let y = 0; y < this.h; y += 1) {
      out += '\n  ';
      for (let x = 0; x < this.w; x += 1) {
        if (this.cf === IMAGE_MODE.ICF_TRUE_COLOR_332) {
          out += `${hex2(this.dOut[i])}, `;
          i += 1;
          if (this.alpha) {
            out += `${hex2(this.dOut[i])}, `;
            i += 1;
          }
        } else if (this.cf === IMAGE_MODE.ICF_TRUE_COLOR_565 || this.cf === IMAGE_MODE.ICF_TRUE_COLOR_565_SWAP) {
          out += this.swapEndian
            ? `${hex2(this.dOut[i + 1])}, ${hex2(this.dOut[i])}, `
            : `${hex2(this.dOut[i])}, ${hex2(this.dOut[i + 1])}, `;
          i += 2;
          if (this.alpha) {
            out += `${hex2(this.dOut[i])}, `;
            i += 1;
          }
        } else if (this.cf === IMAGE_MODE.ICF_TRUE_COLOR_888) {
          out += this.swapEndian
            ? `${hex2(this.dOut[i + 2])}, ${hex2(this.dOut[i + 1])}, ${hex2(this.dOut[i])}, `
            : `${hex2(this.dOut[i])}, ${hex2(this.dOut[i + 1])}, ${hex2(this.dOut[i + 2])}, `;
          out += `${hex2(this.dOut[i + 3])}, `;
          i += 4;
        } else if (this.cf === IMAGE_MODE.CF_ALPHA_1_BIT) {
          if ((x & 0x7) === 0) {
            out += `${hex2(this.dOut[i])}, `;
            i += 1;
          }
        } else if (this.cf === IMAGE_MODE.CF_ALPHA_2_BIT) {
          if ((x & 0x3) === 0) {
            out += `${hex2(this.dOut[i])}, `;
            i += 1;
          }
        } else if (this.cf === IMAGE_MODE.CF_ALPHA_4_BIT) {
          if ((x & 0x1) === 0) {
            out += `${hex2(this.dOut[i])}, `;
            i += 1;
          }
        } else if (this.cf === IMAGE_MODE.CF_ALPHA_8_BIT) {
          out += `${hex2(this.dOut[i])}, `;
          i += 1;
        }
      }
    }

    if (this.cf <= IMAGE_MODE.ICF_TRUE_COLOR_888) out += '\n#endif';
    return out;
  }
}

const enumName = (cf) => {
  switch (cf) {
    case IMAGE_MODE.CF_TRUE_COLOR: return 'LV_IMG_CF_TRUE_COLOR';
    case IMAGE_MODE.CF_TRUE_COLOR_ALPHA: return 'LV_IMG_CF_TRUE_COLOR_ALPHA';
    case IMAGE_MODE.CF_TRUE_COLOR_CHROMA: return 'LV_IMG_CF_TRUE_COLOR_CHROMA_KEYED';
    case IMAGE_MODE.CF_ALPHA_1_BIT: return 'LV_IMG_CF_ALPHA_1BIT';
    case IMAGE_MODE.CF_ALPHA_2_BIT: return 'LV_IMG_CF_ALPHA_2BIT';
    case IMAGE_MODE.CF_ALPHA_4_BIT: return 'LV_IMG_CF_ALPHA_4BIT';
    case IMAGE_MODE.CF_ALPHA_8_BIT: return 'LV_IMG_CF_ALPHA_8BIT';
    default: throw new Error('Unsupported colour format.');
  }
};

const cHeader = (outName) => {
  const attr = `LV_ATTRIBUTE_IMG_${outName.toUpperCase()}`;
  return `#ifdef LV_LVGL_H_INCLUDE_SIMPLE
#include "lvgl.h"
#else
#include "lvgl/lvgl.h"
#endif

#ifndef LV_ATTRIBUTE_MEM_ALIGN
#define LV_ATTRIBUTE_MEM_ALIGN
#endif
#ifndef ${attr}
#define ${attr}
#endif
const LV_ATTRIBUTE_MEM_ALIGN ${attr} uint8_t ${outName}_map[] = {`;
};

const cFooter = (cf, outName, width, height, dataSize) => `\n};\n
const lv_img_dsc_t ${outName} = {
  .header.cf = ${enumName(cf)},
  .header.always_zero = 0,
  .header.reserved = 0,
  .header.w = ${width},
  .header.h = ${height},
  .data_size = ${dataSize},
  .data = ${outName}_map,
};\n`;

/** A C identifier, so the generated file always compiles. */
export const safeCName = (name, fallback = 'img') => {
  const cleaned = String(name || '').trim().replace(/[^a-zA-Z0-9_]/g, '_');
  if (!cleaned) return fallback;
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
};

/**
 * Build the LVGL C source for one image.
 *
 * @param imageData RGBA bytes from a canvas, length width*height*4
 * @returns the complete .c file contents
 */
export const buildImageC = ({ imageData, width, height, cf, dith = false, swapEndian = false, outName }) => {
  const mode = IMAGE_MODE[cf];
  if (mode === undefined) throw new Error(`Unknown colour format "${cf}".`);
  if (!TRUE_COLOR_MODES.has(mode) && !ALPHA_MODES.has(mode)) {
    throw new Error('Only the true-colour and alpha formats are supported here.');
  }

  const name = safeCName(outName);
  const alpha = mode === IMAGE_MODE.CF_TRUE_COLOR_ALPHA || ALPHA_MODES.has(mode);
  const options = { dith, swapEndian };

  let body;
  let dataSize;

  if (TRUE_COLOR_MODES.has(mode)) {
    // True colour emits every depth variant, each behind its own #if, so one
    // file works whatever LV_COLOR_DEPTH the firmware is built with.
    body = [
      IMAGE_MODE.ICF_TRUE_COLOR_332,
      IMAGE_MODE.ICF_TRUE_COLOR_565,
      IMAGE_MODE.ICF_TRUE_COLOR_565_SWAP,
      IMAGE_MODE.ICF_TRUE_COLOR_888,
    ].map((variant) => new Converter(width, height, imageData, alpha, { ...options, cf: variant }).convert())
      .join('');

    dataSize = `${width * height} * ${mode === IMAGE_MODE.CF_TRUE_COLOR_ALPHA ? 'LV_IMG_PX_SIZE_ALPHA_BYTE' : 'LV_COLOR_SIZE / 8'}`;
  } else {
    const converter = new Converter(width, height, imageData, alpha, { ...options, cf: mode });
    body = converter.convert();
    dataSize = String(converter.dOut.length);
  }

  return cHeader(name) + body + cFooter(mode, name, width, height, dataSize);
};
