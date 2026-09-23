import { useCallback, useEffect, useRef } from 'react';
import { colorForClass } from '../../lib/objectDetector';
import { boundsOf, hitTest } from '../../lib/yoloDataset';

/**
 * The drawing surface.
 *
 * The image and the shapes share one canvas rather than being an <img> with an
 * overlay on top. Hit testing then happens in the same coordinate space the
 * pixels are in, and there is no second element to keep aligned as the window
 * resizes — the letterbox is computed once per frame and everything, drawing
 * and clicking alike, goes through it.
 *
 * Shapes arrive and leave normalised to the image (0..1). Nothing here stores
 * a pixel coordinate, so the same labels come back identically on a different
 * monitor or at a different window size.
 */

/** Below this, a drag is a click that slipped rather than a box. */
const MIN_SIZE = 0.004;

/** Click radius for a resize handle and for closing a polygon, in CSS pixels. */
const HANDLE_PX = 9;
const CLOSE_PX = 12;

const CORNERS = ['nw', 'ne', 'se', 'sw'];

const newId = () => (window.crypto?.randomUUID
  ? window.crypto.randomUUID()
  : `s${Date.now()}${Math.random().toString(16).slice(2, 8)}`);

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Where an image letterboxed into the stage actually lands. */
const layoutOf = (stageWidth, stageHeight, image) => {
  const scale = Math.min(stageWidth / image.naturalWidth, stageHeight / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  return { left: (stageWidth - width) / 2, top: (stageHeight - height) / 2, width, height };
};

const cornerPoint = (box, corner) => ({
  x: corner === 'nw' || corner === 'sw' ? box.x : box.x + box.w,
  y: corner === 'nw' || corner === 'ne' ? box.y : box.y + box.h,
});

/** A box from two corners, in any drag direction. */
const boxFromPoints = (ax, ay, bx, by) => ({
  x: Math.min(ax, bx),
  y: Math.min(ay, by),
  w: Math.abs(bx - ax),
  h: Math.abs(by - ay),
});

export default function LabelCanvas({
  imageUrl,
  shapeKind,
  classId,
  classes,
  shapes,
  selectedId,
  onSelect,
  onChange,
  onImageLoaded,
}) {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);

  // The in-progress gesture. Held in a ref, not state: it changes on every
  // pointermove and a re-render per move would make dragging feel heavy for
  // no benefit — nothing outside this canvas needs to see a half-drawn box.
  const draftRef = useRef(null);
  const pointerRef = useRef(null);

  // Read by the draw loop, which must not close over a stale render.
  const viewRef = useRef({ shapes, selectedId, classes, classId, shapeKind });
  viewRef.current = { shapes, selectedId, classes, classId, shapeKind };

  const drawRef = useRef(() => {});

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image?.naturalWidth) return;

    const stageWidth = canvas.clientWidth;
    const stageHeight = canvas.clientHeight;
    if (!stageWidth || !stageHeight) return;

    // Match the backing store to the device pixel ratio, or a 2px outline on a
    // HiDPI screen lands on a half pixel and reads as blurry.
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(stageWidth * ratio)) canvas.width = Math.round(stageWidth * ratio);
    if (canvas.height !== Math.round(stageHeight * ratio)) canvas.height = Math.round(stageHeight * ratio);

    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, stageWidth, stageHeight);

    const view = layoutOf(stageWidth, stageHeight, image);
    context.drawImage(image, view.left, view.top, view.width, view.height);

    const toStageX = (x) => view.left + x * view.width;
    const toStageY = (y) => view.top + y * view.height;

    const { shapes: committed, selectedId: selected, classes: names } = viewRef.current;

    // A move or a resize is previewed from the draft and only written to state
    // when the pointer comes up. Committing on every move instead would put a
    // React render between the mouse and the outline, for a shape that is not
    // final yet either way.
    const preview = draftRef.current?.preview;
    const list = preview
      ? committed.map((shape) => (shape.id === preview.id ? preview : shape))
      : committed;

    list.forEach((shape) => {
      const colour = colorForClass(shape.classId);
      const isSelected = shape.id === selected;

      context.lineWidth = isSelected ? 3 : 2;
      context.strokeStyle = colour;
      context.fillStyle = isSelected ? `${colour.slice(0, -1)} / 28%)` : `${colour.slice(0, -1)} / 14%)`;

      context.beginPath();
      if (shape.type === 'box') {
        context.rect(toStageX(shape.x), toStageY(shape.y), shape.w * view.width, shape.h * view.height);
      } else {
        shape.points.forEach(([x, y], index) => {
          if (index === 0) context.moveTo(toStageX(x), toStageY(y));
          else context.lineTo(toStageX(x), toStageY(y));
        });
        context.closePath();
      }
      context.fill();
      context.stroke();

      // The class name sits above the shape, or inside it when the shape is
      // against the top edge and there is no room above.
      const bounds = boundsOf(shape);
      const label = names[shape.classId] || `class ${shape.classId}`;
      context.font = '600 12px system-ui, sans-serif';
      const textWidth = context.measureText(label).width;
      const labelX = toStageX(bounds.x);
      const above = toStageY(bounds.y) - 20;
      const labelY = above < view.top ? toStageY(bounds.y) + 2 : above;

      context.fillStyle = colour;
      context.fillRect(labelX, labelY, textWidth + 12, 18);
      context.fillStyle = '#0f172a';
      context.textBaseline = 'middle';
      context.fillText(label, labelX + 6, labelY + 9);

      // Handles only on the selected box: they are for resizing, and a
      // polygon is not resized from its corners.
      if (isSelected && shape.type === 'box') {
        context.fillStyle = '#ffffff';
        context.strokeStyle = colour;
        context.lineWidth = 2;
        CORNERS.forEach((corner) => {
          const point = cornerPoint(bounds, corner);
          context.beginPath();
          context.rect(toStageX(point.x) - 5, toStageY(point.y) - 5, 10, 10);
          context.fill();
          context.stroke();
        });
      }
    });

    const draft = draftRef.current;
    if (!draft) return;

    context.setLineDash([6, 4]);
    context.lineWidth = 2;
    context.strokeStyle = colorForClass(viewRef.current.classId);

    if (draft.kind === 'box') {
      const box = boxFromPoints(draft.startX, draft.startY, draft.x, draft.y);
      context.strokeRect(toStageX(box.x), toStageY(box.y), box.w * view.width, box.h * view.height);
    }

    if (draft.kind === 'polygon') {
      context.beginPath();
      draft.points.forEach(([x, y], index) => {
        if (index === 0) context.moveTo(toStageX(x), toStageY(y));
        else context.lineTo(toStageX(x), toStageY(y));
      });
      // The rubber band to the cursor is what makes the next edge predictable.
      if (pointerRef.current) context.lineTo(toStageX(pointerRef.current.x), toStageY(pointerRef.current.y));
      context.stroke();

      context.setLineDash([]);
      const [firstX, firstY] = draft.points[0];
      context.fillStyle = draft.points.length >= 3 ? '#22c55e' : '#ffffff';
      context.strokeStyle = colorForClass(viewRef.current.classId);
      context.beginPath();
      context.arc(toStageX(firstX), toStageY(firstY), 6, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }

    context.setLineDash([]);
  }, []);

  drawRef.current = draw;

  // Loading the image, and telling the parent how big it turned out to be —
  // the natural size is what every stored coordinate is a fraction of.
  useEffect(() => {
    if (!imageUrl) return undefined;

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      onImageLoaded?.({ width: image.naturalWidth, height: image.naturalHeight });
      drawRef.current();
    };
    image.src = imageUrl;

    return () => {
      cancelled = true;
      imageRef.current = null;
      draftRef.current = null;
    };
  }, [imageUrl, onImageLoaded]);

  // Redraw whenever anything visible changes, and whenever the stage resizes.
  useEffect(() => { draw(); });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  /** Pointer position as a fraction of the image, clamped to it. */
  const positionOf = (event) => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image?.naturalWidth) return null;

    const rect = canvas.getBoundingClientRect();
    const view = layoutOf(canvas.clientWidth, canvas.clientHeight, image);
    return {
      x: clamp01((event.clientX - rect.left - view.left) / view.width),
      y: clamp01((event.clientY - rect.top - view.top) / view.height),
      // Handle sizes are in screen pixels; this converts them once.
      tolX: HANDLE_PX / view.width,
      tolY: HANDLE_PX / view.height,
      closeX: CLOSE_PX / view.width,
      closeY: CLOSE_PX / view.height,
    };
  };

  /** The topmost shape under the pointer, so overlapping labels stay reachable. */
  const shapeAt = (x, y) => [...shapes].reverse().find((shape) => hitTest(shape, x, y)) || null;

  const handleAt = (shape, position) => {
    if (!shape || shape.type !== 'box') return null;
    const bounds = boundsOf(shape);
    return CORNERS.find((corner) => {
      const point = cornerPoint(bounds, corner);
      return Math.abs(point.x - position.x) <= position.tolX
        && Math.abs(point.y - position.y) <= position.tolY;
    }) || null;
  };

  const commitPolygon = (points) => {
    draftRef.current = null;
    pointerRef.current = null;
    if (points.length < 3) {
      draw();
      return;
    }
    const shape = { id: newId(), type: 'polygon', classId, points };
    onChange([...shapes, shape]);
    onSelect(shape.id);
  };

  const onPointerDown = (event) => {
    const position = positionOf(event);
    if (!position) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);

    if (shapeKind === 'polygon') {
      const draft = draftRef.current;

      if (draft?.kind === 'polygon') {
        const [firstX, firstY] = draft.points[0];
        const closing = draft.points.length >= 3
          && Math.abs(firstX - position.x) <= position.closeX
          && Math.abs(firstY - position.y) <= position.closeY;

        if (closing) commitPolygon(draft.points);
        else {
          draft.points.push([position.x, position.y]);
          draw();
        }
        return;
      }

      // Nothing in progress: a click is either picking a shape or starting one.
      const hit = shapeAt(position.x, position.y);
      if (hit) {
        onSelect(hit.id);
        draftRef.current = {
          kind: 'move', id: hit.id, startX: position.x, startY: position.y, origin: hit,
        };
        return;
      }

      draftRef.current = { kind: 'polygon', points: [[position.x, position.y]] };
      pointerRef.current = { x: position.x, y: position.y };
      draw();
      return;
    }

    const selected = shapes.find((shape) => shape.id === selectedId);
    const corner = handleAt(selected, position);
    if (corner) {
      draftRef.current = {
        kind: 'resize', id: selected.id, corner, origin: boundsOf(selected), shape: selected,
      };
      return;
    }

    const hit = shapeAt(position.x, position.y);
    if (hit) {
      onSelect(hit.id);
      draftRef.current = {
        kind: 'move', id: hit.id, startX: position.x, startY: position.y, origin: hit,
      };
      return;
    }

    onSelect(null);
    draftRef.current = {
      kind: 'box', startX: position.x, startY: position.y, x: position.x, y: position.y,
    };
  };

  const onPointerMove = (event) => {
    const position = positionOf(event);
    if (!position) return;

    const draft = draftRef.current;
    if (draft?.kind === 'polygon') {
      pointerRef.current = { x: position.x, y: position.y };
      draw();
      return;
    }
    if (!draft) return;

    if (draft.kind === 'box') {
      draft.x = position.x;
      draft.y = position.y;
      draw();
      return;
    }

    if (draft.kind === 'move') {
      // Translation is clamped by the shape's own bounds, so dragging past the
      // edge slides the shape along it instead of pushing part of it outside.
      const bounds = boundsOf(draft.origin);
      const dx = Math.min(1 - bounds.x - bounds.w, Math.max(-bounds.x, position.x - draft.startX));
      const dy = Math.min(1 - bounds.y - bounds.h, Math.max(-bounds.y, position.y - draft.startY));

      draft.preview = draft.origin.type === 'box'
        ? { ...draft.origin, x: draft.origin.x + dx, y: draft.origin.y + dy }
        : {
          ...draft.origin,
          points: draft.origin.points.map(([x, y]) => [clamp01(x + dx), clamp01(y + dy)]),
        };
      draw();
      return;
    }

    if (draft.kind === 'resize') {
      const fixed = cornerPoint(draft.origin, {
        nw: 'se', ne: 'sw', se: 'nw', sw: 'ne',
      }[draft.corner]);
      draft.preview = { ...draft.shape, ...boxFromPoints(fixed.x, fixed.y, position.x, position.y) };
      draw();
    }
  };

  const onPointerUp = (event) => {
    const draft = draftRef.current;
    try {
      // Throws when the pointer is not captured, which is exactly the state a
      // pointercancel arrives in — and this handler serves both events.
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Already released.
    }

    // A polygon is finished by closing it, not by lifting the button, so the
    // gesture survives pointerup untouched.
    if (!draft || draft.kind === 'polygon') return;

    if (draft.kind === 'box') {
      const box = boxFromPoints(draft.startX, draft.startY, draft.x, draft.y);
      draftRef.current = null;

      if (box.w < MIN_SIZE || box.h < MIN_SIZE) {
        draw();
        return;
      }

      const shape = { id: newId(), type: 'box', classId, ...box };
      onChange([...shapes, shape]);
      onSelect(shape.id);
      return;
    }

    // A move or a resize has been previewed from the draft; this is where it
    // becomes real.
    const { preview } = draft;
    draftRef.current = null;

    if (!preview) {
      draw();
      return;
    }

    // A resize collapsed to nothing would otherwise leave an invisible shape
    // behind that still exports as a label.
    if (preview.type === 'box' && (preview.w < MIN_SIZE || preview.h < MIN_SIZE)) {
      onChange(shapes.filter((entry) => entry.id !== preview.id));
      onSelect(null);
      return;
    }

    onChange(shapes.map((entry) => (entry.id === preview.id ? preview : entry)));
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      // Never steal a keystroke from a text field — class names are typed.
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;

      const draft = draftRef.current;

      if (event.key === 'Escape') {
        if (draft) { draftRef.current = null; pointerRef.current = null; draw(); }
        else onSelect(null);
        return;
      }

      if (draft?.kind === 'polygon') {
        if (event.key === 'Enter') { commitPolygon(draft.points); return; }
        if (event.key === 'Backspace') {
          event.preventDefault();
          draft.points.pop();
          if (!draft.points.length) draftRef.current = null;
          draw();
          return;
        }
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        onChange(shapes.filter((shape) => shape.id !== selectedId));
        onSelect(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <canvas
      ref={canvasRef}
      className="yolo-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => {
        const draft = draftRef.current;
        if (draft?.kind === 'polygon') commitPolygon(draft.points);
      }}
    />
  );
}
