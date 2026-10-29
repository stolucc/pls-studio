import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { downloadText, fmt, safeFileName } from '../format';
import type { GrowthInput, GrowthResult, LongEstimate, RiclpmInput, RiclpmResult } from '../rengine/longitudinal';
import { useStore } from '../store';
import { ChartFrame } from './ChartFrame';
import { IconX } from './icons';
import { c, pCell, Table, type Row } from './results/Table';

interface LongState {
  open: boolean;
  growth: { input: GrowthInput; result: GrowthResult } | null;
  riclpm: { input: RiclpmInput; result: RiclpmResult } | null;
  /** Inputs filled in by an example (applied when it changes). */
  preset: { growth: Pick<GrowthInput, 'measures' | 'times' | 'shape' | 'covariates'> } | null;
  setOpen: (v: boolean) => void;
}
export const useLong = create<LongState>((set) => ({ open: false, growth: null, riclpm: null, preset: null, setOpen: (open) => set({ open }) }));

/** Columns in the order clicked: the measurement occasions. */
export function OrderedPicker({ label, columns, value, onChange }: { label: string; columns: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="pick-list">
        {value.map((v, i) => (
          <span key={v} className="chip accent pick">{i + 1}. {v}
            <button aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}><IconX size={11} /></button>
          </span>
        ))}
        {!value.length && <span className="hint">Click columns below in time order.</span>}
      </div>
      <div className="pick-source">
        {columns.filter((n) => !value.includes(n)).map((n) => <button key={n} className="btn sm ghost" onClick={() => onChange([...value, n])}>{n}</button>)}
      </div>
    </div>
  );
}

const fitCards = (f: Partial<Record<'chisq' | 'df' | 'cfi' | 'rmsea' | 'srmr', number>>) => (
  <div className="stat-cards">
    {([['χ²', f.chisq, 2], ['df', f.df, 0], ['CFI', f.cfi, 3], ['RMSEA', f.rmsea, 3], ['SRMR', f.srmr, 3]] as const).map(([k, v, d]) => (
      <div className="stat-card" key={k}><div className="k">{k}</div><div className="v">{v === undefined ? '—' : fmt(v, d)}</div></div>
    ))}
  </div>
);
const estRow = (e: LongEstimate, label: string): Row => [c(label), c(e.est), c(e.se), c(e.z), pCell(e.p), c(e.std)];
const estCols = ['Parameter', 'Estimate', 'Std. error', 'z', 'p', 'Standardised'];

function GrowthView({ r }: { r: GrowthResult }) {
  const name: Record<string, string> = { i: 'Intercept', s: 'Slope', q: 'Quadratic' };
  const f = (x: string) => name[x] ?? x;
  const means = r.estimates.filter((e) => e.op === '~1');
  const vars = r.estimates.filter((e) => e.op === '~~');
  const regs = r.estimates.filter((e) => e.op === '~');
  const W = 460, H = 240, pad = { l: 56, r: 14, t: 12, b: 40 };
  const all = [...r.impliedMeans, ...r.observedMeans];
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const t0 = Math.min(...r.times), t1 = Math.max(...r.times);
  const sx = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi + 0.08 * span - v) / (span * 1.16)) * (H - pad.t - pad.b);
  return (
    <div className="tables">
      {fitCards(r.fit)}
      <Table title={regs.length ? 'Growth factors: intercepts' : 'Growth factors: means'} file="growth-means" columns={estCols} rows={means.map((e) => estRow(e, f(e.lhs)))}
        note={regs.length
          ? 'With covariates these are intercepts: the expected level (at time score 0) and change per unit of time when every covariate is 0.'
          : 'The intercept mean is the average level at time score 0; the slope mean the average change per unit of time.'} />
      <Table title="Growth factors: variances and covariances" file="growth-variances" columns={estCols}
        rows={vars.map((e) => estRow(e, e.lhs === e.rhs ? f(e.lhs) : `${f(e.lhs)} ↔ ${f(e.rhs)}`))}
        note="Variances: how much people differ in level and change; covariance: whether people who start higher change faster." />
      {regs.length > 0 && <Table title="Covariates predicting the growth factors" file="growth-covariates" columns={estCols} rows={regs.map((e) => estRow(e, `${e.rhs} → ${f(e.lhs)}`))} />}
      <ChartFrame id="growth:trajectory" name="growth-trajectory" width={W} height={H} defaults={{ x: 'Time', y: 'Mean' }}>
        {(labels) => (
          <svg className="mc-chart" width={W} height={H} role="img" aria-label="Mean trajectory">
            <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(lo)} y2={sy(lo)} />
            <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(hi)} y2={sy(hi)} />
            <text x={pad.l - 6} y={sy(lo) + 4} textAnchor="end">{fmt(lo, 2)}</text>
            <text x={pad.l - 6} y={sy(hi) + 4} textAnchor="end">{fmt(hi, 2)}</text>
            {r.times.map((t, i) => <text key={i} x={sx(t)} y={H - pad.b + 16} textAnchor="middle">{r.measures[i]}</text>)}
            <path d={r.times.map((t, i) => `${i ? 'L' : 'M'} ${sx(t)} ${sy(r.impliedMeans[i])}`).join(' ')} stroke="#6d28d9" strokeWidth={2.2} fill="none" />
            {r.times.map((t, i) => <circle key={i} cx={sx(t)} cy={sy(r.observedMeans[i])} r={4} fill="#0f9d63" />)}
            <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
            <text transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
          </svg>
        )}
      </ChartFrame>
      <div className="hint">Line: model-implied mean at each occasion; dots: observed means.</div>
    </div>
  );
}

function RiclpmView({ r, input }: { r: RiclpmResult; input: RiclpmInput }) {
  const lagged = r.estimates.filter((e) => e.op === '~');
  const lbl = (e: LongEstimate) => {
    const v = (s: string) => (s.startsWith('wx') ? `${input.x[0].replace(/\d+$/, '') || 'X'}` : `${input.y[0].replace(/\d+$/, '') || 'Y'}`);
    const wave = (s: string) => s.slice(2);
    const kind = e.lhs.slice(0, 2) === e.rhs.slice(0, 2) ? 'autoregressive' : 'cross-lagged';
    return `${v(e.rhs)}(${wave(e.rhs)}) → ${v(e.lhs)}(${wave(e.lhs)}), ${kind}`;
  };
  const between = r.estimates.filter((e) => e.op === '~~' && e.lhs.startsWith('RI'));
  return (
    <div className="tables">
      {fitCards(r.fit)}
      <Table title="Within-person lagged effects" file="riclpm-lagged" columns={estCols} rows={lagged.map((e) => estRow(e, lbl(e)))}
        note={`Effects among within-person deviations from each person's own mean (Hamaker, Kuiper & Grasman, 2015)${r.equal ? ', held equal over time' : ''}. Cross-lagged: a person above their usual level on one variable is later above (or below) their usual level on the other.`} />
      <Table title="Between-person: random intercepts" file="riclpm-between" columns={estCols}
        rows={between.map((e) => estRow(e, e.lhs === e.rhs ? `Variance of ${e.lhs}` : `${e.lhs} ↔ ${e.rhs} (standardised: correlation)`))}
        note="Stable differences between persons, separated from the within-person dynamics." />
      <Table title="RI-CLPM versus the traditional cross-lagged panel model" file="riclpm-vs-clpm" columns={['Model', 'χ²', 'df', 'CFI', 'RMSEA', 'Δχ²', 'Δdf', 'p']}
        rows={[
          [c('CLPM (no random intercepts)'), c(r.clpmFit.chisq ?? null), c(r.clpmFit.df ?? null, '', 0), c(r.clpmFit.cfi ?? null), c(r.clpmFit.rmsea ?? null), c(null), c(null), c(null)],
          [c('RI-CLPM'), c(r.fit.chisq ?? null), c(r.fit.df ?? null, '', 0), c(r.fit.cfi ?? null), c(r.fit.rmsea ?? null), c(r.comparison.chisqDiff), c(r.comparison.dfDiff, '', 0), pCell(r.comparison.p)],
        ]}
        note="A significant difference favours the random intercepts: stable between-person differences would otherwise be mistaken for lagged effects. The test is conservative (variances on the boundary)." />
    </div>
  );
}

/** Latent growth curves and RI-CLPM (lavaan), on the current dataset. */
export function LongitudinalPanel() {
  const open = useLong((s) => s.open);
  const growth = useLong((s) => s.growth);
  const riclpm = useLong((s) => s.riclpm);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const project = useStore((s) => s.projectName);
  const [kind, setKind] = useState<'growth' | 'riclpm'>('growth');
  const [measures, setMeasures] = useState<string[]>(growth?.input.measures ?? []);
  const [times, setTimes] = useState<string>((growth?.input.times ?? []).join(', '));
  const [shape, setShape] = useState<GrowthInput['shape']>(growth?.input.shape ?? 'linear');
  const [covariates, setCovariates] = useState<string[]>(growth?.input.covariates ?? []);
  const [xs, setXs] = useState<string[]>(riclpm?.input.x ?? []);
  const [ys, setYs] = useState<string[]>(riclpm?.input.y ?? []);
  const [equal, setEqual] = useState(riclpm?.input.equal ?? false);
  const [busy, setBusy] = useState(false);
  const preset = useLong((s) => s.preset);
  useEffect(() => {
    if (!preset) return;
    const g = preset.growth;
    setKind('growth'); setMeasures(g.measures); setTimes(g.times.join(', ')); setShape(g.shape); setCovariates(g.covariates);
  }, [preset]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useLong.getState().setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const columns = data && !data.moments ? data.names : [];
  const estimator = settings.estimator === 'MLR' ? 'MLR' : 'ML';
  const missing = settings.missing;
  const timeScores = times.trim() ? times.split(/[,\s]+/).filter(Boolean).map(Number) : measures.map((_, i) => i);
  const growthInput: GrowthInput = { measures, times: timeScores, shape, covariates, estimator, missing };
  const riInput: RiclpmInput = { x: xs, y: ys, equal, estimator, missing };
  const fail = (e: unknown) => import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', `lavaan: ${rMessage(e)}`));
  const logWarnings = (w: string[]) => w.forEach((x) => useStore.getState().logMessage('warning', x, 'lavaan (longitudinal)'));
  const run = async () => {
    setBusy(true);
    try {
      const m = await import('../rengine/longitudinal');
      if (kind === 'growth') {
        const result = await m.growthR(data!, growthInput);
        logWarnings(result.warnings);
        useLong.setState({ growth: { input: growthInput, result } });
      } else {
        const result = await m.riclpmR(data!, riInput);
        logWarnings(result.warnings);
        useLong.setState({ riclpm: { input: riInput, result } });
      }
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  const script = async () => {
    try {
      const m = await import('../rengine/longitudinal');
      const text = kind === 'growth' ? await m.growthScriptR(data!, growthInput) : await m.riclpmScriptR(data!, riInput);
      downloadText(`${safeFileName(project)}-lavaan-${kind}.R`, text, 'text/x-r-source');
    } catch (e) { await fail(e); }
  };
  const ready = kind === 'growth' ? measures.length >= 3 && timeScores.length === measures.length && timeScores.every(Number.isFinite) : xs.length >= 3 && xs.length === ys.length;
  return (
    <div className="sim-backdrop" role="dialog" aria-modal="true" aria-label="Longitudinal models">
      <div className="sim">
        <header className="sim-head">
          <div><b>Longitudinal models</b><span className="muted">lavaan · {estimator}{missing === 'fiml' ? ', FIML' : ''} (from the Model settings)</span></div>
          <button className="btn icon ghost" onClick={() => useLong.getState().setOpen(false)} aria-label="Close"><IconX /></button>
        </header>
        {!columns.length ? <div className="empty-results">Import raw data with repeated measures first.</div> : (
          <div className="sim-body long-body">
            <section className="sim-col">
              <div className="segmented" style={{ marginBottom: 12 }}>
                <button className={kind === 'growth' ? 'on' : ''} onClick={() => setKind('growth')}>Latent growth curve</button>
                <button className={kind === 'riclpm' ? 'on' : ''} onClick={() => setKind('riclpm')}>RI-CLPM</button>
              </div>
              {kind === 'growth' ? (
                <>
                  <OrderedPicker label="Repeated measures (in time order)" columns={columns.filter((n) => !covariates.includes(n))} value={measures} onChange={setMeasures} />
                  <div className="field">
                    <label>Time scores</label>
                    <input className="input" value={times} placeholder={measures.map((_, i) => i).join(', ') || '0, 1, 2, 3'} onChange={(e) => setTimes(e.target.value)} />
                    <div className="hint">Default 0, 1, 2, …: the intercept is the level at the first occasion. Use e.g. 0, 0.5, 1, 2 for unequal spacing.</div>
                  </div>
                  <div className="field">
                    <label>Shape</label>
                    <div className="segmented">
                      {([['linear', 'Linear'], ['quadratic', 'Quadratic'], ['basis', 'Latent basis']] as const).map(([id, l]) => (
                        <button key={id} className={shape === id ? 'on' : ''} onClick={() => setShape(id)}>{l}</button>
                      ))}
                    </div>
                    <div className="hint">Latent basis: the first two time scores fixed (0, 1), the others estimated, so the shape of change is free.</div>
                  </div>
                  <OrderedPicker label="Covariates predicting the growth factors (optional)" columns={columns.filter((n) => !measures.includes(n))} value={covariates} onChange={setCovariates} />
                </>
              ) : (
                <>
                  <OrderedPicker label="Variable X at each wave" columns={columns.filter((n) => !ys.includes(n))} value={xs} onChange={setXs} />
                  <OrderedPicker label="Variable Y at the same waves" columns={columns.filter((n) => !xs.includes(n))} value={ys} onChange={setYs} />
                  <label className="check"><input type="checkbox" checked={equal} onChange={(e) => setEqual(e.target.checked)} />
                    <span>Hold the lagged effects equal over time<br /><span className="hint">For equally spaced waves; test it against the free model by comparing fit.</span></span></label>
                </>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn primary" disabled={!ready || busy} onClick={() => void run()}>{busy ? 'Estimating…' : 'Estimate'}</button>
                <button className="btn" disabled={!ready} onClick={() => void script()}>R script</button>
              </div>
            </section>
            <section className="sim-col wide">
              {kind === 'growth' && growth && <GrowthView r={growth.result} />}
              {kind === 'riclpm' && riclpm && <RiclpmView r={riclpm.result} input={riclpm.input} />}
              {!(kind === 'growth' ? growth : riclpm) && <div className="empty-results">Choose the measures and press Estimate.</div>}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
