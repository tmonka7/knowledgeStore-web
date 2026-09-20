/**
 * Object detection behind a narrow interface so the engine can be swapped,
 * mirroring lib/faceDetector.js.
 *
 * A detector implements:
 *   load()                 -> Promise<void>
 *   detectObjects(source)  -> Promise<Detection[]>
 *
 * A Detection is { classId, label, score, box } where box is NORMALISED to
 * 0..1 of the source's intrinsic size, so nothing downstream has to care about
 * stream resolution or CSS pixels.
 *
 * The engine here is YOLOX-Nano (Apache-2.0) on onnxruntime-web. It is
 * deliberately not Ultralytics YOLO26: that line is AGPL-3.0, which would
 * oblige this product to publish its own source or buy an Enterprise licence.
 * Swapping in yolo26n.onnx later means writing another object with these two
 * methods and returning it from createObjectDetector() — note YOLO26 exports
 * NMS-free, so such an engine skips decodeYolox()/nonMaxSuppression() entirely.
 */

import { sourceSize } from './faceDetector';

// Tuning shared by the detector and the UI copy.
export const DETECTION_RULES = {
  inputSize: 416, // yolox_nano was exported at 416x416
  scoreThreshold: 0.35,
  iouThreshold: 0.45,
  maxDetections: 40,
  padValue: 114, // YOLOX letterboxes with grey 114, top-left aligned
};

export const DETECTION_STATUS = {
  OFF: { code: 'OFF', tone: 'idle', title: 'Object detection is off', hint: 'Turn it on to outline people and vehicles in this view.' },
  LOADING: { code: 'LOADING', tone: 'idle', title: 'Loading detection model...', hint: 'The model is about 4 MB and is cached after the first load.' },
  RUNNING: { code: 'RUNNING', tone: 'success', title: 'Detecting', hint: 'Objects are outlined live on the stream.' },
  NO_RUNTIME: { code: 'NO_RUNTIME', tone: 'warning', title: 'Detection runtime unavailable', hint: 'The ONNX runtime did not load, so this stream is shown without detection.' },
  MODEL_FAILED: { code: 'MODEL_FAILED', tone: 'warning', title: 'Detection model failed to load', hint: 'The stream still plays, but objects cannot be outlined.' },
  UNSUPPORTED_SOURCE: { code: 'UNSUPPORTED_SOURCE', tone: 'warning', title: 'This stream cannot be read for detection', hint: 'Detection needs an MJPEG or MP4/WebM URL. An rtsp:// camera or an embedded viewer page gives the browser no pixels to read.' },
  BLOCKED_BY_CORS: { code: 'BLOCKED_BY_CORS', tone: 'warning', title: 'Stream blocked by CORS', hint: 'The camera must send Access-Control-Allow-Origin before the browser will let this page read its frames.' },
  SOURCE_ERROR: { code: 'SOURCE_ERROR', tone: 'warning', title: 'Stream could not be opened', hint: 'The camera did not return a playable video or image stream.' },
};

/** COCO 80, in the class-index order YOLOX was trained on. */
export const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard',
  'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard',
  'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase',
  'scissors', 'teddy bear', 'hair drier', 'toothbrush',
];

/** The classes a security operator actually watches for; the default filter. */
export const SECURITY_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'bus', 'train', 'truck', 'backpack', 'handbag', 'suitcase',
];

const MODEL_URL = '/yolox-model/yolox_nano.onnx';
const RUNTIME_PATH = '/ort/';

/**
 * Which element can show this address AND expose its pixels.
 *
 * An <iframe> is deliberately not an option: a cross-origin document cannot be
 * drawn to a canvas, so an embedded viewer page yields nothing to detect on.
 */
export const streamMediaKind = (address = '') => {
  if (!/^https?:\/\//i.test(address)) return 'none'; // rtsp:// and friends
  const path = address.split(/[?#]/)[0].toLowerCase();
  if (/\.(mp4|webm|ogv|ogg|mov)$/.test(path)) return 'video';
  if (/\.(mjpg|mjpeg|jpg|jpeg|png)$/.test(path)) return 'image';
  // Common MJPEG endpoints on IP cameras: /video, /videostream.cgi, ?action=stream
  if (/\/(video|videostream|mjpg|mjpeg|snapshot)(\.cgi)?$/.test(path)) return 'image';
  if (/action=stream/i.test(address)) return 'image';
  return 'unknown';
};

/** Stable colour per class so a car keeps the same hue frame to frame. */
export const colorForClass = (classId) => `hsl(${(classId * 47) % 360} 85% 58%)`;

/**
 * The scratch canvas frames are letterboxed into, created once and reused —
 * the loop runs twice a second and a fresh 416x416 canvas each time is pure
 * GC churn. Every frame repaints it end to end, so nothing leaks between runs.
 */
let letterboxCanvas = null;
const letterboxContext = (inputSize) => {
  if (!letterboxCanvas) letterboxCanvas = document.createElement('canvas');
  if (letterboxCanvas.width !== inputSize) {
    letterboxCanvas.width = inputSize;
    letterboxCanvas.height = inputSize;
  }
  return letterboxCanvas.getContext('2d', { willReadFrequently: true });
};

/**
 * Letterbox `source` into an inputSize square, top-left aligned on grey 114,
 * and return it as NCHW BGR float32 in 0..255 — the exact tensor layout the
 * YOLOX ONNX export expects (no /255, no mean/std).
 *
 * Reports `tainted` when the canvas cannot be read, which is how a camera
 * without CORS headers shows up. The caller turns that into BLOCKED_BY_CORS
 * rather than silently reporting no objects.
 */
const preprocess = (source, inputSize) => {
  const { width, height } = sourceSize(source);
  if (!width || !height) return null;

  const ratio = Math.min(inputSize / height, inputSize / width);
  const context = letterboxContext(inputSize);

  const pad = DETECTION_RULES.padValue;
  context.fillStyle = 'rgb(' + pad + ', ' + pad + ', ' + pad + ')';
  context.fillRect(0, 0, inputSize, inputSize);
  context.drawImage(source, 0, 0, Math.round(width * ratio), Math.round(height * ratio));

  let pixels;
  try {
    pixels = context.getImageData(0, 0, inputSize, inputSize).data;
  } catch {
    // Tainting is permanent for the life of a canvas, so the shared scratch
    // one has to go: keeping it would block every later camera, including
    // those that do send CORS headers.
    letterboxCanvas = null;
    return { tainted: true };
  }

  const area = inputSize * inputSize;
  const data = new Float32Array(area * 3);
  for (let index = 0; index < area; index += 1) {
    const offset = index * 4;
    // BGR: YOLOX was trained on OpenCV-ordered channels.
    data[index] = pixels[offset + 2];
    data[area + index] = pixels[offset + 1];
    data[area * 2 + index] = pixels[offset];
  }

  return { data, ratio, tainted: false };
};

/**
 * Grid centres and strides for the three YOLOX feature maps, cached per input
 * size — they are constant for a given export, so rebuilding them every frame
 * would be pure waste.
 */
const gridCache = new Map();
const gridsFor = (inputSize) => {
  if (gridCache.has(inputSize)) return gridCache.get(inputSize);

  const centersX = [];
  const centersY = [];
  const strides = [];
  for (const stride of [8, 16, 32]) {
    const cells = Math.floor(inputSize / stride);
    for (let y = 0; y < cells; y += 1) {
      for (let x = 0; x < cells; x += 1) {
        centersX.push(x);
        centersY.push(y);
        strides.push(stride);
      }
    }
  }

  const grid = { centersX, centersY, strides };
  gridCache.set(inputSize, grid);
  return grid;
};

/**
 * Decode the raw [1, anchors, 85] YOLOX tensor into normalised boxes.
 * Each anchor is [cx, cy, w, h, objectness, ...80 class scores], with cx/cy in
 * grid units and w/h in log space.
 */
const decodeYolox = (output, dims, inputSize, ratio, sourceW, sourceH, allowed) => {
  const anchors = dims[1];
  const stride = dims[2]; // 85 for COCO
  const classCount = stride - 5;
  const { centersX, centersY, strides } = gridsFor(inputSize);
  const detections = [];

  for (let index = 0; index < anchors; index += 1) {
    const base = index * stride;
    const objectness = output[base + 4];
    // Cheap reject before the 80-wide class scan; objectness caps the score.
    if (objectness < DETECTION_RULES.scoreThreshold) continue;

    let bestClass = -1;
    let bestScore = 0;
    for (let offset = 0; offset < classCount; offset += 1) {
      const score = output[base + 5 + offset];
      if (score > bestScore) {
        bestScore = score;
        bestClass = offset;
      }
    }

    const score = objectness * bestScore;
    if (score < DETECTION_RULES.scoreThreshold) continue;
    if (allowed && !allowed.has(bestClass)) continue;

    const cellStride = strides[index];
    const centerX = (output[base] + centersX[index]) * cellStride;
    const centerY = (output[base + 1] + centersY[index]) * cellStride;
    const boxW = Math.exp(output[base + 2]) * cellStride;
    const boxH = Math.exp(output[base + 3]) * cellStride;

    // Undo the letterbox, then normalise against the source's own size.
    const x = Math.max(0, (centerX - boxW / 2) / ratio / sourceW);
    const y = Math.max(0, (centerY - boxH / 2) / ratio / sourceH);

    detections.push({
      classId: bestClass,
      label: COCO_CLASSES[bestClass] || 'class ' + bestClass,
      score,
      box: {
        x,
        y,
        width: Math.min(boxW / ratio / sourceW, 1 - x),
        height: Math.min(boxH / ratio / sourceH, 1 - y),
      },
    });
  }

  return detections;
};

const iou = (a, b) => {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;

  const overlap = (right - left) * (bottom - top);
  return overlap / (a.width * a.height + b.width * b.height - overlap);
};

/** Class-wise NMS: a box only suppresses others of its own class. */
const nonMaxSuppression = (detections) => {
  const ordered = [...detections].sort((a, b) => b.score - a.score);
  const kept = [];

  for (const candidate of ordered) {
    if (kept.length >= DETECTION_RULES.maxDetections) break;
    const overlaps = kept.some((chosen) => chosen.classId === candidate.classId
      && iou(chosen.box, candidate.box) > DETECTION_RULES.iouThreshold);
    if (!overlaps) kept.push(candidate);
  }

  return kept;
};

/** YOLOX-Nano on onnxruntime-web, using the runtime vendored in /public/ort. */
const yoloxDetector = {
  id: 'yolox-nano',
  available: () => typeof window !== 'undefined' && Boolean(window.ort),

  async load() {
    const ort = window.ort;
    if (!ort) throw new Error('onnxruntime-web is not loaded.');

    if (!this._loading) {
      ort.env.wasm.wasmPaths = RUNTIME_PATH;
      // Threads need the COOP/COEP headers this app does not send; asking for
      // more than one would stop the runtime starting rather than speed it up.
      ort.env.wasm.numThreads = 1;
      ort.env.logLevel = 'error';

      this._loading = ort.InferenceSession
        .create(MODEL_URL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
        .then((session) => {
          this._session = session;
        })
        .catch((error) => {
          this._loading = null;
          throw error;
        });
    }

    await this._loading;
  },

  /** @param allowedClassIds optional Set of class indices to keep. */
  async detectObjects(source, allowedClassIds = null) {
    const session = this._session;
    const ort = window.ort;
    if (!session || !ort) return [];

    const { width, height } = sourceSize(source);
    if (!width || !height) return [];

    const { inputSize } = DETECTION_RULES;
    const prepared = preprocess(source, inputSize);
    if (!prepared) return [];
    if (prepared.tainted) {
      const error = new Error('The stream canvas is tainted; the camera sent no CORS headers.');
      error.code = 'BLOCKED_BY_CORS';
      throw error;
    }

    const tensor = new ort.Tensor('float32', prepared.data, [1, 3, inputSize, inputSize]);
    const results = await session.run({ [session.inputNames[0]]: tensor });
    const output = results[session.outputNames[0]];

    return nonMaxSuppression(decodeYolox(
      output.data,
      output.dims,
      inputSize,
      prepared.ratio,
      width,
      height,
      allowedClassIds,
    ));
  },
};

/**
 * Used when the runtime or the model cannot load. It never claims to see an
 * object, so the view falls back to a plain stream instead of inventing boxes.
 */
const unavailableDetector = {
  id: 'unavailable',
  available: () => true,
  async load() {},
  async detectObjects() { return []; },
};

let cached;

/** Resolves to a loaded detector; never rejects. */
export const createObjectDetector = async () => {
  if (cached) return cached;

  if (yoloxDetector.available()) {
    try {
      await yoloxDetector.load();
      cached = yoloxDetector;
      return cached;
    } catch (error) {
      console.warn('Object detection model failed to load; the stream will play without boxes.', error);
    }
  }

  cached = unavailableDetector;
  return cached;
};

/** Maps class names to the indices the model emits. */
export const classIdsFor = (names) => new Set(
  names.map((name) => COCO_CLASSES.indexOf(name)).filter((index) => index >= 0),
);

/**
 * Counts per label, highest first — what the view shows as chips. classId
 * rides along so a chip can take the same colour as its boxes.
 */
export const summarise = (detections) => {
  const counts = new Map();
  for (const detection of detections) {
    const entry = counts.get(detection.label) || { label: detection.label, classId: detection.classId, count: 0 };
    entry.count += 1;
    counts.set(detection.label, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
};
