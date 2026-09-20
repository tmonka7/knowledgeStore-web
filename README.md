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

`frontend/src/lib/lvglImage.js` is a direct port of the converter in
[lv_img_conv](https://github.com/lvgl/lv_img_conv), kept close enough to the
original that output should be byte-identical to
[lvgl.io/tools/imageconverter](https://lvgl.io/tools/imageconverter): the same
pixel packing, the same Floyd-Steinberg dithering, the same PHP-style rounding
and the same emitted C text.

It is ported rather than imported because the published package ships
TypeScript sources and depends on the native `canvas` module — awkward to
install, and redundant when a browser already has a canvas to decode with.

Supported colour formats:

| Format | Notes |
| --- | --- |
| `CF_TRUE_COLOR` | Emits all four `LV_COLOR_DEPTH` variants behind `#if` guards |
| `CF_TRUE_COLOR_ALPHA` | As above, plus a per-pixel alpha byte |
| `CF_TRUE_COLOR_CHROMA` | As above, chroma keyed |
| `CF_ALPHA_1/2/4/8_BIT` | Mask only |

**Not supported:** the `CF_INDEXED_*` formats, which need the `image-q` palette
quantiser, and the `CF_RAW_*` passthroughs. `buildImageC()` throws for these
rather than emitting a plausible-looking but wrong palette.

One upstream quirk is reproduced deliberately: the converter appends a sentinel
byte to the pixel array and counts it in `.data_size`, so the alpha formats
report one byte more than they use. Keeping it means output matches the official
tool exactly; the over-report is harmless to LVGL.
