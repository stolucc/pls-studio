import { useEffect, useState, type ReactNode } from 'react';
import { downloadText, fmt, safeFileName } from '../format';
import type { GmmInput, GmmModel, GmmResult } from '../rengine/mixed';
import { useStore } from '../store';
import { ChartFrame } from './ChartFrame';
import { OrderedPicker, useLong } from './LongitudinalPanel';
import { c, pCell, Table } from './results/Table';
import { isCancelled } from '../cancellable';
import { useCancellable } from './useCancellable';

const COLORS = ['#6d28d9', '#0f9d63', '#d97706', '#2563eb', '#db2777', '#0891b2'];

/** Best model by BIC (the usual choice for the number of classes). */
export const bestByBic = (models: GmmModel[]) => models.reduce((a, b) => (b.bic < a.bic ? b : a), models[0]);

function Trajectories({ r, m }: { r: GmmResult; m: GmmModel }) {
  const W = 480, H = 260, pad = { l: 56, r: 14, t: 12, b: 40 };
  const all = [...m.trajectories.flat(), ...(m.observed ?? []).flat().filter((v): v is number => v !== null)];
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const t0 = r.times[0], t1 = r.times[r.times.length - 1];
  const sx = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi + 0.08 * span - v) / (span * 1.16)) * (H - pad.t - pad.b);
  return (
    <ChartFrame id="gmm:trajectories" name="growth-mixture-trajectories" width={W} height={H} defaults={{ x: 'Time', y: 'Outcome' }}>
      {(labels) => (
        <svg className="mc-chart" width={W} height={H} role="img" aria-label="Class trajectories">
          <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(lo)} y2={sy(lo)} />
          <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(hi)} y2={sy(hi)} />
          <text x={pad.l - 6} y={sy(lo) + 4} textAnchor="end">{fmt(lo, 2)}</text>
          <text x={pad.l - 6} y={sy(hi) + 4} textAnchor="end">{fmt(hi, 2)}</text>
          <text x={sx(t0)} y={H - pad.b + 16} textAnchor="middle">{fmt(t0, 2)}</text>
          <text x={sx(t1)} y={H - pad.b + 16} textAnchor="middle">{fmt(t1, 2)}</text>
          {m.trajectories.map((tr, k) => (
            <g key={k}>
              <path d={tr.map((v, i) => `${i ? 'L' : 'M'} ${sx(r.times[i])} ${sy(v)}`).join(' ')} stroke={COLORS[k % COLORS.length]} strokeWidth={2.2} fill="none" />
              {m.observed?.[k]?.map((v, i) => v !== null && <circle key={i} cx={sx(r.observedTimes[i])} cy={sy(v)} r={3.5} fill={COLORS[k % COLORS.length]} opacity={0.7} />)}
              <text x={W - pad.r} y={sy(tr[tr.length - 1]) - 5} textAnchor="end" fill={COLORS[k % COLORS.length]}>Class {k + 1} ({fmt(100 * m.shares[k], 0)}%)</text>
            </g>
          ))}
          <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
          <text transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

export function GmmView({ r }: { r: GmmResult }) {
  const best = bestByBic(r.models);
  const [k, setK] = useState(best.k);
  const m = r.models.find((x) => x.k === k) ?? best;
  return (
    <div className="tables">
      <Table title="Number of classes" file="gmm-classes" columns={['Classes', 'Log-likelihood', 'Parameters', 'AIC', 'BIC', 'SABIC', 'Entropy', 'Smallest class', 'Converged']}
        rows={r.models.map((x) => [c(x.k, undefined, 0), c(x.logLik, undefined, 2), c(x.npar, undefined, 0), c(x.aic, undefined, 1), { ...c(x.bic, undefined, 1), bold: x.k === best.k },
          c(x.sabic, undefined, 1), c(x.entropy), c(`${fmt(100 * Math.min(...x.shares), 1)}%`), c(x.converged ? 'yes' : 'no')])}
        note={`${r.n} persons, ${r.observations} observations. Lower BIC is better (bold: the lowest); entropy near 1 means well-separated classes. Very small classes (under about 5%) are often not worth keeping. Each solution with two or more classes is the best of several random starts; if the best log-likelihood was found only once, run more starts.`} />
      <div className="segmented wrap" role="radiogroup" aria-label="Solution shown" style={{ alignSelf: 'flex-start' }}>
        {r.models.map((x) => <button key={x.k} role="radio" aria-checked={x.k === k} className={x.k === k ? 'on' : ''} onClick={() => setK(x.k)}>{x.k} {x.k === 1 ? 'class' : 'classes'}</button>)}
      </div>
      <Trajectories r={r} m={m} />
      <div className="hint">Lines: each class’s mean trajectory (covariates at their means); dots: observed means of the people assigned to the class{m.observed ? '' : ' (shown when there are at most 20 distinct occasions)'}.</div>
      <Table title={`Parameters, ${m.k} ${m.k === 1 ? 'class' : 'classes'}`} file={`gmm-${m.k}-parameters`} columns={['Parameter', 'Estimate', 'Std. error', 'p']}
        rows={m.params.map((p) => [c(p.name), c(p.est), c(p.se), pCell(p.p)])}
        note="Class membership: log-odds of each class relative to the last one. Then the class-specific trajectory coefficients (… class k), the covariates, the random-effect variances and covariances (varcov) and the residual standard error (stderr), in lcmm's names." />
    </div>
  );
}

/** Growth mixture model: inputs and results, inside the Longitudinal panel. */
export function GrowthMixture({ columns, tabs }: { columns: string[]; tabs: ReactNode }) {
  const result = useLong((s) => s.gmm);
  const preset = useLong((s) => s.preset);
  const project = useStore((s) => s.projectName);
  const seed = useStore((s) => s.settings.seed);
  const [format, setFormat] = useState<'wide' | 'long'>(result?.input.format ?? 'wide');
  const [measures, setMeasures] = useState<string[]>(result?.input.format === 'wide' ? result.input.measures : []);
  const [times, setTimes] = useState(result?.input.format === 'wide' ? result.input.times.join(', ') : '');
  const [subject, setSubject] = useState(result?.input.format === 'long' ? result.input.subject : '');
  const [time, setTime] = useState(result?.input.format === 'long' ? result.input.time : '');
  const [outcome, setOutcome] = useState(result?.input.format === 'long' ? result.input.outcome : '');
  const [covariates, setCovariates] = useState<string[]>(result?.input.covariates ?? []);
  const [shape, setShape] = useState<GmmInput['shape']>(result?.input.shape ?? 'linear');
  const [random, setRandom] = useState<GmmInput['random']>(result?.input.random ?? 'intercept');
  const [to, setTo] = useState(Math.max(...(result?.input.classes ?? [3])));
  const [nrep, setNrep] = useState(result?.input.nrep ?? 30);
  const { busy, setBusy, guard, cancel } = useCancellable();
  useEffect(() => {
    const g = preset?.gmm;
    if (!g) return;
    setFormat(g.format); setCovariates(g.covariates); setShape(g.shape); setRandom(g.random); setTo(Math.max(...g.classes)); setNrep(g.nrep);
    if (g.format === 'wide') { setMeasures(g.measures); setTimes(g.times.join(', ')); } else { setSubject(g.subject); setTime(g.time); setOutcome(g.outcome); }
  }, [preset]);
  const data = useStore((s) => s.data);
  const timeScores = times.trim() ? times.split(/[,\s]+/).filter(Boolean).map(Number) : measures.map((_, i) => i);
  const classes = Array.from({ length: to }, (_, i) => i + 1);
  const common = { shape, random, classes, covariates, nrep, seed };
  const input: GmmInput = format === 'wide' ? { ...common, format, measures, times: timeScores } : { ...common, format, subject, time, outcome };
  const ready = format === 'wide' ? measures.length >= 3 && timeScores.length === measures.length && timeScores.every(Number.isFinite)
    : !!subject && !!time && !!outcome && new Set([subject, time, outcome]).size === 3;
  const fail = (e: unknown) => isCancelled(e) ? Promise.resolve() : import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', `lcmm: ${rMessage(e)}`));
  const run = async () => {
    setBusy(true);
    try {
      const { gmmR } = await import('../rengine/mixed');
      const r = await guard(gmmR(data!, input));
      r.warnings.forEach((w) => useStore.getState().logMessage('warning', w, `lcmm ${r.engine.version}`));
      useLong.setState({ gmm: { input, result: r } });
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  const script = async () => {
    try {
      const { gmmScriptR } = await import('../rengine/mixed');
      downloadText(`${safeFileName(project)}-lcmm-growth-mixture.R`, await gmmScriptR(data!, input), 'text/x-r-source');
    } catch (e) { await fail(e); }
  };
  const pick = (label: string, value: string, set: (v: string) => void, exclude: string[]) => (
    <div className="field">
      <label>{label}</label>
      <select className="select" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Choose a column…</option>
        {columns.filter((n) => n === value || !exclude.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
  return (
    <>
      <section className="sim-col">
        {tabs}
        <div className="field">
          <label>Data layout</label>
          <div className="segmented">
            <button className={format === 'wide' ? 'on' : ''} onClick={() => setFormat('wide')}>One column per occasion</button>
            <button className={format === 'long' ? 'on' : ''} onClick={() => setFormat('long')}>One row per occasion</button>
          </div>
        </div>
        {format === 'wide' ? (
          <>
            <OrderedPicker label="Repeated measures (in time order)" columns={columns.filter((n) => !covariates.includes(n))} value={measures} onChange={setMeasures} />
            <div className="field">
              <label>Time scores</label>
              <input className="input" value={times} placeholder={measures.map((_, i) => i).join(', ') || '0, 1, 2, 3'} onChange={(e) => setTimes(e.target.value)} />
            </div>
          </>
        ) : (
          <>
            {pick('Person (subject id)', subject, setSubject, [time, outcome, ...covariates])}
            {pick('Time', time, setTime, [subject, outcome, ...covariates])}
            {pick('Outcome', outcome, setOutcome, [subject, time, ...covariates])}
          </>
        )}
        <OrderedPicker label="Covariates (optional, same effect in every class)" columns={columns.filter((n) => ![...measures, subject, time, outcome].includes(n))} value={covariates} onChange={setCovariates} />
        <div className="field">
          <label>Trajectory</label>
          <div className="segmented">
            {([['linear', 'Linear'], ['quadratic', 'Quadratic']] as const).map(([id, l]) => <button key={id} className={shape === id ? 'on' : ''} onClick={() => setShape(id)}>{l}</button>)}
          </div>
        </div>
        <div className="field">
          <label>Random effects within classes</label>
          <div className="segmented">
            {([['none', 'None (LCGA)'], ['intercept', 'Intercept'], ['slope', 'Intercept + slope']] as const).map(([id, l]) => <button key={id} className={random === id ? 'on' : ''} onClick={() => setRandom(id)}>{l}</button>)}
          </div>
          <div className="hint">None: latent class growth analysis (people within a class follow its trajectory exactly). With random effects, people vary around their class’s trajectory.</div>
        </div>
        <div className="row2">
          <div className="field">
            <label>Classes: 1 to</label>
            <input className="input num" type="number" min={2} max={6} value={to} onChange={(e) => setTo(Math.max(2, Math.min(6, Math.round(Number(e.target.value)) || 2)))} />
          </div>
          <div className="field">
            <label>Random starts</label>
            <input className="input num" type="number" min={5} max={100} value={nrep} onChange={(e) => setNrep(Math.max(5, Math.min(100, Math.round(Number(e.target.value)) || 5)))} />
          </div>
        </div>
        <div className="hint">Mixture models have local optima: each solution starts from {nrep} random starting values (seed from the Model settings; lcmm::gridsearch). This takes a while.</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn primary" disabled={!ready || busy} onClick={() => void run()}>{busy ? 'Estimating…' : 'Estimate'}</button>
          {busy && <button className="btn" onClick={cancel}>Cancel</button>}
          <button className="btn" disabled={!ready} onClick={() => void script()}>R script</button>
        </div>
      </section>
      <section className="sim-col wide">
        {result ? <GmmView key={result.result.models.length + result.result.n} r={result.result} /> : <div className="empty-results">Choose the measures and press Estimate.</div>}
      </section>
    </>
  );
}
