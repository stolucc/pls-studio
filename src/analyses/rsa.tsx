// Polynomial regression with response surface analysis as an analysis card
// (Edwards & Parry 1993; Shanock et al. 2010; as the RSA package with lavaan).

import { useState } from 'react';
import { fmt } from '../format';
import type { RsaInput, RsaResult } from '../rengine/rsa';
import { useStore } from '../store';
import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table } from '../components/results/Table';
import { Choice, clampNum, ColumnSelect, freeColumnName, columnsFingerprint, isObj, missingColumns, name, names, oneOf, rawData } from './common';
import type { AnalysisType, OptionsProps } from './types';

export type RsaPreset = Partial<RsaInput>;
export type RsaOptions = Omit<RsaInput, 'confidence'>;

const MEANING: Record<string, string> = {
  a1: 'slope, X = Y', a2: 'curvature, X = Y', a3: 'slope, X = −Y', a4: 'curvature, X = −Y', a5: 'asymmetry (b3 − b5)',
  X0: 'stationary point X', Y0: 'stationary point Y', p10: '1st axis intercept', p11: '1st axis slope', p20: '2nd axis intercept', p21: '2nd axis slope',
};

/** Colour along a violet–teal–amber scale for t in 0..1. */
const shade = (t: number) => {
  const stops = [[76, 29, 149], [13, 148, 136], [245, 158, 11]];
  const s = Math.max(0, Math.min(1, t)) * 2, i = Math.min(1, Math.floor(s)), f = s - i;
  const [a, b] = [stops[i], stops[i + 1]];
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
};

/** The response surface as a 3D mesh (painter's algorithm), with the lines of congruence and incongruence. */
function Surface({ r, input }: { r: RsaResult; input: RsaInput }) {
  const [az, setAz] = useState(-25);
  const W = 520, H = 400;
  const n = r.grid.length, g = r.grid;
  const zs = r.z.flat(), zmin = Math.min(...zs), zmax = Math.max(...zs), zr = zmax - zmin || 1;
  const gmin = g[0], gr = g[n - 1] - g[0] || 1;
  const rad = (az * Math.PI) / 180, el = (28 * Math.PI) / 180;
  const nx = (x: number) => ((x - gmin) / gr) * 2 - 1;
  // Rotated, tilted coordinates; scaled afterwards so that the whole mesh fits the frame.
  const raw = (x: number, y: number, z: number) => {
    const X = nx(x), Y = nx(y), Z = ((z - zmin) / zr) * 1.1 - 0.55;
    const u = X * Math.cos(rad) - Y * Math.sin(rad);
    const d = X * Math.sin(rad) + Y * Math.cos(rad);
    return { u, v: -(Z * Math.cos(el) - d * Math.sin(el)), depth: d };
  };
  const corners = g.flatMap((a, i) => g.map((b, j) => raw(a, b, r.z[i][j]))).concat(g.flatMap((a) => [raw(a, g[0], zmin), raw(a, g[n - 1], zmin), raw(g[0], a, zmin), raw(g[n - 1], a, zmin)]));
  const umin = Math.min(...corners.map((p) => p.u)), umax = Math.max(...corners.map((p) => p.u));
  const vmin = Math.min(...corners.map((p) => p.v)), vmax = Math.max(...corners.map((p) => p.v));
  const k = Math.min((W - 60) / (umax - umin || 1), (H - 70) / (vmax - vmin || 1));
  const proj = (x: number, y: number, z: number) => {
    const p = raw(x, y, z);
    return { sx: 30 + (p.u - umin) * k + (W - 60 - (umax - umin) * k) / 2, sy: 36 + (p.v - vmin) * k, depth: p.depth };
  };
  const quads: { pts: string; depth: number; t: number }[] = [];
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) {
    const c4 = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => proj(g[a], g[b], r.z[a][b]));
    const zavg = (r.z[i][j] + r.z[i + 1][j] + r.z[i + 1][j + 1] + r.z[i][j + 1]) / 4;
    quads.push({ pts: c4.map((p) => `${p.sx},${p.sy}`).join(' '), depth: c4.reduce((s, p) => s + p.depth, 0) / 4, t: (zavg - zmin) / zr });
  }
  quads.sort((a, b) => b.depth - a.depth);
  const zAt = (x: number, y: number) => {
    // bilinear interpolation on the grid
    const fx = ((x - gmin) / gr) * (n - 1), fy = ((y - gmin) / gr) * (n - 1);
    const i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fy))), u = fx - i, v = fy - j;
    return (1 - u) * (1 - v) * r.z[i][j] + u * (1 - v) * r.z[i + 1][j] + u * v * r.z[i + 1][j + 1] + (1 - u) * v * r.z[i][j + 1];
  };
  const line = (f: (s: number) => [number, number]) => Array.from({ length: 41 }, (_, k) => { const [x, y] = f(gmin + (gr * k) / 40); return proj(x, y, zAt(x, y)); })
    .filter((_, k, all) => k < all.length).map((p, k) => `${k ? 'L' : 'M'} ${p.sx} ${p.sy}`).join(' ');
  const mid = gmin + gr / 2;
  const axis = (x: number, y: number) => proj(x, y, zmin);
  const xa = [axis(gmin, gmin), axis(g[n - 1], gmin)], ya = [axis(gmin, gmin), axis(gmin, g[n - 1])];
  return (
    <>
      <ChartFrame id="rsa:surface" name="response-surface" width={W} height={H} defaults={{ x: input.x, y: input.y }}>
        {(labels) => (
          <svg className="mc-chart" width={W} height={H} role="img" aria-label="Response surface">
            {quads.map((q, k) => <polygon key={k} points={q.pts} fill={shade(q.t)} fillOpacity={0.88} stroke="#ffffff" strokeOpacity={0.35} strokeWidth={0.5} />)}
            <path d={line((s) => [s, s])} stroke="#111827" strokeWidth={2} fill="none" />
            <path d={line((s) => [s, 2 * mid - s])} stroke="#111827" strokeWidth={2} strokeDasharray="5 4" fill="none" />
            <line x1={xa[0].sx} y1={xa[0].sy} x2={xa[1].sx} y2={xa[1].sy} stroke="#64748b" />
            <line x1={ya[0].sx} y1={ya[0].sy} x2={ya[1].sx} y2={ya[1].sy} stroke="#64748b" />
            <text x={xa[1].sx} y={xa[1].sy + 16} textAnchor="middle" className="axis-title">{labels.x}</text>
            <text x={ya[1].sx} y={ya[1].sy + 16} textAnchor="middle" className="axis-title">{labels.y}</text>
            <text x={12} y={18}>{input.outcome}: {fmt(zmin, 2)} (violet) – {fmt(zmax, 2)} (amber)</text>
          </svg>
        )}
      </ChartFrame>
      <div className="field" style={{ maxWidth: 360 }}>
        <label>Rotate</label>
        <input type="range" min={-180} max={180} value={az} onChange={(e) => setAz(Number(e.target.value))} />
      </div>
      <div className="hint">Solid line: congruence (X = Y); dashed: incongruence (X = −Y){input.center === 'none' ? '' : `, through the centre`}. Controls at their means.</div>
    </>
  );
}

function RsaView({ r, input, current }: { r: RsaResult; input: RsaInput; current: boolean }) {
  const stat = r.estimation === 'OLS' ? 't' : 'z';
  const level = Math.round(100 * input.confidence);
  const data = useStore((s) => s.data), info = useStore((s) => s.dataInfo);
  const save = () => {
    if (!current || !data || !info || r.nTotal !== data.cols[0]?.length) return;
    const col = new Float64Array(r.nTotal).fill(NaN);
    r.rows.forEach((row, k) => { col[row - 1] = r.block[k]; });
    const name = freeColumnName(data.names, `block_${input.x}_${input.y}`.replace(/[^A-Za-z0-9_]/g, '_'));
    useStore.getState().setData({ ...data, names: [...data.names, name], cols: [...data.cols, col] }, info);
    useStore.getState().toast('success', `Block variable saved as “${name}”. Use it as X in a conditional process model (e.g. PROCESS model 4 or 14).`);
  };
  return (
    <div className="tables">
      {r.steps.length > 0 && (
        <Table title="Steps" file="rsa-steps" columns={['Model', 'R²', 'ΔR²', 'F', 'df', 'p']}
          rows={r.steps.map((s) => [c(s.step), c(s.r2), c(s.dr2 ?? null), c(s.f ?? null, undefined, 2), c(s.df1 ?? null, undefined, 0), pCell(s.p ?? null)])}
          note="Shanock et al. (2010): a significant gain from the quadratic terms supports the polynomial model over the linear one." />
      )}
      <Table title="Polynomial regression" file="rsa-coefficients" columns={['Term', 'b', 'Std. error', stat, 'p', `${level}% CI low`, `${level}% CI high`]}
        rows={r.coefficients.map((x) => [c(x.term), c(x.est), c(x.se), c(x.stat, undefined, 2), pCell(x.p), c(x.ciLow), c(x.ciHigh)])}
        note={`${r.fit.n} observations; R² = ${fmt(r.fit.r2, 3)}${r.fit.adjR2 !== undefined ? `, adjusted ${fmt(r.fit.adjR2, 3)}` : ''}. ${r.estimation === 'OLS' ? 'OLS.' : `lavaan ${r.estimation}, as the RSA package.`} The coefficients are not interpreted one by one: they shape the surface below.`} />
      <Table title="Response surface" file="rsa-surface" columns={['Parameter', 'Estimate', 'Std. error', stat, 'p', 'Meaning']}
        rows={r.surface.map((x) => [c(x.name), c(x.est), c(x.se), c(x.stat, undefined, 2), pCell(x.p), { ...c(MEANING[x.name] ?? ''), cls: 'text-left' }])}
        note={<>a1: does the outcome rise or fall as X and Y increase together? a3: is it higher when X exceeds Y (positive) or Y exceeds X (negative)?
          a4 negative: the outcome drops as X and Y diverge — a fit effect, best supported when the first principal axis lies close to X = Y (p10 ≈ 0, p11 ≈ 1).
          a2: curvature along X = Y; a5: asymmetry (Humberg et al. 2019). Edwards &amp; Parry (1993); Shanock et al. (2010).</>} />
      <Surface r={r} input={input} />
      <div>
        <button className="btn sm" disabled={!current || !data || r.nTotal !== data.cols[0]?.length} onClick={save}
          title="The polynomial's combined prediction (Edwards & Cable 2009), as one predictor for mediation and moderation models">Save the block variable as a data column</button>
      </div>
      {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
    </div>
  );
}


function RsaOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<RsaOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  const [midpoint, setMidpoint] = useState(String(o.midpoint));
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Does it matter whether two predictors match (e.g. identification with the company and with the community)? Instead of a difference score,
        the outcome is regressed on X, Y, X², X·Y and Y²; the resulting surface is read along the lines of congruence (X = Y) and incongruence (X = −Y).
      </p>
      {!columns.length ? <div className="empty-results">Import raw data first.</div> : (
        <>
          <ColumnSelect id="rsa-z" label="Outcome (Z)" value={o.outcome} columns={columns} exclude={[o.x, o.y, ...o.controls]} onChange={(outcome) => set({ ...o, outcome })} />
          <ColumnSelect id="rsa-x" label="Predictor X" value={o.x} columns={columns} exclude={[o.outcome, o.y, ...o.controls]} onChange={(x) => set({ ...o, x })} />
          <ColumnSelect id="rsa-y" label="Predictor Y (same scale as X)" value={o.y} columns={columns} exclude={[o.outcome, o.x, ...o.controls]} onChange={(y) => set({ ...o, y })} />
          <OrderedPicker label="Controls (optional)" columns={columns.filter((n) => ![o.outcome, o.x, o.y].includes(n))} value={o.controls} onChange={(controls) => set({ ...o, controls })} />
          <Choice label="Centring of X and Y (the same for both)" value={o.center} onChange={(center) => set({ ...o, center })}
            options={[['mean', 'Pooled mean'], ['midpoint', 'Scale midpoint'], ['none', 'None']]}
            hint="Both predictors are shifted by the same amount, so the line X = Y keeps its meaning." />
          {o.center === 'midpoint' && (
            <input className="input num" value={midpoint} aria-label="Scale midpoint"
              onChange={(e) => { setMidpoint(e.target.value); const v = Number(e.target.value); if (e.target.value.trim() && Number.isFinite(v)) set({ ...o, midpoint: v }); }} />
          )}
          <Choice label="Estimation" value={o.estimation} onChange={(estimation) => set({ ...o, estimation })}
            options={[['OLS', 'OLS'], ['ML', 'ML (lavaan)'], ['MLR', 'MLR (robust)']]}
            hint="OLS gives the stepwise R² changes; ML/MLR (as the RSA package) adds the stationary point and principal axes with standard errors." />
        </>
      )}
    </fieldset>
  );
}

const input = (o: RsaOptions, confidence: number): RsaInput => ({ ...o, confidence });

/** The result, with the confidence level it was computed at. */
type RsaCardResult = RsaResult & { confidence: number };

export const rsaAnalysis: AnalysisType<RsaOptions, RsaCardResult> = {
  id: 'rsa',
  title: 'Polynomial regression (RSA)',
  sub: 'congruence / imbalance of two predictors, response surface',
  group: 'Regression and causal inference',
  defaults: () => ({ outcome: '', x: '', y: '', controls: [], estimation: 'OLS', center: 'mean', midpoint: 3 }),
  parseOptions: (raw) => (isObj(raw) ? {
    outcome: name(raw.outcome), x: name(raw.x), y: name(raw.y), controls: names(raw.controls),
    estimation: oneOf(raw.estimation, ['OLS', 'ML', 'MLR'] as const, 'OLS'), center: oneOf(raw.center, ['none', 'mean', 'midpoint'] as const, 'mean'),
    midpoint: clampNum(raw.midpoint, -1e6, 1e6, 3),
  } : null),
  Options: RsaOptionsForm,
  View: ({ result, options, current }) => <RsaView r={result} input={input(options, result.confidence ?? 0.95)} current={current} />,
  blocked: (o, ctx) => {
    if (!o.outcome || !o.x || !o.y) return 'Choose the outcome and the two predictors.';
    if (new Set([o.outcome, o.x, o.y]).size < 3) return 'The outcome and the two predictors must be different columns.';
    return missingColumns(ctx, [o.outcome, o.x, o.y, ...o.controls], 'Polynomial regression');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, [o.outcome, o.x, o.y, ...o.controls], [ctx.settings.confidence]),
  run: async (o, ctx) => ({ ...(await (await import('../rengine/rsa')).rsaR(rawData(ctx)!, input(o, ctx.settings.confidence))), confidence: ctx.settings.confidence }),
  script: async (o, ctx) => (await import('../rengine/rsa')).rsaScriptR(rawData(ctx)!, input(o, ctx.settings.confidence)),
  summary: (o) => (o.outcome ? `${o.x} × ${o.y} → ${o.outcome}${o.controls.length ? ` (${o.controls.length} controls)` : ''} · ${o.estimation}` : 'not set up yet'),
};
