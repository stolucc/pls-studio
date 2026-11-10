// CB-SEM diagnostics of the model on the canvas as analysis cards (lavaan):
// local fit (residual z-tests per pair of observed variables, the SRMR's tests,
// further tests of exact fit); discriminant validity per Rönkkö & Cho (2022);
// comparing the diagram with a saved alternative (NET, LRT, Vuong, icci).

import { useState } from 'react';
import type { CbEstimator } from '../engine/cbsem';
import { normalP } from '../engine/stats';
import { fmt } from '../format';
import { parseModelState, toSpec, validateModel, type ModelState } from '../model/project';
import { NEGATIVE_COLOR, POSITIVE_COLOR } from '../figure/palette';
import { clampStrict } from '../parse';
import { c, pCell, Table, type Cell, type Row } from '../components/results/Table';
import type { CbCall } from '../rengine/cbExtras';
import { dvClass, dvClassChi2, largestResiduals, LOCALFIT_TESTS, SCALED_TESTS, type CompareModelsResult, type DiscriminantResult, type DvClass, type ModelFit, type Nesting, type LocalFitBlock, type LocalFitResult, type LocalFitTest } from '../rengine/cbDiag';
import { cbFingerprint, cbModelBlocked } from './cbModel';
import { clampNum, columnsFingerprint, isObj, oneOf } from './common';
import { useStore } from '../store';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

const CB_GROUP = 'CB-SEM model' as const;
const callOf = (ctx: AnalysisCtx): CbCall => ({ data: ctx.data!, spec: toSpec(ctx.model!), missing: ctx.settings.missing, estimator: ctx.settings.estimator as CbEstimator, interaction: ctx.settings.interaction });
const Hint = ({ text }: { text: string }) => <p className="hint" style={{ marginTop: 0 }}>{text}</p>;
/** Why the diagnostics cannot use the model's fit (beyond cbModelBlocked); null when they can. */
function fitBlocked(ctx: AnalysisCtx, what: string): string | null {
  const s = ctx.settings;
  if (s.estimator === '2SLS') return `${what} needs a model fitted as a whole; MIIV-2SLS estimates it equation by equation.`;
  if (s.missing === 'mi') return `${what} is not available with multiple imputation; use FIML or casewise deletion.`;
  if (s.estimator === 'RML') return `${what} is not available with robust ML (rsem); choose ML or MLR.`;
  if (ctx.model?.moderations.length && s.interaction !== 'product') return `${what} is not available for LMS / QML models; use product indicators.`;
  if (ctx.model?.multilevel) return `${what} is not available for two-level models.`;
  return null;
}

// ---------- local fit ----------

export interface LocalFitOptions { tests: LocalFitTest[]; base: 'standard' | 'RLS'; top: number }

/** The tests, how the card names them, and where they come from. */
export const TEST_NAMES: Record<LocalFitTest, string> = {
  'browne.residual.nt.model': 'Browne’s residual-based test, normal theory, model-based (RLS)',
  'browne.residual.nt': 'Browne’s residual-based test, normal theory, sample-based',
  'browne.residual.adf': 'Browne’s residual-based test, distribution-free (ADF)',
  'satorra.bentler': 'Satorra–Bentler scaled χ²',
  'yuan.bentler': 'Yuan–Bentler scaled χ²',
  'mean.var.adjusted': 'Mean- and variance-adjusted χ² (Satterthwaite)',
  'scaled.shifted': 'Scaled and shifted χ²',
  'mean.var.adjusted.corrected': 'Mean- and variance-adjusted χ², corrected trace (Hayakawa)',
  'scaled.shifted.corrected': 'Scaled and shifted χ², corrected trace (Hayakawa)',
  peba4: 'pEBA4 p-value (Foldnes, Moss & Grønneberg)',
  pols3: 'pOLS3 p-value (Foldnes, Moss & Grønneberg)',
  pall: 'pALL p-value (Foldnes, Moss & Grønneberg)',
};
const FMG: readonly LocalFitTest[] = ['peba4', 'pols3', 'pall'];
const HAYAKAWA: readonly LocalFitTest[] = ['mean.var.adjusted.corrected', 'scaled.shifted.corrected'];

/** Why a test does not apply to the model and its settings (lavaan's own conditions); null when it may. */
export function localTestProblem(t: LocalFitTest, ctx: AnalysisCtx): string | null {
  const s = ctx.settings, m = ctx.model;
  if (HAYAKAWA.includes(t)) {
    if (s.estimator !== 'ML') return 'needs the ML estimator';
    if (m?.multigroup) return 'is for one group';
    if (m?.ordered?.length) return 'is for continuous indicators';
    if (['fiml', 'twostage', 'robusttwostage', 'pairwise'].includes(s.missing)) return 'needs complete data (casewise deletion)';
  }
  if (FMG.includes(t) && s.estimator !== 'ML' && s.estimator !== 'MLM') return 'needs the ML or MLM estimator';
  if (t.startsWith('browne') && m?.ordered?.length) return 'is for continuous indicators';
  return null;
}

/** A cell shaded by the size of a z (blue positive: the model under-predicts the correlation; red negative: over-predicts). */
export function zShade(z: number | null): string | undefined {
  if (z === null || !Number.isFinite(z) || Math.abs(z) < 1.96) return undefined;
  const a = Math.min(1, (Math.abs(z) - 1.96) / 2.04) * 0.45 + 0.12;
  const hex = z > 0 ? POSITIVE_COLOR : NEGATIVE_COLOR;
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

type Metric = 'z' | 'normalized' | 'residual';
const METRICS: [Metric, string][] = [['z', 'Standardized (z)'], ['normalized', 'Normalized'], ['residual', 'Residual correlation']];

function ResidualMatrix({ b }: { b: LocalFitBlock }) {
  const [metric, setMetric] = useState<Metric>('z');
  const m = metric === 'residual' ? b.residual : metric === 'normalized' ? b.normalized ?? b.z : b.z;
  const rows: Row[] = b.names.map((n, i) => [c(n), ...b.names.map((_, j): Cell => {
    if (j >= i) return c(null, 'dim');
    const v = m[i]?.[j] ?? null, z = b.z[i]?.[j] ?? null;
    return { ...c(v, undefined, metric === 'residual' ? 3 : 2), bg: zShade(metric === 'normalized' ? v : z), bold: z !== null && Math.abs(z) >= 2.58 };
  })]);
  return (
    <>
      <div className="segmented" style={{ marginBottom: 8 }}>
        {METRICS.filter(([id]) => id !== 'normalized' || b.normalized).map(([id, label]) => <button key={id} className={metric === id ? 'on' : ''} onClick={() => setMetric(id)}>{label}</button>)}
      </div>
      <Table title={`Residual ${metric === 'residual' ? 'correlations' : `z-tests (${metric === 'z' ? 'standardized' : 'normalized'})`}${b.label ? `: ${b.label}` : ''}`} file={`cb-localfit-${metric}`} columns={['', ...b.names]} rows={rows}
        note={metric === 'normalized'
          ? 'Normalized residuals: each raw residual over its standard error under normality, ignoring that the model was estimated, so they are smaller than the standardized z (a conservative screen). Shaded where |value| ≥ 1.96.'
          : `${metric === 'z' ? 'z = residual correlation / its standard error (lavaan::lavResiduals, type “cor.bentler”: observed minus model-implied, both scaled by the observed SDs; standard errors from the asymptotic covariance of the sample moments and the model’s estimation).' : 'Observed minus model-implied correlation (Bentler’s scaling, as the SRMR).'} Shaded where |z| ≥ 1.96: blue, the model under-predicts the correlation; red, it over-predicts it; bold where |z| ≥ 2.58.`} />
    </>
  );
}

function Pairs({ b, top }: { b: LocalFitBlock; top: number }) {
  const all = largestResiduals(b);
  const sig = all.filter((p) => Math.abs(p.z) >= 1.96).length, k = all.length;
  const bonf = 0.05 / Math.max(1, k);
  return (
    <Table title={`Largest residuals${b.label ? `: ${b.label}` : ''} (${Math.min(top, k)} of ${k} pairs)`} file="cb-localfit-largest" columns={['Pair', 'Residual correlation', 'SE', 'z', 'p', 'Normalized']}
      rows={all.slice(0, top).map((p): Row => {
        const i = b.names.indexOf(p.b), j = b.names.indexOf(p.a), pz = normalP(p.z);
        return [c(`${p.a} ↔ ${p.b}`), c(p.residual), c(p.se), { ...c(p.z, Math.abs(p.z) >= 1.96 ? 'bad' : 'dim', 2), bg: zShade(p.z) }, { ...pCell(pz), cls: pz < bonf ? 'bad' : pz < 0.05 ? 'warn' : 'dim' }, c(b.normalized?.[i]?.[j] ?? null, undefined, 2)];
      })}
      note={`${sig} of ${k} pairs have |z| ≥ 1.96 (about ${fmt(0.05 * k, 1)} expected by chance at α = .05 if the model held exactly); p below the Bonferroni level ${bonf < 0.001 ? bonf.toExponential(1) : bonf.toFixed(4)} in red. A large residual points to what the model misses between the two variables: a cross-loading, a correlated error or a path. JARS-Quant (Appelbaum et al. 2018; Table 7) asks for this local fit, not only global indices; Kline (2024) on reading residuals in larger models. Positive: the model under-predicts the correlation.`} />
  );
}

function Srmr({ r }: { r: LocalFitResult }) {
  const rows: Row[] = r.blocks.map((b) => { const s = b.summary; return [c(b.label || 'All'), c(s.srmr), c(s.se), c(s.z, undefined, 2), pCell(s.p), c(s.usrmr), c(s.low !== null && s.high !== null ? `[${fmt(s.low)}, ${fmt(s.high)}]` : null), pCell(s.closeP)]; });
  const h0 = r.blocks[0]?.summary.h0 ?? 0.05;
  return (
    <Table title="SRMR: tests of exact and close fit" file="cb-localfit-srmr" columns={['Group', 'SRMR', 'SE', 'z (exact fit)', 'p', 'Unbiased SRMR', '90% CI', `p (close fit, SRMR ≤ ${fmt(h0, 2)})`]} rows={rows}
      note={`Maydeu-Olivares (2017), lavaan::lavResiduals: the sample SRMR is biased upwards, so the test of exact fit (H0: population SRMR = 0) uses its known distribution under exact fit; the unbiased SRMR has a confidence interval and the test of close fit (H0: SRMR ≤ ${fmt(h0, 2)}; a small p rejects close fit).`} />
  );
}

function Tests({ r }: { r: LocalFitResult }) {
  if (!r.tests.length) return <div className="muted">No further tests chosen.</div>;
  const name = (t: string) => (t === 'standard' ? `Standard χ² (${['MLM', 'MLMV', 'MLR'].includes(r.estimator) ? 'ML' : r.estimator})` : TEST_NAMES[t as LocalFitTest] ?? t);
  const rows: Row[] = r.tests.map((t) => [c(name(t.test)), c(t.stat, undefined, 3), c(t.df, undefined, Number.isInteger(t.df) ? 0 : 3), t.p === null ? c(t.error ? 'not available' : null, 'dim') : pCell(t.p), c(t.scaling), c(t.shift),
    c(t.error ?? (t.warning ? `lavaan: ${t.warning}` : SCALED_TESTS.includes(t.test as LocalFitTest) ? `base: ${t.base === 'browne.residual.nt.model' || t.base === 'rls' ? 'Browne’s RLS' : 'ML χ²'}` : ''), t.error ? 'bad' : 'dim')]);
  return (
    <Table title="Tests of exact fit" file="cb-localfit-tests" columns={['Test', 'Statistic', 'df', 'p', 'Scaling factor', 'Shift', 'Note']} rows={rows}
      note={<>Each test on the fitted model (lavaan::lavTest; {r.engine.package} {r.engine.version}). Browne’s residual-based statistics (Browne 1984; the model-based NT version is lavaan’s default beside the ML χ² since 0.7-3) have type I error rates closer to the nominal level than the ML χ². The scaled and adjusted statistics correct for non-normality (Satorra &amp; Bentler 1994; Yuan &amp; Bentler 2000; Asparouhov &amp; Muthén 2010); Hayakawa’s (2019) corrected trace keeps the adjusted tests accurate with many variables relative to N. pEBA, pOLS and pALL (Foldnes &amp; Grønneberg 2018; Foldnes, Moss &amp; Grønneberg 2024) approximate the statistic’s distribution from the eigenvalues of UΓ. The base statistic (ML χ² or Browne’s RLS, which Hayakawa recommends) applies to the scaled, adjusted and FMG tests. A test that does not apply to this model says why.</>} />
  );
}

function MeanResiduals({ b }: { b: LocalFitBlock }) {
  const m = b.means!;
  return (
    <Table title={`Mean residuals${b.label ? `: ${b.label}` : ''}`} file="cb-localfit-means" columns={['Variable', 'Residual', 'SE', 'z', 'p']}
      rows={m.names.map((n, i): Row => { const z = m.z[i]; return [c(n), c(m.residual[i]), c(m.se[i]), { ...c(z, z !== null && Math.abs(z) >= 1.96 ? 'bad' : 'dim', 2), bg: zShade(z) }, pCell(z === null ? null : normalP(z))]; })}
      note="Observed minus model-implied means (Bentler’s scaling), with their z-tests: the mean structure the model imposes (e.g. equal intercepts across groups) and the observed means it misses." />
  );
}

type LocalTab = 'pairs' | 'matrix' | 'tests';
export function LocalFitView({ r, top }: { r: LocalFitResult; top: number }) {
  const [tab, setTab] = useState<LocalTab>('pairs');
  const tabs: [LocalTab, string][] = [['pairs', 'Largest residuals'], ['matrix', 'Residual matrix'], ['tests', 'SRMR and tests of exact fit']];
  return (
    <>
      <div className="segmented efa-tabs" role="tablist" aria-label="Local fit">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <div className="tables">
        {tab === 'pairs' && r.blocks.map((b, i) => <div key={i}><Pairs b={b} top={top} />{b.means && <MeanResiduals b={b} />}</div>)}
        {tab === 'matrix' && r.blocks.map((b, i) => <ResidualMatrix key={i} b={b} />)}
        {tab === 'tests' && <><Srmr r={r} /><Tests r={r} /></>}
        {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
      </div>
    </>
  );
}

const DEFAULT_TESTS: LocalFitTest[] = ['browne.residual.nt.model', 'satorra.bentler'];

export const localFitAnalysis: AnalysisType<LocalFitOptions, LocalFitResult> = {
  id: 'localfit', title: 'Local fit', sub: 'residual z-tests per pair of variables, the SRMR’s tests, Browne’s and corrected tests of exact fit (lavaan)', group: CB_GROUP,
  fitsModel: true,
  display: ['top'],
  defaults: () => ({ tests: DEFAULT_TESTS, base: 'standard', top: 15 }),
  parseOptions: (raw) => (isObj(raw) ? {
    tests: LOCALFIT_TESTS.filter((t) => Array.isArray(raw.tests) && raw.tests.includes(t)),
    base: oneOf(raw.base, ['standard', 'RLS'] as const, 'standard'), top: clampStrict(raw.top, 1, 500, 15, true),
  } : null),
  Options: ({ options: o, set, ctx, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <Hint text={`Where does the model miss? For every pair of observed variables the residual correlation and its z-test, the SRMR with its tests of exact and close fit, and further tests of exact fit. The CB-SEM model on the canvas, estimated with ${ctx.settings.estimator} (Model settings).`} />
      <div className="field">
        <label htmlFor="lf-top">Largest residuals listed</label>
        <input id="lf-top" aria-label="Largest residuals listed" className="input num" type="number" min={1} max={500} value={o.top} onChange={(e) => set({ ...o, top: clampNum(e.target.value, 1, 500, 15, true) })} />
      </div>
      <div className="field">
        <label>Further tests of exact fit (lavaan::lavTest)</label>
        {LOCALFIT_TESTS.map((t) => {
          const why = localTestProblem(t, ctx);
          return (
            <label key={t} className="check" style={{ marginBottom: 4 }} title={why ? `Not for this model: ${why}.` : undefined}>
              <input type="checkbox" checked={o.tests.includes(t)} onChange={(e) => set({ ...o, tests: LOCALFIT_TESTS.filter((x) => (x === t ? e.target.checked : o.tests.includes(x))) })} />
              <span>{TEST_NAMES[t]}{why ? <span className="muted"> ({why})</span> : null}</span>
            </label>
          );
        })}
      </div>
      <div className="field">
        <label>Base statistic of the scaled, adjusted and FMG tests</label>
        <div className="segmented">
          <button className={o.base === 'standard' ? 'on' : ''} onClick={() => set({ ...o, base: 'standard' })}>ML χ²</button>
          <button className={o.base === 'RLS' ? 'on' : ''} onClick={() => set({ ...o, base: 'RLS' })}>Browne’s RLS</button>
        </div>
        <div className="hint">lavTest’s scaled_test. Hayakawa (2019) recommends the RLS statistic with the corrected tests.</div>
      </div>
    </fieldset>
  ),
  View: ({ result, options }) => <LocalFitView r={result} top={options.top} />,
  blocked: (o, ctx) => {
    const m = cbModelBlocked(ctx, 'Local fit', false) ?? fitBlocked(ctx, 'Local fit');
    if (m) return m;
    const bad = o.tests.map((t) => [t, localTestProblem(t, ctx)] as const).filter(([, why]) => why);
    return bad.length ? `${bad.map(([t, why]) => `${TEST_NAMES[t]} ${why}`).join('; ')}: unselect ${bad.length === 1 ? 'it' : 'them'} or change the Model settings.` : null;
  },
  fingerprint: (o, ctx) => cbFingerprint(ctx, [o.tests.join(','), o.base]),
  run: async (o, ctx) => (await import('../rengine/cbDiag')).localFitR(callOf(ctx), { tests: o.tests, base: o.base }),
  script: async (o, ctx) => (await import('../rengine/cbDiag')).localFitScriptR(callOf(ctx), { tests: o.tests, base: o.base }),
  summary: (o) => `residual z-tests${o.tests.length ? `, ${o.tests.length} further test${o.tests.length === 1 ? '' : 's'}${o.base === 'RLS' ? ' (base RLS)' : ''}` : ''}`,
};

// ---------- discriminant validity (Rönkkö & Cho 2022) ----------

export interface DiscriminantOptions { level: number; merge: boolean }

const DV_LABEL: Record<DvClass, [string, string]> = { severe: ['Severe problem', 'bad'], moderate: ['Moderate problem', 'bad'], marginal: ['Marginal problem', 'warn'], none: ['No problem', 'good'] };
const dvCell = (k: DvClass | null): Cell => (k ? { ...c(DV_LABEL[k][0], DV_LABEL[k][1]), bold: k !== 'none' } : c('—', 'dim'));
const lrtCells = (t: { chisq: number | null; df: number | null; p: number | null }): Cell[] => [c(t.chisq, undefined, 2), pCell(t.p)];

export function DiscriminantView({ r }: { r: DiscriminantResult }) {
  if (!r.pairs.length) return <div className="muted">The model has fewer than two correlated factors: nothing to compare.</div>;
  const pct = `${fmt(r.level * 100, 0)}%`;
  const merge = r.pairs.some((p) => p.merge);
  const rows: Row[] = r.pairs.map((p) => [c(`${p.a} ↔ ${p.b}`), c(p.est), c(p.low !== null && p.high !== null ? `[${fmt(p.low)}, ${fmt(p.high)}]` : null), dvCell(dvClass(p.low, p.high)),
    ...lrtCells(p.cut80), ...lrtCells(p.cut90), ...lrtCells(p.cut100), dvCell(dvClassChi2(p)), ...(merge && p.merge ? lrtCells(p.merge) : merge ? [c(null), c(null)] : [])]);
  return (
    <div className="tables">
      <Table title="Discriminant validity: CI-CFA(sys) and χ²(sys)" file="cb-discriminant"
        columns={['Factors', 'Correlation', `${pct} CI`, 'CI-CFA(sys)', 'Δχ² (ρ = .8)', 'p', 'Δχ² (ρ = .9)', 'p', 'Δχ² (ρ = 1)', 'p', 'χ²(sys)', ...(merge ? ['Δχ² (merged)', 'p'] : [])]} rows={rows}
        note={<>Rönkkö &amp; Cho (2022, Table 12): factor correlations from the CFA with factor variances fixed to 1{r.markers ? ' (the model uses markers, so semTools refitted it that way: same fit, the covariances are the correlations)' : ''}. CI-CFA(sys) compares the upper limit of the {pct} CI (the absolute lower limit of a negative correlation) with .8, .9 and 1: below .8 no problem, .8–.9 marginal, .9–1 moderate, 1 or above severe{r.level !== 0.95 ? '; the classification is defined for the 95% CI' : ''}. χ²(sys) fixes each correlation at .8, .9 and 1 in turn (Δχ², 1 df; semTools compares the model with itself where the estimate is already beyond the cutoff): a correlation belongs to the highest class it is not significantly different from (p ≥ .05). {merge ? 'Merged: the two factors as one (χ²(merge)). ' : ''}Marginal: the scales are probably distinct, but acknowledge and discuss the correlation; moderate: check prior evidence before interpreting; severe: the two cannot be distinguished empirically. Fornell–Larcker performs poorly as a test (Rönkkö &amp; Cho 2022). semTools::discriminantValidity, {r.engine.package} {r.engine.version}.</>} />
      {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
    </div>
  );
}

export const discriminantAnalysis: AnalysisType<DiscriminantOptions, DiscriminantResult> = {
  id: 'cbdiscriminant', title: 'Discriminant validity (CI-CFA)', sub: 'factor correlations with CIs and χ²(cut) tests, classified per Rönkkö & Cho (2022) (semTools)', group: CB_GROUP,
  fitsModel: true,
  defaults: () => ({ level: 0.95, merge: false }),
  parseOptions: (raw) => (isObj(raw) ? { level: clampStrict(raw.level, 0.5, 0.999, 0.95), merge: raw.merge === true } : null),
  Options: ({ options: o, set, ctx, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <Hint text={`Are the factors distinct? Each factor correlation with its confidence interval, and χ² difference tests against the model with the correlation fixed at .8, .9 and 1, classified as Rönkkö & Cho (2022) recommend. The CB-SEM model on the canvas, estimated with ${ctx.settings.estimator} (Model settings); with paths, the correlations of endogenous factors are those of their disturbances.`} />
      <div className="field">
        <label htmlFor="dv-level">Confidence level</label>
        <input id="dv-level" aria-label="Confidence level" className="input num" type="number" min={0.5} max={0.999} step={0.01} value={o.level} onChange={(e) => set({ ...o, level: clampNum(e.target.value, 0.5, 0.999, 0.95) })} />
        <div className="hint">The classification uses the 95% CI.</div>
      </div>
      <label className="check"><input type="checkbox" checked={o.merge} onChange={(e) => set({ ...o, merge: e.target.checked })} /> <span>Also test against merging each pair into one factor (χ²(merge))</span></label>
    </fieldset>
  ),
  View: ({ result }) => <DiscriminantView r={result} />,
  blocked: (_o, ctx) => {
    const m = cbModelBlocked(ctx, 'Discriminant validity', false) ?? fitBlocked(ctx, 'Discriminant validity');
    if (m) return m;
    if (ctx.model?.multigroup) return 'Discriminant validity is computed for one group: remove the grouping.';
    if (ctx.model?.constructs.some((k) => k.type === 'composite')) return 'Discriminant validity (CI-CFA) is for common factors; the model has composites.';
    const factors = ctx.model!.constructs.filter((k) => !k.covariate && k.indicators.length > 0);
    return factors.length < 2 ? 'Discriminant validity needs at least two factors.' : null;
  },
  fingerprint: (o, ctx) => cbFingerprint(ctx, [o.level, o.merge ? 1 : 0]),
  run: async (o, ctx) => (await import('../rengine/cbDiag')).discriminantR(callOf(ctx), o),
  script: async (o, ctx) => (await import('../rengine/cbDiag')).discriminantScriptR(callOf(ctx), o),
  summary: (o) => `${fmt(o.level * 100, 0)}% CIs, χ²(sys)${o.merge ? ' and χ²(merge)' : ''}`,
};

// ---------- comparing two models (lavTestNET, lavTestLRT, nonnest2) ----------

/** The alternative: a snapshot of an earlier diagram (strictly re-read from project files by parseModelState). */
export interface CompareModelsOptions { alternative: { model: ModelState; savedAt: number } | null; nested: Nesting }
const NESTINGS: [Nesting, string][] = [['auto', 'From the nesting test'], ['nested', 'Nested'], ['nonnested', 'Non-nested']];

const indicatorSet = (m: ModelState) => [...new Set(m.constructs.flatMap((k) => k.indicators))].sort();
/** Why the two models cannot be compared (beyond the diagram's own problems); null when they can. */
export function compareModelsProblem(o: CompareModelsOptions, ctx: AnalysisCtx): string | null {
  const s = ctx.settings;
  if (!['ML', 'MLR', 'MLM'].includes(s.estimator)) return 'Comparing models needs a maximum-likelihood estimator (ML, MLR or MLM): Vuong’s tests use each case’s log-likelihood.';
  if (ctx.model?.ordered?.length) return 'Comparing models is for continuous indicators (Vuong’s tests need each case’s normal log-likelihood).';
  if (!o.alternative) return 'Save the current model as the alternative, change the diagram, then run.';
  const alt = o.alternative.model;
  if (JSON.stringify(indicatorSet(alt)) !== JSON.stringify(indicatorSet(ctx.model!))) return 'The two models must use the same observed variables (Vuong’s tests compare likelihoods of the same data): add or remove indicators in the diagram, or save the alternative again.';
  if (alt.ordered?.length) return 'The alternative has ordinal indicators: save it again as a model of continuous indicators.';
  const err = validateModel(alt, ctx.data, s).find((i) => i.level === 'error');
  if (err) return `The alternative cannot be fitted with the current data and settings: ${err.message}`;
  if (JSON.stringify(toSpec(alt)) === JSON.stringify(toSpec(ctx.model!))) return 'The diagram is still the alternative: change the diagram first (paths, loadings, covariances, constraints or groups).';
  return null;
}

const yesNo = (v: boolean | null) => (v === null ? c('could not be decided', 'dim') : c(v ? 'yes' : 'no', v ? 'good' : ''));

export function CompareModelsView({ r }: { r: CompareModelsResult }) {
  const f1 = r.fit1, f2 = r.fit2;
  const fitRow = (label: string, k: keyof ModelFit, d = 3, lower = false): Row => {
    const a = f1[k], b = f2[k];
    const better = lower && a !== null && b !== null && a !== b ? (a < b ? 1 : 2) : 0;
    return [c(label), { ...c(a, undefined, d), bold: better === 1 }, { ...c(b, undefined, d), bold: better === 2 }];
  };
  const n = r.net, equalDf = f1.df !== null && f1.df === f2.df;
  const netVerdict = n.error ? `Not available: ${n.error}`
    : equalDf ? (n.nested12 && n.nested21 ? 'Equivalent: the two models imply the same covariances (equal df), so no test can tell them apart.' : n.nested12 === false || n.nested21 === false ? 'Not equivalent, with equal df: neither is nested in the other, so the χ² difference test does not apply; use Vuong’s tests.' : 'Equivalence could not be decided.')
    : n.nested12 ? 'Model 1 is nested in model 2: the χ² difference test applies.' : n.nested21 ? 'Model 2 is nested in model 1: the χ² difference test applies.' : n.nested12 === false && n.nested21 === false ? 'Not nested: the χ² difference test is invalid; use Vuong’s tests and the information criteria.' : 'Nesting could not be decided.';
  const v = r.vuong, ic = r.icci;
  const vuongRows: Row[] = v.error ? [[c('Vuong’s tests'), c('not available', 'dim'), c(null), c(v.error, 'bad')]] : v.nested ? [
    [c('Vuong’s test for nested models (robust LR)'), c(v.stat, undefined, 3), pCell(v.pA), c('a small p: the larger model fits better, without assuming that either model is correct (weighted χ² reference distribution)', 'dim')],
  ] : [
    [c('Distinguishability (variance test, ω²)'), c(v.omega, undefined, 4), pCell(v.pOmega), c(v.pOmega !== null && v.pOmega < 0.05 ? 'distinguishable: go on to the LR test' : 'not distinguishable on these data: the LR test cannot favour either', 'dim')],
    [c('Non-nested LR test: model 1 better'), c(v.stat, undefined, 3), pCell(v.pA), c('H1: model 1 fits better (z of the mean log-likelihood difference)', 'dim')],
    [c('Non-nested LR test: model 2 better'), c(v.stat, undefined, 3), pCell(v.pB), c('H1: model 2 fits better', 'dim')],
  ];
  const ci = (lo: number | null, hi: number | null) => c(lo !== null && hi !== null ? `[${fmt(lo, 2)}, ${fmt(hi, 2)}]` : null);
  return (
    <div className="tables">
      <Table title="Fit of the two models" file="cb-models-fit" columns={['', 'Model 1 (diagram)', 'Model 2 (alternative)']}
        rows={[fitRow('Free parameters', 'npar', 0), fitRow('χ²', 'chisq'), fitRow('df', 'df', 0), fitRow('p', 'pvalue', 4), fitRow('CFI', 'cfi'), fitRow('RMSEA', 'rmsea'), fitRow('SRMR', 'srmr'), fitRow('Log-likelihood', 'logl', 2), fitRow('AIC', 'aic', 2, true), fitRow('BIC', 'bic', 2, true)]}
        note={`Both fitted by lavaan ${r.engine.lavaan ?? ''} to the same ${r.n} cases. Bold: the lower AIC or BIC.`} />
      <Table title="Nesting and equivalence (lavTestNET)" file="cb-models-net" columns={['', 'Nested?', 'F_min', 'Why not checked']}
        rows={n.error ? [[c('NET'), c('not available', 'dim'), c(null), c(n.error, 'bad')]] : [[c('Model 1 within model 2'), yesNo(n.nested12), c(n.fx12, undefined, 8), c(n.reason12 || null, 'dim')], [c('Model 2 within model 1'), yesNo(n.nested21), c(n.fx21, undefined, 8), c(n.reason21 || null, 'dim')]]}
        note={`${netVerdict} Bentler & Satorra (2010): the less restricted model is fitted to the moments the other implies; a minimum of the fit function below ${n.crit ?? 1e-7} means nested in the covariance sense (Asparouhov & Muthén 2019).`} />
      <Table title="Tests" file="cb-models-tests" columns={['Test', 'Statistic', 'p', 'Reading']}
        rows={[
          r.lrt.error ? [c('χ² difference test'), c('not available', 'dim'), c(null), c(r.lrt.error, 'bad')]
            : [c(`χ² difference test (Δdf = ${r.lrt.df ?? '—'})`), c(r.lrt.chisq, undefined, 3), pCell(r.lrt.p), c([r.lrt.method, ...r.lrt.notes].filter(Boolean).join(' ') || 'valid for nested models only', 'dim')],
          ...vuongRows,
          ic.error ? [c('AIC / BIC difference intervals'), c('not available', 'dim'), c(null), c(ic.error, 'bad')] : [c(`AIC difference (1 − 2), ${fmt((ic.level ?? 0.95) * 100, 0)}% CI`), ci(ic.aicLow, ic.aicHigh), c(null), c('an interval excluding 0 favours the model with the lower AIC', 'dim')],
          ...(ic.error ? [] : [[c(`BIC difference (1 − 2), ${fmt((ic.level ?? 0.95) * 100, 0)}% CI`), ci(ic.bicLow, ic.bicHigh), c(null), c('negative: model 1 preferred; for non-nested, distinguishable models only', 'dim')] as Row]),
        ]}
        note={`Merkle, You & Preacher (2016), nonnest2 ${r.engine.version}: for non-nested models first ask whether the data can distinguish them (the variance test); only then does the LR test say which fits better. ${v.nested ? 'The models were treated as nested' : 'The models were treated as non-nested'} (${r.nestedChoice === 'auto' ? 'from the nesting test' : 'as chosen'}). The interval of the BIC difference (icci) is valid for non-nested, distinguishable models. Vuong (1989).${[...v.notes, ...ic.notes].length ? ` R: ${[...new Set([...v.notes, ...ic.notes])].join(' ')}` : ''}`} />
      {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
    </div>
  );
}

function CompareModelsForm({ options: o, set, ctx, disabled }: OptionsProps<CompareModelsOptions>) {
  const save = () => {
    if (!ctx.model) return;
    set({ ...o, alternative: { model: structuredClone(ctx.model), savedAt: Date.now() } });
    useStore.getState().toast('success', 'Saved the model as the alternative. Now change the diagram (Model tab) and run the comparison.');
  };
  const alt = o.alternative;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Hint text={`Compare the diagram (model 1) with an alternative (model 2) on the same observed variables: nesting and equivalence (lavaan::lavTestNET), the χ² difference test, Vuong’s tests for nested and non-nested models and intervals of the AIC and BIC differences (nonnest2). Both estimated with ${ctx.settings.estimator} (Model settings).`} />
      <button className="btn" disabled={!ctx.model?.constructs.length} onClick={save}>Save the current model as the alternative</button>
      <div className="hint" style={{ marginTop: 6 }}>
        {alt ? `Alternative saved: ${alt.model.constructs.length} constructs, ${alt.model.paths.length} paths${alt.model.multigroup ? `, groups by ${alt.model.multigroup.column}` : ''}${alt.savedAt ? ` (${new Date(alt.savedAt).toLocaleString()})` : ''}.` : 'No alternative saved yet: save the model, change the diagram, then compare.'}
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Vuong’s tests treat the models as</label>
        <div className="segmented">
          {NESTINGS.map(([id, label]) => <button key={id} className={o.nested === id ? 'on' : ''} onClick={() => set({ ...o, nested: id })}>{label}</button>)}
        </div>
      </div>
    </fieldset>
  );
}

export const compareModelsAnalysis: AnalysisType<CompareModelsOptions, CompareModelsResult> = {
  id: 'cbmodels', title: 'Model comparison (CB-SEM)', sub: 'nesting and equivalence, χ² difference, Vuong’s tests for nested and non-nested models, AIC/BIC intervals (lavaan, nonnest2)', group: CB_GROUP,
  fitsModel: true,
  defaults: () => ({ alternative: null, nested: 'auto' }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    let alternative: CompareModelsOptions['alternative'] = null;
    if (isObj(raw.alternative)) {
      try { alternative = { model: parseModelState(raw.alternative.model), savedAt: clampStrict(raw.alternative.savedAt, 0, 1e15, 0) }; } catch { alternative = null; }
    }
    return { alternative, nested: oneOf(raw.nested, ['auto', 'nested', 'nonnested'] as const, 'auto') };
  },
  Options: CompareModelsForm,
  View: ({ result }) => <CompareModelsView r={result} />,
  blocked: (o, ctx) => cbModelBlocked(ctx, 'Comparing models') ?? fitBlocked(ctx, 'Comparing models') ?? compareModelsProblem(o, ctx),
  fingerprint: (o, ctx) => {
    const alt = o.alternative?.model, col = alt?.multigroup?.column;
    return cbFingerprint(ctx, [alt ? JSON.stringify(toSpec(alt)) : null, o.nested, col ? columnsFingerprint(ctx, [col]) : null]);
  },
  run: async (o, ctx) => (await import('../rengine/cbDiag')).compareModelsR(callOf(ctx), toSpec(o.alternative!.model), o.nested),
  script: async (o, ctx) => (await import('../rengine/cbDiag')).compareModelsScriptR(callOf(ctx), toSpec(o.alternative!.model), o.nested),
  summary: (o) => (o.alternative ? `diagram vs the alternative saved ${o.alternative.savedAt ? new Date(o.alternative.savedAt).toLocaleDateString() : 'with the example'}` : 'no alternative saved yet'),
};

