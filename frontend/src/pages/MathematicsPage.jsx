import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Input, InputNumber } from 'antd';
import PageHeader from '../components/ui/PageHeader';
import { analyze, sampleCurve, yWindow } from '../lib/calculus';

const EXAMPLES = [
  { label: 'x³ − 3x', expression: 'x^3 - 3x', min: -3, max: 3 },
  { label: 'sin x', expression: 'sin(x)', min: -6.5, max: 6.5 },
  { label: 'e^(−x²)', expression: 'exp(-x^2)', min: -3, max: 3 },
  { label: 'ln x', expression: 'ln(x)', min: 0.15, max: 8 },
];

const SERIES = [
  { key: 'function', level: 0, label: 'f(x)', color: '#1677ff' },
  { key: 'first', level: 1, label: "f'(x)", color: '#16a34a' },
  { key: 'second', level: 2, label: "f''(x)", color: '#d97706' },
  { key: 'nth', level: null, label: 'nth', color: '#7a5af8' },
];

const ordinal = (order) => {
  const teen = order % 100;
  if (teen >= 11 && teen <= 13) return `${order}th`;
  return `${order}${({ 1: 'st', 2: 'nd', 3: 'rd' })[order % 10] || 'th'}`;
};

function niceStep(span, target) {
  const rough = Math.abs(span) / Math.max(target, 1);
  if (!Number.isFinite(rough) || rough === 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  const nice = fraction >= 7.5 ? 10 : fraction >= 3.5 ? 5 : fraction >= 1.5 ? 2 : 1;
  return nice * magnitude;
}

function drawPlot(canvas, curves, xMin, xMax, windowY) {
  const parent = canvas.parentElement;
  const width = Math.max(parent?.clientWidth || 640, 320);
  const height = 460;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);

  const pad = { left: 52, right: 16, top: 16, bottom: 32 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const xSpan = xMax - xMin || 1;
  const ySpan = windowY.max - windowY.min || 1;
  const xOf = (value) => pad.left + ((value - xMin) / xSpan) * plotWidth;
  const yOf = (value) => pad.top + (1 - (value - windowY.min) / ySpan) * plotHeight;

  context.save();
  context.beginPath();
  context.rect(pad.left, pad.top, plotWidth, plotHeight);
  context.clip();

  context.strokeStyle = '#eef2f8';
  context.lineWidth = 1;
  context.font = '11px Inter, Segoe UI, sans-serif';
  context.fillStyle = '#7b8ba3';
  context.textAlign = 'center';
  context.textBaseline = 'top';

  const xStep = niceStep(xSpan, 6);
  for (let tick = Math.ceil(xMin / xStep) * xStep; tick <= xMax + xStep * 0.01; tick += xStep) {
    const px = xOf(tick);
    context.beginPath();
    context.moveTo(px, pad.top);
    context.lineTo(px, pad.top + plotHeight);
    context.stroke();
  }

  context.textAlign = 'right';
  context.textBaseline = 'middle';
  const yStep = niceStep(ySpan, 5);
  for (let tick = Math.ceil(windowY.min / yStep) * yStep; tick <= windowY.max + yStep * 0.01; tick += yStep) {
    const py = yOf(tick);
    context.beginPath();
    context.moveTo(pad.left, py);
    context.lineTo(pad.left + plotWidth, py);
    context.stroke();
  }

  context.restore();

  const axis = (fromX, fromY, toX, toY) => {
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.lineTo(toX, toY);
    context.stroke();
  };
  context.strokeStyle = '#9aa8bd';
  context.lineWidth = 1.25;
  if (xMin <= 0 && xMax >= 0) axis(xOf(0), pad.top, xOf(0), pad.top + plotHeight);
  if (windowY.min <= 0 && windowY.max >= 0) axis(pad.left, yOf(0), pad.left + plotWidth, yOf(0));

  context.font = '11px Inter, Segoe UI, sans-serif';
  context.fillStyle = '#5b708b';
  context.textAlign = 'center';
  context.textBaseline = 'top';
  for (let tick = Math.ceil(xMin / xStep) * xStep; tick <= xMax + xStep * 0.01; tick += xStep) {
    if (Math.abs(tick) < xStep * 0.001) continue;
    context.fillText(String(Math.round(tick * 1e4) / 1e4), xOf(tick), pad.top + plotHeight + 6);
  }
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let tick = Math.ceil(windowY.min / yStep) * yStep; tick <= windowY.max + yStep * 0.01; tick += yStep) {
    if (Math.abs(tick) < yStep * 0.001) continue;
    context.fillText(String(Math.round(tick * 1e4) / 1e4), pad.left - 8, yOf(tick));
  }

  context.save();
  context.beginPath();
  context.rect(pad.left, pad.top, plotWidth, plotHeight);
  context.clip();
  curves.forEach((curve) => {
    context.beginPath();
    context.strokeStyle = curve.color;
    context.lineWidth = 2;
    context.lineJoin = 'round';
    let drawing = false;
    curve.points.forEach((point, index) => {
      const previous = curve.points[index - 1];
      const jump = previous && Number.isFinite(previous.y) && Number.isFinite(point.y)
        && Math.abs(point.y - previous.y) > ySpan * 8;
      if (!Number.isFinite(point.y) || jump) {
        drawing = false;
        return;
      }
      const px = xOf(point.x);
      const py = yOf(point.y);
      if (!drawing) {
        context.moveTo(px, py);
        drawing = true;
      } else {
        context.lineTo(px, py);
      }
    });
    context.stroke();
  });
  context.restore();

  context.strokeStyle = '#d5deeb';
  context.strokeRect(pad.left, pad.top, plotWidth, plotHeight);
}

export default function MathematicsPage() {
  const [expression, setExpression] = useState('x^3 - 3x');
  const [order, setOrder] = useState(3);
  const [xMin, setXMin] = useState(-3);
  const [xMax, setXMax] = useState(3);
  const [visible, setVisible] = useState({ function: true, first: true, second: true, nth: true });
  const canvasRef = useRef(null);

  const analysis = useMemo(() => {
    try {
      return { result: analyze(expression, order) };
    } catch (error) {
      return { error: error.message };
    }
  }, [expression, order]);

  const rangeError = !(Number.isFinite(xMin) && Number.isFinite(xMax) && xMin < xMax)
    ? 'The left end of the x range has to be less than the right end.'
    : '';

  const curves = useMemo(() => {
    if (!analysis.result || rangeError) return [];
    const nthLevel = analysis.result.order;
    return SERIES.flatMap((series) => {
      if (!visible[series.key]) return [];
      const level = series.key === 'nth' ? nthLevel : series.level;
      if (series.key === 'nth' && (nthLevel === 1 || nthLevel === 2)) return [];
      return [{
        ...series,
        level,
        label: series.key === 'nth' ? `f⁽${nthLevel}⁾(x)` : series.label,
        points: sampleCurve((x) => analysis.result.at(level, x), xMin, xMax),
      }];
    });
  }, [analysis.result, rangeError, visible, xMin, xMax]);

  const windowY = useMemo(() => yWindow(curves), [curves]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || analysis.error || rangeError) return undefined;
    const draw = () => drawPlot(canvas, curves, xMin, xMax, curves.length ? windowY : { min: -1, max: 1 });
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas.parentElement || canvas);
    return () => observer.disconnect();
  }, [analysis.error, curves, rangeError, xMin, xMax, windowY]);

  const toggle = (key) => setVisible((current) => ({ ...current, [key]: !current[key] }));
  const nthLabel = analysis.result ? `f⁽${analysis.result.order}⁾(x)` : `f⁽${order}⁾(x)`;

  return (
    <div className="vision-page vision-stack">
      <PageHeader
        title="Mathematics"
        subtitle="Plot a function of x together with its first, second, and nth derivatives."
      />

      <div className="math-layout">
        <section className="vision-panel vision-panel-tight">
          <h3 className="vision-section-title">Function</h3>
          <label className="math-field">
            <span>f(x)</span>
            <Input
              value={expression}
              spellCheck={false}
              placeholder="sin(x) + x^2"
              onChange={(event) => setExpression(event.target.value)}
              status={analysis.error ? 'error' : undefined}
            />
          </label>
          <p className="math-hint">
            Use x, +, −, *, /, ^, and sin, cos, tan, asin, acos, atan, exp, ln, log, sqrt, abs. 2x and x^2 are fine.
          </p>
          <div className="math-examples">
            {EXAMPLES.map((example) => (
              <Button
                key={example.expression}
                size="small"
                className="vision-btn-ghost"
                onClick={() => {
                  setExpression(example.expression);
                  setXMin(example.min);
                  setXMax(example.max);
                }}
              >
                {example.label}
              </Button>
            ))}
          </div>

          <h3 className="vision-section-title">Derivative order</h3>
          <label className="math-field">
            <span>n</span>
            <InputNumber
              min={1}
              max={8}
              precision={0}
              value={order}
              onChange={(value) => setOrder(value || 1)}
              style={{ width: '100%' }}
            />
          </label>
          <p className="math-hint">
            The graph always offers the first and second derivatives. n picks the higher one, from 1st through 8th.
          </p>

          <h3 className="vision-section-title">On the graph</h3>
          <div className="math-toggles">
            <Checkbox checked={visible.function} onChange={() => toggle('function')}>f(x)</Checkbox>
            <Checkbox checked={visible.first} onChange={() => toggle('first')}>First derivative</Checkbox>
            <Checkbox checked={visible.second} onChange={() => toggle('second')}>Second derivative</Checkbox>
            <Checkbox
              checked={visible.nth && order > 2}
              disabled={order <= 2}
              onChange={() => toggle('nth')}
            >
              {ordinal(order)} derivative
            </Checkbox>
          </div>

          <h3 className="vision-section-title">x range</h3>
          <div className="math-range">
            <InputNumber value={xMin} onChange={(value) => setXMin(value ?? 0)} />
            <span>to</span>
            <InputNumber value={xMax} onChange={(value) => setXMax(value ?? 0)} />
          </div>
        </section>

        <section className="vision-panel vision-panel-tight">
          <h3 className="vision-section-title">Graph</h3>
          {(analysis.error || rangeError) ? (
            <Alert type="error" showIcon message={analysis.error || rangeError} />
          ) : (
            <>
              <div className="math-plot-frame">
                <canvas ref={canvasRef} className="math-plot" role="img" aria-label="Graph of the function and its derivatives" />
              </div>
              <div className="math-legend">
                {curves.map((curve) => (
                  <span key={curve.key}>
                    <i style={{ background: curve.color }} />
                    {curve.label}
                  </span>
                ))}
              </div>
              <div className="math-formulas">
                <p className="math-formula"><span>f(x)</span> = {analysis.result.formula(0)}</p>
                <p className="math-formula"><span>f'(x)</span> = {analysis.result.formula(1)}</p>
                <p className="math-formula"><span>f''(x)</span> = {analysis.result.formula(2)}</p>
                {order > 2 && (
                  <p className="math-formula"><span>{nthLabel}</span> = {analysis.result.formula(order)}</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
