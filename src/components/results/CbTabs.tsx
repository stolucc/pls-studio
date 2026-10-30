import type { CbEstimate, CbResult } from '../../engine/cbsem';
import type { BootstrapResult } from '../../engine/types';
import { fmt, fmtP, stars } from '../../format';
import { useState } from 'react';
import { johnsonNeyman } from '../../engine/jn';
import { mcIndirect, type McIndirect } from '../../engine/mcci';
import { JohnsonNeymanPlot } from '../JohnsonNeymanPlot';
import { BootstrapTab } from './PlsTabs';
import { bootCells, bootCols, c, htmtCls, matrixRows, pCell, Table, type Row } from './Table';
import { runInvariance } from '../../runner';
import { useFreshResults, useStore } from '../../store';
import { RScriptButton } from './RScriptButton';
import { SaveFactorScores } from './SaveScores';

export const CB_TABS = [
  { id: 'fit', label: 'Model fit' },
  { id: 'paths', label: 'Regressions' },
  { id: 'loadings', label: 'Loadings' },
  { id: 'variances', label: 'Variances & covariances' },
  { id: 'effects', label: 'Indirect & total effects' },
  { id: 'defined', label: 'Defined & Wald tests' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'discriminant', label: 'Discriminant validity' },
  { id: 'residuals', label: 'Residuals' },
  { id: 'modindices', label: 'Modification indices' },
  { id: 'invariance', label: 'Measurement invariance' },
  { id: 'bootstrap', label: 'Bootstrapping' },
] as const;
export type CbTabId = (typeof CB_TABS)[number]['id'];

const estRow = (e: CbEstimate, label: string): Row =>
  [c(label), c(e.est), c(e.se), c(e.z), pCell(e.p), c(e.std)];
const estCols = (cb: CbResult) => ['Estimate', cb.estimator === 'MLM' || cb.estimator === 'MLMV' || cb.estimator === 'MLR' || cb.estimator === 'RML' ? 'Robust SE' : 'Std. error', 'z', 'p', 'Standardised'];

/** Robust ML (rsem): the cases it down-weights most. */
function CaseWeights({ w }: { w: NonNullable<CbResult['caseWeights']> }) {
  const low = w.rows.map((row, i) => ({ row, w: w.weights[i] })).filter((x) => x.w < 1).sort((a, b) => a.w - b.w);
  return (
    <Table title={`Down-weighted cases: ${low.length} of ${w.rows.length}`} file="cb-case-weights" columns={['Row', 'Weight']}
      rows={low.slice(0, 20).map((x) => [c(x.row, undefined, 0), c(x.w, x.w < 0.5 ? 'bad' : x.w < 0.8 ? 'warn' : '')])}
      note={`Huber-type case weights (rsem, varphi = 0.1): 1 = full weight; the lower, the more atypical the case.${low.length > 20 ? ' The 20 lowest are shown.' : ''}`} />
  );
}

function Fit({ cb }: { cb: CbResult }) {
  const f = cb.fit;
  const card = (k: string, v: string, cls?: string) => (
    <div className="stat-card"><div className="k">{k}</div><div className="v" style={cls ? { color: `var(--${cls})` } : undefined}>{v}</div></div>
  );
  const ok = (good: boolean) => (good ? 'good' : 'warn');
  const robust = f.chisqScaled !== undefined;
  // Robust ML (rsem) rescales χ² (TRML) but has no robust CFI / TLI / RMSEA: those are ML's on the robust moments.
  const robustIdx = robust && f.cfiRobust !== undefined;
  const pv = robust ? f.pvalueScaled : f.pvalue;
  const cfi = robustIdx ? f.cfiRobust! : f.cfi, tli = robustIdx ? f.tliRobust! : f.tli, rmsea = robustIdx ? f.rmseaRobust! : f.rmsea;
  const rml = cb.estimator === 'RML';
  const ml = cb.estimator !== 'GLS' && cb.estimator !== 'ULS';
  const rows: Row[] = [
    [c('Estimator'), c(cb.estimator), c(null)],
    [c('Observations'), c(String(cb.n)), c(null)],
    ...(cb.imputations ? [[c('Imputed data sets'), c(String(cb.imputations)), c('pooled (Rubin)')]] : []),
    [c('Free parameters'), c(String(f.npar)), c(null)],
    [c('Iterations'), c(String(cb.iterations)), c(null)],
    [c('χ²'), c(f.chisq), c(f.chisqScaled ?? null)],
    [c('df'), c(String(f.df)), c(f.dfScaled !== undefined ? String(f.dfScaled) : null)],
    [c('p'), c(Number.isNaN(f.pvalue) ? null : f.pvalue, '', 4), c(f.pvalueScaled ?? null, '', 4)],
    [c('Scaling factor'), c(null), c(f.scalingFactor ?? null)],
    ...(f.shiftParameter !== undefined ? [[c('Shift parameter'), c(null), c(f.shiftParameter)]] : []),
    [c('χ² (baseline)'), c(f.baselineChisq), c(f.baselineChisqScaled ?? null)],
    [c('df (baseline)'), c(String(f.baselineDf)), c(null)],
    [c('CFI'), c(f.cfi), c(f.cfiRobust ?? null)],
    [c('TLI'), c(f.tli), c(f.tliRobust ?? null)],
    [c('RMSEA'), c(f.rmsea), c(f.rmseaRobust ?? null)],
    [c('RMSEA 90% CI'), c(`[${fmt(f.rmseaLow)}, ${fmt(f.rmseaHigh)}]`), c(null)],
    [c('p (RMSEA ≤ .05)'), c(f.rmseaP), c(null)],
    ...(robustIdx ? [[c('CFI / TLI (scaled)'), c(null), c(`${fmt(f.cfiScaled)} / ${fmt(f.tliScaled)}`)], [c('RMSEA (scaled)'), c(null), c(f.rmseaScaled ?? null)]] : []),
    [c('SRMR'), c(f.srmr), c(null)],
    ...(ml ? [[c('Log-likelihood'), c(f.logl, '', 2), c(null)], [c('AIC'), c(f.aic, '', 2), c(null)], [c('BIC'), c(f.bic, '', 2), c(null)]] : []),
  ];
  return (
    <>
      {cb.interaction && (
        <div className="issue warning" style={{ marginBottom: 10 }}>
          Latent interactions estimated by {cb.interaction.toUpperCase()} (modsem): there is no χ² test for a model with latent interactions. The fit statistics below are those of the same model without the interaction terms; judge the interaction by its estimate, standard error and the change in log-likelihood (Klein &amp; Moosbrugger, 2000).
        </div>
      )}
      <div className="stat-cards">
        {card(rml ? 'χ² (TRML)' : robust ? 'χ² (scaled)' : 'χ²', `${fmt(robust ? f.chisqScaled : f.chisq, 2)}`)}
        {card('df', String(f.df))}
        {card('p', pv === undefined || Number.isNaN(pv) ? '—' : pv < 0.001 ? '<0.001' : fmt(pv))}
        {card(robustIdx ? 'CFI (robust)' : 'CFI', fmt(cfi), ok(cfi >= 0.95))}
        {card(robustIdx ? 'TLI (robust)' : 'TLI', fmt(tli), ok(tli >= 0.95))}
        {card(robustIdx ? 'RMSEA (robust)' : 'RMSEA', fmt(rmsea), ok(rmsea <= 0.06))}
        {card('SRMR', fmt(f.srmr), ok(f.srmr <= 0.08))}
      </div>
      {!rml && !cb.imputations && <SaveFactorScores />}
      <div className="tables">
        <Table title="Fit statistics" file="cb-fit" columns={['Statistic', 'Standard', robust ? 'Robust / scaled' : '']} rows={rows}
          note={<>Hu &amp; Bentler (1999) cutoffs: CFI/TLI ≥ 0.95, RMSEA ≤ 0.06, SRMR ≤ 0.08.{robustIdx && ' Robust CFI/TLI/RMSEA follow Brosseau-Liard & Savalei and estimate the population values; the scaled versions apply the correction to the statistic only.'}{rml && ' Robust ML (rsem; Yuan & Zhang 2012): the model is fitted to Huber-weighted means and covariances; χ² (scaled) is the rescaled statistic TRML; CFI, TLI and RMSEA are those of the fit to the robust moments.'} Validated against lavaan.</>} />
        {cb.caseWeights && <CaseWeights w={cb.caseWeights} />}
        {cb.groups?.levels && cb.groups.icc && (
          <Table title="Intraclass correlations" file="cb-icc" columns={['Variable', 'ICC']}
            rows={Object.entries(cb.groups.icc).map(([k, v]) => [c(k), c(v)])}
            note="Share of each variable’s variance that lies between clusters. Values above about .05 make a two-level model worthwhile." />
        )}
        {cb.warnings.length > 0 && (
          <div>{cb.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>
        )}
      </div>
    </>
  );
}

function Paths({ cb, boot }: { cb: CbResult; boot: BootstrapResult | null }) {
  const regs = cb.estimates.filter((e) => e.op === '~');
  return (
    <div className="tables">
      <Table title="Regressions" file="cb-regressions" columns={['Path', ...estCols(cb)]}
        rows={regs.map((e) => estRow(e, `${e.rhs} → ${e.lhs}`))}
        note={`${cb.estimator} estimates; standardised = std.all.${cb.estimator === 'ULS' ? ' ULS standard errors are not robust to misspecification or non-normality; prefer bootstrap intervals.' : ''}`} />
      <Table title="R²" file="cb-r2" columns={['Construct', 'R²']}
        rows={cb.constructs.map((n, j) => ({ n, v: cb.r2Constructs[j] })).filter((x) => x.v !== null).map((x) => [c(x.n), c(x.v)])} />
      {boot && (
        <Table title="Bootstrapped standardised paths" file="cb-boot-paths" columns={['Path', 'Original', ...bootCols(boot)]}
          rows={boot.stats.filter((s) => s.group === 'path').map((s) => [c(s.label), c(s.original), ...bootCells(s)])} />
      )}
    </div>
  );
}

function Loadings({ cb }: { cb: CbResult }) {
  const rows = cb.estimates.filter((e) => e.op === '=~').map((e) => {
    const k = cb.indicators.findIndex((i) => i.name === e.rhs);
    const row = estRow(e, `${e.lhs} → ${e.rhs}`);
    row[5] = c(e.std, Math.abs(e.std) >= 0.708 ? 'good' : Math.abs(e.std) >= 0.4 ? 'warn' : 'bad');
    return [...row, c(cb.r2Indicators[k])];
  });
  return (
    <Table title="Factor loadings" file="cb-loadings" columns={['Loading', ...estCols(cb), 'Indicator R²']} rows={rows}
      note="The first indicator of each factor is the marker (loading fixed to 1, no standard error)." />
  );
}

function Variances({ cb }: { cb: CbResult }) {
  const vv = cb.estimates.filter((e) => e.op === '~~');
  const lv = new Set(cb.constructs);
  // Endogenous constructs enter (co)variances through their disturbances.
  const z = (name: string) => (cb.r2Constructs[cb.constructs.indexOf(name)] != null ? `ζ ${name}` : name);
  return (
    <div className="tables">
      <Table title="Factor (co)variances and disturbances" file="cb-lv-cov" columns={['Parameter', ...estCols(cb)]}
        rows={vv.filter((e) => e.kind === 'lvcov' || e.kind === 'fixed' || (lv.has(e.lhs) && e.kind !== 'residual' && e.kind !== 'rescov')).map((e) => estRow(e, e.lhs === e.rhs ? z(e.lhs) : `${z(e.lhs)} ↔ ${z(e.rhs)}`))}
        note="For endogenous factors the variance is the disturbance (residual) variance, and a covariance between two endogenous factors is the covariance of their disturbances (standardised: their correlation)." />
      <Table title="Indicator error variances and covariances" file="cb-residuals" columns={['Indicator', ...estCols(cb)]}
        rows={vv.filter((e) => e.kind === 'residual' || e.kind === 'rescov').map((e) => estRow(e, e.lhs === e.rhs ? e.lhs : `${e.lhs} ↔ ${e.rhs}`))}
        note="Standardised error variance = 1 − indicator R²; standardised error covariance = error correlation. Single-indicator factors have their error variance fixed to 0, or, with a known reliability, at (1 − reliability) × the indicator’s variance (shown without a standard error)." />
      {cb.estimates.some((e) => e.kind === 'mean') && (
        <Table title="Latent means" file="cb-latent-means" columns={['Factor', ...estCols(cb)]}
          rows={cb.estimates.filter((e) => e.kind === 'mean').map((e) => estRow(e, e.lhs))}
          note="Under scalar invariance the latent means of the first group are fixed to 0; in the other groups they are the differences from it, in the factors’ units." />
      )}
      {cb.estimates.some((e) => e.kind === 'threshold') && (
        <Table title="Thresholds of the ordinal indicators" file="cb-thresholds" columns={['Indicator', 'Threshold', ...estCols(cb)]}
          rows={cb.estimates.filter((e) => e.kind === 'threshold').map((e) => [c(e.lhs), c(e.rhs, 'dim'), ...estRow(e, '').slice(1)])}
          note="Each threshold is the point on the underlying continuous (latent response) variable, in standard-normal units, above which the next category is observed. An item with k categories has k − 1 thresholds." />
      )}
    </div>
  );
}

function ModIndices({ cb }: { cb: CbResult }) {
  const mi = cb.modindices ?? [];
  if (!mi.length) return <div className="empty-results">No modification index reaches 3.84 (χ²(1) at α = .05): no single added parameter would improve fit significantly.</div>;
  const groups = mi.some((m) => m.group);
  return (
    <Table title="Modification indices" file="cb-modindices" columns={['Parameter', ...(groups ? ['Group'] : []), 'MI', 'EPC', 'Standardised EPC']}
      rows={mi.map((m) => [c(`${m.lhs} ${m.op} ${m.rhs}`), ...(groups ? [c(m.group ?? '')] : []), c(m.mi, m.mi > 10 ? 'warn' : ''), c(m.epc), c(m.sepc)])}
      note="Expected drop in χ² if the parameter were freed (MI, 1 df; ≥ 3.84 shown, largest first), with the expected parameter change (EPC). =~ cross-loading, ~ path, ~~ (error) covariance. Free a parameter only when theory supports it: changes driven by modification indices capitalise on chance (MacCallum, Roznowski & Necowitz, 1992)." />
  );
}

function Invariance({ cb }: { cb: CbResult }) {
  const multigroup = useStore((s) => s.model.multigroup);
  const results = useFreshResults();
  const job = useStore((s) => s.job);
  const inv = results?.invariance ?? null;
  const score = cb.groups?.score ?? [];
  if (!multigroup) return <div className="empty-results">Choose a grouping column under Groups (Model inspector) to compare the model across groups.</div>;
  const d = (v: number | undefined, digits = 3) => (v === undefined ? c(null) : c(v, '', digits));
  return (
    <div className="tables">
      <div className="table-tools">
        <button className="btn sm primary" disabled={!!job} onClick={() => runInvariance()}>{inv ? 'Run again' : 'Compare configural, metric, scalar and strict'}</button>
        <div className="spacer" />
        <RScriptButton what="invariance" />
      </div>
      {inv && (
        <Table title={`Measurement invariance across ${multigroup.column}`} file="cb-invariance"
          columns={['Model', 'χ²', 'df', 'CFI', 'RMSEA', 'SRMR', 'Δχ²', 'Δdf', 'p', 'ΔCFI', 'ΔRMSEA']}
          rows={inv.levels.map((l) => [c(l.level), c(l.chisq), c(l.df, '', 0), c(l.cfi), c(l.rmsea), c(l.srmr), d(l.chisqDiff), d(l.dfDiff, 0),
            // A significant difference means the added equalities do not hold: a warning, not a success.
            l.p === undefined ? c(null) : { v: `${fmtP(l.p)} ${stars(l.p)}`, cls: l.p < 0.05 ? 'bad' : 'dim' }, l.cfiChange === undefined ? c(null) : c(l.cfiChange, l.cfiChange < -0.01 ? 'bad' : 'good'), d(l.rmseaChange)])}
          note={<>Each model adds equality constraints to the one before (loadings; intercepts or thresholds; residual variances); partial invariance as set under Groups applies throughout. Δχ²: difference test{inv.robust ? ' (scaled, for the robust estimator)' : ''} against the previous model. A drop in CFI of more than .01 (red) suggests non-invariance (Cheung &amp; Rensvold, 2002; Chen, 2007).</>} />
      )}
      {score.length > 0 && (
        <Table title={`Score tests of the equality constraints (${multigroup.invariance} model)`} file="cb-score-tests" columns={['Parameter', 'Groups', 'χ²', 'df', 'p']}
          rows={[...score].sort((a, b) => b.x2 - a.x2).map((t) => [c(t.param), c(t.groups.join(' = ')), c(t.x2, t.p < 0.05 ? 'warn' : ''), c(t.df, '', 0), pCell(t.p)])}
          note="How much χ² would drop if this single equality across groups were released (lavaan::lavTestScore). The largest significant one is the first candidate for partial invariance (right-click the indicator → Free across groups)." />
      )}
    </div>
  );
}

function Defined({ cb }: { cb: CbResult }) {
  const defs = cb.estimates.filter((e) => e.kind === 'defined');
  const wald = cb.wald ?? [];
  const labelled = cb.estimates.filter((e) => e.label);
  if (!defs.length && !wald.length && !labelled.length) {
    return <div className="empty-results">No labels, defined parameters or Wald tests. Label parameters with right-click → Label…, then define functions of them or test hypotheses in the Model inspector (lavaan).</div>;
  }
  return (
    <div className="tables">
      {defs.length > 0 && (
        <Table title="Defined parameters" file="cb-defined" columns={['Parameter', 'Definition', ...estCols(cb)]}
          rows={defs.map((e) => [c(e.lhs), c(e.rhs, 'dim'), ...estRow(e, '').slice(1)])}
          note="Functions of labelled parameters (lavaan :=), with delta-method standard errors and z tests. For indirect effects, prefer bootstrap confidence intervals (Bootstrapping)." />
      )}
      {wald.length > 0 && (
        <Table title="Wald tests" file="cb-wald" columns={['Test', 'χ²', 'df', 'p']}
          rows={wald.map((w) => [c(w.name), c(w.stat), c(w.df, '', 0), pCell(w.p)])}
          note="Joint Wald test of each set of hypotheses (lavaan::lavTestWald): a small p is evidence against the hypotheses." />
      )}
      {labelled.length > 0 && (
        <Table title="Labelled parameters" file="cb-labels" columns={['Label', 'Parameter', ...estCols(cb)]}
          rows={labelled.map((e) => [c(e.label!), ...estRow(e, `${e.lhs} ${e.op} ${e.rhs}`)])}
          note="Parameters sharing a label are estimated as equal." />
      )}
    </div>
  );
}

function Effects({ cb, boot }: { cb: CbResult; boot: BootstrapResult | null }) {
  const C = cb.constructs;
  const [mc, setMc] = useState<{ rows: McIndirect[]; error?: string } | null>(null);
  const runMc = () => {
    try { setMc({ rows: mcIndirect(cb, 20000, 20261027, 0.95) }); } catch (e) { setMc({ rows: [], error: e instanceof Error ? e.message : String(e) }); }
  };
  const rows = (kind: 'total' | 'indirect'): Row[] => {
    const out: Row[] = [];
    for (let i = 0; i < C.length; i++) for (let j = 0; j < C.length; j++) {
      const v = kind === 'total' ? cb.stdTotal[i][j] : cb.stdIndirect[i][j];
      if (i === j || Math.abs(v) < 1e-12) continue;
      const b = boot?.stats.find((s) => s.key === `${kind}:${C[i]}:${C[j]}`);
      out.push([c(`${C[i]} → ${C[j]}`), c(v), ...(boot ? bootCells(b) : [])]);
    }
    return out;
  };
  return (
    <div className="tables">
      <Table title="Standardised indirect effects" file="cb-indirect" columns={['Effect', 'Estimate', ...(boot ? bootCols(boot) : [])]} rows={rows('indirect')}
        note={boot ? 'Percentile bootstrap intervals are the recommended test of mediation.' : 'Run bootstrapping for confidence intervals of indirect effects.'} />
      <Table title="Standardised total effects" file="cb-total" columns={['Effect', 'Estimate', ...(boot ? bootCols(boot) : [])]} rows={rows('total')} />
      <div>
        {!mc ? (
          <button className="btn" onClick={runMc}>Monte Carlo CIs for indirect effects</button>
        ) : mc.error ? <div className="issue error">{mc.error}</div> : (
          <Table title="Monte Carlo CIs (unstandardised indirect effects)" file="cb-mc-indirect" columns={['Effect', 'Estimate', 'MC SE', '95% CI low', 'CI high', 'Significant']}
            rows={mc.rows.map((r) => {
              const sig = r.ciLow > 0 || r.ciHigh < 0;
              return [c(`${r.from} → ${r.to}`), c(r.est), c(r.se), c(r.ciLow), c(r.ciHigh), c(sig ? 'yes' : 'no', sig ? 'good' : 'dim')];
            })}
            note="Preacher & Selig (2012): 20,000 draws of the regression coefficients from N(θ̂, V̂) using this estimator's covariance matrix; percentile limits. A fast alternative to bootstrapping. Validated against semTools::monteCarloCI." />
        )}
      </div>
    </div>
  );
}

function Reliability({ cb }: { cb: CbResult }) {
  // semTools' omega and alpha come with the R engine.
  const model = cb.reliability.some((r) => r.omega !== undefined || r.alpha !== undefined);
  return (
    <Table title="Reliability and convergent validity" file="cb-reliability"
      columns={['Factor', 'Composite reliability', 'AVE', ...(model ? ['ω (semTools)', 'α'] : [])]}
      rows={cb.constructs.map((n, j) => {
        const r = cb.reliability[j];
        return [c(n), c(r.cr, r.cr >= 0.7 ? 'good' : 'warn'), c(r.ave, r.ave >= 0.5 ? 'good' : 'bad'),
          ...(model ? [c(r.omega ?? null, r.omega === undefined ? '' : r.omega >= 0.7 ? 'good' : 'warn'), c(r.alpha ?? null, r.alpha === undefined ? '' : r.alpha >= 0.7 ? 'good' : 'warn')] : [])];
      })}
      note={`From standardised loadings: CR = (Σλ)² / ((Σλ)² + Σ(1−λ²)), AVE = mean λ².${model ? ' ω: the model-based reliability of each factor’s indicator sum (semTools::compRelSEM; residual covariances and ordinal indicators taken into account, total variance from the unrestricted model); α: coefficient alpha of the same sum.' : ''}`} />
  );
}

function Discriminant({ cb }: { cb: CbResult }) {
  const C = cb.constructs;
  const flRows: Row[] = C.map((name, i) => {
    const diag = Math.sqrt(cb.reliability[i].ave);
    return [c(name), ...C.map((_, j) => {
      if (j > i) return c(null, 'dim');
      if (j === i) return { v: diag, bold: true };
      const r = cb.lvCor[i][j];
      return c(r, Math.abs(r) > diag || Math.abs(r) > Math.sqrt(cb.reliability[j].ave) ? 'bad' : '');
    })];
  });
  return (
    <div className="tables">
      <Table title="HTMT" file="cb-htmt" columns={['', ...C]} rows={matrixRows(C, (i, j) => cb.htmt[i][j], htmtCls)} />
      <Table title="HTMT2" file="cb-htmt2" columns={['', ...C]} rows={matrixRows(C, (i, j) => cb.htmt2[i][j], htmtCls)} />
      <Table title="Fornell–Larcker (model-implied factor correlations)" file="cb-fl" columns={['', ...C]} rows={flRows}
        note="Diagonal: √AVE. A factor correlation near 1 also signals poor discriminant validity." />
    </div>
  );
}

function Residuals({ cb }: { cb: CbResult }) {
  const names = cb.indicators.map((i) => i.name);
  return (
    <Table title="Residual correlations (observed − implied)" file="cb-residual-cor" columns={['', ...names]}
      rows={matrixRows(names, (i, j) => (i === j ? null : cb.residualCor[i][j]), (v) => (Math.abs(v) > 0.1 ? 'bad' : Math.abs(v) > 0.05 ? 'warn' : ''))}
      note="Absolute residual correlations above 0.10 point to local misfit (e.g. a missing cross-loading or error covariance)." />
  );
}

/** How the interaction was estimated, and the conditional effect the Johnson–Neyman analysis uses. */
export function jnNote(cb: CbResult, mo: CbResult['moderations'][number], jn: { quadratic: boolean; bx: number; bint: number; crit: number }): string {
  const lms = cb.interaction === 'lms' || cb.interaction === 'qml';
  const how = lms
    ? `Latent ${jn.quadratic ? 'quadratic term' : 'interaction'} estimated by ${cb.interaction!.toUpperCase()} (modsem; ${cb.interaction === 'lms' ? 'Klein & Moosbrugger 2000' : 'Klein & Muthén 2007'}), without product indicators.`
    : jn.quadratic ? 'Latent quadratic term from squared mean-centred indicators (Marsh, Wen & Hau 2004).' : 'Latent interaction from matched-pair products of mean-centred indicators (Marsh, Wen & Hau 2004).';
  const effect = jn.quadratic ? `Slope of ${mo.from} at x: θ(x) = ${fmt(jn.bx)} + 2·${fmt(jn.bint)}·x` : `Conditional effect θ(m) = ${fmt(jn.bx)} + ${fmt(jn.bint)}·m`;
  return `${how} ${effect} with delta-method SEs from the ${lms ? `${cb.interaction!.toUpperCase()} (modsem)` : cb.estimator} parameter covariance; boundaries solve |θ(m)|/SE(m) = ${jn.crit.toFixed(3)}.${lms ? '' : ' Validated against lavaan.'}`;
}

function Moderation({ cb }: { cb: CbResult }) {
  if (cb.moderations.length === 0) {
    return <div className="empty-results">No moderators. Drag from an exogenous factor’s dot onto a path arrow to add a latent interaction.</div>;
  }
  return (
    <div className="tables">
      {cb.moderations.map((mo) => {
        const name = cb.constructs[mo.construct];
        const est = cb.estimates.find((e) => e.op === '~' && e.lhs === mo.to && e.rhs === name)!;
        let jn: ReturnType<typeof johnsonNeyman> | null = null;
        let error = '';
        try { jn = johnsonNeyman(cb, mo); } catch (e) { error = e instanceof Error ? e.message : String(e); }
        const rows: Row[] = [estRow(est, `${name} → ${mo.to}`)];
        return (
          <div key={mo.construct} style={{ display: 'grid', gap: 12 }}>
            <Table title={mo.from === mo.moderator ? `Quadratic effect of ${mo.from} on ${mo.to}` : `${mo.moderator} moderating ${mo.from} → ${mo.to}`} file={`cb-interaction-${mo.construct}`} columns={[mo.from === mo.moderator ? 'Quadratic term' : 'Interaction', ...estCols(cb)]} rows={rows} />
            {error && <div className="issue error">{error}</div>}
            {jn && (
              <>
                <JohnsonNeymanPlot jn={jn} from={mo.from} moderator={mo.moderator} to={mo.to} width={420} height={230} />
                <Table title="Johnson–Neyman" file={`cb-jn-${mo.construct}`} columns={jn.quadratic ? [`${mo.from} (SD)`, `${mo.from} (latent units)`, 'Slope', 'Std. error', 'Significant'] : ['Moderator (SD)', 'Moderator (latent units)', 'Effect', 'Std. error', 'Significant']}
                  rows={[
                    ...jn.boundaries.map((b) => [c(`boundary ${(b / jn!.sdM).toFixed(3)}`), c(b), c(jn!.effect(b)), c(jn!.se(b)), c('edge')]),
                    ...[-1, 0, 1].map((k) => {
                      const m = k * jn!.sdM;
                      return [c(k === 0 ? 'mean' : `${k > 0 ? '+' : ''}${k} SD`), c(m), c(jn!.effect(m)), c(jn!.se(m)), c(jn!.significantAt(m) ? 'yes' : 'no', jn!.significantAt(m) ? 'good' : 'dim')];
                    }),
                  ]}
                  note={jnNote(cb, mo, jn)} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CbTab({ tab, cb, boot }: { tab: CbTabId; cb: CbResult; boot: BootstrapResult | null }) {
  switch (tab) {
    case 'fit': return <Fit cb={cb} />;
    case 'paths': return <Paths cb={cb} boot={boot} />;
    case 'loadings': return <Loadings cb={cb} />;
    case 'variances': return <Variances cb={cb} />;
    case 'effects': return <Effects cb={cb} boot={boot} />;
    case 'defined': return <Defined cb={cb} />;
    case 'moderation': return <Moderation cb={cb} />;
    case 'reliability': return <Reliability cb={cb} />;
    case 'discriminant': return <Discriminant cb={cb} />;
    case 'residuals': return <Residuals cb={cb} />;
    case 'modindices': return <ModIndices cb={cb} />;
    case 'invariance': return <Invariance cb={cb} />;
    case 'bootstrap': return <BootstrapTab boot={boot} std />;
  }
}
