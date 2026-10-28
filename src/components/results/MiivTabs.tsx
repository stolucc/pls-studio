import type { MiivResult } from '../../engine/miiv';
import { fmt } from '../../format';
import { c, pCell, Table, type Row } from './Table';

export const MIIV_TABS = [
  { id: 'equations', label: 'Equations & Sargan tests' },
  { id: 'coefficients', label: 'Coefficients' },
] as const;
export type MiivTabId = (typeof MIIV_TABS)[number]['id'];

function Equations({ miiv }: { miiv: MiivResult }) {
  const rows: Row[] = miiv.equations.map((e) => [
    c(e.dv), c(e.regressors.join(' + ')), c(e.kind, 'dim'), c(String(e.instruments.length)),
    c(e.sargan), c(e.sarganDf ? String(e.sarganDf) : '0'),
    e.sarganP === null ? c('exactly identified', 'dim') : { v: e.sarganP < 0.001 ? '<0.001' : fmt(e.sarganP), cls: e.sarganP < 0.05 ? 'bad' : 'good' },
    c(e.sigma2),
  ]);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Table title="MIIV-2SLS equations" file="miiv-equations"
        columns={['Dependent', 'Regressors (scaling indicators)', 'Type', 'Instruments', 'Sargan χ²', 'df', 'p', 'σ²(u)']} rows={rows}
        note={<>Bollen’s (1996) model-implied instrumental variables: every latent variable is replaced by its scaling indicator and each equation is estimated separately by two-stage least squares, so misspecification elsewhere does not bias it. A significant Sargan test (red) means at least one instrument correlates with the equation’s error: evidence of misspecification affecting this equation. Validated against MIIVsem.</>} />
      <details>
        <summary className="hint" style={{ cursor: 'pointer' }}>Instruments per equation</summary>
        <Table title="Instruments" file="miiv-instruments" columns={['Dependent', 'Instruments']}
          rows={miiv.equations.map((e) => [c(e.dv), c(e.instruments.join(', '))])} />
      </details>
    </div>
  );
}

function Coefficients({ miiv }: { miiv: MiivResult }) {
  const hasStd = miiv.estimates.some((e) => e.std !== undefined);
  const rows: Row[] = miiv.estimates.map((e) => [c(e.op === '=~' ? `${e.lhs} → ${e.rhs}` : `${e.rhs} → ${e.lhs}`), c(e.op === '=~' ? 'loading' : 'regression', 'dim'), c(e.est), c(e.se), c(e.z), pCell(e.p), ...(hasStd ? [c(e.std ?? null)] : [])]);
  const vars = miiv.variances ?? [];
  return (
    <div className="tables">
    <Table title="Coefficients" file="miiv-coefficients" columns={['Parameter', 'Type', 'Estimate', 'Std. error', 'z', 'p', ...(hasStd ? ['Standardised'] : [])]} rows={rows}
      note={hasStd
        ? "Estimates are unstandardised, in the metric of each factor's scaling indicator (first indicator, loading fixed to 1). Standardised values use the variances estimated with the 2SLS coefficients held fixed (MIIVsem's var.cov = TRUE; std.all). MIIV-2SLS has no global fit test."
        : "Unstandardised, in the metric of each factor's scaling indicator (first indicator, loading fixed to 1). MIIV-2SLS estimates loadings and regressions; variances, covariances and global fit indices are not part of it (choose the R engine for standardised values)."} />
    {vars.length > 0 && (
      <Table title="Variances and covariances" file="miiv-variances" columns={['Parameter', 'Estimate', 'Standardised']}
        rows={vars.map((v) => [c(v.lhs === v.rhs ? `${v.latent ? 'ζ/ψ ' : 'ε '}${v.lhs}` : `${v.lhs} ↔ ${v.rhs}`), c(v.est), c(v.std)])}
        note="Estimated after the 2SLS coefficients, as MIIVsem's var.cov = TRUE: the coefficients are held at their 2SLS values and the variances and covariances estimated by ML, without standard errors. Standardised: std.all (an error variance standardises to 1 − R²). Covariates keep their sample (co)variances." />
    )}
    </div>
  );
}

export function MiivTab({ tab, miiv }: { tab: MiivTabId; miiv: MiivResult }) {
  return tab === 'equations' ? <Equations miiv={miiv} /> : <Coefficients miiv={miiv} />;
}
