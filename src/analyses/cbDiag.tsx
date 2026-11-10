// CB-SEM diagnostics of the model on the canvas as analysis cards (lavaan):
// local fit (residual z-tests per pair of observed variables, the SRMR's tests,
// further tests of exact fit).

import { useState } from 'react';
import type { CbEstimator } from '../engine/cbsem';
import { normalP } from '../engine/stats';
import { fmt } from '../format';
import { toSpec } from '../model/project';
import { NEGATIVE_COLOR, POSITIVE_COLOR } from '../figure/palette';
import { clampStrict } from '../parse';
import { c, pCell, Table, type Cell, type Row } from '../components/results/Table';
import type { CbCall } from '../rengine/cbExtras';
import { largestResiduals, LOCALFIT_TESTS, SCALED_TESTS, type LocalFitBlock, type LocalFitResult, type LocalFitTest } from '../rengine/cbDiag';
import { cbFingerprint, cbModelBlocked } from './cbModel';
import { clampNum, isObj, oneOf } from './common';
import type { AnalysisCtx, AnalysisType } from './types';

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

