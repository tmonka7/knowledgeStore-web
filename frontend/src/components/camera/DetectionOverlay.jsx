import { useEffect, useRef } from 'react';
import { colorForClass } from '../../lib/objectDetector';

/**
 * Draws detection boxes on a canvas sitting over the stream.
 *
 * Boxes arrive normalised to the SOURCE frame, but the media element is laid
 * out with `object-fit: contain` while detection is on, so the frame is
 * letterboxed inside the stage. containRect() reproduces that letterbox and
 * every box is mapped through it — otherwise the outlines drift away from the
 * objects whenever the stream's aspect ratio differs from the stage's.
 */

/** Where an object-fit: contain frame actually lands inside the stage. */
const containRect = (sourceW, sourceH, stageW, stageH) => {
  const scale = Math.min(stageW / sourceW, stageH / sourceH);
  const width = sourceW * scale;
  const height = sourceH * scale;
  return { left: (stageW - width) / 2, top: (stageH - height) / 2, width, height };
};

export default function DetectionOverlay({ detections, sourceRef, showLabels = true }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const source = sourceRef?.current;
    if (!canvas) return undefined;

    const draw = () => {
      const stageW = canvas.clientWidth;
      const stageH = canvas.clientHeight;
      if (!stageW || !stageH) return;

      // Match the backing store to the device pixel ratio so 2px strokes and
      // 12px labels stay crisp on a HiDPI monitor.
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(stageW * ratio) || canvas.height !== Math.round(stageH * ratio)) {
        canvas.width = Math.round(stageW * ratio);
        canvas.height = Math.round(stageH * ratio);
      }

      const context = canvas.getContext('2d');
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, stageW, stageH);

      const sourceW = source?.videoWidth || source?.naturalWidth || 0;
      const sourceH = source?.videoHeight || source?.naturalHeight || 0;
      if (!sourceW || !sourceH || !detections?.length) return;

      const frame = containRect(sourceW, sourceH, stageW, stageH);
      context.lineWidth = 2;
      context.font = '600 12px Inter, system-ui, sans-serif';
      context.textBaseline = 'top';

      for (const detection of detections) {
        const color = colorForClass(detection.classId);
        const x = frame.left + detection.box.x * frame.width;
        const y = frame.top + detection.box.y * frame.height;
        const width = detection.box.width * frame.width;
        const height = detection.box.height * frame.height;

        context.strokeStyle = color;
        context.strokeRect(x, y, width, height);

        if (!showLabels) continue;

        const text = detection.label + ' ' + Math.round(detection.score * 100) + '%';
        const textWidth = context.measureText(text).width;
        // Flip the tag inside the box when the detection touches the top edge.
        const tagY = y - 18 < frame.top ? y + 2 : y - 18;

        context.fillStyle = color;
        context.fillRect(x, tagY, textWidth + 10, 16);
        context.fillStyle = '#0b121f';
        context.fillText(text, x + 5, tagY + 2);
      }
    };

    draw();

    // The stage is responsive and the panel can reflow, so redraw on resize
    // rather than assuming the canvas keeps the size it had on mount.
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [detections, sourceRef, showLabels]);

  return <canvas ref={canvasRef} className="vision-detect-overlay" aria-hidden="true" />;
}
