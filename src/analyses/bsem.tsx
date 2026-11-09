// Bayesian SEM card: the CB-SEM model of the diagram fitted by blavaan (Stan) in
// desktop R through the helper. Convergence first (R-hat, effective sample
// sizes), then blavaan's fit measures and the posterior of every parameter;
// optionally Mplus's default priors, priors on labelled parameters (MODEL
// PRIORS), approximate invariance across groups (DIFF priors, blavaan's wiggle),
// a defined quantity over a moderator (LOOP) and plausible values.

import { useState } from 'react';
import { ChartFrame } from '../components/ChartFrame';
import { c, Table, type Row } from '../components/results/Table';
import { fmt } from '../format';
import { namesIn, parseExpr } from '../model/expr';
import { labelUses, toSpec, validateModel } from '../model/project';
import { useCompute } from '../rengine/compute';
import type { BsemLoop, BsemLoopResult, BsemOptions, BsemPrior, BsemResult } from '../rengine/bsem';
import { Choice, clampNum, columnsFingerprint, isObj, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';
import { fingerprint } from './codec';

const engine = () => import('../rengine/bsem');
const pct = (conf: number) => `${Math.round(conf * 100)}%`;
const modelIndicators = (ctx: AnalysisCtx) => [...new Set((ctx.model?.constructs ?? []).flatMap((k) => k.indicators))];
const OP_NAME: Record<string, string> = { '=~': 'Loadings', '~': 'Regressions', '~~': 'Variances and covariances', '~1': 'Intercepts and means', '|': 'Thresholds' };
const OP_FILE: Record<string, string> = { '=~': 'loadings', '~': 'regressions', '~~': 'covariances', '~1': 'means', '|': 'thresholds' };

// ---- Priors on labelled parameters, written as Mplus's MODEL PRIORS: "xload1-xload6 ~ N(0, 0.01);" ----

/** Labels with a numeric suffix as a range (dir1-dir18), or one by one. */
function expandLabels(text: string): string[] {
  return text.replace(/\s*-\s*/g, '-').split(/[\s,]+/).filter(Boolean).flatMap((t) => {
    const parts = t.split('-');
    if (parts.length === 1) return [t];
    const m = parts.map((p) => /^([A-Za-z][A-Za-z0-9_]*?)(\d+)$/.exec(p));
    if (parts.length !== 2 || !m[0] || !m[1] || m[0][1] !== m[1][1] || Number(m[1][2]) < Number(m[0][2])) throw new Error(`“${t}” is not a range of labels (such as dir1-dir18).`);
    return Array.from({ length: Number(m[1][2]) - Number(m[0][2]) + 1 }, (_, i) => `${m[0]![1]}${Number(m[0]![2]) + i}`);
  });
}
/** Parse prior lines "labels ~ N(mean, variance)"; throws with a readable message. */
export function parsePriors(text: string): BsemPrior[] {
  return text.split(/[;\n]/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(.+?)~\s*N\s*\(\s*([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s*,\s*([\d.]+(?:[eE][-+]?\d+)?)\s*\)$/i.exec(l);
    if (!m) throw new Error(`“${l}”: write a prior as labels ~ N(mean, variance), for example xload1-xload6 ~ N(0, 0.01).`);
    const mean = Number(m[2]), variance = Number(m[3]);
    if (!Number.isFinite(mean) || !(variance > 0)) throw new Error(`“${l}”: the variance must be positive.`);
    return { labels: expandLabels(m[1]), mean, variance };
  });
}
/** Ranges are kept as typed only in the text box: the stored form lists every label. */
export const printPriors = (ps: BsemPrior[]) => ps.map((p) => `${p.labels.join(' ')} ~ N(${p.mean}, ${p.variance});`).join('\n');

function PriorBox({ value, onChange }: { value: BsemPrior[]; onChange: (v: BsemPrior[]) => void }) {
  const [text, setText] = useState(printPriors(value));
  const [err, setErr] = useState<string | null>(null);
  const commit = (t: string) => { try { onChange(parsePriors(t)); setErr(null); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className="field"><label htmlFor="bs-pri">Priors on labelled parameters</label>
      <textarea id="bs-pri" className="input" rows={3} value={text} placeholder="xload1-xload6 ~ N(0, 0.01);" onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)} />
      <div className="hint">{err ?? 'As Mplus’s MODEL PRIORS: labels (a range such as dir1-dir18) ~ N(mean, variance). A zero mean and a small variance (0.01) lets cross-loadings and direct effects be near zero rather than zero (BSEM, Muthén & Asparouhov 2012).'}</div></div>
  );
}

function BsemForm({ options: o, set, disabled, ctx }: OptionsProps<BsemOptions>) {
  const n = (k: 'chains' | 'burnin' | 'sample', lo: number, hi: number) => (e: { target: { value: string } }) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v) && v >= lo && v <= hi) set({ ...o, [k]: v }); };
  const groups = !!ctx?.model?.multigroup;
  const loop = o.loop;
  const setLoop = (p: Partial<BsemLoop>) => set({ ...o, loop: { ...loop!, ...p } });
  const lnum = (k: 'from' | 'to' | 'by') => (e: { target: { value: string } }) => { const v = Number(e.target.value); if (Number.isFinite(v)) setLoop({ [k]: v }); };
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>The CB-SEM model on the canvas, fitted by MCMC (blavaan with Stan), in desktop R through the PLS Studio Helper: Stan does not run in the browser.</p>
      <Choice label="Identification of the factors" value={o.identification} onChange={(identification) => set({ ...o, identification })}
        options={[['unit', 'Unit factor variances'], ['marker', 'Marker indicators (as the diagram)']]}
        hint={o.identification === 'unit' ? 'Each factor’s variance fixed at 1, every loading estimated (lavaan’s std.lv): the chains mix more reliably. The loadings are then on the standardised-factor scale.' : 'The first loading of each factor fixed at 1, as in the ML fit. Chains can get stuck in a second mode; check R-hat.'} />
      <Choice label="Default priors" value={o.priors ?? 'blavaan'} onChange={(p) => { const { priors: _p, ...rest } = o; set(p === 'mplus' ? { ...rest, priors: 'mplus' } : rest); }}
        options={[['blavaan', 'blavaan’s'], ['mplus', 'Mplus’s (flat)']]}
        hint={o.priors === 'mplus' ? 'Mplus’s defaults: flat for loadings, regressions, intercepts and means (N(0, 10⁶) here), flat for variances (IG(−1, 0)) and covariance matrices (IW(0, −p−1); here a uniform correlation with variance priors that make a pair’s covariance matrix flat), N(0, 5) for the loadings and thresholds of ordinal indicators.' : 'blavaan’s defaults: N(0, 10) for loadings and regressions, N(0, 32) for intercepts, Gamma(1, 0.5) on the SDs, uniform correlations.'} />
      <PriorBox value={o.labelPriors ?? []} onChange={(ps) => { const { labelPriors: _l, ...rest } = o; set(ps.length ? { ...rest, labelPriors: ps } : rest); }} />
      {groups && <>
        <label className="check"><input type="checkbox" checked={!!o.wiggle} onChange={(e) => { const { wiggle: _w, ...rest } = o; set(e.target.checked ? { ...rest, wiggle: { what: ['loadings', 'intercepts'], variance: 0.01 } } : rest); }} /> Approximate invariance: parameters held equal across groups may differ a little</label>
        {o.wiggle && <div className="row2">
          <div className="field"><label>Approximately equal</label>
            {(['loadings', 'intercepts'] as const).map((w) => <label key={w} className="check"><input type="checkbox" checked={o.wiggle!.what.includes(w)} onChange={(e) => { const what = e.target.checked ? [...o.wiggle!.what, w] : o.wiggle!.what.filter((x) => x !== w); if (what.length) set({ ...o, wiggle: { ...o.wiggle!, what } }); }} /> {w}</label>)}</div>
          <div className="field"><label htmlFor="bs-wv">Prior variance of a difference</label><input id="bs-wv" className="input num" type="number" min={0.0001} step={0.001} value={o.wiggle.variance} onChange={(e) => { const v = Number(e.target.value); if (v > 0) set({ ...o, wiggle: { ...o.wiggle!, variance: v } }); }} />
            <div className="hint">Mplus’s DIFF(…) ~ N(0, v): every difference between two groups has prior variance v. blavaan (wiggle) centres each group on the first with SD √(v/2): a difference between two other groups then has variance v, one from the first group v/2.</div></div>
        </div>}
      </>}
      <label className="check"><input type="checkbox" checked={!!loop} onChange={(e) => { const { loop: _l, ...rest } = o; set(e.target.checked ? { ...rest, loop: { name: 'effect', expr: '', variable: 'mod', from: -2, to: 2, by: 0.1 } } : rest); }} /> A quantity over a moderator (Mplus LOOP)</label>
      {loop && <>
        <div className="row2">
          <div className="field"><label htmlFor="bs-ln">Name</label><input id="bs-ln" className="input" value={loop.name} onChange={(e) => setLoop({ name: e.target.value })} /></div>
          <div className="field"><label htmlFor="bs-lv">Moderator</label><input id="bs-lv" className="input" value={loop.variable} onChange={(e) => setLoop({ variable: e.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="bs-le">Expression</label><input id="bs-le" className="input" value={loop.expr} placeholder="b*(gamma1 + gamma2*mod)" onChange={(e) => setLoop({ expr: e.target.value })} />
          <div className="hint">Labelled parameters, the moderator, numbers and arithmetic; computed from every draw.</div></div>
        <div className="row2">
          <div className="field"><label htmlFor="bs-lf">From</label><input id="bs-lf" className="input num" type="number" value={loop.from} onChange={lnum('from')} /></div>
          <div className="field"><label htmlFor="bs-lt">To</label><input id="bs-lt" className="input num" type="number" value={loop.to} onChange={lnum('to')} /></div>
          <div className="field"><label htmlFor="bs-lb">Step</label><input id="bs-lb" className="input num" type="number" min={0} value={loop.by} onChange={lnum('by')} /></div>
        </div>
      </>}
      <div className="field"><label htmlFor="bs-pv">Plausible values per case</label><input id="bs-pv" className="input num" type="number" min={0} max={500} value={o.plausible ?? 0} onChange={(e) => { const v = Math.round(Number(e.target.value)); if (v >= 0 && v <= 500) { const { plausible: _p, ...rest } = o; set(v ? { ...rest, plausible: v } : rest); } }} />
        <div className="hint">Draws of every case’s factor scores from the posterior (Mplus FSCORES(n)): summarised over cases and draws. 0: none.</div></div>
      <div className="row2">
        <div className="field"><label htmlFor="bs-ch">Chains</label><input id="bs-ch" className="input num" type="number" min={1} max={8} value={o.chains} onChange={n('chains', 1, 8)} /></div>
        <div className="field"><label htmlFor="bs-bi">Burn-in per chain</label><input id="bs-bi" className="input num" type="number" min={100} max={100000} step={100} value={o.burnin} onChange={n('burnin', 100, 100000)} /></div>
      </div>
      <div className="field"><label htmlFor="bs-s">Draws per chain</label><input id="bs-s" className="input num" type="number" min={100} max={100000} step={100} value={o.sample} onChange={n('sample', 100, 100000)} />
        <div className="hint">blavaan’s defaults: 3 chains, 500 burn-in and 1,000 draws each. The seed is the project’s.</div></div>
    </fieldset>
  );
}

function LoopChart({ l, conf }: { l: BsemLoopResult; conf: number }) {
  const W = 520, H = 300, pad = { l: 56, r: 16, t: 14, b: 44 };
  const lo = Math.min(0, ...l.low), hi = Math.max(0, ...l.high), m = (hi - lo || 1) * 0.06;
  const x0 = l.x[0], x1 = l.x[l.x.length - 1];
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi + m - v) / (hi - lo + 2 * m)) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: 6 }, (_, i) => lo - m + ((hi - lo + 2 * m) * i) / 5);
  const xt = Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4);
  const line = (ys: number[]) => ys.map((y, i) => `${i ? 'L' : 'M'}${sx(l.x[i]).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');
  return (
    <ChartFrame id="bsem:loop" name="bsem-loop" width={W} height={H} defaults={{ x: l.variable, y: l.name }}
      caption={<span className="hint">Posterior median of {l.name} at each value of {l.variable} (line) and the central {pct(conf)} credible interval (dashed).</span>}>
      {(labels) => (
        <svg className="mc-chart data-chart" width={W} height={H} role="img" aria-label={l.name}>
          {ticks.map((v) => <g key={v}><line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} /><text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">{fmt(v, 2)}</text></g>)}
          {xt.map((v) => <text key={v} x={sx(v)} y={H - pad.b + 16} textAnchor="middle">{fmt(v, 2)}</text>)}
          <line className="ref-line" x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} />
          <path d={line(l.low)} fill="none" stroke="currentColor" strokeDasharray="4 3" />
          <path d={line(l.high)} fill="none" stroke="currentColor" strokeDasharray="4 3" />
          <path d={line(l.median)} fill="none" stroke="var(--accent)" strokeWidth={2} />
          <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
          <text transform={`translate(12 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

function BsemView({ r }: { r: BsemResult }) {
  const f = r.fit;
  const groups = r.groups?.length ? r.groups : [null];
  const name = (p: BsemResult['parameters'][number]) => (p.op === '~1' ? `${p.lhs} (intercept)` : p.op === '|' ? `${p.lhs} threshold ${p.rhs.replace(/^t/, '')}` : `${p.lhs} ${p.op} ${p.rhs}`) + (p.label ? ` (${p.label})` : '');
  const rhatCell = (v: number | null) => (v === null || v === undefined ? c(null) : { v: fmt(v, 3), cls: v >= 1.05 ? 'bad' : v >= 1.01 ? 'warn' : 'good' });
  const withPrior = r.parameters.some((p) => p.prior);
  const cols = ['Parameter', 'Posterior median', 'Mean', 'SD', `${pct(r.confidence)} credible interval`, 'R-hat', 'n_eff', ...(withPrior ? ['Prior'] : [])];
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>{r.chains} chains × {r.sample.toLocaleString('en')} draws after {r.burnin.toLocaleString('en')} burn-in, seed {r.seed}; n = {r.n}{r.groups?.length ? ` in ${r.groups.length} groups` : ''}; factors identified by {r.identification === 'unit' ? 'unit variances (std.lv)' : 'marker indicators'}; {r.priors === 'mplus' ? 'Mplus’s default priors' : 'blavaan’s default priors'}{r.wiggleSd !== undefined && r.wiggleSd !== null ? `; approximate invariance, SD ${fmt(r.wiggleSd, 4)} around the first group` : ''}; blavaan {r.engine.version}{r.engine.desktop ? ` in desktop ${r.engine.desktop}` : ''}.</p>
      <div className={`stat-cards`}>
        <div className="stat-card"><div className="k">Converged</div><div className={`v ${r.converged ? 'good' : 'bad'}`}>{r.converged ? 'yes' : 'no'}</div></div>
        <div className="stat-card"><div className="k">Largest R-hat</div><div className={`v ${r.maxRhat >= 1.05 ? 'bad' : r.maxRhat >= 1.01 ? 'warn' : 'good'}`}>{fmt(r.maxRhat, 3)}</div></div>
        <div className="stat-card"><div className="k">Smallest n_eff</div><div className={`v ${r.minNeff < 400 ? 'warn' : ''}`}>{fmt(r.minNeff, 0)}</div></div>
        {f.ppp !== undefined && f.ppp !== null && <div className="stat-card"><div className="k">PPP</div><div className="v">{fmt(f.ppp, 3)}</div></div>}
      </div>
      {!r.converged && <p className="hint" style={{ color: 'var(--bad)' }}>The chains did not converge (an R-hat of 1.05 or more): the estimates below are not reliable. Run more burn-in and draws, another seed, or unit factor variances.</p>}
      <Table title="Fit" file="bsem-fit" columns={['Measure', 'Value']} rows={([
        ['Posterior predictive p (PPP)', f.ppp], ['DIC', f.dic], ['Effective parameters (pD)', f.pDic], ['WAIC', f.waic], ['LOOIC', f.looic], ['SE of LOOIC', f.seLooic], ['Marginal log-likelihood', f.margLogLik], ['BIC', f.bic],
      ] as [string, number | undefined][]).filter(([, v]) => v !== undefined && v !== null).map(([k, v]): Row => [c(k), c(v!, undefined, k.startsWith('Posterior') ? 3 : 1)])}
        note="PPP: the share of draws in which data replicated from the model fit worse than the observed data; near 0.5 is good, below about 0.05 signals misfit. DIC, WAIC and LOOIC compare models: smaller is better." />
      {groups.flatMap((g, gi) => ['=~', '~', '~~', '~1', '|'].map((op) => [op, r.parameters.filter((p) => p.op === op && (g === null || p.group === gi + 1))] as const).filter(([, ps]) => ps.length).map(([op, ps]) => (
        <Table key={`${gi}${op}`} title={`${OP_NAME[op] ?? op}${g === null ? '' : ` — group ${g}`}`} file={`bsem-${OP_FILE[op] ?? 'parameters'}${g === null ? '' : `-g${gi + 1}`}`} columns={cols}
          rows={ps.map((p): Row => [c(name(p)), c(p.median ?? null), c(p.mean), c(p.sd), c(`[${fmt(p.low)}, ${fmt(p.high)}]`), rhatCell(p.rhat), c(p.neff, undefined, 0), ...(withPrior ? [c(p.prior ?? '')] : [])])} />
      )))}
      {!!r.defined?.length && <Table title="Defined parameters" file="bsem-defined" columns={['Parameter', 'Posterior median', 'Mean', 'SD', `${pct(r.confidence)} credible interval`]}
        rows={r.defined.map((d): Row => [c(`${d.name} := ${d.expr}`), c(d.median), c(d.mean), c(d.sd), c(`[${fmt(d.low)}, ${fmt(d.high)}]`)])} note="Computed from every draw of the parameters they combine." />}
      {r.loop && <>
        <LoopChart l={r.loop} conf={r.confidence} />
        <Table title={`${r.loop.name} = ${r.loop.expr}`} file="bsem-loop" columns={[r.loop.variable, 'Posterior median', 'SD', `${pct(r.confidence)} credible interval`]}
          rows={r.loop.x.map((x, i): Row => [c(fmt(x, 3)), c(r.loop!.median[i]), c(r.loop!.sd[i]), c(`[${fmt(r.loop!.low[i])}, ${fmt(r.loop!.high[i])}]`)])} />
      </>}
      {r.plausible && <Table title="Plausible values" file="bsem-plausible" columns={['Factor', 'Mean', 'Variance', 'Mean of the cases’ SDs']}
        rows={r.plausible.factors.map((k, i): Row => [c(k), c(r.plausible!.mean[i]), c(r.plausible!.cov[i]?.[i] ?? null), c(r.plausible!.meanSd[i])])}
        note={`${r.plausible.draws} draws of each of the ${r.plausible.cases} cases’ factor scores, spaced evenly over the posterior draws: mean and variance over all cases and draws, and each case’s SD over its draws, averaged (Mplus’s SUMMARIES OF PLAUSIBLE VALUES).`} />}
      <p className="hint">R-hat compares the chains with each other (1.00 means they agree; 1.05 or more: not converged). n_eff: the number of independent draws the chains are worth. The posterior median is Mplus’s point estimate for Bayes; blavaan prints the mean.</p>
    </div>
  );
}

const prior = (v: unknown): BsemPrior | null => {
  if (!isObj(v) || !Array.isArray(v.labels)) return null;
  const labels = v.labels.filter((x): x is string => typeof x === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(x)).slice(0, 500);
  const mean = Number(v.mean), variance = Number(v.variance);
  return labels.length && Number.isFinite(mean) && Number.isFinite(variance) && variance > 0 ? { labels, mean, variance } : null;
};
const loopOf = (v: unknown): BsemLoop | null => {
  if (!isObj(v) || typeof v.expr !== 'string' || typeof v.name !== 'string' || typeof v.variable !== 'string') return null;
  const from = Number(v.from), to = Number(v.to), by = Number(v.by);
  return Number.isFinite(from) && Number.isFinite(to) && by > 0 ? { name: v.name.slice(0, 31), expr: v.expr.slice(0, 500), variable: v.variable.slice(0, 31), from, to, by } : null;
};

/** Why the card's own options cannot run on this model, or null. */
function optionsProblem(o: BsemOptions, ctx: AnalysisCtx): string | null {
  const m = ctx.model!;
  const labels = labelUses(m);
  const known = new Set([...labels.keys(), ...(m.defined ?? []).map((d) => d.name)]);
  for (const p of o.labelPriors ?? []) { const bad = p.labels.filter((l) => !labels.has(l)); if (bad.length) return `Priors: ${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not a label of the model.`; }
  if (o.plausible && m.multigroup) return 'Plausible values here are for one group (no grouping column).';
  if (o.wiggle && !m.multigroup) return 'Approximate invariance needs several groups (a grouping column on the Model tab).';
  if (o.wiggle && (m.multigroup?.invariance ?? 'configural') === 'configural') return 'Approximate invariance relaxes parameters held equal across groups: choose metric or scalar invariance on the Model tab.';
  if (o.loop) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(o.loop.name) || !/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(o.loop.variable)) return 'The loop’s name and moderator are names: a letter, then letters, digits or _.';
    let e; try { e = parseExpr(o.loop.expr); } catch (err) { return `The loop’s expression: ${(err as Error).message}`; }
    const bad = namesIn(e).filter((x) => x !== o.loop!.variable && !known.has(x));
    if (bad.length) return `The loop’s expression: ${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not a label of the model or the moderator.`;
    if (o.loop.to < o.loop.from || (o.loop.to - o.loop.from) / o.loop.by > 1000) return 'The loop runs from its start to its end in at most 1,000 steps.';
  }
  return null;
}

export const bsemAnalysis: AnalysisType<BsemOptions, BsemResult> = {
  id: 'bsem', title: 'Bayesian SEM (blavaan)', sub: 'the CB-SEM model by MCMC (Stan): posterior, R-hat, PPP, WAIC, LOO; Mplus’s priors, BSEM priors, approximate invariance; desktop R', group: 'CB-SEM model',
  fitsModel: true,
  defaults: () => ({ identification: 'unit', chains: 3, burnin: 500, sample: 1000 }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const o: BsemOptions = {
      identification: oneOf(raw.identification, ['unit', 'marker'] as const, 'unit'), chains: clampNum(raw.chains, 1, 8, 3, true),
      burnin: clampNum(raw.burnin, 100, 100000, 500, true), sample: clampNum(raw.sample, 100, 100000, 1000, true),
    };
    if (raw.priors === 'mplus') o.priors = 'mplus';
    const ps = Array.isArray(raw.labelPriors) ? raw.labelPriors.slice(0, 100).map(prior).filter((p): p is BsemPrior => !!p) : [];
    if (ps.length) o.labelPriors = ps;
    if (isObj(raw.wiggle)) {
      const what = (Array.isArray(raw.wiggle.what) ? raw.wiggle.what : []).filter((w): w is 'loadings' | 'intercepts' => w === 'loadings' || w === 'intercepts');
      const variance = Number(raw.wiggle.variance);
      if (what.length && variance > 0 && variance <= 100) o.wiggle = { what: [...new Set(what)], variance };
    }
    const l = loopOf(raw.loop);
    if (l) o.loop = l;
    const pv = clampNum(raw.plausible, 0, 500, 0, true);
    if (pv > 0) o.plausible = pv;
    return o;
  },
  Options: BsemForm,
  View: ({ result }) => <BsemView r={result} />,
  blocked: (o, ctx) => {
    if (ctx.settings.method !== 'cbsem') return 'Bayesian SEM fits a CB-SEM model: switch the model to CB-SEM (Model tab).';
    if (!rawData(ctx)) return 'Bayesian SEM needs raw data: import a dataset (not a covariance matrix).';
    if (!ctx.model?.constructs.length) return 'Draw a CB-SEM model first (Model tab).';
    const m = ctx.model;
    if (m.multilevel) return 'Bayesian SEM here fits models without clusters.';
    if (m.moderations.length) return 'Bayesian SEM here does not include latent interactions.';
    if (m.esem?.blocks.length) return 'ESEM blocks are not available in Bayesian SEM.';
    if (m.constructs.some((k) => k.type === 'composite')) return 'Composites are not available in Bayesian SEM.';
    if (ctx.settings.missing === 'mi') return 'Bayesian SEM handles missing values itself: choose casewise or FIML, not multiple imputation.';
    if (m.constant && o.identification === 'unit') return 'Means and intercepts need marker identification: choose Marker indicators.';
    const own = optionsProblem(o, ctx);
    if (own) return own;
    if (useCompute.getState().backend !== 'helper') return 'Bayesian SEM runs in desktop R (Stan does not run in the browser): choose Desktop R (helper) under R runs in, on the Model tab, with the PLS Studio Helper running.';
    const err = validateModel(m, rawData(ctx)!, { ...ctx.settings, estimator: m.ordered?.length ? 'WLSMV' : 'ML' }).find((i) => i.level === 'error');
    return err ? `Fix the model first: ${err.message}` : null;
  },
  fingerprint: (o, ctx) => {
    if (ctx.settings.method !== 'cbsem' || !ctx.model || !rawData(ctx)) return null;
    const cols = columnsFingerprint(ctx, [...modelIndicators(ctx), ...(ctx.model.multigroup ? [ctx.model.multigroup.column] : [])]);
    // (the options added later enter only when set: an old run keeps its fingerprint)
    const extra = [o.priors, o.labelPriors, o.wiggle, o.loop, o.plausible].some((x) => x !== undefined) ? [JSON.stringify([o.priors ?? null, o.labelPriors ?? null, o.wiggle ?? null, o.loop ?? null, o.plausible ?? null])] : [];
    return cols && fingerprint([cols, JSON.stringify(toSpec(ctx.model)), ctx.settings.missing, o.identification, o.chains, o.burnin, o.sample, ctx.settings.seed, ctx.settings.confidence, ...extra]);
  },
  run: async (o, ctx) => (await engine()).bsemR(rawData(ctx)!, toSpec(ctx.model!), ctx.settings.missing, o, ctx.settings.seed, ctx.settings.confidence),
  script: async (o, ctx) => (await engine()).bsemScriptR(rawData(ctx)!, toSpec(ctx.model!), ctx.settings.missing, o, ctx.settings.seed, ctx.settings.confidence),
  summary: (o) => `the CB-SEM model on the canvas · ${o.chains} chains × ${o.sample} · ${o.identification === 'unit' ? 'unit variances' : 'markers'}${o.priors === 'mplus' ? ' · Mplus’s priors' : ''}${o.labelPriors?.length ? ` · ${o.labelPriors.reduce((a, p) => a + p.labels.length, 0)} priors` : ''}${o.wiggle ? ' · approximate invariance' : ''}`,
};
