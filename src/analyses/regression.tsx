// Regression card: linear, logistic / probit (also binomial counts), Poisson,
// negative binomial, Gamma, ordinal and multinomial, with categorical
// predictors, interaction terms, weights and robust standard errors.

import { useState } from 'react';
import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { fmt, fmtP } from '../format';
import type { Coefficient, Family, RegressionInput, RegressionResult } from '../rengine/regression';
import { Choice, ColumnSelect, columnsFingerprint, isObj, missingColumns, name, names, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export interface RegressionOptions { outcome: string; predictors: string[]; categorical: string[]; interactions: string[][]; family: Family; link: string; trials: string; weights: string; se: RegressionInput['se']; cluster: string }
type Result = RegressionResult & { input: RegressionInput };

export const FAMILIES: readonly (readonly [Family, string, string])[] = [
  ['gaussian', 'Linear (Gaussian)', 'Ordinary least squares for a continuous outcome (lm).'],
  ['binomial', 'Logistic / probit', 'A 0/1 outcome, or counts of successes with the number of trials (glm, binomial).'],
  ['poisson', 'Poisson', 'A count outcome; check the dispersion (glm, poisson).'],
  ['negbin', 'Negative binomial', 'An over-dispersed count outcome (MASS::glm.nb).'],
  ['gamma', 'Gamma', 'A positive, right-skewed outcome; inverse link (glm, Gamma).'],
  ['ordinal', 'Ordinal (proportional odds)', 'An ordered categorical outcome (MASS::polr).'],
  ['multinomial', 'Multinomial logistic', 'An unordered categorical outcome, one equation per level against the first (nnet::multinom).'],
];
const FAMILY_NAME = Object.fromEntries(FAMILIES.map(([id, l]) => [id, l])) as Record<Family, string>;
const LINKS: Record<string, readonly (readonly [string, string])[]> = { binomial: [['logit', 'Logit'], ['probit', 'Probit'], ['cloglog', 'Complementary log-log']], ordinal: [['logistic', 'Logit'], ['probit', 'Probit'], ['cloglog', 'Complementary log-log']] };

function RegressionOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<RegressionOptions>) {
  const d = rawData(ctx);
  const columns = d?.names ?? [];
  const [ia, setIa] = useState<string[]>([]);
  if (!d || !columns.length) return <div className="empty-results">Import raw data first.</div>;
  const taken = [o.outcome, o.trials, o.weights, o.cluster];
  const text = (n: string) => !!d.categories?.[n];
  const links = LINKS[o.family];
  return (
    <fieldset className="card-options" disabled={disabled}>
      <div className="field">
        <label htmlFor="reg-family">Model</label>
        <select id="reg-family" className="select" value={o.family} onChange={(e) => { const family = e.target.value as Family; set({ ...o, family, link: family === 'ordinal' ? 'logistic' : 'logit', trials: family === 'binomial' ? o.trials : '' }); }}>
          {FAMILIES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select>
        <div className="hint">{FAMILIES.find(([id]) => id === o.family)![2]}</div>
      </div>
      {links && <Choice label="Link" value={o.link} onChange={(link) => set({ ...o, link })} options={links} />}
      <ColumnSelect id="reg-y" label={o.family === 'binomial' && o.trials ? 'Outcome (successes)' : 'Outcome'} value={o.outcome} columns={columns} exclude={[...o.predictors, ...taken.filter((x) => x !== o.outcome)]} onChange={(outcome) => set({ ...o, outcome })} />
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
          <select id="reg-se" className="select" value={o.se} disabled={o.family === 'ordinal' || o.family === 'multinomial'} onChange={(e) => set({ ...o, se: e.target.value as RegressionInput['se'] })}>
            <option value="model">Model-based</option><option value="HC3">Robust (HC3)</option><option value="cluster">Cluster-robust</option>
          </select>
        </div>
      </div>
      {o.se === 'cluster' && <ColumnSelect id="reg-cl" label="Cluster" value={o.cluster} columns={columns} exclude={[o.outcome, ...o.predictors, o.trials, o.weights]} onChange={(cluster) => set({ ...o, cluster })} />}
    </fieldset>
  );
}

const coefRow = (e: Coefficient, ratio: boolean): Row => [c(e.term), c(e.est), c(e.se), c(e.stat), pCell(e.p), c(`[${fmt(e.ciLow)}, ${fmt(e.ciHigh)}]`), ...(ratio ? [c(e.ratio ?? null)] : [])];

function Curve({ r }: { r: RegressionResult }) {
  const cv = r.curve!;
  const W = 520, H = 300, pad = { l: 56, r: 16, t: 14, b: 44 };
  const probs = cv.probs;
  const ys = probs ? [0, 1] : (() => { const all = [...(cv.y ?? []), ...(cv.points?.y ?? [])]; const lo = Math.min(...all), hi = Math.max(...all), m = (hi - lo || 1) * 0.05; return [lo - m, hi + m]; })();
  const x0 = cv.grid[0], x1 = cv.grid[cv.grid.length - 1];
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((ys[1] - v) / (ys[1] - ys[0] || 1)) * (H - pad.t - pad.b);
  const ticks = (lo: number, hi: number) => Array.from({ length: 6 }, (_, i) => lo + ((hi - lo) * i) / 5);
  const COLORS = ['var(--accent)', '#d97706', '#059669', '#dc2626', '#7c3aed', '#0891b2'];
  return (
    <ChartFrame id={`regression:${cv.x}`} name={`regression-${cv.x}`} width={W} height={H} defaults={{ x: cv.x, y: probs ? 'Probability' : r.family === 'binomial' ? 'Probability' : 'Predicted outcome' }}
      caption={<span className="hint">The fitted {probs ? 'probability of each level' : 'response'} over {cv.x}, other predictors at their means (categorical ones at their reference level).{cv.points ? ' Dots: the data.' : ''}</span>}>
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

function RegressionView({ r }: { r: Result }) {
  const f = r.fit, pct = Math.round(r.input.confidence * 100);
  const ratio = r.coefficients.some((e) => e.ratio !== undefined && e.ratio !== null);
  const ratioName = r.family === 'binomial' || r.family === 'ordinal' || r.family === 'multinomial' ? 'Odds ratio' : 'Rate ratio';
  const cols = ['Term', 'Estimate', 'Std. error', r.family === 'gaussian' && r.se === 'model' ? 't' : 'z', 'p', `${pct}% CI`, ...(ratio ? [ratioName] : [])];
  const cards: [string, string][] = [['n', String(f.n)],
    ...(f.r2 !== undefined && f.r2 !== null ? [['R²', fmt(f.r2)], ['Adj. R²', fmt(f.adjR2!)]] as [string, string][] : []),
    ...(r.lrt?.pseudoR2 !== undefined && r.lrt?.pseudoR2 !== null ? [['Pseudo R² (McFadden)', fmt(r.lrt.pseudoR2)]] as [string, string][] : []),
    ['AIC', fmt(f.aic, 1)], ['BIC', fmt(f.bic, 1)],
    ...(f.dispersion !== undefined && f.dispersion !== null ? [['Dispersion', fmt(f.dispersion, 2)]] as [string, string][] : []),
    ...(f.theta !== undefined && f.theta !== null ? [['θ', fmt(f.theta, 2)]] as [string, string][] : [])];
  const dg = r.diagnostics;
  return (
    <div className="tables">
      <div className="stat-cards">{cards.map(([k, v]) => <div className="stat-card" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}</div>
      <p className="hint" style={{ marginTop: 0 }}>
        {FAMILY_NAME[r.family]}{r.link && r.link !== 'logit' && r.link !== 'logistic' ? ` (${r.link} link)` : ''}: <code>{r.formula}</code>; {r.engine.package} {r.engine.version}.
        {r.se !== 'model' && ` ${r.se === 'HC3' ? 'Heteroskedasticity-consistent (HC3)' : 'Cluster-robust'} standard errors.`}
        {r.lrt && <> Likelihood-ratio test against the intercept-only model: χ²({r.lrt.df}) = {fmt(r.lrt.stat, 2)}, p {r.lrt.p < 0.001 ? '< 0.001' : `= ${fmt(r.lrt.p)}`}.</>}
        {f.dispersion !== undefined && f.dispersion !== null && f.dispersion > 1.5 && r.family === 'poisson' && ' Dispersion well above 1: consider the negative binomial.'}
      </p>
      {r.family === 'multinomial' && r.levels
        ? r.levels.others.map((l) => <Table key={l} title={`${l} versus ${r.levels!.reference}`} file={`regression-${l}`} columns={cols} rows={r.coefficients.filter((e) => e.level === l).map((e) => coefRow(e, ratio))} />)
        : <Table title="Coefficients" file="regression-coefficients" columns={cols} rows={r.coefficients.map((e) => coefRow(e, ratio))}
          note={ratio ? `${ratioName}s: exp(estimate), the multiplicative change in the ${r.family === 'binomial' || r.family === 'ordinal' ? 'odds' : 'expected count'} per unit of the predictor.` : undefined} />}
      {r.thresholds.length > 0 && <Table title="Thresholds (cut points between the ordered levels)" file="regression-thresholds" columns={cols.slice(0, 6)} rows={r.thresholds.map((e) => coefRow(e, false))} />}
      {(dg.vif?.length || dg.auc !== undefined || dg.hosmerLemeshow) ? (
        <Table title="Diagnostics" file="regression-diagnostics" columns={['Statistic', 'Value']} rows={[
          ...(dg.vif ?? []).map((v): Row => [c(`VIF ${v.term}`), c(v.vif)]),
          ...(dg.accuracy !== undefined ? [[c('Classification accuracy (cut-off 0.5)'), c(dg.accuracy)] as Row] : []),
          ...(dg.auc !== undefined && dg.auc !== null ? [[c('Area under the ROC curve'), c(dg.auc)] as Row] : []),
          ...(dg.hosmerLemeshow ? [[c(`Hosmer–Lemeshow χ²(${dg.hosmerLemeshow.df})`), c(`${fmt(dg.hosmerLemeshow.stat, 2)}, p ${fmtP(dg.hosmerLemeshow.p)}`)] as Row] : []),
        ]} note="VIF above 5 (or 10) signals collinear predictors. Hosmer–Lemeshow: a small p means the fitted probabilities do not match the observed rates." />
      ) : null}
      {r.curve && <Curve r={r} />}
    </div>
  );
}

export const regressionInput = (o: RegressionOptions, ctx: Pick<AnalysisCtx, 'settings'>): RegressionInput => ({ ...o, confidence: ctx.settings.confidence });
export const regressionColumns = (o: RegressionOptions) => [...new Set([o.outcome, ...o.predictors, ...o.interactions.flat(), o.trials, o.weights, o.se === 'cluster' ? o.cluster : ''].filter(Boolean))];
const FAMILY_IDS = FAMILIES.map(([id]) => id);

export const regressionAnalysis: AnalysisType<RegressionOptions, Result> = {
  id: 'regression',
  title: 'Regression',
  sub: 'linear, logistic, Poisson, negative binomial, Gamma, ordinal, multinomial (lm, glm, MASS, nnet)',
  group: 'Regression and causal inference',
  entries: [
    { title: 'Linear regression', sub: 'a continuous outcome (lm)', options: (o) => ({ ...o, family: 'gaussian' }) },
    { title: 'Logistic regression', sub: 'a 0/1 outcome or counts of successes (glm)', options: (o) => ({ ...o, family: 'binomial', link: 'logit' }) },
    { title: 'Count regression', sub: 'Poisson or negative binomial (glm, MASS)', options: (o) => ({ ...o, family: 'poisson' }) },
    { title: 'Ordinal regression', sub: 'proportional odds (MASS::polr)', options: (o) => ({ ...o, family: 'ordinal', link: 'logistic' }) },
    { title: 'Multinomial regression', sub: 'an unordered categorical outcome (nnet)', options: (o) => ({ ...o, family: 'multinomial' }) },
  ],
  cardTitle: (o) => `${FAMILY_NAME[o.family]}${o.outcome ? `: ${o.outcome}` : ''}`,
  defaults: () => ({ outcome: '', predictors: [], categorical: [], interactions: [], family: 'gaussian', link: 'logit', trials: '', weights: '', se: 'model', cluster: '' }),
  parseOptions: (raw) => (isObj(raw) ? {
    outcome: name(raw.outcome), predictors: names(raw.predictors), categorical: names(raw.categorical),
    interactions: (Array.isArray(raw.interactions) ? raw.interactions.slice(0, 50) : []).map((t) => names(t)).filter((t) => t.length >= 2),
    family: oneOf(raw.family, FAMILY_IDS, 'gaussian'), link: name(raw.link, 20) || 'logit', trials: name(raw.trials), weights: name(raw.weights),
    se: oneOf(raw.se, ['model', 'HC3', 'cluster'] as const, 'model'), cluster: name(raw.cluster),
  } : null),
  Options: RegressionOptionsForm,
  View: ({ result }) => <RegressionView r={result} />,
  blocked: (o, ctx) => {
    if (!o.outcome) return 'Choose the outcome.';
    if (!o.predictors.length && !o.interactions.length) return 'Choose at least one predictor.';
    if (o.predictors.includes(o.outcome) || o.interactions.some((t) => t.includes(o.outcome))) return 'The outcome cannot be a predictor.';
    if (o.se === 'cluster' && !o.cluster) return 'Choose the cluster column.';
    return missingColumns(ctx, regressionColumns(o), 'Regression');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, regressionColumns(o), [o.family, o.link, o.se, ...o.categorical, ...o.interactions.map((t) => t.join(':')), ctx.settings.confidence]),
  run: async (o, ctx) => { const input = regressionInput(o, ctx); return { ...(await (await import('../rengine/regression')).regressionR(rawData(ctx)!, input)), input }; },
  script: async (o, ctx) => (await import('../rengine/regression')).regressionScriptR(rawData(ctx)!, regressionInput(o, ctx)),
  summary: (o) => `${FAMILY_NAME[o.family].toLowerCase()} · ${o.outcome || '…'} on ${o.predictors.length ? o.predictors.join(', ') : '…'}${o.se !== 'model' ? ` · ${o.se} SEs` : ''}`,
};
