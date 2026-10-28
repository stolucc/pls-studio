import type { JohnsonNeyman } from '../engine/jn';

/**
 * Johnson–Neyman plot: conditional effect of the predictor across moderator
 * values (±3 SD of the latent moderator) with its confidence band; shaded
 * where the effect is significant, dashed lines at the region boundaries.
 */
export function JohnsonNeymanPlot({ jn, from, moderator, width = 320, height = 200 }: {
  jn: JohnsonNeyman; from: string; moderator: string; width?: number; height?: number;
}) {
  const pad = { l: 40, r: 10, t: 10, b: 34 };
  const lo = -3 * jn.sdM, hi = 3 * jn.sdM;
  const N = 120;
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const m = lo + ((hi - lo) * i) / N;
    const e = jn.effect(m), h = jn.crit * jn.se(m);
    return { m, e, l: e - h, u: e + h, sig: jn.significantAt(m) };
  });
  const yMin = Math.min(0, ...pts.map((p) => p.l)), yMax = Math.max(0, ...pts.map((p) => p.u));
  const span = yMax - yMin || 1;
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const sx = (m: number) => pad.l + ((m - lo) / (hi - lo)) * W;
  const sy = (v: number) => pad.t + ((yMax + 0.05 * span - v) / (span * 1.1)) * H;
  const line = (key: 'e' | 'l' | 'u') => pts.map((p, i) => `${i ? 'L' : 'M'} ${sx(p.m)} ${sy(p[key])}`).join(' ');
  const band = `${line('u')} ${[...pts].reverse().map((p) => `L ${sx(p.m)} ${sy(p.l)}`).join(' ')} Z`;
  // Contiguous significant stretches → shaded rectangles.
  const regions: [number, number][] = [];
  pts.forEach((p, i) => {
    if (!p.sig) return;
    if (i > 0 && pts[i - 1].sig) regions[regions.length - 1][1] = p.m;
    else regions.push([p.m, p.m]);
  });
  const sdTicks = [-3, -2, -1, 0, 1, 2, 3];
  return (
    <figure style={{ margin: 0 }}>
      <svg className="jn" width={width} height={height} role="img"
        aria-label={`Johnson-Neyman plot of the effect of ${from} across ${moderator}`}>
        {regions.map(([a, b], i) => (
          <rect key={i} className="jn-sig" x={sx(a)} y={pad.t} width={Math.max(1, sx(b) - sx(a))} height={H} />
        ))}
        <line className="axis" x1={pad.l} x2={pad.l + W} y1={sy(0)} y2={sy(0)} strokeDasharray="3 3" />
        <line className="axis" x1={pad.l} x2={pad.l} y1={pad.t} y2={pad.t + H} />
        <path className="jn-band" d={band} />
        <path className="jn-line" d={line('e')} />
        {jn.boundaries.filter((b) => b > lo && b < hi).map((b) => (
          <g key={b}>
            <line className="jn-bound" x1={sx(b)} x2={sx(b)} y1={pad.t} y2={pad.t + H} />
            <text x={sx(b) + 3} y={pad.t + 10}>{(b / jn.sdM).toFixed(2)} SD</text>
          </g>
        ))}
        {sdTicks.map((k) => <text key={k} x={sx(k * jn.sdM)} y={pad.t + H + 14} textAnchor="middle">{k}</text>)}
        <text x={pad.l + W / 2} y={height - 4} textAnchor="middle">{moderator} (SD)</text>
        <text x={pad.l - 6} y={sy(yMax) + 4} textAnchor="end">{yMax.toFixed(2)}</text>
        <text x={pad.l - 6} y={sy(0) + 4} textAnchor="end">0</text>
        <text x={pad.l - 6} y={sy(yMin) + 4} textAnchor="end">{yMin.toFixed(2)}</text>
      </svg>
      <figcaption className="hint" style={{ marginTop: 4 }}>
        Effect of {from} (unstandardised) with 95% band; shaded where significant (α = .05).
        {jn.boundaries.length === 0 ? ' No boundary: significance does not change with the moderator.' : ''}
      </figcaption>
    </figure>
  );
}
