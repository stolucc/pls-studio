import { quadraticSlope, quadraticValue, turningPoint } from '../engine/quadratic';
import { legendHeight, SvgLegend, type LegendItem } from '../figure/legend';
import { PlotPanel } from '../figure/panel';
import { ChartFrame } from './ChartFrame';

/**
 * Simple-slope plot for a two-stage interaction: the predicted outcome
 * (in SD units) across the predictor for the moderator at −1 SD, mean, +1 SD:
 * ŷ = β_x·x + β_m·m + β_int·x·m.
 */
export function SimpleSlopes({
  bx,
  bm,
  bint,
  from,
  moderator,
  to,
  width = 260,
  height = 170,
}: {
  bx: number;
  bm: number;
  bint: number;
  from: string;
  moderator: string;
  to: string;
  width?: number;
  height?: number;
}) {
  const levels = [
    { m: -1, label: `${moderator} −1 SD`, color: '#c4b5fd' },
    { m: 0, label: `${moderator} mean`, color: '#8b5cf6' },
    { m: 1, label: `${moderator} +1 SD`, color: '#5b21b6' },
  ];
  // One line per level of the moderator, keyed above the plot.
  const legend: LegendItem[] = levels.map((l) => ({ label: l.label, color: l.color }));
  const legendH = legendHeight(legend, width - 46 - 10);
  const pad = { l: 46, r: 10, t: 10 + legendH, b: 30 };
  const total = height + legendH;
  const y = (x: number, m: number) => bx * x + bm * m + bint * x * m;
  const ys = levels.flatMap((l) => [y(-1, l.m), y(1, l.m)]);
  const lim = Math.max(0.5, ...ys.map(Math.abs)) * 1.1;
  const W = width - pad.l - pad.r;
  const H = total - pad.t - pad.b;
  const sx = (x: number) => pad.l + ((x + 1) / 2) * W;
  const sy = (v: number) => pad.t + ((lim - v) / (2 * lim)) * H;
  const caption = (
    <figcaption
      style={{
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap',
        fontSize: 11,
        color: 'var(--text-2)',
        marginTop: 4,
      }}
    >
      {levels.map((l) => (
        <span key={l.m}>
          {l.label}: slope {(bx + bint * l.m).toFixed(3)}
        </span>
      ))}
    </figcaption>
  );
  return (
    <ChartFrame
      id={`slopes:${from}:${moderator}:${to}`}
      name={`slopes-${from}-${moderator}-${to}`}
      width={width}
      height={total}
      caption={caption}
      defaults={{ x: `${from} (SD)`, y: `${to} (predicted, SD)` }}
    >
      {(labels) => (
        <svg
          className="slopes"
          width={width}
          height={total}
          role="img"
          aria-label={`Simple slopes of ${from} on ${to} at three levels of ${moderator}`}
        >
          <SvgLegend items={legend} x={pad.l} y={0} width={W} />
          <PlotPanel x={pad.l} y={pad.t} width={W} height={H} />
          <line
            className="axis"
            x1={pad.l}
            y1={sy(0)}
            x2={pad.l + W}
            y2={sy(0)}
            strokeDasharray="3 3"
          />
          <line className="axis" x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + H} />
          <line className="axis" x1={pad.l} y1={pad.t + H} x2={pad.l + W} y2={pad.t + H} />
          <text x={pad.l - 4} y={sy(lim) + 4} textAnchor="end">
            {lim.toFixed(1)}
          </text>
          <text x={pad.l - 4} y={sy(0) + 4} textAnchor="end">
            0
          </text>
          <text x={pad.l - 4} y={sy(-lim) + 4} textAnchor="end">
            {(-lim).toFixed(1)}
          </text>
          <text x={sx(-1)} y={total - 14} textAnchor="start">
            −1 SD
          </text>
          <text x={sx(1)} y={total - 14} textAnchor="end">
            +1 SD
          </text>
          <text className="axis-title" x={pad.l + W / 2} y={total - 2} textAnchor="middle">
            {labels.x}
          </text>
          <text
            className="axis-title"
            transform={`translate(11 ${pad.t + H / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            {labels.y}
          </text>
          {levels.map((l) => (
            <line
              key={l.m}
              x1={sx(-1)}
              y1={sy(y(-1, l.m))}
              x2={sx(1)}
              y2={sy(y(1, l.m))}
              stroke={l.color}
              strokeWidth={2.2}
              strokeLinecap="round"
            />
          ))}
        </svg>
      )}
    </ChartFrame>
  );
}

/**
 * A quadratic effect (X² → Y): the fitted curve ŷ = β·x + β_q·x² over ±2 SD of
 * X, the slope at −1 SD, the mean and +1 SD, and the turning point when it is
 * within range.
 */
export function QuadraticCurve({
  b,
  bq,
  from,
  to,
  width = 260,
  height = 170,
}: {
  b: number;
  bq: number;
  from: string;
  to: string;
  width?: number;
  height?: number;
}) {
  const R = 2;
  const xs = Array.from({ length: 81 }, (_, i) => -R + (2 * R * i) / 80);
  const ys = xs.map((x) => quadraticValue(b, bq, x));
  const lim = Math.max(0.5, ...ys.map(Math.abs)) * 1.1;
  const levels = [
    { x: -1, label: '−1 SD', color: '#c4b5fd' },
    { x: 0, label: 'mean', color: '#8b5cf6' },
    { x: 1, label: '+1 SD', color: '#5b21b6' },
  ];
  // The fitted curve and the three points whose slopes the caption gives, keyed above the plot.
  const legend: LegendItem[] = [
    { label: 'Fitted curve', color: '#8b5cf6' },
    ...levels.map((l) => ({ label: `${from} ${l.label}`, color: l.color, mark: 'dot' as const })),
  ];
  const legendH = legendHeight(legend, width - 46 - 10);
  const pad = { l: 46, r: 10, t: 10 + legendH, b: 30 };
  const total = height + legendH;
  const W = width - pad.l - pad.r;
  const H = total - pad.t - pad.b;
  const sx = (x: number) => pad.l + ((x + R) / (2 * R)) * W;
  const sy = (v: number) => pad.t + ((lim - v) / (2 * lim)) * H;
  const tp = turningPoint(b, bq);
  const caption = (
    <figcaption
      style={{
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap',
        fontSize: 11,
        color: 'var(--text-2)',
        marginTop: 4,
      }}
    >
      {levels.map((l) => (
        <span key={l.x}>
          slope at {l.label}: {quadraticSlope(b, bq, l.x).toFixed(3)}
        </span>
      ))}
      {tp !== null && (
        <span>
          turning point: {tp.toFixed(2)} SD{Math.abs(tp) > R ? ' (outside ±2 SD)' : ''}
        </span>
      )}
    </figcaption>
  );
  return (
    <ChartFrame
      id={`quad:${from}:${to}`}
      name={`quadratic-${from}-${to}`}
      width={width}
      height={total}
      caption={caption}
      defaults={{ x: `${from} (SD)`, y: `${to} (predicted, SD)` }}
    >
      {(labels) => (
        <svg
          className="slopes"
          width={width}
          height={total}
          role="img"
          aria-label={`Quadratic effect of ${from} on ${to}`}
        >
          <SvgLegend items={legend} x={pad.l} y={0} width={W} />
          <PlotPanel x={pad.l} y={pad.t} width={W} height={H} />
          <line
            className="axis"
            x1={pad.l}
            y1={sy(0)}
            x2={pad.l + W}
            y2={sy(0)}
            strokeDasharray="3 3"
          />
          <line className="axis" x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + H} />
          <line className="axis" x1={pad.l} y1={pad.t + H} x2={pad.l + W} y2={pad.t + H} />
          <text x={pad.l - 4} y={sy(lim) + 4} textAnchor="end">
            {lim.toFixed(1)}
          </text>
          <text x={pad.l - 4} y={sy(0) + 4} textAnchor="end">
            0
          </text>
          <text x={pad.l - 4} y={sy(-lim) + 4} textAnchor="end">
            {(-lim).toFixed(1)}
          </text>
          <text x={sx(-R)} y={total - 14} textAnchor="start">
            −2 SD
          </text>
          <text x={sx(R)} y={total - 14} textAnchor="end">
            +2 SD
          </text>
          <text className="axis-title" x={pad.l + W / 2} y={total - 2} textAnchor="middle">
            {labels.x}
          </text>
          <text
            className="axis-title"
            transform={`translate(11 ${pad.t + H / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            {labels.y}
          </text>
          {tp !== null && Math.abs(tp) <= R && (
            <line
              className="axis"
              x1={sx(tp)}
              y1={pad.t}
              x2={sx(tp)}
              y2={pad.t + H}
              strokeDasharray="2 3"
            />
          )}
          <polyline
            points={xs.map((x, i) => `${sx(x)},${sy(ys[i])}`).join(' ')}
            fill="none"
            stroke="#8b5cf6"
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          {levels.map((l) => (
            <circle
              key={l.x}
              cx={sx(l.x)}
              cy={sy(quadraticValue(b, bq, l.x))}
              r={3.5}
              fill={l.color}
            />
          ))}
        </svg>
      )}
    </ChartFrame>
  );
}
