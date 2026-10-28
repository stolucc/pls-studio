/**
 * Simple-slope plot for a two-stage interaction: the predicted outcome
 * (in SD units) across the predictor for the moderator at −1 SD, mean, +1 SD:
 * ŷ = β_x·x + β_m·m + β_int·x·m.
 */
export function SimpleSlopes({ bx, bm, bint, from, moderator, to, width = 260, height = 170 }: {
  bx: number; bm: number; bint: number; from: string; moderator: string; to: string; width?: number; height?: number;
}) {
  const pad = { l: 34, r: 10, t: 10, b: 30 };
  const levels = [
    { m: -1, label: `${moderator} −1 SD`, color: '#c4b5fd' },
    { m: 0, label: `${moderator} mean`, color: '#8b5cf6' },
    { m: 1, label: `${moderator} +1 SD`, color: '#5b21b6' },
  ];
  const y = (x: number, m: number) => bx * x + bm * m + bint * x * m;
  const ys = levels.flatMap((l) => [y(-1, l.m), y(1, l.m)]);
  const lim = Math.max(0.5, ...ys.map(Math.abs)) * 1.1;
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const sx = (x: number) => pad.l + ((x + 1) / 2) * W;
  const sy = (v: number) => pad.t + ((lim - v) / (2 * lim)) * H;
  return (
    <figure style={{ margin: 0 }}>
      <svg className="slopes" width={width} height={height} role="img"
        aria-label={`Simple slopes of ${from} on ${to} at three levels of ${moderator}`}>
        <line className="axis" x1={pad.l} y1={sy(0)} x2={pad.l + W} y2={sy(0)} strokeDasharray="3 3" />
        <line className="axis" x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + H} />
        <line className="axis" x1={pad.l} y1={pad.t + H} x2={pad.l + W} y2={pad.t + H} />
        <text x={pad.l - 4} y={sy(lim) + 4} textAnchor="end">{lim.toFixed(1)}</text>
        <text x={pad.l - 4} y={sy(0) + 4} textAnchor="end">0</text>
        <text x={pad.l - 4} y={sy(-lim) + 4} textAnchor="end">{(-lim).toFixed(1)}</text>
        <text x={sx(-1)} y={height - 14} textAnchor="start">−1 SD</text>
        <text x={sx(1)} y={height - 14} textAnchor="end">+1 SD</text>
        <text x={pad.l + W / 2} y={height - 2} textAnchor="middle">{from}</text>
        {levels.map((l) => (
          <line key={l.m} x1={sx(-1)} y1={sy(y(-1, l.m))} x2={sx(1)} y2={sy(y(1, l.m))} stroke={l.color} strokeWidth={2.2} strokeLinecap="round" />
        ))}
      </svg>
      <figcaption style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-2)', marginTop: 4 }}>
        {levels.map((l) => (
          <span key={l.m} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 3, borderRadius: 2, background: l.color }} />
            {l.label}: slope {(bx + bint * l.m).toFixed(3)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
