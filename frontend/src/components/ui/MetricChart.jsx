import { useId } from 'react';

/*
 * One sampled metric over time.
 *
 * A single series, so one hue and no legend — the panel title says what is
 * plotted. The wash under the line is the same hue at low opacity rather than
 * a second colour, the grid stays a step off the surface, and only the first,
 * middle and last samples are labelled: a tick per sample collides at this
 * width and none of them are read anyway.
 */
const WIDTH = 320;
const HEIGHT = 132;
const LEFT = 30;
const RIGHT = 8;
const TOP = 12;
const BASELINE = 104;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
const PLOT_HEIGHT = BASELINE - TOP;

const clamp = (value, max) => Math.min(Math.max(Number(value) || 0, 0), max);

export default function MetricChart({
  series = [],
  color = 'var(--v-primary)',
  max = 100,
  formatValue = (value) => `${Math.round(value)}%`,
  formatAxis,
  ariaLabel = 'Metric over time',
  emptyLabel = 'Waiting for the first sample…',
}) {
  // useId is unique per instance, so two charts on one page never share a
  // gradient. The colons it contains are stripped because they end up in url().
  const gradientId = `metric-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const axisLabel = formatAxis || ((value) => formatValue(value));

  if (!series.length) {
    return (
      <div className="vision-graph-empty">{emptyLabel}</div>
    );
  }

  const ceiling = max > 0 ? max : 1;
  const points = series.map((sample, index) => ({
    ...sample,
    x: series.length === 1
      ? LEFT + PLOT_WIDTH / 2
      : LEFT + (index / (series.length - 1)) * PLOT_WIDTH,
    y: BASELINE - (clamp(sample.value, ceiling) / ceiling) * PLOT_HEIGHT,
  }));

  const last = points[points.length - 1];
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(' ');
  const areaPath = [
    `M${points[0].x},${BASELINE}`,
    ...points.map((point) => `L${point.x},${point.y}`),
    `L${last.x},${BASELINE}`,
    'Z',
  ].join(' ');
  const slotWidth = PLOT_WIDTH / points.length;

  // First, middle and last — enough to read the window without a collision.
  const tickIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="vision-graph-svg" role="img" aria-label={ariaLabel}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.28 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>

      <g className="vision-graph-grid">
        <line x1={LEFT} y1={TOP} x2={WIDTH - RIGHT} y2={TOP} />
        <line x1={LEFT} y1={(TOP + BASELINE) / 2} x2={WIDTH - RIGHT} y2={(TOP + BASELINE) / 2} />
      </g>
      <line x1={LEFT} y1={BASELINE} x2={WIDTH - RIGHT} y2={BASELINE} className="vision-graph-axis" />

      <text x={LEFT - 6} y={TOP + 3} textAnchor="end" className="vision-graph-label">{axisLabel(ceiling)}</text>
      <text x={LEFT - 6} y={(TOP + BASELINE) / 2 + 3} textAnchor="end" className="vision-graph-label">{axisLabel(ceiling / 2)}</text>
      <text x={LEFT - 6} y={BASELINE + 3} textAnchor="end" className="vision-graph-label">{axisLabel(0)}</text>

      <path d={areaPath} fill={`url(#${gradientId})`} />
      <polyline className="vision-graph-line" style={{ stroke: color }} points={linePoints} />

      {/* The latest sample is the one the reader came for, so it is the only
          one that carries a marker. The halo and the surface ring keep it
          legible where the line doubles back under it. */}
      <circle cx={last.x} cy={last.y} r={7} className="vision-graph-halo" style={{ fill: color }} />
      <circle cx={last.x} cy={last.y} r={3.5} className="vision-graph-dot" style={{ fill: color }} />

      {points.map((point, index) => (
        <rect
          key={`${point.time}-${index}`}
          x={point.x - slotWidth / 2}
          y={TOP}
          width={slotWidth}
          height={PLOT_HEIGHT}
          fill="transparent"
        >
          {/* Native tooltip: no JS, and it reaches keyboard and screen readers. */}
          <title>{`${point.time}: ${formatValue(point.value)}`}</title>
        </rect>
      ))}

      {tickIndexes.map((index) => (
        <text
          key={`tick-${index}`}
          x={points[index].x}
          y={HEIGHT - 8}
          textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
          className="vision-graph-label"
        >
          {points[index].time}
        </text>
      ))}
    </svg>
  );
}
