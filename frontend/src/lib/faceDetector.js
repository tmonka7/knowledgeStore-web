/**
 * Face detection behind a narrow interface so the engine can be swapped.
 *
 * A detector implements:
 *   load()                      -> Promise<void>
 *   detectFace(source)          -> Promise<Detection | null>
 *   getFaceBoundingBox(det)     -> Box
 *   isFaceInsideFrame(box, rect)-> boolean
 *   getFaceQuality(source, box) -> Quality
 *
 * Boxes and rects are NORMALISED to 0..1 of the source's intrinsic size, so
 * nothing downstream has to care about video resolution or CSS pixels. To move
 * to MediaPipe / ONNX / a server API, write another object with these five
 * methods and return it from createFaceDetector().
 */

// Tuning shared by the detector and the UI copy.
export const FACE_RULES = {
  minFaceRatio: 0.12, // face width relative to the crop rect
  maxFaceRatio: 0.95,
  minCoverage: 0.88, // fraction of the face box that must sit inside the rect
  minBrightness: 0.16,
  maxBrightness: 0.96,
};

export const DIAGNOSIS = {
  OK: { code: 'OK', tone: 'success', title: 'Face detected — position is good', hint: 'You can capture now.' },
  NO_FACE: { code: 'NO_FACE', tone: 'idle', title: 'No face detected', hint: 'Please position your face inside the frame.' },
  TOO_SMALL: { code: 'TOO_SMALL', tone: 'warning', title: 'Move closer', hint: 'Your face is too small.' },
  TOO_LARGE: { code: 'TOO_LARGE', tone: 'warning', title: 'Move farther away', hint: 'Your face is too large.' },
  OUTSIDE_FRAME: { code: 'OUTSIDE_FRAME', tone: 'warning', title: 'Face partially outside frame', hint: 'Move your face completely inside the rectangle.' },
  POOR_LIGHT: { code: 'POOR_LIGHT', tone: 'warning', title: 'Poor lighting', hint: 'Please move to a brighter area.' },
  DETECTOR_OFF: { code: 'DETECTOR_OFF', tone: 'idle', title: 'Position your face inside the frame', hint: 'Automatic detection is unavailable, so check the framing yourself.' },
};

export const CAMERA_ERRORS = {
  PERMISSION_DENIED: { code: 'PERMISSION_DENIED', title: 'Camera access required', hint: 'Please allow camera access to register your face.' },
  NO_DEVICE: { code: 'NO_DEVICE', title: 'Camera unavailable', hint: 'No camera device was found. Please check your camera connection.' },
  UNAVAILABLE: { code: 'UNAVAILABLE', title: 'Camera unavailable', hint: 'Please check your camera connection.' },
  UNSUPPORTED: { code: 'UNSUPPORTED', title: 'Camera unavailable', hint: 'This browser cannot open a camera. Upload a photo instead.' },
};

const MODEL_URL = '/face-api-model';

export const sourceSize = (source) => ({
  width: source?.videoWidth || source?.naturalWidth || source?.width || 0,
  height: source?.videoHeight || source?.naturalHeight || source?.height || 0,
});

/** Area of the intersection of two normalised rects. */
const intersectionArea = (a, b) => {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
};

const baseDetector = {
  getFaceBoundingBox: (detection) => detection?.box || null,

  isFaceInsideFrame(box, rect, minCoverage = FACE_RULES.minCoverage) {
    if (!box || !rect) return false;
    const faceArea = box.width * box.height;
    if (faceArea <= 0) return false;
    return intersectionArea(box, rect) / faceArea >= minCoverage;
  },

  /**
   * Mean luminance of the region, plus how much of the rect the face fills.
   * Sampling a downscaled copy keeps this cheap enough to run per frame.
   */
  getFaceQuality(source, box, rect) {
    const { width, height } = sourceSize(source);
    if (!width || !height || !box) return { brightness: null, sizeRatio: 0 };

    const sizeRatio = rect?.width ? box.width / rect.width : box.width;
    let brightness = null;

    try {
      const sample = document.createElement('canvas');
      sample.width = 32;
      sample.height = 32;
      const context = sample.getContext('2d', { willReadFrequently: true });
      context.drawImage(
        source,
        box.x * width, box.y * height, box.width * width, box.height * height,
        0, 0, 32, 32,
      );
      const { data } = context.getImageData(0, 0, 32, 32);
      let total = 0;
      for (let index = 0; index < data.length; index += 4) {
        // Rec. 601 luma — close enough for a lighting check.
        total += (0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]);
      }
      brightness = total / (data.length / 4) / 255;
    } catch {
      // A tainted canvas (cross-origin frame) just means no lighting check.
      brightness = null;
    }

    return { brightness, sizeRatio };
  },
};

/** face-api.js implementation, using the models already served from /public. */
const faceApiDetector = {
  ...baseDetector,
  id: 'face-api',
  available: () => typeof window !== 'undefined' && Boolean(window.faceapi),

  async load() {
    const faceapi = window.faceapi;
    if (!faceapi) throw new Error('face-api is not loaded.');
    if (!this._loading) {
      this._loading = Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      ]).catch((error) => {
        this._loading = null;
        throw error;
      });
    }
    await this._loading;
  },

  async detectFace(source) {
    const faceapi = window.faceapi;
    const { width, height } = sourceSize(source);
    if (!faceapi || !width || !height) return null;

    const result = await faceapi.detectSingleFace(
      source,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 }),
    );
    if (!result) return null;

    const { box } = result;
    return {
      score: result.score,
      box: {
        x: box.x / width,
        y: box.y / height,
        width: box.width / width,
        height: box.height / height,
      },
    };
  },
};

/**
 * Used when face-api or its models cannot load. It never claims to see a face,
 * so the UI falls back to manual framing instead of inventing a detection.
 */
const unavailableDetector = {
  ...baseDetector,
  id: 'unavailable',
  available: () => true,
  async load() {},
  async detectFace() { return null; },
};

let cached;

/** Resolves to a loaded detector; never rejects. */
export const createFaceDetector = async () => {
  if (cached) return cached;

  if (faceApiDetector.available()) {
    try {
      await faceApiDetector.load();
      cached = faceApiDetector;
      return cached;
    } catch (error) {
      console.warn('Face detection models failed to load; manual framing only.', error);
    }
  }

  cached = unavailableDetector;
  return cached;
};

/** Maps a detection plus the current crop rect to one of the DIAGNOSIS states. */
export const diagnose = ({ detector, detection, rect, quality }) => {
  if (detector?.id === 'unavailable') return DIAGNOSIS.DETECTOR_OFF;
  if (!detection) return DIAGNOSIS.NO_FACE;

  const box = detector.getFaceBoundingBox(detection);
  if (!detector.isFaceInsideFrame(box, rect)) return DIAGNOSIS.OUTSIDE_FRAME;

  const ratio = quality?.sizeRatio ?? 0;
  if (ratio < FACE_RULES.minFaceRatio) return DIAGNOSIS.TOO_SMALL;
  if (ratio > FACE_RULES.maxFaceRatio) return DIAGNOSIS.TOO_LARGE;

  const { brightness } = quality || {};
  if (brightness !== null && brightness !== undefined
    && (brightness < FACE_RULES.minBrightness || brightness > FACE_RULES.maxBrightness)) {
    return DIAGNOSIS.POOR_LIGHT;
  }

  return DIAGNOSIS.OK;
};

/** Translates a getUserMedia rejection into one of CAMERA_ERRORS. */
export const cameraErrorFor = (error) => {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return CAMERA_ERRORS.PERMISSION_DENIED;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return CAMERA_ERRORS.NO_DEVICE;
    case 'NotReadableError':
    case 'AbortError':
      return CAMERA_ERRORS.UNAVAILABLE;
    default:
      return CAMERA_ERRORS.UNAVAILABLE;
  }
};
