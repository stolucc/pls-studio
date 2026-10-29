import type { CbEstimate, CbResult } from '../../engine/cbsem';
import type { BootstrapResult } from '../../engine/types';
import { fmt } from '../../format';
import { useState } from 'react';
import { johnsonNeyman } from '../../engine/jn';
import { mcIndirect, type McIndirect } from '../../engine/mcci';
import { JohnsonNeymanPlot } from '../JohnsonNeymanPlot';
import { BootstrapTab } from './PlsTabs';
import { bootCells, bootCols, c, htmtCls, matrixRows, pCell, Table, type Row } from './Table';

export const CB_TABS = [
  { id: 'fit', label: 'Model fit' },
  { id: 'paths', label: 'Regressions' },
  { id: 'loadings', label: 'Loadings' },
  { id: 'variances', label: 'Variances & covariances' },
  { id: 'effects', label: 'Indirect & total effects' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'discriminant', label: 'Discriminant validity' },
  { id: 'residuals', label: 'Residuals' },
  { id: 'bootstrap', label: 'Bootstrapping' },
] as const;
export type CbTabId = (typeof CB_TABS)[number]['id'];

const estRow = (e: CbEstimate, label: string): Row =>
  [c(label), c(e.est), c(e.se), c(e.z), pCell(e.p), c(e.std)];
const estCols = (cb: CbResult) => ['Estimate', cb.estimator === 'MLM' || cb.estimator === 'MLMV' || cb.estimator === 'MLR' ? 'Robust SE' : 'Std. error', 'z', 'p', 'Standardised'];

function Fit({ cb }: { cb: CbResult }) {
  const f = cb.fit;
  const card = (k: string, v: string, cls?: string) => (
    <div className="stat-card"><div className="k">{k}</div><div className="v" style={cls ? { color: `var(--${cls})` } : undefined}>{v}</div></div>
  );
  const ok = (good: boolean) => (good ? 'good' : 'warn');
  const robust = f.chisqScaled !== undefined;
  const pv = robust ? f.pvalueScaled : f.pvalue;
  const cfi = robust ? f.cfiRobust! : f.cfi, tli = robust ? f.tliRobust! : f.tli, rmsea = robust ? f.rmseaRobust! : f.rmsea;
  const ml = cb.estimator !== 'GLS' && cb.estimator !== 'ULS';
  const rows: Row[] = [
    [c('Estimator'), c(cb.estimator), c(null)],
    [c('Observations'), c(String(cb.n)), c(null)],
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
    ...(robust ? [[c('CFI / TLI (scaled)'), c(null), c(`${fmt(f.cfiScaled)} / ${fmt(f.tliScaled)}`)], [c('RMSEA (scaled)'), c(null), c(f.rmseaScaled ?? null)]] : []),
    [c('SRMR'), c(f.srmr), c(null)],
    ...(ml ? [[c('Log-likelihood'), c(f.logl, '', 2), c(null)], [c('AIC'), c(f.aic, '', 2), c(null)], [c('BIC'), c(f.bic, '', 2), c(null)]] : []),
  ];
  return (
    <>
      <div className="stat-cards">
        {card(robust ? 'χ² (scaled)' : 'χ²', `${fmt(robust ? f.chisqScaled : f.chisq, 2)}`)}
        {card('df', String(f.df))}
        {card('p', pv === undefined || Number.isNaN(pv) ? '—' : pv < 0.001 ? '<0.001' : fmt(pv))}
        {card(robust ? 'CFI (robust)' : 'CFI', fmt(cfi), ok(cfi >= 0.95))}
        {card(robust ? 'TLI (robust)' : 'TLI', fmt(tli), ok(tli >= 0.95))}
        {card(robust ? 'RMSEA (robust)' : 'RMSEA', fmt(rmsea), ok(rmsea <= 0.06))}
        {card('SRMR', fmt(f.srmr), ok(f.srmr <= 0.08))}
      </div>
      <div className="tables">
        <Table title="Fit statistics" file="cb-fit" columns={['Statistic', 'Standard', robust ? 'Robust / scaled' : '']} rows={rows}
          note={<>Hu &amp; Bentler (1999) cutoffs: CFI/TLI ≥ 0.95, RMSEA ≤ 0.06, SRMR ≤ 0.08.{robust && ' Robust CFI/TLI/RMSEA follow Brosseau-Liard & Savalei and estimate the population values; the scaled versions apply the correction to the statistic only.'} Validated against lavaan.</>} />
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
        note="Standardised error variance = 1 − indicator R²; standardised error covariance = error correlation. Single-indicator factors have their error variance fixed to 0." />
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
  return (
    <Table title="Reliability and convergent validity" file="cb-reliability" columns={['Factor', 'Composite reliability', 'AVE']}
      rows={cb.constructs.map((n, j) => [c(n), c(cb.reliability[j].cr, cb.reliability[j].cr >= 0.7 ? 'good' : 'warn'), c(cb.reliability[j].ave, cb.reliability[j].ave >= 0.5 ? 'good' : 'bad')])}
      note="From standardised loadings: CR = (Σλ)² / ((Σλ)² + Σ(1−λ²)), AVE = mean λ²." />
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
                  note={`${jn.quadratic ? `Latent quadratic term from squared mean-centred indicators (Marsh, Wen & Hau 2004). Slope of ${mo.from} at x: θ(x) = ${fmt(jn.bx)} + 2·${fmt(jn.bint)}·x` : `Latent interaction from matched-pair products of mean-centred indicators (Marsh, Wen & Hau 2004). Conditional effect θ(m) = ${fmt(jn.bx)} + ${fmt(jn.bint)}·m`} with delta-method SEs from the ${cb.estimator} parameter covariance; boundaries solve |θ(m)|/SE(m) = ${jn.crit.toFixed(3)}. Validated against lavaan.`} />
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
    case 'moderation': return <Moderation cb={cb} />;
    case 'reliability': return <Reliability cb={cb} />;
    case 'discriminant': return <Discriminant cb={cb} />;
    case 'residuals': return <Residuals cb={cb} />;
    case 'bootstrap': return <BootstrapTab boot={boot} std />;
  }
}
