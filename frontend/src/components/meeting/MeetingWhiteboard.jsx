import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal, Segmented, Tooltip } from 'antd';
import {
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useLanguage } from '../../i18n';

/*
 * The shared whiteboard.
 *
 * Strokes are held by the room and relayed through the same socket that
 * carries the call, so what is drawn here is drawn on everybody's board. They
 * are stored as fractions of the board rather than as pixels: the canvas is a
 * different size on every screen in the call, and a line has to land in the
 * same place on all of them.
 *
 * Widths are in thousandths of the board's height for the same reason — a pen
 * two pixels wide is a hairline on a desktop and a smear on a phone, whereas
 * this keeps the drawing proportional to the surface it was drawn on.
 *
 * The board is not saved anywhere. It lives with the room and is gone when the
 * last person leaves, which is why the toolbar has a download button.
 */

const COLOURS = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#d97706', '#9333ea'];
const SIZES = [4, 10, 22];

// An eraser the width of a pen is useless for anything but taking back a
// single line, and the pen widths are already chosen to be fine.
const ERASER_SCALE = 4;

// How often the pen's position goes out to the room. Under about 50ms the
// batches are mostly one point each and the socket does more work than the
// drawing is worth; much over it and the line visibly catches up in steps.
const SEND_INTERVAL_MS = 60;

// Two thousandths of the board — roughly a pixel on a large screen. Below this
// a resting hand fills the stroke with points that draw nothing.
const MIN_STEP = 0.002;

const strokeId = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/**
 * One stroke onto the canvas, in device pixels.
 *
 * The eraser is `destination-out` rather than a stroke in the background
 * colour: the canvas itself is transparent and the board's background comes
 * from CSS, so erasing genuinely removes ink instead of painting over it in a
 * colour that has to be kept in step with the theme.
 */
const paint = (ctx, stroke, width, height) => {
  const { points } = stroke;
  if (!points || points.length < 2) return;

  const lineWidth = Math.max(1, (stroke.size / 1000) * height);

  ctx.globalCompositeOperation = stroke.mode === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.colour;
  ctx.fillStyle = stroke.colour;
  ctx.lineWidth = lineWidth;

  // A tap is a dot. Left as a zero-length path it would draw nothing at all,
  // and a pen that does nothing when you tap it reads as a broken pen.
  if (points.length === 2) {
    ctx.beginPath();
    ctx.arc(points[0] * width, points[1] * height, lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0] * width, points[1] * height);
  for (let index = 2; index < points.length; index += 2) {
    ctx.lineTo(points[index] * width, points[index + 1] * height);
  }
  ctx.stroke();
};

export default function MeetingWhiteboard({ whiteboard, onClose }) {
  const { t } = useLanguage();
  const [tool, setTool] = useState('pen');
  const [colour, setColour] = useState(COLOURS[0]);
  const [size, setSize] = useState(SIZES[0]);

  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  // The stroke being drawn right now. Held outside React so the line keeps up
  // with the hand rather than with the render loop.
  const liveRef = useRef(null);
  // How many coordinates of the live stroke the room has already been told
  // about, so an append sends the tail and not the whole thing again.
  const sentRef = useRef(0);
  const lastSendRef = useRef(0);

  const { strokes, epoch } = whiteboard;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const live = liveRef.current;
    for (const stroke of strokes) {
      // Once a stroke is committed it is in both places for a moment. Drawing
      // the ref's copy and skipping the room's keeps it from being laid down
      // twice, which a translucent colour would show as a darker line.
      if (live && stroke.id === live.id) continue;
      paint(ctx, stroke, width, height);
    }
    if (live) paint(ctx, live, width, height);

    ctx.globalCompositeOperation = 'source-over';
  }, [strokes]);

  // Coalesced: a fast pen produces pointer events well above the refresh rate,
  // and repainting the whole board for each of them is work nobody ever sees.
  const requestRedraw = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      redraw();
    });
  }, [redraw]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  /*
   * Somebody cleared the board while this pen was down.
   *
   * The stroke in progress was wiped on the server along with everything else,
   * so it has to be let go of here too — carrying on would finish a line that
   * this browser is alone in having, and it would sit there until the next
   * clear. The pointer handlers all bail on a null live stroke, so releasing it
   * is enough; nothing else has to know.
   */
  useEffect(() => {
    liveRef.current = null;
    requestRedraw();
  }, [epoch, requestRedraw]);

  /*
   * The canvas is sized in device pixels and laid out in CSS pixels. Without
   * this the browser stretches one to the other and every line on a high-DPI
   * screen — which is most of them — comes out soft.
   */
  // Read through a ref by the resize effect below, so that effect can depend on
  // nothing and subscribe once. Depending on `redraw` there would tear down and
  // rebuild the observer on every stroke anyone in the room draws.
  const redrawRef = useRef(redraw);
  redrawRef.current = redraw;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width === width && canvas.height === height) return;

      // Setting either dimension clears the canvas, so the board has to be
      // painted again afterwards — hence the redraw rather than a bare resize.
      canvas.width = width;
      canvas.height = height;
      redrawRef.current();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const toBoard = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    ];
  };

  const flush = (force) => {
    const stroke = liveRef.current;
    if (!stroke) return;

    const now = performance.now();
    if (!force && now - lastSendRef.current < SEND_INTERVAL_MS) return;

    const points = stroke.points.slice(sentRef.current);
    if (!points.length) return;

    sentRef.current = stroke.points.length;
    lastSendRef.current = now;
    whiteboard.append(stroke.id, points);
  };

  const onPointerDown = (event) => {
    // Right and middle buttons open menus and paste; neither should draw.
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const canvas = canvasRef.current;
    // Capture, so a stroke that leaves the canvas mid-drag still ends on this
    // element instead of being abandoned wherever the pointer happens to be.
    canvas.setPointerCapture(event.pointerId);

    const [x, y] = toBoard(event);
    const stroke = {
      id: strokeId(),
      colour,
      size: tool === 'eraser' ? Math.min(64, size * ERASER_SCALE) : size,
      mode: tool,
      points: [x, y],
    };

    liveRef.current = stroke;
    sentRef.current = stroke.points.length;
    lastSendRef.current = performance.now();
    whiteboard.begin(stroke);
    requestRedraw();
  };

  const onPointerMove = (event) => {
    const stroke = liveRef.current;
    if (!stroke) return;

    const [x, y] = toBoard(event);
    const points = stroke.points;
    const lastX = points[points.length - 2];
    const lastY = points[points.length - 1];
    if (Math.abs(x - lastX) < MIN_STEP && Math.abs(y - lastY) < MIN_STEP) return;

    points.push(x, y);
    requestRedraw();
    flush(false);
  };

  const onPointerUp = (event) => {
    const stroke = liveRef.current;
    if (!stroke) return;

    flush(true);
    canvasRef.current?.releasePointerCapture?.(event.pointerId);

    /*
     * The ref is cleared and the finished stroke handed to the room in the same
     * breath, with no repaint in between: the canvas already shows this line,
     * and the next repaint is the one the new strokes trigger. Redrawing here
     * instead would blank it for the frame between the two.
     */
    liveRef.current = null;
    whiteboard.commit({ ...stroke, points: [...stroke.points] });
  };

  const confirmClear = () => {
    Modal.confirm({
      title: t('clearBoardQuestion'),
      content: t('clearBoardWarning'),
      okText: t('clear'),
      okButtonProps: { danger: true },
      cancelText: t('cancel'),
      onOk: whiteboard.clear,
    });
  };

  /*
   * Flattened onto an opaque copy first. The board canvas is transparent so the
   * eraser can work, and a transparent PNG of black ink is invisible in most
   * things that open one.
   */
  const download = () => {
    const source = canvasRef.current;
    if (!source) return;

    const output = document.createElement('canvas');
    output.width = source.width;
    output.height = source.height;

    const ctx = output.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.drawImage(source, 0, 0);

    const link = document.createElement('a');
    link.download = `whiteboard-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    link.href = output.toDataURL('image/png');
    link.click();
  };

  return (
    <section className="meeting-board" aria-label={t('whiteboard')}>
      <div className="meeting-board-bar">
        <Segmented
          value={tool}
          onChange={setTool}
          options={[
            { label: t('pen'), value: 'pen' },
            { label: t('eraser'), value: 'eraser' },
          ]}
        />

        <div className="meeting-board-colours" role="group" aria-label={t('penColour')}>
          {COLOURS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`meeting-board-swatch${swatch === colour ? ' is-active' : ''}`}
              style={{ background: swatch }}
              aria-label={swatch}
              aria-pressed={swatch === colour}
              onClick={() => {
                setColour(swatch);
                // Picking a colour is asking to draw with it, so it takes the
                // eraser off rather than quietly changing what the eraser is.
                setTool('pen');
              }}
            />
          ))}
        </div>

        <div className="meeting-board-sizes" role="group" aria-label={t('penSize')}>
          {SIZES.map((option, index) => (
            <button
              key={option}
              type="button"
              className={`meeting-board-size${option === size ? ' is-active' : ''}`}
              aria-label={t(['strokeThin', 'strokeMedium', 'strokeThick'][index])}
              aria-pressed={option === size}
              onClick={() => setSize(option)}
            >
              <span style={{ width: 4 + index * 5, height: 4 + index * 5 }} />
            </button>
          ))}
        </div>

        <span className="meeting-board-spacer" />

        <Tooltip title={t('undoMyLastStroke')}>
          <Button
            icon={<UndoOutlined />}
            aria-label={t('undoMyLastStroke')}
            onClick={whiteboard.undo}
          />
        </Tooltip>

        <Tooltip title={t('downloadBoard')}>
          <Button
            icon={<DownloadOutlined />}
            aria-label={t('downloadBoard')}
            onClick={download}
          />
        </Tooltip>

        <Tooltip title={t('clearBoard')}>
          <Button
            danger
            icon={<DeleteOutlined />}
            aria-label={t('clearBoard')}
            onClick={confirmClear}
          />
        </Tooltip>

        <Tooltip title={t('close')}>
          <Button icon={<CloseOutlined />} aria-label={t('close')} onClick={onClose} />
        </Tooltip>
      </div>

      <div className="meeting-board-surface">
        <canvas
          ref={canvasRef}
          className="meeting-board-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          // A pointer the browser takes away — a palm landing on a touchscreen,
          // a stylus leaving range — ends the stroke rather than leaving it open
          // and picking up again wherever the pen next appears.
          onPointerCancel={onPointerUp}
        />

        {!strokes.length && (
          <p className="meeting-board-hint vision-cell-muted">{t('boardEmptyHint')}</p>
        )}
      </div>
    </section>
  );
}
