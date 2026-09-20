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
