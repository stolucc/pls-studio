import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { downloadText, fmt, safeFileName } from '../format';
import type { RsaInput, RsaResult } from '../rengine/rsa';
import { useStore } from '../store';
import { ChartFrame } from './ChartFrame';
import { IconX } from './icons';
import { OrderedPicker } from './LongitudinalPanel';
import { c, pCell, Table } from './results/Table';
import { freeColumnName } from './SegmentationPanel';

export type RsaPreset = Partial<RsaInput>;
interface RsaState { open: boolean; result: { input: RsaInput; result: RsaResult } | null; preset: RsaPreset | null; setOpen: (v: boolean) => void }
export const usePolynomial = create<RsaState>((set) => ({ open: false, result: null, preset: null, setOpen: (open) => set({ open }) }));

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

function RsaView({ r, input }: { r: RsaResult; input: RsaInput }) {
  const stat = r.estimation === 'OLS' ? 't' : 'z';
  const level = Math.round(100 * input.confidence);
  const data = useStore((s) => s.data), info = useStore((s) => s.dataInfo);
  const save = () => {
    if (!data || !info || r.nTotal !== data.cols[0]?.length) return;
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
        <button className="btn sm" disabled={!data || r.nTotal !== data.cols[0]?.length} onClick={save}
          title="The polynomial's combined prediction (Edwards & Cable 2009), as one predictor for mediation and moderation models">Save the block variable as a data column</button>
      </div>
      {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
    </div>
  );
}

/** Polynomial regression with response surface analysis on the current dataset. */
export function PolynomialPanel() {
  const open = usePolynomial((s) => s.open);
  const saved = usePolynomial((s) => s.result);
  const preset = usePolynomial((s) => s.preset);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const project = useStore((s) => s.projectName);
  const [outcome, setOutcome] = useState(saved?.input.outcome ?? '');
  const [x, setX] = useState(saved?.input.x ?? '');
  const [y, setY] = useState(saved?.input.y ?? '');
  const [controls, setControls] = useState<string[]>(saved?.input.controls ?? []);
  const [estimation, setEstimation] = useState<RsaInput['estimation']>(saved?.input.estimation ?? 'OLS');
  const [center, setCenter] = useState<RsaInput['center']>(saved?.input.center ?? 'mean');
  const [midpoint, setMidpoint] = useState(String(saved?.input.midpoint ?? 3));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!preset) return;
    if (preset.outcome !== undefined) setOutcome(preset.outcome);
    if (preset.x !== undefined) setX(preset.x);
    if (preset.y !== undefined) setY(preset.y);
    if (preset.controls) setControls(preset.controls);
    if (preset.estimation) setEstimation(preset.estimation);
    if (preset.center) setCenter(preset.center);
  }, [preset]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') usePolynomial.getState().setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const close = () => usePolynomial.getState().setOpen(false);
  const columns = data && !data.moments ? data.names : [];
  const input: RsaInput = { outcome, x, y, controls, estimation, center, midpoint: Number(midpoint), confidence: settings.confidence };
  const ready = !!outcome && !!x && !!y && new Set([outcome, x, y]).size === 3 && (center !== 'midpoint' || Number.isFinite(Number(midpoint)));
  const fail = (e: unknown) => import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', rMessage(e)));
  const run = async () => {
    setBusy(true);
    try {
      const { rsaR } = await import('../rengine/rsa');
      const result = await rsaR(data!, input);
      result.warnings.forEach((w) => useStore.getState().logMessage('warning', w, `${result.engine.package} ${result.engine.version}`));
      usePolynomial.setState({ result: { input, result } });
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  const script = async () => {
    try {
      const { rsaScriptR } = await import('../rengine/rsa');
      downloadText(`${safeFileName(project)}-response-surface.R`, await rsaScriptR(data!, input), 'text/x-r-source');
    } catch (e) { await fail(e); }
  };
  const pick = (label: string, value: string, set: (v: string) => void, exclude: string[]) => (
    <div className="field">
      <label>{label}</label>
      <select className="select" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Choose…</option>
        {columns.filter((n) => n === value || !exclude.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
  return (
    <div className="sim-backdrop" role="dialog" aria-modal="true" aria-label="Polynomial regression">
      <div className="sim">
        <header className="sim-head">
          <div><b>Polynomial regression and response surface analysis</b><span className="muted">{estimation === 'OLS' ? 'OLS (Shanock et al. 2010)' : `lavaan ${estimation} (as the RSA package)`}</span></div>
          <button className="btn icon ghost" onClick={close} aria-label="Close"><IconX /></button>
        </header>
        {!columns.length ? <div className="empty-results">Import raw data first.</div> : (
          <div className="sim-body long-body">
            <section className="sim-col">
              <p className="hint" style={{ marginTop: 0 }}>
                Does it matter whether two predictors match (e.g. identification with the company and with the community)? Instead of a difference score,
                the outcome is regressed on X, Y, X², X·Y and Y²; the resulting surface is read along the lines of congruence (X = Y) and incongruence (X = −Y).
              </p>
              {pick('Outcome (Z)', outcome, setOutcome, [x, y, ...controls])}
              {pick('Predictor X', x, setX, [outcome, y, ...controls])}
              {pick('Predictor Y (same scale as X)', y, setY, [outcome, x, ...controls])}
              <OrderedPicker label="Controls (optional)" columns={columns.filter((n) => ![outcome, x, y].includes(n))} value={controls} onChange={setControls} />
              <div className="field">
                <label>Centring of X and Y (the same for both)</label>
                <div className="segmented">
                  {([['mean', 'Pooled mean'], ['midpoint', 'Scale midpoint'], ['none', 'None']] as const).map(([id, l]) => <button key={id} className={center === id ? 'on' : ''} onClick={() => setCenter(id)}>{l}</button>)}
                </div>
                {center === 'midpoint' && <input className="input num" style={{ marginTop: 6 }} value={midpoint} onChange={(e) => setMidpoint(e.target.value)} aria-label="Scale midpoint" />}
                <div className="hint">Both predictors are shifted by the same amount, so the line X = Y keeps its meaning.</div>
              </div>
              <div className="field">
                <label>Estimation</label>
                <div className="segmented">
                  {([['OLS', 'OLS'], ['ML', 'ML (lavaan)'], ['MLR', 'MLR (robust)']] as const).map(([id, l]) => <button key={id} className={estimation === id ? 'on' : ''} onClick={() => setEstimation(id)}>{l}</button>)}
                </div>
                <div className="hint">OLS gives the stepwise R² changes; ML/MLR (as the RSA package) adds the stationary point and principal axes with standard errors.</div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn primary" disabled={!ready || busy} onClick={() => void run()}>{busy ? 'Estimating…' : 'Estimate'}</button>
                <button className="btn" disabled={!ready} onClick={() => void script()}>R script</button>
              </div>
            </section>
            <section className="sim-col wide">
              {saved ? <RsaView r={saved.result} input={saved.input} /> : <div className="empty-results">Choose the outcome and the two predictors, and press Estimate.</div>}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
