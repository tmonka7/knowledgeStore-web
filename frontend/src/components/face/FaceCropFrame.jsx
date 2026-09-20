import { useCallback, useEffect, useRef } from 'react';
import { clampRect } from '../../lib/faceCrop';

const HANDLES = [
  { id: 'nw', x: 0, y: 0, label: 'top left' },
  { id: 'n', x: 0.5, y: 0, label: 'top' },
  { id: 'ne', x: 1, y: 0, label: 'top right' },
  { id: 'e', x: 1, y: 0.5, label: 'right' },
  { id: 'se', x: 1, y: 1, label: 'bottom right' },
  { id: 's', x: 0.5, y: 1, label: 'bottom' },
  { id: 'sw', x: 0, y: 1, label: 'bottom left' },
  { id: 'w', x: 0, y: 0.5, label: 'left' },
];

const MIN_SIZE = 0.12;
const KEY_STEP = 0.02;

/**
 * Draggable / resizable crop rectangle in normalised (0..1) coordinates.
 *
 * Pointer Events cover mouse, touch and pen with one code path; arrow keys move
 * the frame and shift+arrows resize it so the control is usable without a
 * pointer at all.
 */
export default function FaceCropFrame({ rect, onChange, tone = 'idle', disabled = false }) {
  const rootRef = useRef(null);
  const dragRef = useRef(null);

  const resolve = useCallback((event) => {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds?.height) return null;
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
  }, []);

  const beginDrag = (event, handle) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const point = resolve(event);
    if (!point) return;

    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { handle, origin: point, start: { ...rect }, pointerId: event.pointerId };
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = resolve(event);
    if (!point) return;

    const dx = point.x - drag.origin.x;
    const dy = point.y - drag.origin.y;
    const start = drag.start;

    if (drag.handle === 'move') {
      onChange(clampRect({ ...start, x: start.x + dx, y: start.y + dy }));
      return;
    }

    // Resizing works on edges so opposite sides stay put.
    let left = start.x;
    let top = start.y;
    let right = start.x + start.width;
    let bottom = start.y + start.height;

    if (drag.handle.includes('w')) left = Math.min(start.x + dx, right - MIN_SIZE);
    if (drag.handle.includes('e')) right = Math.max(start.x + start.width + dx, left + MIN_SIZE);
    if (drag.handle.includes('n')) top = Math.min(start.y + dy, bottom - MIN_SIZE);
    if (drag.handle.includes('s')) bottom = Math.max(start.y + start.height + dy, top + MIN_SIZE);

    onChange(clampRect({
      x: Math.max(0, left),
      y: Math.max(0, top),
      width: Math.min(1, right) - Math.max(0, left),
      height: Math.min(1, bottom) - Math.max(0, top),
    }));
  };

  const endDrag = (event) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      dragRef.current = null;
    }
  };

  const onKeyDown = (event) => {
    if (disabled) return;
    const deltas = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();

    const [dx, dy] = delta;
    if (event.shiftKey) {
      onChange(clampRect({
        ...rect,
        width: Math.max(MIN_SIZE, rect.width + dx),
        height: Math.max(MIN_SIZE, rect.height + dy),
      }));
      return;
    }
    onChange(clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }));
  };

  // A pointer released outside the window would otherwise leave a drag stuck on.
  useEffect(() => {
    const cancel = () => { dragRef.current = null; };
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, []);

  const style = {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };

  return (
    <div className="face-crop-layer" ref={rootRef}>
      <div
        className={`face-crop-frame is-${tone}${disabled ? ' is-disabled' : ''}`}
        style={style}
        role="group"
        aria-label="Face crop area. Use the arrow keys to move it, or hold shift and use the arrow keys to resize it."
        tabIndex={disabled ? -1 : 0}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => beginDrag(event, 'move')}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
      >
        <span className="face-crop-grid" aria-hidden="true" />
        {HANDLES.map((handle) => (
          <span
            key={handle.id}
            className={`face-crop-handle handle-${handle.id}`}
            role="button"
            tabIndex={-1}
            aria-label={`Resize from the ${handle.label}`}
            onPointerDown={(event) => beginDrag(event, handle.id)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
          />
        ))}
      </div>
    </div>
  );
}
