// The linear regression's extras on the regression card: the blocks of a hierarchical regression (R² change and
// its F test), each term's standardised β, zero-order, partial and part correlations and tolerance, and the cases'
// residuals, leverage and influence with flags, savable as data columns.

import { c, pCell, Table, type Row } from '../components/results/Table';
import { fmt } from '../format';
import type {
  CaseDiagnostics,
  RegressionInput,
  RegressionResult,
  TermDetail,
} from '../rengine/regression';
import { useStore } from '../store';
import { freeColumnName } from './common';

type WithInput = RegressionResult & { input: RegressionInput };

/** The model summary of each block: R², adjusted R², the change in R² and its F test (SPSS's R² change). */
export function HierarchicalBlocks({
  r,
  o,
}: {
  r: WithInput;
  o: { predictors: string[]; interactions: string[][]; blocks?: string[][] };
}) {
  const blockTerms = (i: number): string => {
    if (i === 0) {
      const terms = [...o.predictors, ...o.interactions.map((t) => t.join(' × '))];
      return terms.join(', ');
    }
    return `+ ${(r.input.blocks ?? [])[i - 1]?.join(', ') ?? ''}`;
  };
  const rows: Row[] = (r.blocks ?? []).map((b, i) => [
    c(b.block, undefined, 0),
    c(blockTerms(i)),
    c(b.r2),
    c(b.adj_r2),
    c(b.r2_change),
    c(b.f_change, undefined, 2),
    c(b.df1, undefined, 0),
    c(b.df2, undefined, 0),
    pCell(b.p_change),
  ]);
  return (
    <Table
      title="Hierarchical regression: R² change by block"
      file="regression-blocks"
      columns={['Block', 'Predictors', 'R²', 'Adj. R²', 'ΔR²', 'F change', 'df1', 'df2', 'p']}
      rows={rows}
      note="Each block is added to the model before it, on the same cases (those complete on every block’s variables). F change: the first block against the intercept-only model, each further block against the model before it (anova of the two lm fits)."
    />
  );
}

/** VIF above 10 is bad, above 5 a warning. */
function vifClass(vif: number): string {
  if (vif > 10) return 'bad';
  if (vif > 5) return 'warn';
  return '';
}

/** Each term's standardised coefficient, correlations with the outcome and collinearity. */
export function TermDetails({ details }: { details: TermDetail[] }) {
  const rows: Row[] = details.map((d) => [
    c(d.term),
    c(d.beta),
    c(d.zero_order),
    c(d.partial),
    c(d.part),
    c(d.tolerance),
    c(d.vif, vifClass(d.vif), 2),
  ]);
  return (
    <Table
      title="Standardised coefficients and correlations"
      file="regression-standardised"
      columns={['Term', 'β', 'Zero-order r', 'Partial r', 'Part r', 'Tolerance', 'VIF']}
      rows={rows}
      note="β: the coefficient with the term and the outcome in standard-deviation units (the design matrix’s columns: a dummy or product term is standardised as a column). Zero-order: the term’s correlation with the outcome; partial: with the outcome, both adjusted for the other terms, t / √(t² + df); part (semi-partial): with the outcome, the term adjusted for the others, t·√((1 − R²) / df), whose square is the R² the term adds last. Tolerance: 1 − R² of the term on the other terms (1 / VIF)."
    />
  );
}

/** The flags' cut-offs: |standardised residual| > 3, leverage > 2k/n, Cook's D > 4/n, |DFBETAS| > 2/√n. */
export function caseCutoffs(cases: CaseDiagnostics) {
  const n = cases.row.length;
  const k = cases.dfbetas.length;
  return { residual: 3, leverage: (2 * k) / n, cooks: 4 / n, dfbetas: 2 / Math.sqrt(n) };
}

/** The flags of case i, and its largest |DFBETAS| with the term. */
export function caseFlags(cases: CaseDiagnostics, i: number) {
  const cut = caseCutoffs(cases);
  let maxAbs = 0;
  let maxTerm = '';
  for (const d of cases.dfbetas) {
    const v = Math.abs(d.values[i]);
    if (v > maxAbs) {
      maxAbs = v;
      maxTerm = d.term;
    }
  }
  const flags: string[] = [];
  if (Math.abs(cases.standardized[i]) > cut.residual) flags.push('residual');
  if (cases.leverage[i] > cut.leverage) flags.push('leverage');
  if (cases.cooks[i] > cut.cooks) flags.push('Cook’s D');
  if (maxAbs > cut.dfbetas) flags.push(`DFBETAS (${maxTerm})`);
  return { flags, maxAbs, maxTerm };
}

/** The columns a save adds: name stem, values per case. */
const SAVED: [string, string, keyof Omit<CaseDiagnostics, 'row' | 'dfbetas'>][] = [
  ['pred', 'predicted values', 'fitted'],
  ['resid', 'residuals', 'residual'],
  ['zresid', 'standardised residuals', 'standardized'],
  ['sresid', 'studentised residuals', 'studentized'],
  ['lever', 'leverage', 'leverage'],
  ['cook', 'Cook’s distance', 'cooks'],
];

/** The diagnostics as full-length data columns: each case's value at its row, NaN where a row was left out. */
export function caseColumns(
  cases: CaseDiagnostics,
  rows: number,
  outcome: string,
  names: string[],
) {
  const taken = [...names];
  return SAVED.map(([stem, , key]) => {
    const col = new Float64Array(rows).fill(NaN);
    cases.row.forEach((row, i) => {
      col[row - 1] = cases[key][i];
    });
    const name = freeColumnName(taken, `${stem}_${outcome}`);
    taken.push(name);
    return { name, col };
  });
}

/** The flagged cases and the button that saves the diagnostics as data columns. */
export function CaseDiagnosticsView({
  cases,
  r,
  current,
}: {
  cases: CaseDiagnostics;
  r: WithInput;
  current: boolean;
}) {
  const data = useStore((s) => s.data);
  const info = useStore((s) => s.dataInfo);
  const rows = data?.cols[0]?.length ?? 0;
  const cut = caseCutoffs(cases);
  const flagged = cases.row
    .map((row, i) => ({ row, i, ...caseFlags(cases, i) }))
    .filter((x) => x.flags.length > 0)
    .sort((a, b) => cases.cooks[b.i] - cases.cooks[a.i]);
  const fits = cases.row.every((row) => row >= 1 && row <= rows);
  const canSave = current && !!data && !!info && fits;
  let saveTitle = `Add ${SAVED.map(([, label]) => label).join(', ')} as data columns (blank where a row was left out)`;
  if (!current) saveTitle = 'The data or the options changed since this ran: run it again first';
  else if (!fits) saveTitle = 'The data has fewer rows than when this ran: run it again first';
  const save = () => {
    if (!canSave) return;
    const added = caseColumns(cases, rows, r.input.outcome, data.names);
    useStore.getState().setData(
      {
        ...data,
        names: [...data.names, ...added.map((a) => a.name)],
        cols: [...data.cols, ...added.map((a) => a.col)],
      },
      info,
    );
    useStore
      .getState()
      .toast('success', `Saved as data columns: ${added.map((a) => a.name).join(', ')}.`);
  };
  const tableRows: Row[] = flagged.map((x) => [
    c(x.row, undefined, 0),
    c(cases.fitted[x.i]),
    c(cases.residual[x.i]),
    c(cases.standardized[x.i], Math.abs(cases.standardized[x.i]) > cut.residual ? 'bad' : ''),
    c(cases.studentized[x.i]),
    c(cases.leverage[x.i], cases.leverage[x.i] > cut.leverage ? 'warn' : ''),
    c(cases.cooks[x.i], cases.cooks[x.i] > cut.cooks ? 'warn' : ''),
    c(`${fmt(x.maxAbs)} (${x.maxTerm})`, x.maxAbs > cut.dfbetas ? 'warn' : ''),
    c(x.flags.join(', ')),
  ]);
  const n = cases.row.length;
  return (
    <>
      <Table
        title={`Case diagnostics: ${flagged.length} of ${n} cases flagged`}
        file="regression-cases"
        columns={[
          'Row',
          'Predicted',
          'Residual',
          'Std. residual',
          'Stud. residual',
          'Leverage',
          'Cook’s D',
          'Max |DFBETAS|',
          'Flags',
        ]}
        rows={tableRows}
        note={`Flagged: |standardised residual| > 3, leverage (hat value) > 2k/n = ${fmt(cut.leverage, 3)}, Cook’s distance > 4/n = ${fmt(cut.cooks, 3)}, or a standardised DFBETA beyond 2/√n = ${fmt(cut.dfbetas, 3)} (k = ${cases.dfbetas.length} coefficients, n = ${n} cases); sorted by Cook’s distance. Studentised residuals are deleted residuals (rstudent). Rule-of-thumb cut-offs: look at the flagged cases, do not drop them automatically. R’s rstandard, rstudent, hatvalues, cooks.distance and dfbetas.`}
      />
      <div className="table-tools">
        <button className="btn sm" disabled={!canSave} title={saveTitle} onClick={save}>
          Save as data columns
        </button>
        <span className="hint">
          Predicted values, residuals (raw, standardised, studentised), leverage and Cook’s distance
          of each case.
        </span>
      </div>
    </>
  );
}
