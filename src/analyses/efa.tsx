// Exploratory factor analysis and principal component analysis (psych) as an
// analysis card: suitability, number of factors, the rotated solution, and
// constructs built from it.

import { useState } from 'react';
import { fmt } from '../format';
import { congruenceLabel, congruenceMatches, constructsFromSolution, crossLoadings, DEFAULT_EFA, EFA_CRITERIA, EFA_METHODS, EFA_ROTATIONS, kmoLabel, loadingOrder, parseEfaDesign, POLYCHORIC_PARALLEL, switchAnalysis, type EfaComparison, type EfaDesign } from '../model/efa';
import type { EfaResult } from '../rengine/efa';
import { useStore } from '../store';
import { ChartFrame } from '../components/ChartFrame';
import { VariablePicker } from '../components/VariablePicker';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { columnsFingerprint, missingColumns, rawData } from './common';
import type { AnalysisType, OptionsProps } from './types';

export type EfaPreset = Partial<EfaDesign>;
type EfaTab = 'suitability' | 'number' | 'loadings' | 'cross' | 'correlations' | 'variance' | 'fit' | 'congruence';

/** Scree plot: eigenvalues, with parallel analysis's simulated ones and the eigenvalue-1 line. */
function Scree({ r }: { r: EfaResult }) {
  const W = 380, H = 230, pad = { l: 44, r: 12, t: 12, b: 36 };
  const obs = r.parallel?.observed.length ? r.parallel.observed : r.eigenvalues;
  const sim = r.parallel?.simulated ?? [];
  const n = obs.length, top = Math.max(1, ...obs, ...sim) * 1.05, bottom = Math.min(0, ...obs, ...sim);
  const sx = (i: number) => pad.l + (n === 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const sy = (v: number) => pad.t + ((top - v) / (top - bottom || 1)) * (H - pad.t - pad.b);
  const line = (v: number[]) => v.map((y, i) => `${i ? 'L' : 'M'} ${sx(i)} ${sy(y)}`).join(' ');
  const pca = r.method === 'pca';
  return (
    <ChartFrame id="efa:scree" name="scree" width={W} height={H} defaults={{ x: pca ? 'Component' : 'Factor', y: 'Eigenvalue' }}>
      {(labels) => (
        <svg className="mc-chart" width={W} height={H} role="img" aria-label="Scree plot">
          <line x1={pad.l} x2={W - pad.r} y1={sy(1)} y2={sy(1)} stroke="#cbd5e1" strokeDasharray="4 3" />
          {bottom < 0 && <line x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} stroke="#e2e8f0" />}
          {sim.length > 0 && <path d={line(sim)} stroke="#d97706" strokeWidth={1.6} strokeDasharray="5 3" fill="none" />}
          <path d={line(obs)} stroke="#6d28d9" strokeWidth={1.8} fill="none" />
          {obs.map((y, i) => <circle key={i} cx={sx(i)} cy={sy(y)} r={2.8} fill="#6d28d9" />)}
          {obs.map((_, i) => (n <= 15 || i % 2 === 0) && <text key={i} x={sx(i)} y={H - pad.b + 14} textAnchor="middle">{i + 1}</text>)}
          <text x={pad.l - 6} y={sy(top / 1.05) + 4} textAnchor="end">{fmt(top / 1.05, 1)}</text>
          <text x={pad.l - 6} y={sy(1) + 4} textAnchor="end">1</text>
          <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
          <text transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

function EfaView({ r, threshold }: { r: EfaResult; threshold: number }) {
  const [tab, setTab] = useState<EfaTab>('loadings');
  const [residual, setResidual] = useState(false);
  const pca = r.method === 'pca';
  const unit = pca ? 'component' : 'factor';
  const order = loadingOrder(r.loadings);
  const cell = (v: number) => (Math.abs(v) < threshold ? c('', 'dim') : { ...c(v), bold: Math.abs(v) >= 0.5 });
  const rows = (m: number[][], blank = true): Row[] => order.map((i) => [c(r.variables[i]), ...m[i].map((v) => (blank ? cell(v) : c(v))), c(r.communality[i]), c(r.uniqueness[i]), c(r.complexity[i], undefined, 2)]);
  const cross = crossLoadings(r.loadings, threshold);
  const clean = cross.filter((x) => x.flags.length === 0).length;
  const tabs: [EfaTab, string][] = [['suitability', 'Suitability'], ['number', `Number of ${unit}s`], ['loadings', 'Loadings'], ['cross', 'Cross-loadings'], ['correlations', 'Correlations'], ['variance', pca ? 'Components' : 'Factors'], ...(pca ? [] : [['fit', 'Fit'] as [EfaTab, string]]),
    ...(r.congruence ? [['congruence', 'Congruence'] as [EfaTab, string]] : [])];
  const shown = tabs.some(([id]) => id === tab) ? tab : 'loadings';
  const flagText = { 'cross-loads': `cross-loads (≥ ${threshold})`, weak: 'weak (< .40)', close: 'close (gap < .20)' };
  return (
    <>
      <div className="segmented efa-tabs" role="tablist" aria-label="Results">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={shown === id} className={shown === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}{id === 'cross' && cross.length - clean > 0 ? ` (${cross.length - clean})` : ''}
          </button>
        ))}
      </div>
      <div className="tables">
        {shown === 'suitability' && (
          <Table title={`Suitability: KMO ${fmt(r.kmo.overall)} (${kmoLabel(r.kmo.overall)})${r.correlation === 'polychoric' ? ', polychoric correlations' : ''}`} file="efa-suitability" columns={['Measure', 'Value', 'df', 'p']}
            rows={[[c('Kaiser–Meyer–Olkin (overall)'), c(r.kmo.overall), c(''), c('')], [c('Bartlett’s test of sphericity, χ²'), c(r.bartlett.chisq, undefined, 2), c(r.bartlett.df, undefined, 0), pCell(r.bartlett.p)],
              ...r.variables.map((v, i) => [c(`MSA ${v}`), { ...c(r.kmo.items[i]), cls: r.kmo.items[i] < 0.5 ? 'bad' : undefined }, c(''), c('')])]}
            note={`KMO ≥ .6 is usually wanted (Kaiser 1974: .9 marvelous, .8 meritorious, .7 middling, .6 mediocre, .5 miserable); per item (MSA), below .5 suggests dropping it. Bartlett’s test should reject (the correlations are not all zero).`} />
        )}
        {shown === 'number' && (
          <>
            <div className="mc-grid"><Scree r={r} /></div>
            <Table title={`How many ${unit}s`} file="efa-number" columns={['Criterion', 'Suggests']}
              rows={[
                ...(r.parallel ? [[c(`Parallel analysis (Horn 1965; ${r.parallel.iterations} samples)`), c(r.parallel.suggested ?? '–', undefined, 0)]] : []),
                [c('Velicer’s MAP (minimum average partial)'), c(r.map.suggested, undefined, 0)],
                [c('Eigenvalues > 1 (Kaiser; tends to overestimate)'), c(r.kaiser, undefined, 0)],
              ]}
              note={`Purple: eigenvalues of the ${pca ? 'correlation matrix' : 'reduced correlation matrix (factor analysis)'}${r.parallel ? '; dashed amber: the mean eigenvalues of random data of the same size (parallel analysis: keep those above it)' : ''}. Parallel analysis and MAP are the more reliable guides; then judge the solution’s interpretability.`} />
          </>
        )}
        {shown === 'loadings' && (
          <>
            <Table title={`${r.oblique ? 'Pattern matrix' : 'Loadings'}: ${r.k} ${unit}s, ${r.estimator === 'WLSMV' ? 'WLSMV with standard errors (lavaan)' : EFA_METHODS.find((m) => m.id === r.method)?.label.toLowerCase()}, ${r.rotation === 'none' ? 'unrotated' : `${EFA_ROTATIONS.find((x) => x.id === r.rotation)?.label.toLowerCase()} rotation`}`}
              file="efa-loadings" columns={['Variable', ...r.factors, 'h²', 'u²', 'Complexity']} rows={rows(r.loadings)}
              note={`Sorted by the ${unit} each variable loads most on; loadings below ${threshold} are blank, ≥ .5 bold. h²: communality; u²: uniqueness; complexity: Hofmann’s index (1: one ${unit}). The Cross-loadings tab lists every loading.`} />
            {r.se && <Table title="Standard errors of the loadings" file="efa-loadings-se" columns={['Variable', ...r.factors, 'u²']}
              rows={order.map((i) => [c(r.variables[i]), ...r.se!.loadings[i].map((v) => c(v)), c(r.se!.uniqueness[i])])}
              note={`Standard errors of the standardised loadings and uniquenesses (lavaan, delta method${r.estimator === 'WLSMV' ? '; WLSMV, robust' : ''}). A loading more than about twice its standard error differs from 0 at the 5% level.`} />}
            {r.structure && <Table title={`Structure matrix (correlations of variables and ${unit}s)`} file="efa-structure" columns={['Variable', ...r.factors, 'h²', 'u²', 'Complexity']} rows={rows(r.structure)} />}
          </>
        )}
        {shown === 'cross' && (
          <>
            <Table title={`Cross-loadings: ${clean} of ${cross.length} variables load cleanly on one ${unit}`} file="efa-cross-loadings"
              columns={['Variable', `Primary ${unit}`, 'Loading', `Second ${unit}`, 'Loading', 'Difference', 'Check']}
              rows={order.map((i) => cross[i]).map((x) => [
                c(r.variables[x.variable]), c(r.factors[x.primary]), { ...c(x.primaryLoading), bold: Math.abs(x.primaryLoading) >= 0.5 },
                c(x.secondary === null ? '–' : r.factors[x.secondary]), x.secondaryLoading === null ? c('–') : { ...c(x.secondaryLoading), bold: Math.abs(x.secondaryLoading) >= threshold },
                x.gap === null ? c('–') : c(x.gap), x.flags.length ? c(x.flags.map((f) => flagText[f]).join('; '), 'bad') : c('clean', 'good'),
              ])}
              note={`Rules of thumb (e.g. Howard 2016): a variable should load at least .40 on its ${unit}, below ${threshold} on every other, and at least .20 more on its own than on the next. Variables flagged here are candidates for removal or rewording; drop one at a time and recalculate.`} />
            <Table title="All loadings (none hidden)" file="efa-loadings-all" columns={['Variable', ...r.factors, 'h²', 'u²', 'Complexity']} rows={rows(r.loadings, false)} />
          </>
        )}
        {shown === 'correlations' && (() => {
          const m = residual ? r.residuals : r.correlations;
          const big = order.reduce((n, i, a) => n + order.slice(0, a).filter((j) => Math.abs(r.residuals[i][j]) > 0.1).length, 0);
          const pairs = (order.length * (order.length - 1)) / 2;
          // Shading by size: observed correlations in the accent colour; residuals above .10 flagged.
          const shade = (v: number) => `rgba(109, 40, 217, ${Math.min(1, Math.abs(v)) * 0.45})`;
          return (
            <>
              <div className="segmented" style={{ marginBottom: 10, maxWidth: 360 }}>
                <button className={residual ? '' : 'on'} onClick={() => setResidual(false)}>Observed</button>
                <button className={residual ? 'on' : ''} onClick={() => setResidual(true)}>Residual{big ? ` (${big} > .10)` : ''}</button>
              </div>
              <Table title={residual ? `Residual correlations: ${big} of ${pairs} pairs above .10` : r.correlation === 'polychoric' ? 'Polychoric correlations between the variables' : 'Correlations between the variables'} file={residual ? 'efa-residual-correlations' : 'efa-correlations'}
                columns={['', ...order.map((i) => r.variables[i])]}
                rows={order.map((i, a) => [c(r.variables[i]), ...order.map((j, b) => (b > a ? c('') : b === a ? c(residual ? '' : '1', 'dim')
                  : residual ? (Math.abs(m[i][j]) > 0.1 ? { ...c(m[i][j], 'bad'), bold: true } : c(m[i][j], 'dim')) : { ...c(m[i][j]), bg: shade(m[i][j]) }))])}
                note={residual
                  ? `What the ${r.k}-${unit} solution leaves unexplained: observed minus model-implied correlation (ΛΦΛᵀ). Residuals above .10 (bold) point to a missing ${unit}, locally dependent items (similar wording) or a misplaced item.`
                  : `${r.correlation === 'polychoric' ? `Polychoric correlations (psych’s mixedCor): ordinal ${r.ordinal?.length ? r.ordinal.join(', ') : 'none'}${r.ordinal && r.ordinal.length < r.variables.length ? `; continuous (polyserial, Pearson): ${r.variables.filter((v) => !r.ordinal!.includes(v)).join(', ')}` : ''}. ` : ''}Pairwise correlations the analysis starts from, ordered as the loadings table so its blocks show; shading by size. Very high correlations (above about .8) suggest redundant items; variables correlating with nothing will not load.`} />
            </>
          );
        })()}
        {shown === 'variance' && (
          <>
            <Table title="Variance explained" file="efa-variance" columns={['', ...r.factors]}
              rows={[[c('Sum of squared loadings'), ...r.ssLoadings.map((v) => c(v))], [c('Proportion'), ...r.proportion.map((v) => c(v))], [c('Cumulative'), ...r.cumulative.map((v) => c(v))]]} />
            {r.phi && <Table title={`${pca ? 'Component' : 'Factor'} correlations`} file="efa-phi" columns={['', ...r.factors]}
              rows={r.factors.map((f, i) => [c(f), ...r.phi![i].map((v, j) => (j <= i ? c(v) : c('')))])} />}
            {r.phi && r.se?.phi && <Table title="Standard errors of the factor correlations" file="efa-phi-se" columns={['', ...r.factors]}
              rows={r.factors.map((f, i) => [c(f), ...r.se!.phi![i].map((v, j) => (j < i ? c(v) : c('')))])} />}
          </>
        )}
        {shown === 'fit' && !pca && r.comparison && (
          <Table title={`Fit by number of factors (${r.estimator === 'WLSMV' ? 'WLSMV' : 'maximum likelihood'}, lavaan)`} file="efa-fit"
            columns={['Factors', 'Parameters', 'χ²', 'df', 'p', 'RMSEA', '90% CI', 'CFI', 'TLI', 'SRMR', ...(r.estimator === 'WLSMV' ? [] : ['Log-likelihood', 'AIC', 'BIC'])]}
            rows={r.comparison.map((f) => [c(f.k, undefined, 0), c(f.npar ?? null, undefined, 0), c(f.chisq ?? null, undefined, 3), c(f.df ?? null, undefined, 0), pCell(f.p ?? null), c(f.rmsea ?? null),
              c(f.rmseaLow != null && f.rmseaHigh != null ? `${fmt(f.rmseaLow)}–${fmt(f.rmseaHigh)}` : '–'), c(f.cfi ?? null), c(f.tli ?? null), c(f.srmr ?? null),
              ...(r.estimator === 'WLSMV' ? [] : [c(f.logl ?? null, undefined, 3), c(f.aic ?? null, undefined, 3), c(f.bic ?? null, undefined, 3)])])}
            note={`Each number of factors against the saturated model (n = ${r.n})${r.estimator === 'WLSMV' ? '; WLSMV’s scaled and shifted χ², which cannot be differenced directly' : '; with nested numbers of factors the difference in χ² is a likelihood-ratio test'}. RMSEA ≤ .06, CFI and TLI ≥ .95 and SRMR ≤ .08 suggest good fit (Hu & Bentler 1999). As Mplus’s TYPE = EFA.`} />
        )}
        {shown === 'fit' && !pca && !r.comparison && (
          <Table title="Fit of the factor model" file="efa-fit" columns={['χ²', 'df', 'p', 'RMSEA', '90% CI', 'TLI', 'BIC']}
            rows={[[c(r.fit.chisq ?? null, undefined, 2), c(r.fit.df ?? null, undefined, 0), pCell(r.fit.p ?? null), c(r.fit.rmsea ?? null),
              c(r.fit.rmseaLow != null && r.fit.rmseaHigh != null ? `${fmt(r.fit.rmseaLow)}–${fmt(r.fit.rmseaHigh)}` : '–'), c(r.fit.tli ?? null), c(r.fit.bic ?? null, undefined, 1)]]}
            note={`Likelihood-ratio test of the ${r.k}-factor model against the saturated one (psych; n = ${r.n}). RMSEA ≤ .06 and TLI ≥ .95 suggest good fit (Hu & Bentler 1999). χ² rejects easily in large samples.`} />
        )}
        {shown === 'congruence' && r.congruence && <CongruenceTables r={r} unit={unit} />}
        <div className="hint">{r.engine.package === 'lavaan'
          ? `Solution calculated by lavaan ${r.engine.version} (efa(), ${r.estimator ?? 'ML'}, rotation with random starts); suitability and the number of factors by psych.`
          : `Calculated by psych ${r.engine.version} (Revelle)${r.rotation !== 'none' && r.oblique ? ' with GPArotation' : ''}.`}</div>
      </div>
    </>
  );
}


/** A solution's description for table titles: extraction and rotation. */
function solutionName(method: EfaDesign['method'], rotation: EfaDesign['rotation']): string {
  const extraction = EFA_METHODS.find((m) => m.id === method)?.label.toLowerCase() ?? method;
  if (rotation === 'none') return `${extraction}, unrotated`;
  const rot = EFA_ROTATIONS.find((x) => x.id === rotation)?.label.toLowerCase() ?? rotation;
  return `${extraction}, ${rot}`;
}

const CONGRUENCE_SOURCE = 'Lorenzo-Seva, U., & ten Berge, J. M. F. (2006). Tucker’s congruence coefficient as a '
  + 'meaningful index of factor similarity. Methodology, 2(2), 57–64. https://doi.org/10.1027/1614-2241.2.2.57';

/** Cell class by Lorenzo-Seva & ten Berge's thresholds. */
function congruenceClass(phi: number): string | undefined {
  const label = congruenceLabel(phi);
  if (label === 'equal') return 'good';
  if (label === 'not similar') return 'dim';
  return undefined;
}

/** Tucker's congruence coefficients between the solution and the second one, and each factor's best match. */
export function CongruenceTables({ r, unit }: { r: EfaResult; unit: string }) {
  const cg = r.congruence!;
  const first = solutionName(r.method, r.rotation);
  const second = solutionName(cg.method, cg.rotation);
  const matches = congruenceMatches(cg.coefficients);
  const equal = matches.filter((m) => congruenceLabel(m.coefficient) === 'equal' && !m.shared).length;
  const matchRows: Row[] = matches.map((m) => {
    const label = congruenceLabel(m.coefficient);
    return [
      c(r.factors[m.factor]),
      c(cg.factors[m.match]),
      { ...c(m.coefficient), bold: Math.abs(m.coefficient) >= 0.95 },
      m.shared ? c(`${label}; shares its match`, 'bad') : c(label, congruenceClass(m.coefficient)),
    ];
  });
  const matrixRows: Row[] = r.factors.map((f, i) => [
    c(f),
    ...cg.coefficients[i].map((v) => ({ ...c(v, congruenceClass(v)), bold: Math.abs(v) >= 0.95 })),
  ]);
  const loadingRows: Row[] = loadingOrder(cg.loadings).map((i) => [
    c(r.variables[i]),
    ...cg.loadings[i].map((v) => c(v)),
  ]);
  const Unit = `${unit[0].toUpperCase()}${unit.slice(1)}`;
  return (
    <>
      <Table title={`Best matches: ${equal} of ${matches.length} ${unit}s reappear in the second solution`}
        file="efa-congruence-matches"
        columns={[`${Unit} (${first})`, `Match (${second})`, 'Congruence', 'Reading']}
        rows={matchRows}
        note={`Each ${unit}’s most congruent ${unit} in the second solution (largest |φ|; the order and sign of `
          + `${unit}s are arbitrary, so a negative φ is a reflected match). Lorenzo-Seva & ten Berge (2006): `
          + '|φ| ≥ .95, the factors can be considered equal; .85–.94, fair similarity; below .85, not similar. '
          + `Source: ${CONGRUENCE_SOURCE}.`} />
      <Table title={`Tucker’s congruence coefficients: ${first} (rows) and ${second} (columns)`}
        file="efa-congruence" columns={['', ...cg.factors]} rows={matrixRows}
        note={'φ = Σ xᵢyᵢ / √(Σ xᵢ² Σ yᵢ²) over the two factors’ loadings (psych::factor.congruence); '
          + 'bold: ≥ .95. It compares the pattern of the loadings, not their size, and is not a significance test.'} />
      <Table title={`Loadings of the second solution: ${second}`} file="efa-congruence-loadings"
        columns={['Variable', ...cg.factors]} rows={loadingRows} />
    </>
  );
}

/** Add one construct per factor, with the variables loading most on it, to the diagram. */
function BuildModel({ r, threshold }: { r: EfaResult; threshold: number }) {
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const build = () => {
    const s = constructsFromSolution(r, threshold);
    const st = useStore.getState();
    if (!s.constructs.length) { st.toast('error', `No loading reaches ${threshold}: lower the threshold.`); return; }
    st.addFactors(s.constructs.map((k) => k.indicators), s.correlated, s.constructs.map((k) => k.name));
    st.layout();
    st.toast('success', `Added ${s.constructs.length} construct${s.constructs.length > 1 ? 's' : ''} to the diagram (Model tab), each with the variables loading most on it (≥ ${threshold})${s.correlated ? ', correlated (oblique solution)' : ''}.${s.left.length ? ` Left out: ${s.left.join(', ')}.` : ''} For a confirmatory factor analysis, choose CB-SEM.`);
  };
  return <button className="btn sm" disabled={readOnly} onClick={build} title="Add one construct per factor, with the variables loading most on it, to the diagram">Build model from this solution</button>;
}

/** The rotations a comparison can use: psych's (not lavaan's bifactor ones). */
const COMPARE_ROTATIONS = EFA_ROTATIONS.filter((m) => !m.lavaan);

/** The second solution of a congruence comparison: none, or a psych extraction and rotation. */
function CompareFields({ d, setDesign, unit }: {
  d: EfaDesign;
  setDesign: (p: Partial<EfaDesign>) => void;
  unit: string;
}) {
  const cmp = d.compare;
  const setMethod = (value: string) => {
    if (value === '') {
      setDesign({ compare: undefined });
      return;
    }
    const method = value as EfaComparison['method'];
    // A new comparison starts from the solution's own rotation.
    const own = COMPARE_ROTATIONS.find((m) => m.id === d.rotation)?.id as EfaComparison['rotation'] | undefined;
    setDesign({ compare: { method, rotation: cmp?.rotation ?? own ?? 'varimax' } });
  };
  const setRotation = (value: string) => {
    if (!cmp) return;
    setDesign({ compare: { ...cmp, rotation: value as EfaComparison['rotation'] } });
  };
  return (
    <div className="row2">
      <div className="field"><label htmlFor="efa-cmp">Compare with (congruence)</label>
        <select id="efa-cmp" className="select" value={cmp?.method ?? ''} onChange={(e) => setMethod(e.target.value)}>
          <option value="">No comparison</option>
          {EFA_METHODS.filter((m) => m.id !== 'lavaan').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <div className="hint">A second solution with the same number of {unit}, compared one by one with
          Tucker’s congruence coefficient (psych::factor.congruence): does the structure survive another
          extraction or rotation?</div></div>
      {cmp && (
        <div className="field"><label htmlFor="efa-cmp-rot">Its rotation</label>
          <select id="efa-cmp-rot" className="select" value={cmp.rotation} onChange={(e) => setRotation(e.target.value)}>
            {COMPARE_ROTATIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select></div>
      )}
    </div>
  );
}

function EfaOptionsForm({ options: d, set, ctx, disabled }: OptionsProps<EfaDesign>) {
  // Switching back from PCA to factor analysis restores the extraction chosen before.
  const [lastExtraction, setLastExtraction] = useState<Exclude<EfaDesign['method'], 'pca'>>(d.method === 'pca' ? 'minres' : d.method);
  const ds = rawData(ctx);
  if (!ds) return <div className="empty-results">Import raw data first.</div>;
  const columns = ds.names;
  const indicators = (ctx.model?.constructs ?? []).flatMap((k) => k.indicators).filter((v) => columns.includes(v));
  const setDesign = (p: Partial<EfaDesign>) => { if (p.method && p.method !== 'pca') setLastExtraction(p.method); set({ ...d, ...p }); };
  const vars = d.vars.filter((v) => columns.includes(v));
  const maxK = Math.max(1, vars.length - 1);
  const oblique = EFA_ROTATIONS.find((x) => x.id === d.rotation)?.oblique;
  const unit = d.method === 'pca' ? 'components' : 'factors';
  return (
    <fieldset className="card-options" disabled={disabled}>
      <VariablePicker columns={columns} value={vars} onChange={(v) => setDesign({ vars: columns.filter((x) => v.includes(x)), nfactors: Math.min(d.nfactors, Math.max(1, v.length - 1)) })} />
      {indicators.length >= 3 && <button className="btn sm ghost" onClick={() => setDesign({ vars: indicators })}>Use the model’s indicators ({indicators.length})</button>}
      <div className="field">
        <label>Analysis</label>
        <div className="segmented" role="radiogroup" aria-label="Analysis">
          <button role="radio" aria-checked={d.method !== 'pca'} className={d.method !== 'pca' ? 'on' : ''} onClick={() => set(switchAnalysis(d, false, lastExtraction))}>Factor analysis</button>
          <button role="radio" aria-checked={d.method === 'pca'} className={d.method === 'pca' ? 'on' : ''} onClick={() => set(switchAnalysis(d, true))}>Principal components</button>
        </div>
      </div>
      {d.method !== 'pca' && (
        <div className="field">
          <label htmlFor="efa-ext">Extraction</label>
          <select id="efa-ext" className="select" value={d.method} onChange={(e) => setDesign({ method: e.target.value as EfaDesign['method'] })}>
            {EFA_METHODS.filter((m) => m.id !== 'pca').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      )}
      <div className="row2">
        <div className="field"><label htmlFor="efa-crit">Number of {unit}</label>
          <select id="efa-crit" className="select" value={d.criterion} onChange={(e) => setDesign({ criterion: e.target.value as EfaDesign['criterion'] })}>
            {EFA_CRITERIA.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select></div>
        {d.criterion === 'fixed' && (
          <div className="field"><label htmlFor="efa-k">{d.method === 'pca' ? 'Components' : 'Factors'}</label>
            <input id="efa-k" className="input num" type="number" min={1} max={maxK} value={d.nfactors} onChange={(e) => setDesign({ nfactors: Math.max(1, Math.min(maxK, Math.round(Number(e.target.value)) || 1)) })} /></div>
        )}
      </div>
      <div className="row2">
        <div className="field"><label htmlFor="efa-rot">Rotation</label>
          <select id="efa-rot" className="select" value={d.rotation} onChange={(e) => setDesign({ rotation: e.target.value as EfaDesign['rotation'] })}>
            {EFA_ROTATIONS.filter((m) => !m.lavaan || d.method === 'lavaan' || m.id === d.rotation).map((m) => <option key={m.id} value={m.id}>{m.label}{m.id === 'none' ? '' : m.oblique ? ' (oblique)' : ' (orthogonal)'}</option>)}
          </select></div>
        <div className="field"><label htmlFor="efa-par">Parallel analysis samples</label>
          <input id="efa-par" className="input num" type="number" min={0} max={2000} value={d.parallel} onChange={(e) => setDesign({ parallel: Math.max(0, Math.min(2000, Math.round(Number(e.target.value)) || 0)) })} /></div>
      </div>
      {d.method === 'lavaan' && (
        <div className="row2">
          {(d.rotation === 'geominQ' || d.rotation === 'bigeomin') && (
            <div className="field"><label htmlFor="efa-eps">Geomin ε</label>
              <input id="efa-eps" className="input num" type="number" min={0.00001} max={1} step={0.0001} value={d.epsilon ?? 0.001}
                onChange={(e) => { const v = Number(e.target.value); setDesign({ epsilon: v > 0 && v <= 1 ? v : undefined }); }} />
              <div className="hint">lavaan’s default 0.001; Mplus uses 0.0001 with two factors, 0.001 with three, 0.01 with four or more.</div></div>
          )}
          <div className="field"><label htmlFor="efa-from">Compare fit from</label>
            <input id="efa-from" className="input num" type="number" min={1} max={maxK} value={d.from ?? 1} onChange={(e) => setDesign({ from: Math.max(1, Math.min(maxK, Math.round(Number(e.target.value)) || 1)) })} />
            <div className="hint">The fit of every number of {unit} from this one to the solution’s (Mplus: TYPE = EFA 1 4).</div></div>
          {d.correlation !== 'polychoric' && (
            <div className="field"><label htmlFor="efa-info">Standard errors</label>
              <select id="efa-info" className="select" value={d.information ?? 'expected'} onChange={(e) => setDesign({ information: e.target.value === 'observed' ? 'observed' : undefined })}>
                <option value="expected">Expected information (lavaan)</option><option value="observed">Observed information (Mplus)</option>
              </select></div>
          )}
          {d.correlation === 'polychoric' && (
            <div className="field"><label htmlFor="efa-wlsmv-se">Standard errors</label>
              <select id="efa-wlsmv-se" className="select" value={d.wlsmvSe ?? 'mplus'} onChange={(e) => setDesign({ wlsmvSe: e.target.value === 'lavaan' ? 'lavaan' : undefined })}>
                <option value="mplus">Mplus / classic WLSMV (default)</option><option value="lavaan">lavaan 0.7 (observed information in the sandwich)</option>
              </select>
              <div className="hint">Mplus’s WLSMV puts the expected information in the sandwich and divides by N; lavaan 0.7 puts the observed information there, which for rotated solutions gives standard errors up to several times larger.</div></div>
          )}
          {d.correlation === 'polychoric' && (
            <label className="check"><input type="checkbox" checked={d.mimic === 'Mplus'} onChange={(e) => setDesign({ mimic: e.target.checked ? 'Mplus' : undefined })} />
              <span>Test statistic as Mplus<br /><span className="hint">lavaan’s mimic = “Mplus”: the mean- and variance-adjusted χ² Mplus prints (lavaan’s own differs slightly).</span></span></label>
          )}
        </div>
      )}
      {d.method !== 'lavaan' && <CompareFields d={d} setDesign={setDesign} unit={unit} />}
      <div className="field"><label htmlFor="efa-thr">Hide loadings below</label>
        <input id="efa-thr" className="input num" type="number" min={0} max={0.95} step={0.05} value={d.threshold} onChange={(e) => setDesign({ threshold: Math.max(0, Math.min(0.95, Number(e.target.value) || 0)) })} />
        <div className="hint">Changes the tables and Build model only; no need to run again.</div></div>
      <div className="field">
        <label>Correlations</label>
        <div className="segmented" role="radiogroup" aria-label="Correlations">
          <button role="radio" aria-checked={d.correlation !== 'polychoric'} className={d.correlation !== 'polychoric' ? 'on' : ''} onClick={() => setDesign({ correlation: 'pearson' })}>Pearson</button>
          <button role="radio" aria-checked={d.correlation === 'polychoric'} className={d.correlation === 'polychoric' ? 'on' : ''}
            onClick={() => setDesign({ correlation: 'polychoric', ...(d.parallel > POLYCHORIC_PARALLEL ? { parallel: POLYCHORIC_PARALLEL } : {}) })}>Polychoric</button>
        </div>
        <div className="hint">{d.correlation === 'polychoric'
          ? `For ordinal (Likert) items: the correlations of the continuous responses assumed to underlie the categories (psych’s mixedCor). Items with at most 8 categories are treated as ordinal (tetrachoric when binary), others as continuous (polyserial, Pearson). Pearson correlations of such items are too low, the more so with few or skewed categories, which lowers loadings and can split items by their popularity. Each parallel-analysis sample recomputes the polychoric correlations, so the samples are slow (about a second each for 25 items): set to ${POLYCHORIC_PARALLEL} when chosen.`
          : 'Pearson correlations treat the values as continuous. For ordinal (Likert) items with few or skewed categories choose polychoric.'}
          {d.method === 'lavaan' ? (d.correlation === 'polychoric' ? ' lavaan estimates the solution by WLSMV from the polychoric correlations of the ordinal items.' : ' lavaan estimates the solution by maximum likelihood; with pairwise missing values, by full-information ML.') : ''}</div>
      </div>
      <div className="field">
        <label>Missing values</label>
        <div className="segmented">
          <button className={d.missing === 'pairwise' ? 'on' : ''} onClick={() => setDesign({ missing: 'pairwise' })}>Pairwise</button>
          <button className={d.missing === 'listwise' ? 'on' : ''} onClick={() => setDesign({ missing: 'listwise' })}>Listwise</button>
        </div>
      </div>
      <p className="hint">{d.method === 'pca'
        ? 'PCA summarises the variables in components that explain as much of their variance as possible; it is a data reduction, not a model of latent factors.'
        : `Factor analysis models common factors behind the variables (shared variance only); use it to explore a measurement structure before a CFA.${d.method === 'lavaan' ? ' The lavaan extraction adds standard errors of the rotated loadings and factor correlations and the fit of each number of factors (as Mplus’s TYPE = EFA).' : ''}`}
        {oblique ? ` An oblique rotation lets the ${unit} correlate, which is usual for psychological constructs.` : ''}</p>
    </fieldset>
  );
}

/** The variables the design uses that are in the data. */
const usedVars = (d: EfaDesign, names: string[]) => d.vars.filter((v) => names.includes(v));

export const efaAnalysis: AnalysisType<EfaDesign, EfaResult> = {
  id: 'efa',
  title: 'Exploratory factor analysis',
  sub: 'EFA: parallel analysis, rotations, cross-loadings (psych)',
  entries: [
    { title: 'Exploratory factor analysis', sub: 'EFA: parallel analysis, rotations, cross-loadings (psych)', options: (d) => switchAnalysis(d, false) },
    { title: 'Principal component analysis', sub: 'PCA: components, rotations (psych)', options: (d) => switchAnalysis(d, true) },
  ],
  cardTitle: (d) => (d.method === 'pca' ? 'Principal component analysis' : 'Exploratory factor analysis'),
  group: 'Measurement',
  display: ['threshold'],
  // Projects from before the Analyses tab kept the design in their settings: start from it.
  defaults: (ctx) => ({ ...(ctx.settings.efa ?? DEFAULT_EFA) }),
  parseOptions: (raw) => parseEfaDesign(raw) ?? null,
  Options: EfaOptionsForm,
  View: ({ result, options }) => (
    <>
      <EfaView r={result} threshold={options.threshold} />
      <div><BuildModel r={result} threshold={options.threshold} /></div>
    </>
  ),
  blocked: (d, ctx) => {
    const ds = rawData(ctx);
    if (!ds) return missingColumns(ctx, [], d.method === 'pca' ? 'PCA' : 'Factor analysis');
    const vars = usedVars(d, ds.names);
    if (vars.length < 3) return 'Choose at least three variables.';
    if (d.criterion === 'fixed' && d.nfactors >= vars.length) return `Choose fewer ${d.method === 'pca' ? 'components' : 'factors'} than variables.`;
    if (d.criterion === 'parallel' && d.parallel <= 0) return 'Parallel analysis needs samples.';
    if (d.compare && d.method === 'lavaan') {
      return 'The congruence comparison needs a psych extraction for the solution: choose another extraction or no comparison.';
    }
    if (EFA_ROTATIONS.find((x) => x.id === d.rotation)?.lavaan) {
      if (d.method !== 'lavaan') return 'Bifactor rotations need the lavaan extraction (maximum likelihood with standard errors).';
      if ((d.from ?? 1) < 2 || (d.criterion === 'fixed' && d.nfactors < 2)) return 'A bifactor rotation needs at least two factors (a general and a specific one): compare fit from 2.';
    }
    return null;
  },
  fingerprint: (d, ctx) => {
    const ds = rawData(ctx);
    return ds ? columnsFingerprint(ctx, usedVars(d, ds.names), [ctx.settings.seed]) : null;
  },
  run: async (d, ctx) => (await import('../rengine/efa')).efaR(rawData(ctx)!, { ...d, vars: usedVars(d, rawData(ctx)!.names) }, ctx.settings.seed),
  script: async (d, ctx) => (await import('../rengine/efa')).efaScriptR(rawData(ctx)!, { ...d, vars: usedVars(d, rawData(ctx)!.names) }, ctx.settings.seed),
  summary: (d) => `${d.vars.length} variables · ${d.criterion === 'fixed' ? `${d.nfactors} ${d.method === 'pca' ? 'components' : 'factors'}` : EFA_CRITERIA.find((x) => x.id === d.criterion)?.label.toLowerCase()} · ${EFA_ROTATIONS.find((x) => x.id === d.rotation)?.label.toLowerCase()}`,
};
