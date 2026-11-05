// Regression card: linear, logistic / probit (also binomial counts), Poisson
// (also zero-inflated), negative binomial, Gamma, ordinal, multinomial,
// censored (tobit, also censored-inflated) and survival (Cox, piecewise
// exponential), with categorical predictors, interaction terms, weights and
// robust standard errors.

import { useState } from 'react';
import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { fmt, fmtP } from '../format';
import type { Coefficient, Family, RegressionCurve, RegressionInput, RegressionResult } from '../rengine/regression';
import { confirmDialog } from '../components/Overlays';
import { newId, type Construct, type ModelState, type Path } from '../model/project';
import { useStore } from '../store';
import { Choice, ColumnSelect, columnsFingerprint, isObj, missingColumns, name, names, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

/** `plot`: which predictor's partial-effect curve to show (display only). */
export interface RegressionOptions extends Pick<RegressionInput, 'censoring' | 'inflated' | 'reference' | 'status' | 'statusCensored' | 'cuts'> { outcome: string; predictors: string[]; categorical: string[]; interactions: string[][]; family: Family; link: string; trials: string; weights: string; se: RegressionInput['se']; cluster: string; plot: string }
type Result = RegressionResult & { input: RegressionInput };

export const FAMILIES: readonly (readonly [Family, string, string])[] = [
  ['gaussian', 'Linear (Gaussian)', 'Ordinary least squares for a continuous outcome (lm).'],
  ['binomial', 'Logistic / probit', 'A 0/1 outcome, or counts of successes with the number of trials (glm, binomial).'],
  ['poisson', 'Poisson', 'A count outcome; check the dispersion (glm, poisson).'],
  ['negbin', 'Negative binomial', 'An over-dispersed count outcome (MASS::glm.nb).'],
  ['gamma', 'Gamma', 'A positive, right-skewed outcome; inverse link (glm, Gamma).'],
  ['ordinal', 'Ordinal (proportional odds)', 'An ordered categorical outcome (MASS::polr).'],
  ['multinomial', 'Multinomial logistic', 'An unordered categorical outcome, one equation per level against a reference level (nnet::multinom).'],
  ['censored', 'Censored (tobit)', 'A continuous outcome censored at its lowest (or highest) value: a normal model for the latent outcome (survival::survreg); optionally censored-inflated.'],
  ['survival', 'Survival (Cox, piecewise exponential)', 'Time to an event, with censored times: Cox regression (survival::coxph), or a piecewise-constant baseline hazard with cut points.'],
];
/** Models whose standard errors are model-based or HC0 (the maximum-likelihood sandwich, Mplus MLR) only. */
const ownSe = (o: Pick<RegressionOptions, 'family' | 'inflated'>) => o.family === 'multinomial' || o.family === 'censored' || o.family === 'survival' || (o.family === 'poisson' && !!o.inflated);
/** Cut points typed as a list ("1, 2, 3") or ranges ("1:20"). */
export function parseCuts(text: string): number[] {
  const out: number[] = [];
  for (const piece of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(-?[\d.]+):(-?[\d.]+)$/.exec(piece);
    if (m) { const a = Number(m[1]), b = Number(m[2]); if (Number.isFinite(a) && Number.isFinite(b) && b - a <= 1000) for (let x = Math.ceil(a); x <= b; x++) out.push(x); }
    else if (Number.isFinite(Number(piece))) out.push(Number(piece));
  }
  return [...new Set(out.filter((x) => x > 0))].sort((a, b) => a - b).slice(0, 200);
}
const FAMILY_NAME = Object.fromEntries(FAMILIES.map(([id, l]) => [id, l])) as Record<Family, string>;
const LINKS: Record<string, readonly (readonly [string, string])[]> = { binomial: [['logit', 'Logit'], ['probit', 'Probit'], ['cloglog', 'Complementary log-log']], ordinal: [['logistic', 'Logit'], ['probit', 'Probit'], ['cloglog', 'Complementary log-log']] };

function RegressionOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<RegressionOptions>) {
  const d = rawData(ctx);
  const columns = d?.names ?? [];
  const [ia, setIa] = useState<string[]>([]);
  if (!d || !columns.length) return <div className="empty-results">Import raw data first.</div>;
  const taken = [o.outcome, o.trials, o.weights, o.cluster, o.family === 'survival' ? o.status ?? '' : ''];
  const text = (n: string) => !!d.categories?.[n];
  const links = LINKS[o.family];
  return (
    <fieldset className="card-options" disabled={disabled}>
      <div className="field">
        <label htmlFor="reg-family">Model</label>
        <select id="reg-family" className="select" value={o.family} onChange={(e) => { const family = e.target.value as Family; const own = family === 'ordinal' || (ownSe({ family, inflated: o.inflated }) && o.se !== 'HC0'); set({ ...o, family, link: family === 'ordinal' ? 'logistic' : 'logit', trials: family === 'binomial' ? o.trials : '', ...(own ? { se: 'model', cluster: '' } : {}) }); }}>
          {FAMILIES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select>
        <div className="hint">{FAMILIES.find(([id]) => id === o.family)![2]}</div>
      </div>
      {links && <Choice label="Link" value={o.link} onChange={(link) => set({ ...o, link })} options={links} />}
      <ColumnSelect id="reg-y" label={o.family === 'binomial' && o.trials ? 'Outcome (successes)' : 'Outcome'} value={o.outcome} columns={columns} exclude={[...o.predictors, ...taken.filter((x) => x !== o.outcome)]} onChange={(outcome) => set({ ...o, outcome })} />
      {o.family === 'survival' && <>
        <ColumnSelect id="reg-status" label="Status (0/1)" value={o.status ?? ''} columns={columns} exclude={[o.outcome, ...o.predictors]} onChange={(status) => set({ ...o, status })} />
        <Choice label="Status coding" value={o.statusCensored ? 'censored' : 'event'} onChange={(v) => set({ ...o, statusCensored: v === 'censored' })} options={[['event', '1 = event'], ['censored', '1 = censored (Mplus TIMECENSORED)']]} />
        <div className="field">
          <label htmlFor="reg-cuts">Baseline hazard</label>
          <input id="reg-cuts" className="input" placeholder="Cox (none); or cut points, e.g. 1:20" defaultValue={(o.cuts ?? []).join(', ')} onBlur={(e) => set({ ...o, cuts: parseCuts(e.target.value) })} />
          <div className="hint">Empty: Cox regression (the baseline hazard left unspecified). Cut points (a list, or a range such as 1:20): a constant baseline hazard within each interval, the last open-ended (piecewise exponential; Mplus SURVIVAL = t (20*1) with BASEHAZARD = ON).</div>
        </div>
      </>}
      {o.family === 'censored' && <Choice label="Censored" value={o.censoring ?? 'below'} onChange={(censoring) => set({ ...o, censoring })} options={[['below', 'From below (at the lowest value)'], ['above', 'From above (at the highest value)']]} />}
      {(o.family === 'censored' || o.family === 'poisson') && (
        <div className="field">
          <label className="check"><input type="checkbox" checked={!!o.inflated} onChange={(e) => set({ ...o, inflated: e.target.checked, ...(e.target.checked && o.se !== 'model' && o.se !== 'HC0' ? { se: 'model', cluster: '' } : {}) })} /> {o.family === 'poisson' ? 'Zero-inflated' : 'Censored-inflated'}</label>
          <div className="hint">{o.family === 'poisson' ? 'Extra zeros: a logistic model (the inflation) for the probability of a structural zero, on the same predictors (Mplus COUNT = u (i)).' : 'Extra values at the censoring point: a logistic model (the inflation) for their probability, on the same predictors (Mplus CENSORED = y (bi)).'} Maximum likelihood written out in R (optim).</div>
        </div>
      )}
      {o.family === 'multinomial' && <Choice label="Reference level" value={o.reference ?? 'first'} onChange={(reference) => set({ ...o, reference })} options={[['first', 'First (R)'], ['last', 'Last (Mplus)']]} />}
      {o.family === 'binomial' && <ColumnSelect id="reg-n" label="Trials (optional: for counts of successes)" optional="None: the outcome is 0/1" value={o.trials} columns={columns} exclude={[o.outcome, ...o.predictors]} onChange={(trials) => set({ ...o, trials })} />}
      <OrderedPicker label="Predictors (main effects)" columns={columns.filter((n) => !taken.includes(n))} value={o.predictors} onChange={(predictors) => set({ ...o, predictors, categorical: o.categorical.filter((x) => predictors.includes(x) || o.interactions.some((t) => t.includes(x))) })} />
      {[...new Set([...o.predictors, ...o.interactions.flat()])].some((n) => !text(n)) && (
        <div className="field">
          <label>Treat as categorical</label>
          <div className="chips">
            {[...new Set([...o.predictors, ...o.interactions.flat()])].filter((n) => !text(n)).map((n) => (
              <label key={n} className="check"><input type="checkbox" checked={o.categorical.includes(n)} onChange={(e) => set({ ...o, categorical: e.target.checked ? [...o.categorical, n] : o.categorical.filter((x) => x !== n) })} /> {n}</label>
            ))}
          </div>
          <div className="hint">Numeric codes that stand for groups: one dummy per level, the lowest value as reference. Text columns are categorical anyway.</div>
        </div>
      )}
      {o.predictors.length >= 1 && (
        <div className="field">
          <label>Interaction terms</label>
          {o.interactions.map((t, i) => (
            <div key={i} className="chips" style={{ alignItems: 'center' }}>
              <span>{t.join(' × ')}</span>
              <button className="btn sm ghost" onClick={() => set({ ...o, interactions: o.interactions.filter((_, k) => k !== i) })} aria-label={`Remove ${t.join(' × ')}`}>Remove</button>
            </div>
          ))}
          <div className="chips" style={{ alignItems: 'center' }}>
            {columns.filter((n) => !taken.includes(n)).map((n) => <label key={n} className="check"><input type="checkbox" checked={ia.includes(n)} onChange={(e) => setIa(e.target.checked ? [...ia, n] : ia.filter((x) => x !== n))} /> {n}</label>)}
            <button className="btn sm" disabled={ia.length < 2 || o.interactions.some((t) => t.length === ia.length && t.every((x) => ia.includes(x)))} onClick={() => { set({ ...o, interactions: [...o.interactions, columns.filter((n) => ia.includes(n))] }); setIa([]); }}>Add term</button>
          </div>
          <div className="hint">Tick two or more variables and add their product (a:b in R). A variable that is not among the predictors enters through the term only (nested effects, as R’s a/b).</div>
        </div>
      )}
      <div className="row2">
        <ColumnSelect id="reg-w" label="Frequency weights (optional)" optional="None" value={o.weights} columns={columns} exclude={[o.outcome, ...o.predictors, o.trials, o.cluster]} onChange={(weights) => set({ ...o, weights })} />
        <div className="field">
          <label htmlFor="reg-se">Standard errors</label>
          <select id="reg-se" className="select" value={o.se} disabled={o.family === 'ordinal'} onChange={(e) => { const se = e.target.value as RegressionInput['se']; set({ ...o, se, cluster: se === 'cluster' ? o.cluster : '' }); }}>
            <option value="model">Model-based</option>{!ownSe(o) && <option value="HC3">Robust (HC3; small samples)</option>}<option value="HC0">Robust (HC0, White; as Mplus MLR)</option>{!ownSe(o) && <option value="cluster">Cluster-robust</option>}
          </select>
        </div>
      </div>
      {o.se === 'cluster' && <ColumnSelect id="reg-cl" label="Cluster" value={o.cluster} columns={columns} exclude={[o.outcome, ...o.predictors, o.trials, o.weights]} onChange={(cluster) => set({ ...o, cluster })} />}
      {o.predictors.filter((n) => !text(n) && !o.categorical.includes(n)).length > 1 && (
        <ColumnSelect id="reg-plot" label="Curve over (display)" optional="The first numeric predictor" value={o.plot} columns={o.predictors.filter((n) => !text(n) && !o.categorical.includes(n))} onChange={(plot) => set({ ...o, plot })} />
      )}
      <div className="hint">The curve is a partial-effect plot: the fitted response over one predictor, the other predictors at their means (categorical ones at their reference level). For the raw relation between two columns use a Chart card.</div>
    </fieldset>
  );
}

const coefRow = (e: Coefficient, ratio: boolean): Row => [c(e.term), c(e.est), c(e.se), c(e.stat), pCell(e.p), c(`[${fmt(e.ciLow)}, ${fmt(e.ciHigh)}]`), ...(ratio ? [c(e.ratio ?? null)] : [])];

function Curve({ r, cv }: { r: RegressionResult; cv: RegressionCurve }) {
  const W = 520, H = 300, pad = { l: 56, r: 16, t: 14, b: 44 };
  const probs = cv.probs;
  const ys = probs ? [0, 1] : (() => { let lo = Infinity, hi = -Infinity; for (const v of [...(cv.y ?? []), ...(cv.points?.y ?? [])]) { if (v < lo) lo = v; if (v > hi) hi = v; } const m = (hi - lo || 1) * 0.05; return [lo - m, hi + m]; })();
  const x0 = cv.grid[0], x1 = cv.grid[cv.grid.length - 1];
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((ys[1] - v) / (ys[1] - ys[0] || 1)) * (H - pad.t - pad.b);
  const ticks = (lo: number, hi: number) => Array.from({ length: 6 }, (_, i) => lo + ((hi - lo) * i) / 5);
  const COLORS = ['var(--accent)', '#d97706', '#059669', '#dc2626', '#7c3aed', '#0891b2'];
  return (
    <ChartFrame id={`regression:${cv.x}`} name={`regression-${cv.x}`} width={W} height={H} defaults={{ x: cv.x, y: probs ? 'Probability' : r.family === 'binomial' ? 'Probability' : 'Predicted outcome' }}
      caption={<span className="hint">Partial effect of {cv.x}: the fitted {probs ? 'probability of each level' : 'response'} over it, the other predictors at their means (categorical ones at their reference level).{cv.points ? ' Dots: the observed values.' : ''}{r.curves.length > 1 ? ' Another predictor: Curve over, in the options.' : ''}</span>}>
      {(labels) => (
        <svg className="mc-chart data-chart" width={W} height={H} role="img" aria-label="Fitted curve">
          {ticks(ys[0], ys[1]).map((v) => <g key={v}><line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} /><text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">{fmt(v, 2)}</text></g>)}
          {ticks(x0, x1).map((v) => <text key={`x${v}`} x={sx(v)} y={H - pad.b + 16} textAnchor="middle">{fmt(v, 2)}</text>)}
          {cv.points && cv.points.x.map((x, i) => <circle key={i} className="dot" cx={sx(x)} cy={sy(cv.points!.y[i])} r={2.5} />)}
          {cv.y && <polyline className="fit-line" fill="none" points={cv.grid.map((x, i) => `${sx(x)},${sy(cv.y![i])}`).join(' ')} />}
          {probs && probs.map((p, j) => <polyline key={j} className="fit-line" fill="none" style={{ stroke: COLORS[j % COLORS.length] }} points={cv.grid.map((x, i) => `${sx(x)},${sy(p[i])}`).join(' ')} />)}
          {probs && cv.levels!.map((l, j) => <g key={l}><line x1={W - pad.r - 110} x2={W - pad.r - 96} y1={pad.t + 10 + j * 14} y2={pad.t + 10 + j * 14} style={{ stroke: COLORS[j % COLORS.length], strokeWidth: 2 }} /><text x={W - pad.r - 92} y={pad.t + 14 + j * 14}>{l}</text></g>)}
          <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
          <text transform={`translate(12 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

/** A result as stored by this version, or by the one before it (one `curve`, no `curves`). */
const curvesOf = (r: Result): RegressionCurve[] => Array.isArray(r.curves) ? r.curves : (r as unknown as { curve?: RegressionCurve | null }).curve ? [(r as unknown as { curve: RegressionCurve }).curve] : [];

/**
 * A linear regression as a path model: the predictors as observed covariates (fixed.x), the outcome
 * a single indicator without error, one path per predictor; the same coefficients under ML, and a
 * diagram to grow (indicators, mediators, groups). Returns why it cannot be drawn otherwise.
 */
export function regressionModel(o: RegressionOptions): ModelState | string {
  if (o.family !== 'gaussian') return 'Only a linear regression is a path model with the same estimates; the other families have no CB-SEM counterpart.';
  if (o.categorical.length) return `Categorical predictors (${o.categorical.join(', ')}) enter as dummy variables: add them as computed columns (e.g. g == 2) first.`;
  if (o.interactions.length) return 'Interaction terms are not drawn: draw the main effects, then add a moderation arrow on the canvas.';
  if (o.trials) return 'Trials apply to a binomial outcome only.';
  if (o.weights) return 'Weighted regression is not a path model; CB-SEM has sampling weights under the Model inspector instead.';
  if (!o.outcome || !o.predictors.length) return 'Choose the outcome and at least one predictor.';
  const gap = 180;
  const predictors: Construct[] = o.predictors.map((x, i) => ({ id: newId('c'), name: x, type: 'factor', mode: 'A', indicators: [x], x: 0, y: Math.round((i - (o.predictors.length - 1) / 2) * gap), side: 'left', covariate: true }));
  const outcome: Construct = { id: newId('c'), name: o.outcome, type: 'factor', mode: 'A', indicators: [o.outcome], x: 520, y: 0, side: 'right' };
  const paths: Path[] = predictors.map((p) => ({ id: newId('p'), from: p.id, to: outcome.id }));
  return { constructs: [...predictors, outcome], paths, moderations: [], ...(o.se === 'cluster' && o.cluster ? { cluster: o.cluster } : {}) };
}

/** Replace the diagram by the regression's path model and switch to CB-SEM (ML). */
export async function drawRegressionModel(o: RegressionOptions): Promise<boolean> {
  const st = useStore.getState();
  const m = regressionModel(o);
  if (typeof m === 'string') { st.toast('error', m); return false; }
  if (st.model.constructs.length && !(await confirmDialog({ title: 'Replace the diagram?', body: 'The regression becomes the diagram on the Model tab; the current constructs and paths are replaced (undo restores them).', confirmLabel: 'Replace' }))) return false;
  st.commit(() => m);
  st.setSettings({ method: 'cbsem', estimator: 'ML' });
  st.setWorkspace('model');
  st.toast('success', `${o.outcome} on ${o.predictors.join(', ')} as a path model: the predictors as observed covariates, the outcome a single indicator. CB-SEM with ML gives the regression's coefficients (standard errors divide by N rather than N − p). Add indicators, mediators or groups from here.${o.se === 'cluster' && o.cluster ? ` Sampling clusters: ${o.cluster}.` : o.se === 'HC3' || o.se === 'HC0' ? ` ${o.se} errors are not carried over; choose MLR for robust ones.` : ''}`);
  return true;
}

function DrawModel({ o }: { o: RegressionOptions }) {
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const why = regressionModel(o);
  return <button className="btn sm" disabled={readOnly || typeof why === 'string'} title={typeof why === 'string' ? why : 'Draw this regression as a path model on the Model tab (CB-SEM)'} onClick={() => void drawRegressionModel(o)}>Draw as SEM</button>;
}

function RegressionView({ r, plot, o }: { r: Result; plot: string; o: RegressionOptions }) {
  const curves = curvesOf(r);
  const cv = curves.find((k) => k.x === plot) ?? curves[0];
  const f = r.fit, pct = Math.round(r.input.confidence * 100);
  const ratio = (r.coefficients ?? []).some((e) => e.ratio !== undefined && e.ratio !== null);
  const ratioName = r.family === 'binomial' || r.family === 'ordinal' || r.family === 'multinomial' ? 'Odds ratio' : r.family === 'survival' ? 'Hazard ratio' : 'Rate ratio';
  const cols = ['Term', 'Estimate', 'Std. error', r.family === 'gaussian' || r.family === 'gamma' ? 't' : 'z', 'p', `${pct}% CI`, ...(ratio ? [ratioName] : [])];
  const cards: [string, string][] = [['n', String(f.n)],
    ...(f.r2 !== undefined && f.r2 !== null ? [['R²', fmt(f.r2)], ['Adj. R²', fmt(f.adjR2!)]] as [string, string][] : []),
    ...(r.lrt?.pseudoR2 !== undefined && r.lrt?.pseudoR2 !== null ? [['Pseudo R² (McFadden)', fmt(r.lrt.pseudoR2)]] as [string, string][] : []),
    ['AIC', fmt(f.aic, 1)], ['BIC', fmt(f.bic, 1)],
    ...(f.dispersion !== undefined && f.dispersion !== null ? [['Dispersion', fmt(f.dispersion, 2)]] as [string, string][] : []),
    ...(f.theta !== undefined && f.theta !== null ? [['θ', fmt(f.theta, 2)]] as [string, string][] : []),
    ...(f.residualVariance !== undefined && f.residualVariance !== null ? [['Residual variance', `${fmt(f.residualVariance)} (SE ${fmt(f.residualVarianceSe!)})`]] as [string, string][] : []),
    ...(f.censored !== undefined && f.censored !== null ? [['Censored', String(f.censored)]] as [string, string][] : []),
    ...(f.zeros !== undefined && f.zeros !== null ? [['Zeros', String(f.zeros)]] as [string, string][] : []),
    ...(f.events !== undefined && f.events !== null ? [['Events', String(f.events)]] as [string, string][] : [])];
  const main = (r.coefficients ?? []).filter((e) => !e.part), inflation = (r.coefficients ?? []).filter((e) => e.part === 'inflation'), baseline = (r.coefficients ?? []).filter((e) => e.part === 'baseline');
  const dg = r.diagnostics;
  return (
    <div className="tables">
      <div className="stat-cards">{cards.map(([k, v]) => <div className="stat-card" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}</div>
      {r.family === 'gaussian' && <div className="table-tools"><DrawModel o={o} /><span className="hint">A linear regression is a saturated path model: draw it to extend it into an SEM.</span></div>}
      <p className="hint" style={{ marginTop: 0 }}>
        {FAMILY_NAME[r.family]}{r.link && r.link !== 'logit' && r.link !== 'logistic' ? ` (${r.link} link)` : ''}: <code>{r.formula}</code>; {r.engine.package} {r.engine.version}.
        {r.se !== 'model' && ` ${r.se === 'HC3' ? 'Heteroskedasticity-consistent (HC3)' : r.se === 'HC0' ? 'Heteroskedasticity-consistent (HC0, White; Mplus MLR)' : 'Cluster-robust'} standard errors.`}
        {r.lrt && <> Likelihood-ratio test against the intercept-only model: χ²({r.lrt.df}) = {fmt(r.lrt.stat, 2)}, p {r.lrt.p < 0.001 ? '< 0.001' : `= ${fmt(r.lrt.p)}`}.</>}
        {f.dispersion !== undefined && f.dispersion !== null && f.dispersion > 1.5 && r.family === 'poisson' && ' Dispersion well above 1: consider the negative binomial.'}
      </p>
      {r.family === 'multinomial' && r.levels
        ? r.levels.others.map((l) => <Table key={l} title={`${l} versus ${r.levels!.reference}`} file={`regression-${l}`} columns={cols} rows={r.coefficients.filter((e) => e.level === l).map((e) => coefRow(e, ratio))} />)
        : <Table title="Coefficients" file="regression-coefficients" columns={cols} rows={main.map((e) => coefRow(e, ratio))}
          note={ratio ? `${ratioName}s: exp(estimate), the multiplicative change in the ${r.family === 'binomial' || r.family === 'ordinal' ? 'odds' : r.family === 'survival' ? 'hazard' : 'expected count'} per unit of the predictor.` : undefined} />}
      {inflation.length > 0 && <Table title="Inflation (logistic model for the extra values)" file="regression-inflation" columns={cols.slice(0, 6)} rows={inflation.map((e) => coefRow(e, false))}
        note={`The log-odds of a ${r.family === 'poisson' ? 'structural zero' : 'value at the censoring point beyond the censored-normal model'} (Mplus: ${r.family === 'poisson' ? 'u' : 'y'}#1 ON …).`} />}
      {baseline.length > 0 && <Table title="Baseline hazard by interval" file="regression-baseline-hazard" columns={cols.slice(0, 6)} rows={baseline.map((e) => coefRow(e, false))}
        note="The hazard in each interval for a person with all predictors at zero; z and p test its logarithm against 0; the interval is exp(log hazard ± z × SE)." />}
      {r.thresholds.length > 0 && <Table title="Thresholds (cut points between the ordered levels)" file="regression-thresholds" columns={cols.slice(0, 6)} rows={r.thresholds.map((e) => coefRow(e, false))} />}
      {(dg.vif?.length || dg.auc !== undefined || dg.hosmerLemeshow) ? (
        <Table title="Diagnostics" file="regression-diagnostics" columns={['Statistic', 'Value']} rows={[
          ...(dg.vif ?? []).map((v): Row => [c(`VIF ${v.term}`), c(v.vif)]),
          ...(dg.accuracy !== undefined ? [[c('Classification accuracy (cut-off 0.5)'), c(dg.accuracy)] as Row] : []),
          ...(dg.auc !== undefined && dg.auc !== null ? [[c('Area under the ROC curve'), c(dg.auc)] as Row] : []),
          ...(dg.hosmerLemeshow ? [[c(`Hosmer–Lemeshow χ²(${dg.hosmerLemeshow.df})`), c(`${fmt(dg.hosmerLemeshow.stat, 2)}, p ${fmtP(dg.hosmerLemeshow.p)}`)] as Row] : []),
        ]} note="VIF above 5 (or 10) signals collinear predictors. Hosmer–Lemeshow: a small p means the fitted probabilities do not match the observed rates." />
      ) : null}
      {cv && <Curve r={{ ...r, curves }} cv={cv} />}
    </div>
  );
}

export const regressionInput = (o: RegressionOptions, ctx: Pick<AnalysisCtx, 'settings'>): RegressionInput => ({ ...o, confidence: ctx.settings.confidence });
export const regressionColumns = (o: RegressionOptions) => [...new Set([o.outcome, ...o.predictors, ...o.interactions.flat(), o.trials, o.weights, o.se === 'cluster' ? o.cluster : '', o.family === 'survival' ? o.status ?? '' : ''].filter(Boolean))];
const FAMILY_IDS = FAMILIES.map(([id]) => id);

export const regressionAnalysis: AnalysisType<RegressionOptions, Result> = {
  id: 'regression',
  title: 'Regression',
  sub: 'linear, logistic, Poisson, negative binomial, Gamma, ordinal, multinomial, censored, survival (lm, glm, MASS, nnet, survival)',
  group: 'Regression and causal inference',
  entries: [
    { title: 'Linear regression', sub: 'a continuous outcome (lm)', options: (o) => ({ ...o, family: 'gaussian' }) },
    { title: 'Logistic regression', sub: 'a 0/1 outcome or counts of successes (glm)', options: (o) => ({ ...o, family: 'binomial', link: 'logit' }) },
    { title: 'Count regression', sub: 'Poisson or negative binomial (glm, MASS)', options: (o) => ({ ...o, family: 'poisson' }) },
    { title: 'Ordinal regression', sub: 'proportional odds (MASS::polr)', options: (o) => ({ ...o, family: 'ordinal', link: 'logistic' }) },
    { title: 'Multinomial regression', sub: 'an unordered categorical outcome (nnet)', options: (o) => ({ ...o, family: 'multinomial' }) },
    { title: 'Censored (tobit) regression', sub: 'an outcome censored at a limit (survival::survreg)', options: (o) => ({ ...o, family: 'censored' }) },
    { title: 'Survival analysis', sub: 'Cox or piecewise exponential (survival)', options: (o) => ({ ...o, family: 'survival' }) },
  ],
  cardTitle: (o) => `${FAMILY_NAME[o.family]}${o.outcome ? `: ${o.outcome}` : ''}`,
  defaults: () => ({ outcome: '', predictors: [], categorical: [], interactions: [], family: 'gaussian', link: 'logit', trials: '', weights: '', se: 'model', cluster: '', plot: '' }),
  parseOptions: (raw) => (isObj(raw) ? {
    outcome: name(raw.outcome), predictors: names(raw.predictors), categorical: names(raw.categorical),
    interactions: (Array.isArray(raw.interactions) ? raw.interactions.slice(0, 50) : []).map((t) => names(t)).filter((t) => t.length >= 2),
    family: oneOf(raw.family, FAMILY_IDS, 'gaussian'), link: name(raw.link, 20) || 'logit', trials: name(raw.trials), weights: name(raw.weights),
    se: oneOf(raw.se, ['model', 'HC0', 'HC3', 'cluster'] as const, 'model'), cluster: name(raw.cluster), plot: name(raw.plot),
    // (the options of censored, inflated, multinomial and survival models only when set)
    ...(raw.censoring === 'above' ? { censoring: 'above' as const } : {}), ...(raw.inflated === true ? { inflated: true } : {}), ...(raw.reference === 'last' ? { reference: 'last' as const } : {}),
    ...(name(raw.status) ? { status: name(raw.status) } : {}), ...(raw.statusCensored === true ? { statusCensored: true } : {}),
    ...(Array.isArray(raw.cuts) && raw.cuts.length ? { cuts: parseCuts(raw.cuts.filter((x) => typeof x === 'number').join(',')) } : {}),
  } : null),
  Options: RegressionOptionsForm,
  View: ({ result, options }) => <RegressionView r={result} plot={options.plot} o={options} />,
  display: ['plot'],
  blocked: (o, ctx) => {
    if (!o.outcome) return 'Choose the outcome.';
    if (!o.predictors.length && !o.interactions.length) return 'Choose at least one predictor.';
    if (o.predictors.includes(o.outcome) || o.interactions.some((t) => t.includes(o.outcome))) return 'The outcome cannot be a predictor.';
    const levels = rawData(ctx)?.categories?.[o.outcome];
    if (levels && !['ordinal', 'multinomial'].includes(o.family) && !(o.family === 'binomial' && levels.length === 2 && !o.trials)) return `“${o.outcome}” is a text column: choose ordinal or multinomial regression${levels.length === 2 ? ', or logistic regression (its second level counts as the event)' : ''}.`;
    if (o.se === 'cluster' && !o.cluster) return 'Choose the cluster column.';
    if (o.se !== 'model' && o.family === 'ordinal') return 'Robust standard errors apply to linear and generalised linear models; choose model-based errors for ordinal models.';
    if ((o.se === 'HC3' || o.se === 'cluster') && ownSe(o)) return 'Choose model-based or HC0 (Mplus MLR) standard errors for this model.';
    if (o.family === 'survival' && !o.status) return 'Choose the status column (0/1: which times are events, which censored).';
    if (o.family === 'survival' && o.status && o.status === o.outcome) return 'The status column cannot be the survival time.';
    if ((o.family === 'survival' || (o.family === 'poisson' && o.inflated) || (o.family === 'censored' && o.inflated)) && o.weights) return 'Weights are not available for survival and inflated models.';
    return missingColumns(ctx, regressionColumns(o), 'Regression');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, regressionColumns(o), [o.family, o.link, o.se, ...o.categorical, ...o.interactions.map((t) => t.join(':')), ctx.settings.confidence,
    // (only options that differ from the defaults: earlier results keep their fingerprint)
    ...(o.family === 'censored' && o.censoring === 'above' ? ['above'] : []), ...((o.family === 'censored' || o.family === 'poisson') && o.inflated ? ['inflated'] : []),
    ...(o.family === 'multinomial' && o.reference === 'last' ? ['last'] : []), ...(o.family === 'survival' ? [o.statusCensored ? 'censored' : 'event', (o.cuts ?? []).join(',')] : [])]),
  run: async (o, ctx) => { const input = regressionInput(o, ctx); return { ...(await (await import('../rengine/regression')).regressionR(rawData(ctx)!, input)), input }; },
  script: async (o, ctx) => (await import('../rengine/regression')).regressionScriptR(rawData(ctx)!, regressionInput(o, ctx)),
  summary: (o) => `${FAMILY_NAME[o.family].toLowerCase()} · ${o.outcome || '…'} on ${o.predictors.length ? o.predictors.join(', ') : '…'}${o.se !== 'model' ? ` · ${o.se} SEs` : ''}`,
};
