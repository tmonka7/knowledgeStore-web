// Font conversion for the LVGL tool page.
//
// This delegates to the real lv_font_conv (github.com/lvgl/lv_font_conv), the
// same library behind lvgl.io/tools/fontconverter, rather than approximating
// its output. It runs here rather than in the browser because the package is
// CommonJS built around a FreeType WASM build and Node Buffers; bundling it
// for the browser is what the upstream project's own webpack build is for.
//
// Image conversion is NOT here: it happens client-side in
// frontend/src/lib/lvglImage.js, because lv_img_conv ships TypeScript sources
// and depends on the native `canvas` module, while a browser already has a
// perfectly good canvas to decode with.

import convert from 'lv_font_conv/lib/convert.js';

const MAX_UNICODE = 0x10ffff;

/** Parse one code point, decimal or 0x-prefixed hex. Mirrors the upstream CLI. */
const unicodePoint = (value) => {
  const match = /^(?:(?:0x([0-9a-f]+))|([0-9]+))$/i.exec(String(value).trim());
  if (!match) throw new Error(`"${value}" is not a number.`);

  const [, hex, dec] = match;
  const point = hex ? parseInt(hex, 16) : parseInt(dec, 10);
  if (point > MAX_UNICODE) throw new Error(`"${value}" is outside the Unicode range.`);
  return point;
};

/**
 * Parse a range string such as "0x20-0x7F,0x1F450=>0xF005" into the flat
 * [start, end, mapped_start, ...] triples collect_font_data reads in threes.
 */
export const parseRanges = (input) => {
  const result = [];

  for (const segment of String(input).split(',')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const match = /^(.+?)(?:-(.+?))?(?:=>(.+?))?$/i.exec(trimmed);
    if (!match) throw new Error(`"${trimmed}" is not a valid range.`);

    const [, rawStart, rawEnd, rawMapped] = match;
    const start = unicodePoint(rawStart);
    const end = rawEnd ? unicodePoint(rawEnd) : start;
    if (start > end) throw new Error(`Invalid range: "${trimmed}".`);

    result.push(start, end, rawMapped ? unicodePoint(rawMapped) : start);
  }

  return result;
};

/** A C identifier derived from the requested name, so the output always compiles. */
const safeFontName = (name, fallback = 'lv_font_custom') => {
  const cleaned = String(name || '').trim().replace(/[^a-zA-Z0-9_]/g, '_');
  if (!cleaned) return fallback;
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
};

const asBoolean = (value) => value === true || value === 'true' || value === '1';

const BPP_CHOICES = [1, 2, 3, 4, 8];

export const convertFont = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'A font file (.ttf, .otf, .woff) is required.' });
    }

    const size = Number(req.body.size);
    if (!Number.isInteger(size) || size <= 0) {
      return res.status(400).json({ message: 'Size must be a positive whole number of pixels.' });
    }

    const bpp = Number(req.body.bpp);
    if (!BPP_CHOICES.includes(bpp)) {
      return res.status(400).json({ message: `Bpp must be one of ${BPP_CHOICES.join(', ')}.` });
    }

    // Either is accepted, matching --range / --symbols upstream, but at least
    // one must be present or the converter has no glyphs to emit.
    const ranges = [];
    if (req.body.range && String(req.body.range).trim()) {
      ranges.push({ range: parseRanges(req.body.range) });
    }
    if (req.body.symbols && String(req.body.symbols).length) {
      ranges.push({ symbols: String(req.body.symbols) });
    }
    if (!ranges.length) {
      return res.status(400).json({ message: 'Provide a Unicode range, a symbol list, or both.' });
    }

    const fontName = safeFontName(req.body.name, 'lv_font_custom');
    const output = `${fontName}.c`;

    const args = {
      size,
      bpp,
      format: 'lvgl',
      output,
      lv_font_name: fontName,
      lv_include: req.body.lvInclude ? String(req.body.lvInclude) : undefined,
      lv_fallback: req.body.fallback ? safeFontName(req.body.fallback) : undefined,
      lcd: asBoolean(req.body.lcd),
      lcd_v: asBoolean(req.body.lcdV),
      use_color_info: asBoolean(req.body.useColorInfo),
      no_compress: asBoolean(req.body.noCompress),
      no_prefilter: asBoolean(req.body.noPrefilter),
      no_kerning: asBoolean(req.body.noKerning),
      fast_kerning: asBoolean(req.body.fastKerning),
      full_info: false,
      font: [{
        // source_path is only an identity key once source_bin is supplied.
        source_path: req.file.originalname || 'font.ttf',
        source_bin: req.file.buffer,
        ranges,
      }],
    };

    // Reproduced in the generated file's header comment, so anyone reading the
    // output can see exactly how it was produced.
    args.opts_string = [
      `--size ${size}`,
      `--bpp ${bpp}`,
      '--format lvgl',
      `--font ${args.font[0].source_path}`,
      req.body.range ? `--range ${req.body.range}` : '',
      req.body.symbols ? `--symbols ${req.body.symbols}` : '',
      args.no_compress ? '--no-compress' : '',
      args.no_kerning ? '--no-kerning' : '',
    ].filter(Boolean).join(' ');

    const files = await convert(args);
    const produced = files[output];
    if (produced === undefined) {
      return res.status(500).json({ message: 'The converter produced no output.' });
    }

    const code = Buffer.isBuffer(produced) ? produced.toString('utf8') : String(produced);

    // Returned as JSON rather than a file body so the page can preview the C
    // source and still save it; the browser builds the download from `code`.
    return res.json({
      filename: output,
      fontName,
      code,
      bytes: Buffer.byteLength(code, 'utf8'),
    });
  } catch (error) {
    // lv_font_conv raises AppError for bad input (unreadable font, empty
    // range), which is the user's problem to fix rather than a server fault.
    if (error?.name === 'AppError' || /Cannot load font|doesn't have any characters|is not a number|Invalid range|not a valid range|outside the Unicode range/i.test(error?.message || '')) {
      return res.status(400).json({ message: error.message });
    }
    return next(error);
  }
};
