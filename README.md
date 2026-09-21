# Knowledge Store

A full-stack starter app with:
- React + Vite + Ant Design frontend
- Node.js 20 + Express backend
- Login / registration
- User management
- Data manager API and UI

## Quick start

1. Install dependencies:
   - `npm install --prefix backend`
   - `npm install --prefix frontend`
2. Start backend:
   - `npm --prefix backend run dev`
3. Start frontend:
   - `npm --prefix frontend run dev`
4. Open:
   - Frontend: http://localhost:5173
   - API: http://localhost:4000/api/health

## Default admin login

- Username: `admin`
- Password: `admin123`

## Camera object detection

The camera view (**Cameras -> View -> Detect Objects**) outlines people and
vehicles on a live stream, entirely in the browser. Detection runs on
YOLOX-Nano via onnxruntime-web; `frontend/src/lib/objectDetector.js` keeps the
engine behind a two-method interface (`load`, `detectObjects`) so it can be
swapped without touching the view.

### Vendored assets

Both are committed under `frontend/public/`, matching how `face-api.js` and its
models are already handled — no build step and no extra npm dependency:

| Path | Size | Source |
| --- | --- | --- |
| `public/yolox-model/yolox_nano.onnx` | 3.6 MB | [YOLOX 0.1.1rc0 release](https://github.com/Megvii-BaseDetection/YOLOX/releases/tag/0.1.1rc0) |
| `public/ort/` | 11 MB | [onnxruntime-web 1.19.2](https://www.npmjs.com/package/onnxruntime-web) dist files |

The runtime is loaded as a plain script in `index.html`, so it is fetched once
and cached rather than bundled. It is pinned to a single WASM thread because
threading requires `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`
headers this app does not send.

### Which streams can be detected on

Detection needs pixel access, which a cross-origin `<iframe>` never grants. With
detection on, the view therefore swaps the iframe for a `<video>` or `<img>`:

- **Works:** MJPEG endpoints and MP4/WebM URLs that send
  `Access-Control-Allow-Origin`.
- **Stream plays, no boxes:** the same URLs without that header. The canvas is
  tainted, and the view reports "Stream blocked by CORS" rather than silently
  showing nothing.
- **Not supported:** `rtsp://` addresses and camera viewer *pages*. Neither
  gives the browser frames to read. Reaching these would need a server-side
  decoder (ffmpeg plus an inference sidecar) pushing boxes to the UI.

### Model licensing

YOLOX is **Apache-2.0**, which is why it is used here in preference to
Ultralytics YOLO26. The YOLO26 line is **AGPL-3.0**: shipping it in this product
would oblige you to release the app's own source or buy an Ultralytics
Enterprise licence. If that licence is acquired, `yolo26n.onnx` drops in behind
the same interface — note it exports NMS-free, so such an engine skips the
`decodeYolox()` / `nonMaxSuppression()` steps entirely.

## LVGL converters

**Tools -> LVGL** turns fonts and images into LVGL-ready C source and downloads
the `.c` file. The two halves run in different places, for different reasons.

### Font converter (server side)

`POST /api/tools/lvgl/font` (multipart) runs the real
[lv_font_conv](https://github.com/lvgl/lv_font_conv) — the same library behind
[lvgl.io/tools/fontconverter](https://lvgl.io/tools/fontconverter) — and returns
the generated C source as JSON, which the page saves as a file.

It runs on the API rather than in the browser because the package is CommonJS
built around a FreeType WASM build and Node Buffers. Bundling it for the browser
is what the upstream project's own webpack build exists to do, and reproducing
that here would add a build step for one page.

Fields map onto the CLI flags: `size`, `bpp` (1/2/3/4/8), `range`
(`0x20-0x7F`, `32-127`, `0x1F450=>0xF005`), `symbols`, plus `--no-compress`,
`--no-kerning` and `--lcd`. Either a range or a symbol list is required, exactly
as upstream requires.

### Image converter (client side)

Targets **LVGL v9 only**.

`frontend/src/lib/lvglImage.js` is a port of `scripts/LVGLImage.py` from the
lvgl repository, which is the official converter for v9 and what
[lvgl.io/tools/imageconverter](https://lvgl.io/tools/imageconverter) runs. The
pixel packing, the ordered RGB565 dither, the background pre-multiply and the
emitted C text all follow it.

It is ported rather than imported because LVGLImage.py is Python, and because
a browser already has a canvas to decode with.

> The older [lv_img_conv](https://github.com/lvgl/lv_img_conv) project is **v8**
> and is deliberately not used. It emits `lv_img_dsc_t` with `LV_IMG_CF_*`
> constants, a `header.always_zero` field, and the pixel data repeated four
> times behind `#if LV_COLOR_DEPTH` guards. None of that compiles against v9.

v9 output declares `lv_image_dsc_t` with an explicit `LV_COLOR_FORMAT_*`, a
stride, and a single copy of the data:

```c
const lv_image_dsc_t my_image = {
  .header = {
    .magic = LV_IMAGE_HEADER_MAGIC,
    .cf = LV_COLOR_FORMAT_RGB565A8,
    ...
```

Supported colour formats:

| Group | Formats |
| --- | --- |
| True colour | `ARGB8888`, `XRGB8888`, `RGB888`, `RGB565`, `RGB565_SWAPPED`, `RGB565A8`, `ARGB8565` |
| Greyscale | `L8`, `AL88` |
| Alpha only | `A1`, `A2`, `A4`, `A8` |
| Indexed | `I1`, `I2`, `I4`, `I8` |

Formats with no alpha channel (`XRGB8888`, `RGB888`, `RGB565`,
`RGB565_SWAPPED`, `L8`) blend onto a chosen background colour, using upstream's
`(c * a + (255 - a) * bg) >> 8` rather than a divide by 255, so output matches
byte for byte. Ordered dithering is offered for the RGB565 family, using the
same 8×8 threshold tables.

One deliberate difference: LVGLImage.py only accepts an already-palettised PNG
for `I1`/`I2`/`I4`/`I8`. A browser tool gets handed arbitrary images, so the
palette is built here with gifenc (MIT, vendored at `public/gifenc`, imported
lazily). The emitted bytes still follow the v9 layout — a padded palette of
little-endian `(a<<24)|(r<<16)|(g<<8)|b` entries, then row-aligned indices.

Not implemented: `RAW`/`RAW_ALPHA` passthrough, RLE and LZ4 compression
(`LV_IMAGE_FLAGS_COMPRESSED`), premultiplied alpha, and custom stride
alignment. `.flags` is always `0`.

### Font converter and LVGL v9

`lv_font_conv` output is version-guarded rather than v8-only: the generated C
carries `#if LVGL_VERSION_MAJOR >= 9` around the fields that moved, emits
`.fallback` for v8.2+/v9, and confines the `.cache` member to v8. The same file
compiles on both, so no v9-specific handling is needed on the font side.
