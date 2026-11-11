// The Meta-analysis card's charts: the forest plot (each study's effect with its confidence interval, sized by its
// weight, and the pooled estimate as a diamond with its prediction interval) and the funnel plot (effect against
// standard error, with the pseudo-confidence region and the studies trim-and-fill adds).

import { ChartFrame } from '../components/ChartFrame';
import { qnorm } from '../engine/stats';
import { fmt } from '../format';
import type { MetaResult } from '../rengine/meta';

/** About five round tick values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const first = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let t = first; t <= hi + step * 1e-9; t += step) {
    // (rounded to the step's precision: no 0.30000000000000004)
    ticks.push(Number(t.toFixed(10)));
  }
  return ticks;
}

/** The measure's scale, for the axis title. */
export function scaleName(r: Pick<MetaResult, 'measure'>): string {
  const names: Record<string, string> = {
    GEN: 'Effect size',
    SMD: 'Standardised mean difference',
    MD: 'Mean difference',
    OR: 'Log odds ratio',
    RR: 'Log risk ratio',
    RD: 'Risk difference',
    ZCOR: 'Fisher’s z',
    PLO: 'Logit proportion',
    PR: 'Proportion',
  };
  return names[r.measure] ?? 'Effect size';
}

const ROW = 20;
const CHAR = 6.2;

/** The forest plot: one row per study, then the pooled estimate (without moderators). */
export function ForestPlot({ r, pct }: { r: MetaResult; pct: number }) {
  const studies = r.studies;
  const pooled = r.pooled;
  const longest = Math.max(5, ...studies.map((s) => s.label.length));
  // (the label column as wide as the longest label: nothing is cut off)
  const labelWidth = Math.ceil(longest * CHAR) + 12;
  const textWidth = 190;
  const plotWidth = 300;
  const W = labelWidth + plotWidth + textWidth;
  const top = 26;
  const rows = studies.length + (pooled ? 2 : 0);
  const H = top + rows * ROW + 46;
  const lows = studies.map((s) => s.ciLow);
  const highs = studies.map((s) => s.ciHigh);
  if (pooled) {
    lows.push(pooled.piLow);
    highs.push(pooled.piHigh);
  }
  const lo = Math.min(0, ...lows);
  const hi = Math.max(0, ...highs);
  const margin = (hi - lo || 1) * 0.04;
  const x0 = labelWidth;
  const sx = (v: number) => x0 + ((v - lo + margin) / (hi - lo + 2 * margin)) * plotWidth;
  const rowY = (i: number) => top + i * ROW + ROW / 2;
  const maxWeight = Math.max(...studies.map((s) => s.weight), 1e-9);
  const bottom = top + rows * ROW;
  const ticks = niceTicks(lo, hi);
  const textX = x0 + plotWidth + 10;
  return (
    <ChartFrame
      id="meta:forest"
      name="meta-forest"
      width={W}
      height={H}
      defaults={{ x: scaleName(r), y: 'Study' }}
      caption={
        <span className="hint">
          Squares: each study’s effect, sized by its weight in the model; lines: {pct}% confidence
          intervals.
          {pooled &&
            ` Diamond: the pooled estimate and its confidence interval; the line through it: the ${pct}% prediction interval (where a new study’s true effect is expected).`}
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={W}
          height={H}
          role="img"
          aria-label="Forest plot"
        >
          <text x={4} y={14} className="axis-title">
            {labels.y}
          </text>
          <text x={textX} y={14} className="axis-title">
            Estimate [{pct}% CI] · weight
          </text>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={sx(t)} x2={sx(t)} y1={top} y2={bottom} />
              <text x={sx(t)} y={bottom + 14} textAnchor="middle">
                {fmt(t, 2)}
              </text>
            </g>
          ))}
          <line className="ref-line" x1={sx(0)} x2={sx(0)} y1={top} y2={bottom} />
          {studies.map((s, i) => {
            const size = 4 + 6 * Math.sqrt(s.weight / maxWeight);
            return (
              <g key={i}>
                <text x={4} y={rowY(i) + 4}>
                  {s.label}
                </text>
                <line
                  className="whisker"
                  x1={sx(s.ciLow)}
                  x2={sx(s.ciHigh)}
                  y1={rowY(i)}
                  y2={rowY(i)}
                />
                <rect
                  className="bar"
                  x={sx(s.yi) - size / 2}
                  y={rowY(i) - size / 2}
                  width={size}
                  height={size}
                />
                <text x={textX} y={rowY(i) + 4}>
                  {`${fmt(s.yi, 2)} [${fmt(s.ciLow, 2)}, ${fmt(s.ciHigh, 2)}] · ${fmt(s.weight, 1)}%`}
                </text>
              </g>
            );
          })}
          {pooled && (
            <g>
              <text x={4} y={rowY(studies.length + 1) + 4} className="axis-title">
                {r.method === 'FE' ? 'Equal-effects model' : 'Random-effects model'}
              </text>
              <line
                className="whisker"
                x1={sx(pooled.piLow)}
                x2={sx(pooled.piHigh)}
                y1={rowY(studies.length + 1)}
                y2={rowY(studies.length + 1)}
              />
              <polygon
                className="box"
                points={[
                  `${sx(pooled.ciLow)},${rowY(studies.length + 1)}`,
                  `${sx(pooled.est)},${rowY(studies.length + 1) - 7}`,
                  `${sx(pooled.ciHigh)},${rowY(studies.length + 1)}`,
                  `${sx(pooled.est)},${rowY(studies.length + 1) + 7}`,
                ].join(' ')}
              />
              <text x={textX} y={rowY(studies.length + 1) + 4} className="axis-title">
                {`${fmt(pooled.est, 2)} [${fmt(pooled.ciLow, 2)}, ${fmt(pooled.ciHigh, 2)}]`}
              </text>
            </g>
          )}
          <text x={x0 + plotWidth / 2} y={H - 8} textAnchor="middle" className="axis-title">
            {labels.x}
          </text>
        </svg>
      )}
    </ChartFrame>
  );
}

/** The funnel plot: effect sizes against their standard errors (0 at the top). */
export function FunnelPlot({ r, pct }: { r: MetaResult; pct: number }) {
  const W = 480;
  const H = 340;
  const pad = { l: 60, r: 16, t: 14, b: 44 };
  const centre = r.pooled?.est ?? 0;
  const filled = r.bias?.trimfill.filled ?? [];
  const points = [
    ...r.studies.map((s) => ({ yi: s.yi, se: Math.sqrt(s.vi), filled: false })),
    ...filled.map((s) => ({ yi: s.yi, se: Math.sqrt(s.vi), filled: true })),
  ];
  const maxSe = Math.max(...points.map((p) => p.se)) * 1.05 || 1;
  const z = qnorm(1 - (1 - pct / 100) / 2);
  const lo = Math.min(centre - z * maxSe, ...points.map((p) => p.yi));
  const hi = Math.max(centre + z * maxSe, ...points.map((p) => p.yi));
  const sx = (v: number) => pad.l + ((v - lo) / (hi - lo || 1)) * (W - pad.l - pad.r);
  const sy = (se: number) => pad.t + (se / maxSe) * (H - pad.t - pad.b);
  const region = [
    `${sx(centre)},${sy(0)}`,
    `${sx(centre + z * maxSe)},${sy(maxSe)}`,
    `${sx(centre - z * maxSe)},${sy(maxSe)}`,
  ].join(' ');
  return (
    <ChartFrame
      id="meta:funnel"
      name="meta-funnel"
      width={W}
      height={H}
      defaults={{ x: scaleName(r), y: 'Standard error' }}
      caption={
        <span className="hint">
          Each study’s effect against its standard error; the triangle: where {pct}% of studies
          would fall around the pooled estimate without heterogeneity or bias. An empty corner
          suggests small-study effects.
          {filled.length > 0 &&
            ` Open circles: the ${filled.length} ${filled.length === 1 ? 'study' : 'studies'} trim-and-fill adds.`}
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={W}
          height={H}
          role="img"
          aria-label="Funnel plot"
        >
          <polygon points={region} fill="var(--border)" fillOpacity={0.35} />
          {niceTicks(0, maxSe, 4).map((t) => (
            <g key={`y${t}`}>
              <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} />
              <text x={pad.l - 6} y={sy(t) + 4} textAnchor="end">
                {fmt(t, 2)}
              </text>
            </g>
          ))}
          {niceTicks(lo, hi).map((t) => (
            <text key={`x${t}`} x={sx(t)} y={H - pad.b + 16} textAnchor="middle">
              {fmt(t, 2)}
            </text>
          ))}
          <line className="ref-line" x1={sx(centre)} x2={sx(centre)} y1={sy(0)} y2={sy(maxSe)} />
          {points.map((p, i) => (
            <circle
              key={i}
              className={p.filled ? undefined : 'dot'}
              cx={sx(p.yi)}
              cy={sy(p.se)}
              r={4}
              fill={p.filled ? 'none' : undefined}
              stroke={p.filled ? 'var(--text-2)' : undefined}
            />
          ))}
          <text
            x={pad.l + (W - pad.l - pad.r) / 2}
            y={H - 4}
            textAnchor="middle"
            className="axis-title"
          >
            {labels.x}
          </text>
          <text
            transform={`translate(14 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`}
            textAnchor="middle"
            className="axis-title"
          >
            {labels.y}
          </text>
        </svg>
      )}
    </ChartFrame>
  );
}
