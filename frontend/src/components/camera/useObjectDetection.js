import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DETECTION_STATUS,
  createObjectDetector,
  summarise,
} from '../../lib/objectDetector';

/** How often a frame is sampled. YOLOX-Nano on wasm needs ~150-300ms a frame. */
const DETECT_INTERVAL = 500;

/**
 * Runs the detector over a media element while `enabled`.
 *
 * Returns { status, detections, summary }. `status` is one of DETECTION_STATUS
 * and is the single place the view learns why it is not seeing boxes — a
 * runtime that never loaded, an rtsp:// address with no pixels, or a camera
 * that sends no CORS headers all surface here instead of looking like an empty
 * scene.
 *
 * `sourceRef` points at the <video> or <img> showing the stream; `ready` tells
 * the loop that element has actually decoded a frame, and `sourceFailed` that
 * it never will.
 */
export default function useObjectDetection({
  enabled,
  sourceRef,
  ready,
  sourceFailed,
  mediaKind,
  classFilter,
}) {
  const [status, setStatus] = useState(DETECTION_STATUS.OFF);
  const [detections, setDetections] = useState([]);
  const detectorRef = useRef(null);

  // A Set identity changing every render would restart the loop each time.
  const allowed = useMemo(
    () => (classFilter && classFilter.size ? classFilter : null),
    [classFilter],
  );

  useEffect(() => {
    if (!enabled) {
      setStatus(DETECTION_STATUS.OFF);
      setDetections([]);
      return undefined;
    }

    // rtsp:// and other non-HTTP addresses never reach a canvas, so say so
    // rather than spinning on a model that has nothing to read.
    if (mediaKind === 'none') {
      setStatus(DETECTION_STATUS.UNSUPPORTED_SOURCE);
      setDetections([]);
      return undefined;
    }

    // The element gave up on the address, so no frame is ever coming. Say that
    // rather than sitting on LOADING for the rest of the session.
    if (sourceFailed) {
      setStatus(DETECTION_STATUS.SOURCE_ERROR);
      setDetections([]);
      return undefined;
    }

    let cancelled = false;
    let timer = null;
    let busy = false;

    // Only on a genuinely cold start: this effect also re-runs when the class
    // filter changes, and the model is cached by then.
    if (!detectorRef.current) setStatus(DETECTION_STATUS.LOADING);

    const tick = async () => {
      const detector = detectorRef.current;
      const source = sourceRef.current;
      if (busy || cancelled || !detector || !source) return;

      busy = true;
      try {
        const found = await detector.detectObjects(source, allowed);
        if (cancelled) return;
        setDetections(found);
        setStatus(DETECTION_STATUS.RUNNING);
      } catch (error) {
        if (cancelled) return;
        // A tainted canvas will never recover on its own, so stop the loop and
        // explain it; anything else is treated as a transient decode hiccup.
        if (error?.code === 'BLOCKED_BY_CORS') {
          setStatus(DETECTION_STATUS.BLOCKED_BY_CORS);
          setDetections([]);
          clearInterval(timer);
        }
      } finally {
        busy = false;
      }
    };

    createObjectDetector().then((detector) => {
      if (cancelled) return;
      detectorRef.current = detector;

      if (detector.id === 'unavailable') {
        setStatus(typeof window !== 'undefined' && window.ort
          ? DETECTION_STATUS.MODEL_FAILED
          : DETECTION_STATUS.NO_RUNTIME);
        return;
      }

      // Hold at LOADING until the element has a frame; detecting on a video
      // with no dimensions yet just burns a model run on nothing.
      if (!ready) return;
      timer = setInterval(tick, DETECT_INTERVAL);
      tick();
    });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [enabled, ready, sourceFailed, mediaKind, allowed, sourceRef]);

  const summary = useMemo(() => summarise(detections), [detections]);

  return { status, detections, summary };
}
