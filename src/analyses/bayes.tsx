// Bayesian tests (R/bayes.R) with JASP's default priors: the JZS t-tests and
// Pearson correlations (BayesFactor), the binomial test (beta prior, base R).
// The posterior sampling uses the project's seed; the credible level is the
// project's confidence level.

import { OrderedPicker } from '../components/OrderedPicker';
import { c, Table, type Row } from '../components/results/Table';
import { fmt } from '../format';
import type { Alternative, BAnovaInput, BAnovaResult, BBinomialInput, BBinomialResult, BContingencyInput, BContingencyResult, BCorrelationInput, BCorrelationResult, BTTestInput, BTTestResult } from '../rengine/tests';
import { Choice, ColumnSelect, columnsFingerprint, isObj, missingColumns, name, names, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

const engine = () => import('../rengine/tests');
const ALT_IDS = ['two.sided', 'greater', 'less'] as const;
const pct = (conf: number) => `${Math.round(conf * 100)}%`;
const NoData = () => <div className="empty-results">Import raw data first.</div>;
const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > lo && v <= hi ? v : fallback);

/** A Bayes factor for reading: plain between 0.001 and 10,000, otherwise in powers of ten. */
export function fmtBF(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '—';
  if (v === 0) return '0';
  return v >= 1e4 || v < 1e-3 ? v.toExponential(2).replace('e+', ' × 10^').replace('e-', ' × 10^-') : fmt(v, v >= 100 ? 1 : 3);
}
/** Evidence categories of Lee & Wagenmakers (2013), after Jeffreys (1961), for BF10 (below 1: for H0). */
export function evidence(bf10: number): string {
  const b = bf10 >= 1 ? bf10 : 1 / bf10, side = bf10 >= 1 ? 'for H1' : 'for H0';
  if (!Number.isFinite(b)) return `extreme ${side}`;
  if (b < 1.0001) return 'none';
  const word = b < 3 ? 'anecdotal' : b < 10 ? 'moderate' : b < 30 ? 'strong' : b < 100 ? 'very strong' : 'extreme';
  return `${word} ${side}`;
}
const bfName = (alt: Alternative) => (alt === 'two.sided' ? 'BF₁₀' : alt === 'greater' ? 'BF₊₀' : 'BF₋₀');
const bfCells = (bf10: number): Row => [c(fmtBF(bf10)), c(fmtBF(1 / bf10)), c(evidence(bf10))];
const altHint = (o: { alternative: Alternative }, what: string) => (o.alternative === 'two.sided' ? `H1: ${what} differs from zero.` : `H1 is one-sided: ${what} ${o.alternative === 'greater' ? 'positive' : 'negative'} (the prior restricted to that side).`);
const ALTS: readonly (readonly [Alternative, string])[] = [['two.sided', 'Two-sided'], ['greater', 'Positive'], ['less', 'Negative']];
const EVIDENCE_NOTE = 'BF₁₀: how many times more likely the data are under H1 than under H0; BF₀₁ = 1/BF₁₀. Evidence categories after Jeffreys (Lee & Wagenmakers 2013): 1–3 anecdotal, 3–10 moderate, 10–30 strong, 30–100 very strong, above 100 extreme.';

function PriorWidth({ id = 'bayes-width', value, onChange, label, hint }: { id?: string; value: number; onChange: (v: number) => void; label: string; hint: string }) {
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <input id={id} className="input num" type="number" min={0.01} max={100} step={0.001} value={Number(value.toFixed(4))} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) onChange(v); }} />
      <div className="hint">{hint}</div></div>
  );
}

// ---------------------------------------------------------------- t-tests

export type BTTestOptions = Omit<BTTestInput, 'confidence' | 'seed'>;
const T_NAME = { one: 'Bayesian one-sample t-test', paired: 'Bayesian paired-samples t-test', independent: 'Bayesian independent-samples t-test' } as const;

function BTTestForm({ options: o, set, ctx, disabled }: OptionsProps<BTTestOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  const numeric = d.names.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Choice label="Design" value={o.type} onChange={(type) => set({ ...o, type })} options={[['one', 'One sample'], ['paired', 'Paired samples'], ['independent', 'Independent samples']]} />
      {o.type === 'paired' ? (
        <div className="field">
          <label>Pairs</label>
          {o.pairs.map((p, i) => (
            <div key={i} className="row2">
              <ColumnSelect id={`bt-a${i}`} label="First" value={p[0]} columns={numeric} onChange={(a) => set({ ...o, pairs: o.pairs.map((q, k) => (k === i ? [a, q[1]] : q)) })} />
              <ColumnSelect id={`bt-b${i}`} label="Second" value={p[1]} columns={numeric} exclude={[p[0]]} onChange={(b) => set({ ...o, pairs: o.pairs.map((q, k) => (k === i ? [q[0], b] : q)) })} />
              <button className="btn sm ghost" onClick={() => set({ ...o, pairs: o.pairs.filter((_, k) => k !== i) })} aria-label={`Remove pair ${i + 1}`}>Remove</button>
            </div>
          ))}
          <button className="btn sm" onClick={() => set({ ...o, pairs: [...o.pairs, ['', '']] })}>Add pair</button>
        </div>
      ) : (
        <OrderedPicker label="Variables" columns={numeric.filter((n) => n !== o.group)} value={o.vars} onChange={(vars) => set({ ...o, vars })} />
      )}
      {o.type === 'independent' && <ColumnSelect id="bt-g" label="Grouping variable (two groups)" value={o.group} columns={d.names} exclude={o.vars} onChange={(group) => set({ ...o, group })} />}
      {o.type === 'one' && (
        <div className="field"><label htmlFor="bt-mu">Test value</label>
          <input id="bt-mu" className="input num" type="number" step="any" value={o.testValue} onChange={(e) => { const v = Number(e.target.value); set({ ...o, testValue: Number.isFinite(v) ? v : 0 }); }} /></div>
      )}
      <Choice label="Alternative hypothesis" value={o.alternative} onChange={(alternative) => set({ ...o, alternative })} options={ALTS}
        hint={altHint(o, o.type === 'independent' ? 'the effect (first group minus second)' : o.type === 'paired' ? 'the effect (first minus second)' : 'the effect (mean minus test value)')} />
      <PriorWidth label="Cauchy prior width (r)" value={o.priorWidth} onChange={(priorWidth) => set({ ...o, priorWidth })}
        hint="The prior on the standardised effect δ under H1: Cauchy(0, r). √2/2 ≈ 0.707 is the default of JASP and BayesFactor (“medium”); 1 is “wide”." />
    </fieldset>
  );
}

function BTTestView({ r }: { r: BTTestResult }) {
  const cri = pct(r.confidence);
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>Cauchy prior width r = {fmt(r.priorWidth)}{r.type === 'one' ? `, test value ${fmt(r.testValue)}` : ''}{r.groups ? `; ${r.groups[0]} − ${r.groups[1]}` : ''}; BayesFactor {r.engine.version}.</p>
      <Table title={T_NAME[r.type]} file="bayes-ttest" columns={['Variable', bfName(r.alternative), 'BF₀₁', 'Evidence', 'Error %']}
        rows={r.rows.map((x): Row => [c(x.label), ...bfCells(x.bf10), c(x.error === null || x.error === undefined ? null : x.error * 100, undefined, 4)])} note={EVIDENCE_NOTE} />
      <Table title="Posterior of the standardised effect δ" file="bayes-ttest-posterior" columns={['Variable', 'Median', `${cri} credible interval`]}
        rows={r.rows.map((x): Row => [c(x.label), c(x.delta.median), c(`[${fmt(x.delta.low)}, ${fmt(x.delta.high)}]`)])}
        note={`From ${r.iterations.toLocaleString('en')} posterior samples under H1${r.alternative === 'two.sided' ? '' : ' (restricted to the one-sided alternative)'}, seed ${r.seed}.`} />
    </div>
  );
}

const btCols = (o: BTTestOptions) => (o.type === 'paired' ? o.pairs.flat() : [...o.vars, o.type === 'independent' ? o.group : '']).filter(Boolean);
const btInput = (o: BTTestOptions, ctx: Pick<AnalysisCtx, 'settings'>): BTTestInput => ({
  ...o, vars: o.type === 'paired' ? [] : o.vars, pairs: o.type === 'paired' ? o.pairs : [], group: o.type === 'independent' ? o.group : '', seed: ctx.settings.seed, confidence: ctx.settings.confidence,
});

export const bayesTtestAnalysis: AnalysisType<BTTestOptions, BTTestResult> = {
  id: 'bttest', title: 'Bayesian t-tests', sub: 'Bayes factors for one sample, paired, independent (JZS; BayesFactor)', group: 'Basic statistics',
  entries: [
    { title: 'Bayesian independent-samples t-test', sub: 'two groups; Bayes factor and posterior effect size', options: (o) => ({ ...o, type: 'independent' }) },
    { title: 'Bayesian paired-samples t-test', sub: 'two measurements of the same cases', options: (o) => ({ ...o, type: 'paired' }) },
    { title: 'Bayesian one-sample t-test', sub: 'a mean against a test value', options: (o) => ({ ...o, type: 'one' }) },
  ],
  cardTitle: (o) => T_NAME[o.type],
  defaults: () => ({ type: 'independent', vars: [], pairs: [['', '']], group: '', testValue: 0, alternative: 'two.sided', priorWidth: Math.SQRT1_2, iterations: 10000 }),
  parseOptions: (raw) => (isObj(raw) ? {
    type: oneOf(raw.type, ['one', 'paired', 'independent'] as const, 'independent'), vars: names(raw.vars),
    pairs: (Array.isArray(raw.pairs) ? raw.pairs.slice(0, 100) : []).filter(Array.isArray).map((p) => [name(p[0]), name(p[1])] as [string, string]),
    group: name(raw.group), testValue: typeof raw.testValue === 'number' && Number.isFinite(raw.testValue) ? raw.testValue : 0,
    alternative: oneOf(raw.alternative, ALT_IDS, 'two.sided'), priorWidth: num(raw.priorWidth, 0, 100, Math.SQRT1_2),
    iterations: Math.round(num(raw.iterations, 999, 1e6, 10000)),
  } : null),
  Options: BTTestForm,
  View: ({ result }) => <BTTestView r={result} />,
  blocked: (o, ctx) => {
    if (o.type === 'paired') { if (!o.pairs.length || o.pairs.some((p) => !p[0] || !p[1])) return 'Choose both variables of each pair.'; if (o.pairs.some((p) => p[0] === p[1])) return 'A pair needs two different variables.'; }
    else if (!o.vars.length) return 'Choose at least one variable.';
    if (o.type === 'independent' && !o.group) return 'Choose the grouping variable.';
    return missingColumns(ctx, btCols(o), 'Bayesian t-test');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, btCols(o), [o.type, o.testValue, o.alternative, o.priorWidth, o.iterations, ctx.settings.seed, ctx.settings.confidence]),
  run: async (o, ctx) => (await engine()).bttestR(rawData(ctx)!, btInput(o, ctx)),
  script: async (o, ctx) => (await engine()).bttestScriptR(rawData(ctx)!, btInput(o, ctx)),
  summary: (o) => `${T_NAME[o.type].toLowerCase()} · ${o.type === 'paired' ? o.pairs.map((p) => p.join(' − ')).join(', ') || '…' : o.vars.join(', ') || '…'}${o.type === 'independent' ? ` by ${o.group || '…'}` : ''} · r = ${fmt(o.priorWidth)}`,
};

// ---------------------------------------------------------------- correlation

export type BCorrelationOptions = Omit<BCorrelationInput, 'confidence' | 'seed'>;

export const bayesCorrelationAnalysis: AnalysisType<BCorrelationOptions, BCorrelationResult> = {
  id: 'bcorrelation', title: 'Bayesian correlation', sub: 'Pearson’s r with Bayes factors and the posterior of ρ (BayesFactor)', group: 'Basic statistics',
  cardTitle: () => 'Bayesian Pearson correlations',
  defaults: () => ({ vars: [], alternative: 'two.sided', priorWidth: 1, iterations: 10000 }),
  parseOptions: (raw) => (isObj(raw) ? { vars: names(raw.vars), alternative: oneOf(raw.alternative, ALT_IDS, 'two.sided'), priorWidth: num(raw.priorWidth, 0, 100, 1), iterations: Math.round(num(raw.iterations, 999, 1e6, 10000)) } : null),
  Options: ({ options: o, set, ctx, disabled }) => {
    const d = rawData(ctx);
    if (!d) return <NoData />;
    return (
      <fieldset className="card-options" disabled={disabled}>
        <OrderedPicker label="Variables" columns={d.names.filter((n) => !d.categories?.[n])} value={o.vars} onChange={(vars) => set({ ...o, vars })} />
        <Choice label="Alternative hypothesis" value={o.alternative} onChange={(alternative) => set({ ...o, alternative })} options={ALTS} hint={altHint(o, 'the correlation')} />
        <PriorWidth label="Stretched beta prior width (κ)" value={o.priorWidth} onChange={(priorWidth) => set({ ...o, priorWidth })}
          hint="The prior on ρ: a beta(1/κ, 1/κ) stretched to −1…1. κ = 1 (uniform) is JASP’s default; smaller κ puts more weight near zero." />
      </fieldset>
    );
  },
  View: ({ result: r }) => (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>Stretched beta prior width κ = {fmt(r.priorWidth)}; pairwise complete cases; BayesFactor {r.engine.version}.</p>
      <Table title="Bayesian Pearson correlations" file="bayes-correlation" columns={['Pair', 'r', 'N', bfName(r.alternative), 'BF₀₁', 'Evidence', 'Posterior median ρ', `${pct(r.confidence)} credible interval`]}
        rows={r.pairs.map((p): Row => [c(`${p.a} – ${p.b}`), c(p.r), c(p.n, undefined, 0), ...bfCells(p.bf10), c(p.rho.median), c(`[${fmt(p.rho.low)}, ${fmt(p.rho.high)}]`)])}
        note={`${EVIDENCE_NOTE} Posterior from ${r.iterations.toLocaleString('en')} samples, seed ${r.seed}.`} />
    </div>
  ),
  blocked: (o, ctx) => (o.vars.length < 2 ? 'Choose at least two variables.' : missingColumns(ctx, o.vars, 'Bayesian correlation')),
  fingerprint: (o, ctx) => columnsFingerprint(ctx, o.vars, [o.alternative, o.priorWidth, o.iterations, ctx.settings.seed, ctx.settings.confidence]),
  run: async (o, ctx) => (await engine()).bcorrelationR(rawData(ctx)!, { ...o, seed: ctx.settings.seed, confidence: ctx.settings.confidence }),
  script: async (o, ctx) => (await engine()).bcorrelationScriptR(rawData(ctx)!, { ...o, seed: ctx.settings.seed, confidence: ctx.settings.confidence }),
  summary: (o) => `${o.vars.join(', ') || '…'} · κ = ${fmt(o.priorWidth)}`,
};

// ---------------------------------------------------------------- binomial

export type BBinomialOptions = Omit<BBinomialInput, 'confidence'>;

export const bayesBinomialAnalysis: AnalysisType<BBinomialOptions, BBinomialResult> = {
  id: 'bbinomial', title: 'Bayesian binomial test', sub: 'a proportion against a value, beta prior (Bayes factor, posterior)', group: 'Basic statistics',
  cardTitle: (o) => `Bayesian binomial test${o.variable ? `: ${o.variable}` : ''}`,
  defaults: () => ({ variable: '', testValue: 0.5, alternative: 'two.sided', priorA: 1, priorB: 1 }),
  parseOptions: (raw) => (isObj(raw) ? {
    variable: name(raw.variable), testValue: typeof raw.testValue === 'number' && raw.testValue > 0 && raw.testValue < 1 ? raw.testValue : 0.5,
    alternative: oneOf(raw.alternative, ALT_IDS, 'two.sided'), priorA: num(raw.priorA, 0, 1e4, 1), priorB: num(raw.priorB, 0, 1e4, 1),
  } : null),
  Options: ({ options: o, set, ctx, disabled }) => {
    const d = rawData(ctx);
    if (!d) return <NoData />;
    const setNum = (k: 'testValue' | 'priorA' | 'priorB') => (e: { target: { value: string } }) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) set({ ...o, [k]: v }); };
    return (
      <fieldset className="card-options" disabled={disabled}>
        <ColumnSelect id="bb-x" label="Variable" value={o.variable} columns={d.names} onChange={(variable) => set({ ...o, variable })} />
        <div className="field"><label htmlFor="bb-p">Test proportion</label><input id="bb-p" className="input num" type="number" min={0.001} max={0.999} step={0.01} value={o.testValue} onChange={setNum('testValue')} /></div>
        <Choice label="Alternative hypothesis" value={o.alternative} onChange={(alternative) => set({ ...o, alternative })} options={[['two.sided', 'Two-sided'], ['greater', 'Greater'], ['less', 'Less']]}
          hint={o.alternative === 'two.sided' ? 'H1: the proportion differs from the test value.' : `H1: the proportion is ${o.alternative === 'greater' ? 'above' : 'below'} the test value (the prior restricted to that side).`} />
        <div className="row2">
          <div className="field"><label htmlFor="bb-a">Beta prior a</label><input id="bb-a" className="input num" type="number" min={0.01} step={0.1} value={o.priorA} onChange={setNum('priorA')} /></div>
          <div className="field"><label htmlFor="bb-b">Beta prior b</label><input id="bb-b" className="input num" type="number" min={0.01} step={0.1} value={o.priorB} onChange={setNum('priorB')} /></div>
        </div>
        <div className="hint">The prior on the proportion under H1: beta(a, b). a = b = 1 (uniform) is JASP’s default.</div>
      </fieldset>
    );
  },
  View: ({ result: r }) => (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>Beta({fmt(r.priorA, 2)}, {fmt(r.priorB, 2)}) prior; test proportion {fmt(r.testValue)}; closed form (base R {r.engine.version}).</p>
      <Table title={`Bayesian binomial test: ${r.variable}`} file="bayes-binomial" columns={['Category', 'Count', 'Total', 'Proportion', r.alternative === 'two.sided' ? 'BF₁₀' : r.alternative === 'greater' ? 'BF₊₀' : 'BF₋₀', 'BF₀₁', 'Evidence', 'Posterior median', `${pct(r.confidence)} credible interval`]}
        rows={r.levels.map((l, i): Row => [c(l), c(r.counts[i], undefined, 0), c(r.n, undefined, 0), c(r.counts[i] / r.n), ...bfCells(r.rows[i].bf10), c(r.rows[i].median), c(`[${fmt(r.rows[i].low)}, ${fmt(r.rows[i].high)}]`)])}
        note={`Each category against the rest. ${EVIDENCE_NOTE} The posterior (beta) is the unrestricted one.`} />
    </div>
  ),
  blocked: (o, ctx) => (!o.variable ? 'Choose the variable.' : missingColumns(ctx, [o.variable], 'Bayesian binomial test')),
  fingerprint: (o, ctx) => columnsFingerprint(ctx, [o.variable], [o.testValue, o.alternative, o.priorA, o.priorB, ctx.settings.confidence]),
  run: async (o, ctx) => (await engine()).bbinomialR(rawData(ctx)!, { ...o, confidence: ctx.settings.confidence }),
  script: async (o, ctx) => (await engine()).bbinomialScriptR(rawData(ctx)!, { ...o, confidence: ctx.settings.confidence }),
  summary: (o) => `${o.variable || '…'} vs ${o.testValue} · beta(${o.priorA}, ${o.priorB})`,
};

// ---------------------------------------------------------------- ANOVA / ANCOVA

export type BAnovaOptions = Omit<BAnovaInput, 'seed'>;

function BAnovaForm({ options: o, set, ctx, disabled }: OptionsProps<BAnovaOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  const numeric = d.names.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <ColumnSelect id="ba-y" label="Dependent variable" value={o.dependent} columns={numeric} exclude={[...o.factors, ...o.covariates]} onChange={(dependent) => set({ ...o, dependent })} />
      <OrderedPicker label="Fixed factors" columns={d.names.filter((n) => n !== o.dependent && !o.covariates.includes(n))} value={o.factors} onChange={(factors) => set({ ...o, factors })} />
      <OrderedPicker label="Covariates (ANCOVA, optional)" columns={numeric.filter((n) => n !== o.dependent && !o.factors.includes(n))} value={o.covariates} onChange={(covariates) => set({ ...o, covariates })} />
      <Choice label="Model terms" value={o.interactions ? 'full' : 'main'} onChange={(v) => set({ ...o, interactions: v === 'full' })} options={[['full', 'With interactions'], ['main', 'Main effects only']]}
        hint="Every model that keeps an interaction’s main effects is compared with the null model (BayesFactor’s “withmain”, as JASP)." />
      <div className="row2">
        <PriorWidth id="ba-rf" label="Prior width, fixed effects" value={o.priorFixed} onChange={(priorFixed) => set({ ...o, priorFixed })} hint="JASP’s default 0.5 (BayesFactor’s “medium”)." />
        <PriorWidth id="ba-rc" label="Prior width, covariates" value={o.priorCovariates} onChange={(priorCovariates) => set({ ...o, priorCovariates })} hint="JASP’s default √2/4 ≈ 0.354." />
      </div>
    </fieldset>
  );
}

function BAnovaView({ r }: { r: BAnovaResult }) {
  const best = r.models.reduce((a, m) => (m.posterior > a.posterior ? m : a), r.models[0]);
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>{r.dependent}, n = {r.n}; prior widths {fmt(r.priorFixed)} (factors){r.covariates.length ? `, ${fmt(r.priorCovariates)} (covariates)` : ''}; {r.iterations.toLocaleString('en')} samples, seed {r.seed}; BayesFactor {r.engine.version}.</p>
      <Table title={`Bayesian ${r.covariates.length ? 'ANCOVA' : 'ANOVA'}: model comparison`} file="bayes-anova-models" columns={['Model', 'P(M)', 'P(M | data)', 'BF_M', 'BF₁₀', 'Error %']}
        rows={[...r.models].sort((a, b) => b.posterior - a.posterior).map((m): Row => [{ v: m.model, bold: m === best }, c(1 / r.models.length), c(m.posterior), c(fmtBF(m.bfM)), c(fmtBF(m.bf10)), c(m.error ? m.error * 100 : null, undefined, 4)])}
        note="BF₁₀: each model against the null model (intercept only). P(M): equal prior probabilities; BF_M: a model’s posterior odds over its prior odds. Error: the proportional error of BayesFactor’s numerical integration or sampling." />
      <Table title="Analysis of effects (across all models)" file="bayes-anova-effects" columns={['Effect', 'P(incl)', 'P(incl | data)', 'BF_incl', 'Evidence']}
        rows={r.effects.map((e): Row => [c(e.effect), c(e.priorInclusion), c(e.posteriorInclusion), c(fmtBF(e.bfInclusion)), c(evidence(e.bfInclusion))])}
        note="Inclusion Bayes factor: the posterior odds of the models with the effect over those without, by their prior odds." />
    </div>
  );
}

const baCols = (o: BAnovaOptions) => [o.dependent, ...o.factors, ...o.covariates].filter(Boolean);
export const bayesAnovaAnalysis: AnalysisType<BAnovaOptions, BAnovaResult> = {
  id: 'banova', title: 'Bayesian ANOVA', sub: 'model comparison and inclusion Bayes factors; ANCOVA with covariates (BayesFactor)', group: 'Basic statistics',
  entries: [
    { title: 'Bayesian ANOVA', sub: 'between-subjects factors; models and effects', options: (o) => o },
    { title: 'Bayesian ANCOVA', sub: 'factors and covariates', options: (o) => o },
  ],
  cardTitle: (o) => `Bayesian ${o.covariates.length ? 'ANCOVA' : 'ANOVA'}${o.dependent ? `: ${o.dependent}` : ''}`,
  defaults: () => ({ dependent: '', factors: [], covariates: [], interactions: true, priorFixed: 0.5, priorCovariates: Math.SQRT2 / 4, iterations: 10000 }),
  parseOptions: (raw) => (isObj(raw) ? {
    dependent: name(raw.dependent), factors: names(raw.factors), covariates: names(raw.covariates), interactions: raw.interactions !== false,
    priorFixed: num(raw.priorFixed, 0, 100, 0.5), priorCovariates: num(raw.priorCovariates, 0, 100, Math.SQRT2 / 4), iterations: Math.round(num(raw.iterations, 999, 1e6, 10000)),
  } : null),
  Options: BAnovaForm,
  View: ({ result }) => <BAnovaView r={result} />,
  blocked: (o, ctx) => {
    if (!o.dependent) return 'Choose the dependent variable.';
    if (!o.factors.length) return 'Choose at least one factor.';
    if (o.factors.length + o.covariates.length > 6) return 'At most six factors and covariates: the number of models grows quickly.';
    return missingColumns(ctx, baCols(o), 'Bayesian ANOVA');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, baCols(o), [String(o.interactions), o.priorFixed, o.priorCovariates, o.iterations, ...o.factors, '|', ...o.covariates, ctx.settings.seed]),
  run: async (o, ctx) => (await engine()).banovaR(rawData(ctx)!, { ...o, seed: ctx.settings.seed }),
  script: async (o, ctx) => (await engine()).banovaScriptR(rawData(ctx)!, { ...o, seed: ctx.settings.seed }),
  summary: (o) => `${o.dependent || '…'} by ${o.factors.join(' × ') || '…'}${o.covariates.length ? ` + ${o.covariates.join(', ')}` : ''}`,
};

// ---------------------------------------------------------------- contingency tables

export type BContingencyOptions = BContingencyInput;
const SAMPLING: readonly (readonly [BContingencyInput['sampling'], string])[] = [
  ['jointMulti', 'Joint multinomial'], ['indepRows', 'Independent multinomial, rows fixed'], ['indepCols', 'Independent multinomial, columns fixed'], ['poisson', 'Poisson'], ['hypergeom', 'Hypergeometric (2 × 2)'],
];
const SAMPLING_HINT: Record<BContingencyInput['sampling'], string> = {
  jointMulti: 'Only the total N was fixed by the design (JASP’s default).', indepRows: 'The number of cases in each row was fixed by the design.', indepCols: 'The number of cases in each column was fixed by the design.',
  poisson: 'Nothing was fixed: the total itself is random.', hypergeom: 'Both margins were fixed (2 × 2 tables only).',
};

export const bayesContingencyAnalysis: AnalysisType<BContingencyOptions, BContingencyResult> = {
  id: 'bcontingency', title: 'Bayesian contingency table', sub: 'independence against association (Gunel & Dickey; BayesFactor)', group: 'Basic statistics',
  cardTitle: (o) => `Bayesian contingency table${o.rows && o.columns ? `: ${o.rows} × ${o.columns}` : ''}`,
  defaults: () => ({ rows: '', columns: '', counts: '', sampling: 'jointMulti', priorConcentration: 1 }),
  parseOptions: (raw) => (isObj(raw) ? {
    rows: name(raw.rows), columns: name(raw.columns), counts: name(raw.counts),
    sampling: oneOf(raw.sampling, ['jointMulti', 'indepRows', 'indepCols', 'poisson', 'hypergeom'] as const, 'jointMulti'), priorConcentration: num(raw.priorConcentration, 0, 1e4, 1),
  } : null),
  Options: ({ options: o, set, ctx, disabled }) => {
    const d = rawData(ctx);
    if (!d) return <NoData />;
    return (
      <fieldset className="card-options" disabled={disabled}>
        <div className="row2">
          <ColumnSelect id="bc-r" label="Rows" value={o.rows} columns={d.names} exclude={[o.columns, o.counts]} onChange={(rows) => set({ ...o, rows })} />
          <ColumnSelect id="bc-c" label="Columns" value={o.columns} columns={d.names} exclude={[o.rows, o.counts]} onChange={(columns) => set({ ...o, columns })} />
        </div>
        <ColumnSelect id="bc-w" label="Counts (optional)" optional="None: one row per case" value={o.counts} columns={d.names.filter((n) => !d.categories?.[n])} exclude={[o.rows, o.columns]} onChange={(counts) => set({ ...o, counts })} />
        <div className="field"><label htmlFor="bc-s">Sampling plan</label>
          <select id="bc-s" className="select" value={o.sampling} onChange={(e) => set({ ...o, sampling: e.target.value as BContingencyInput['sampling'] })}>
            {SAMPLING.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          </select>
          <div className="hint">{SAMPLING_HINT[o.sampling]} The Bayes factor depends on what the design fixed.</div></div>
        <PriorWidth label="Prior concentration (a)" value={o.priorConcentration} onChange={(priorConcentration) => set({ ...o, priorConcentration })} hint="The Dirichlet prior on the cell probabilities; 1 is JASP’s default." />
      </fieldset>
    );
  },
  View: ({ result: r }) => (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>{SAMPLING.find(([id]) => id === r.sampling)?.[1]} sampling, prior concentration {fmt(r.priorConcentration)}; n = {r.n}; BayesFactor {r.engine.version}.</p>
      <Table title={`${r.rows} × ${r.columns}`} file="bayes-contingency-table" columns={[`${r.rows} \\ ${r.columns}`, ...r.colLevels, 'Total']}
        rows={[...r.rowLevels.map((l, i): Row => [c(l), ...r.counts[i].map((x) => c(x, undefined, 0)), c(r.counts[i].reduce((a, b) => a + b, 0), undefined, 0)]),
          [c('Total'), ...r.colLevels.map((_, j) => c(r.counts.reduce((a, row) => a + row[j], 0), undefined, 0)), c(r.n, undefined, 0)]]} />
      <Table title="Bayesian test of association" file="bayes-contingency" columns={['BF₁₀', 'BF₀₁', 'Evidence', 'Error %']}
        rows={[[...bfCells(r.bf10), c(r.error ? r.error * 100 : null, undefined, 4)]]} note={`H0: the row and column variables are independent; H1: they are associated. ${EVIDENCE_NOTE}`} />
    </div>
  ),
  blocked: (o, ctx) => (!o.rows || !o.columns ? 'Choose the row and the column variables.' : o.rows === o.columns ? 'Choose two different variables.' : missingColumns(ctx, [o.rows, o.columns, o.counts].filter(Boolean), 'Bayesian contingency table')),
  fingerprint: (o, ctx) => columnsFingerprint(ctx, [o.rows, o.columns, o.counts].filter(Boolean), [o.rows, o.columns, o.counts, o.sampling, o.priorConcentration]),
  run: async (o, ctx) => (await engine()).bcontingencyR(rawData(ctx)!, o),
  script: async (o, ctx) => (await engine()).bcontingencyScriptR(rawData(ctx)!, o),
  summary: (o) => `${o.rows || '…'} × ${o.columns || '…'} · ${SAMPLING.find(([id]) => id === o.sampling)?.[1].toLowerCase()}`,
};

export const BAYES_TYPES = [bayesTtestAnalysis, bayesAnovaAnalysis, bayesCorrelationAnalysis, bayesContingencyAnalysis, bayesBinomialAnalysis];
