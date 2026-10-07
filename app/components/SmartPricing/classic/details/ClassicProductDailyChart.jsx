import { useMemo, useState } from 'react';
import { formatMetricMoney, formatNumber, formatRate } from '../classicExperimentDetailsHelpers';
import { DAILY_METRICS, buildDailyChart, defaultDailyMetric } from './productDetailReport';
import styles from '../SmartPricingClassic.module.css';

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 12, right: 12, bottom: 24, left: 56 };
const VARIATION_COLOURS = 7;

function formatDay(day) {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Catalog price keeps the grey dashed line; every other variation gets its own colour. */
function lineClasses(lines) {
  let variation = 0;
  return lines.map(line => {
    if (line.isControl) return styles.dailyLine0;
    const slot = 1 + (variation % VARIATION_COLOURS);
    variation += 1;
    return styles[`dailyLine${slot}`];
  });
}

/** SVG path for a line with gaps where a day has no reading. */
function buildPath(points, x, y) {
  let path = '';
  let drawing = false;
  points.forEach((point, i) => {
    if (point.value === null) {
      drawing = false;
      return;
    }
    path += `${drawing ? 'L' : 'M'}${x(i).toFixed(1)},${y(point.value).toFixed(1)} `;
    drawing = true;
  });
  return path.trim();
}

/**
 * Day-by-day results per variation, drawn by hand so the admin ships no chart
 * library for one panel.
 */
export default function ClassicProductDailyChart({ daily, rows, currency = 'USD', primaryMetric }) {
  const [metric, setMetric] = useState(() => defaultDailyMetric(primaryMetric));
  const [cumulative, setCumulative] = useState(true);
  const [hover, setHover] = useState(null);

  const chart = useMemo(
    () => buildDailyChart(daily, rows, { metric, cumulative }),
    [daily, rows, metric, cumulative]
  );
  const { kind } = DAILY_METRICS[metric];
  const format = value => {
    if (value === null || value === undefined) return '—';
    if (kind === 'money') return formatMetricMoney(value, currency);
    if (kind === 'rate') return formatRate(value);
    return formatNumber(Math.round(value));
  };

  if (!chart.days.length) return null;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const top = chart.max > 0 ? chart.max * 1.1 : 1;
  const steps = Math.max(1, chart.days.length - 1);
  const x = i => PAD.left + (chart.days.length === 1 ? plotW / 2 : (i / steps) * plotW);
  const y = value => PAD.top + plotH - (value / top) * plotH;
  const ticks = [0, top / 2, top];
  const labelDays = Array.from(new Set([0, Math.floor(steps / 2), steps])).filter(
    i => i < chart.days.length
  );
  const hoverIndex = hover === null ? chart.days.length - 1 : hover;
  const colours = lineClasses(chart.lines);

  const onMove = event => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width) return;
    const ratio = ((event.clientX - box.left) / box.width) * WIDTH;
    const index = Math.round(((ratio - PAD.left) / plotW) * steps);
    setHover(Math.max(0, Math.min(chart.days.length - 1, index)));
  };

  return (
    <div className={styles.statCard}>
      <div className={styles.productDetailRowTop}>
        <h4 className={styles.panelTitle}>Day by day</h4>
        <div className={styles.productDetailChartControls}>
          <div className={`${styles.segment} ${styles.segmentInline}`} role="group" aria-label="Metric">
            {Object.entries(DAILY_METRICS).map(([id, item]) => (
              <button
                key={id}
                type="button"
                aria-pressed={metric === id}
                className={`${styles.segmentBtn} ${metric === id ? styles.segmentBtnActive : ''}`}
                onClick={() => setMetric(id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className={`${styles.segment} ${styles.segmentInline}`} role="group" aria-label="View">
            {[
              [true, 'Running total'],
              [false, 'Each day'],
            ].map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={cumulative === value}
                className={`${styles.segmentBtn} ${cumulative === value ? styles.segmentBtnActive : ''}`}
                onClick={() => setCumulative(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {chart.hasData ? (
        <>
          <div className={styles.productDetailChartReadout} aria-live="polite">
            <span className={styles.productSub}>{formatDay(chart.days[hoverIndex])}</span>
            {chart.lines.map((line, index) => (
              <span key={line.key} className={styles.productDetailLegendItem}>
                <span className={`${styles.productDetailSwatch} ${colours[index]}`} />
                {line.label} <strong>{format(line.points[hoverIndex]?.value ?? null)}</strong>
              </span>
            ))}
          </div>
          <svg
            className={styles.productDetailChart}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`${DAILY_METRICS[metric].label}, ${cumulative ? 'running total' : 'each day'}, per variation over ${chart.days.length} days`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map(tick => (
              <g key={tick}>
                <line className={styles.productDetailGrid} x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} />
                <text className={styles.productDetailAxis} x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">
                  {format(tick)}
                </text>
              </g>
            ))}
            {labelDays.map(i => (
              <text
                key={i}
                className={styles.productDetailAxis}
                x={x(i)}
                y={HEIGHT - 6}
                textAnchor={i === 0 ? 'start' : i === steps ? 'end' : 'middle'}
              >
                {formatDay(chart.days[i])}
              </text>
            ))}
            <line
              className={styles.productDetailGuide}
              x1={x(hoverIndex)}
              x2={x(hoverIndex)}
              y1={PAD.top}
              y2={PAD.top + plotH}
            />
            {chart.lines.map((line, index) => (
              <path
                key={line.key}
                className={`${styles.productDetailLine} ${colours[index]}`}
                d={buildPath(line.points, x, y)}
              />
            ))}
          </svg>
          <p className={styles.help}>
            Visitors are counted on the day they first saw this product, with the orders they went on to
            place. The last day or two can still grow as those visitors buy.
          </p>
        </>
      ) : (
        <p className={styles.help}>No visitors have reached this product&apos;s test yet.</p>
      )}
    </div>
  );
}
