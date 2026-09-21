import { Empty, Tooltip } from 'antd';
import { roundedTopBar } from '../ui/chartShapes';
import { formatMoney } from './money';

/*
 * Two series that must be told apart, so this is the categorical case: income
 * takes the design system's primary blue and expense its amber. Green/red is
 * the conventional pairing and the reason it is avoided — it is exactly the
 * pair red-green colour blindness collapses. Blue and amber separate under
 * every common form of CVD, and the legend below carries identity anyway.
 */
const WIDTH = 480;
const HEIGHT = 176;
const BASELINE = 132;
const TOP = 18;
const LEFT = 34;
const BAR_GAP = 2;
const MAX_BAR = 18;

/** A rounded value for the top gridline, so the axis reads 800 rather than 793.4. */
const niceCeiling = (value) => {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
};

/**
 * Income and expense per month.
 *
 * Both series are money on the same scale, so they share one axis — a second
 * axis would let the two be scaled into any story at all.
 */
export function MonthlyFlowChart({ months = [], currency }) {
  const peak = niceCeiling(Math.max(0, ...months.flatMap((month) => [month.income, month.expense])));
  const slot = (WIDTH - LEFT - 12) / Math.max(1, months.length);
  const barWidth = Math.min(MAX_BAR, Math.max(6, (slot - 16) / 2));
  const scale = (value) => ((Number(value) || 0) / peak) * (BASELINE - TOP);

  return (
    <figure className="vision-chart-figure">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="vision-graph-svg"
        role="img"
        aria-label={`Income and expense per month: ${months.map((month) => `${month.label} income ${month.income}, expense ${month.expense}`).join('; ')}`}
      >
        <g className="vision-graph-grid">
          <line x1={LEFT} y1={TOP} x2={WIDTH - 12} y2={TOP} />
          <line x1={LEFT} y1={(TOP + BASELINE) / 2} x2={WIDTH - 12} y2={(TOP + BASELINE) / 2} />
        </g>
        <line x1={LEFT} y1={BASELINE} x2={WIDTH - 12} y2={BASELINE} className="vision-graph-axis" />

        {/* Two labels rather than a full scale: the tooltips carry exact values. */}
        <text x={LEFT - 6} y={TOP + 4} textAnchor="end" className="vision-graph-label">
          {formatMoney(peak, currency, { compact: true })}
        </text>
        <text x={LEFT - 6} y={BASELINE + 4} textAnchor="end" className="vision-graph-label">0</text>

        {months.map((month, index) => {
          const groupCentre = LEFT + index * slot + slot / 2;
          const incomeHeight = scale(month.income);
          const expenseHeight = scale(month.expense);
          const incomeX = groupCentre - barWidth - BAR_GAP / 2;
          const expenseX = groupCentre + BAR_GAP / 2;

          return (
            <g key={month.key}>
              {incomeHeight > 0 && (
                <path
                  d={roundedTopBar(incomeX, BASELINE - incomeHeight, barWidth, incomeHeight)}
                  className="vision-bar is-income"
                />
              )}
              {expenseHeight > 0 && (
                <path
                  d={roundedTopBar(expenseX, BASELINE - expenseHeight, barWidth, expenseHeight)}
                  className="vision-bar is-expense"
                />
              )}
              {/* Native tooltip: no JS, and it reaches keyboard and screen readers. */}
              <rect
                x={groupCentre - slot / 2}
                y={TOP}
                width={slot}
                height={BASELINE - TOP}
                fill="transparent"
              >
                <title>
                  {`${month.label} — in ${formatMoney(month.income, currency)}, out ${formatMoney(month.expense, currency)}, net ${formatMoney(month.net, currency)}`}
                </title>
              </rect>
              <text x={groupCentre} y={BASELINE + 18} textAnchor="middle" className="vision-graph-label">
                {month.label}
              </text>
            </g>
          );
        })}
      </svg>

      <ul className="vision-chart-legend">
        <li><span className="vision-legend-dot is-income" />Income</li>
        <li><span className="vision-legend-dot is-expense" />Expense</li>
      </ul>
    </figure>
  );
}

/** Ranked magnitude within one series, so values are labelled directly. */
export function CategoryBreakdown({ rows = [], type, currency }) {
  if (!rows.length) {
    return <Empty description={`No ${type} recorded`} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const total = rows.reduce((sum, row) => sum + row.total, 0);

  return (
    <ul className="vision-rank-list">
      {rows.map((row) => {
        const share = total ? Math.round((row.total / total) * 100) : 0;
        return (
          <li key={row.category}>
            <Tooltip title={`${row.count} entr${row.count === 1 ? 'y' : 'ies'} · ${share}% of ${type}`}>
              <div className="vision-rank-row">
                <span className="vision-rank-label" title={row.category}>{row.category}</span>
                <span className="vision-rank-track">
                  <span
                    className={`vision-rank-fill is-${type}`}
                    style={{ width: `${Math.max(2, share)}%` }}
                  />
                </span>
                <span className="vision-rank-value">{formatMoney(row.total, currency, { compact: true })}</span>
              </div>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Running balance across the same months as the bars — one series, so one hue
 * and no legend; the panel title says what it is.
 */
export function BalanceTrend({ months = [], currency }) {
  const running = months.reduce((points, month) => {
    const previous = points.length ? points[points.length - 1].value : 0;
    points.push({ label: month.label, value: Math.round((previous + month.net) * 100) / 100 });
    return points;
  }, []);

  if (!running.length) return null;

  const values = running.map((point) => point.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const toY = (value) => BASELINE - ((value - min) / span) * (BASELINE - TOP);
  const toX = (index) => LEFT + (index / Math.max(1, running.length - 1)) * (WIDTH - LEFT - 16);
  const zeroY = toY(0);

  return (
    <figure className="vision-chart-figure">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="vision-graph-svg"
        role="img"
        aria-label={`Running balance: ${running.map((point) => `${point.label} ${point.value}`).join(', ')}`}
      >
        <g className="vision-graph-grid">
          <line x1={LEFT} y1={TOP} x2={WIDTH - 12} y2={TOP} />
        </g>
        {/* Zero is the line that matters here, so it is the one that is drawn. */}
        <line x1={LEFT} y1={zeroY} x2={WIDTH - 12} y2={zeroY} className="vision-graph-axis" />
        <text x={LEFT - 6} y={zeroY + 4} textAnchor="end" className="vision-graph-label">0</text>

        <polyline className="vision-graph-line is-balance" points={running.map((point, index) => `${toX(index)},${toY(point.value)}`).join(' ')} />

        {running.map((point, index) => (
          <g key={point.label}>
            <circle cx={toX(index)} cy={toY(point.value)} r={4} className="vision-graph-dot is-balance">
              <title>{`${point.label}: ${formatMoney(point.value, currency)}`}</title>
            </circle>
            <text x={toX(index)} y={BASELINE + 18} textAnchor="middle" className="vision-graph-label">
              {point.label}
            </text>
          </g>
        ))}

        {/* Only the endpoint is labelled — the figure the reader came for. */}
        <text
          x={toX(running.length - 1)}
          y={toY(running[running.length - 1].value) - 10}
          textAnchor="end"
          className="vision-bar-value"
        >
          {formatMoney(running[running.length - 1].value, currency, { compact: true })}
        </text>
      </svg>
    </figure>
  );
}
