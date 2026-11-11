// Partial and semi-partial correlations (ppcor, Kim 2015): each pair of the chosen variables controlling for the
// chosen control variables, or for all the other variables of the set; Pearson, Spearman or Kendall.

import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { fmt } from '../format';
import { PCOR_METHODS, type PcorInput, type PcorMethod, type PcorResult } from '../rengine/pcor';
import { Choice, columnsFingerprint, isObj, missingColumns, names, oneOf, rawData } from './common';
import type { AnalysisType, OptionsProps } from './types';

export type PcorOptions = PcorInput;

const METHOD_NAME: Record<PcorMethod, string> = {
  pearson: 'Pearson',
  spearman: 'Spearman',
  kendall: 'Kendall',
};

function PcorForm({ options: o, set, ctx, disabled }: OptionsProps<PcorOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data first.</div>;
  const numeric = d.names.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <OrderedPicker
        label="Variables"
        columns={numeric.filter((n) => !o.controls.includes(n))}
        value={o.vars}
        onChange={(vars) => set({ ...o, vars })}
      />
      <OrderedPicker
        label="Control for (optional)"
        columns={numeric.filter((n) => !o.vars.includes(n))}
        value={o.controls}
        onChange={(controls) => set({ ...o, controls })}
      />
      <Choice
        label="Coefficient"
        value={o.method}
        onChange={(method) => set({ ...o, method })}
        options={[
          ['pearson', 'Pearson’s r'],
          ['spearman', 'Spearman’s ρ'],
          ['kendall', 'Kendall’s τ'],
        ]}
      />
      <div className="hint">
        Partial: the correlation of two variables after removing the controls from both.
        Semi-partial (part): after removing them from one of the two only. Without control variables
        each pair is controlled for all the other chosen variables (ppcor’s pcor and spcor
        matrices). Rows with a missing value in any chosen column are left out (listwise).
      </div>
    </fieldset>
  );
}

function PcorView({ r }: { r: PcorResult }) {
  let sym = 'τ';
  if (r.method === 'pearson') sym = 'r';
  else if (r.method === 'spearman') sym = 'ρ';
  const stat = r.method === 'kendall' ? 'z' : 't';
  const matrixMode = r.controls.length === 0;
  const at = (a: string, b: string) =>
    r.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  // The partial correlations as a lower triangle: a dash on the diagonal, blanks above.
  const matrix: Row[] = r.vars.map((a, i) => [
    c(a),
    ...r.vars.map((b, j) => {
      if (j === i) return c('—');
      if (j > i) return c(null);
      return c(at(a, b)!.partial.r);
    }),
  ]);
  const partialRows: Row[] = r.pairs.map((p) => [
    c(`${p.a} – ${p.b}`),
    c(p.given.join(', ')),
    c(p.partial.r),
    c(p.partial.stat, undefined, 3),
    pCell(p.partial.p),
  ]);
  const semiRows: Row[] = r.pairs.flatMap((p): Row[] => [
    [
      c(`${p.a} with ${p.b} (adjusted)`),
      c(p.semiAB.r),
      c(p.semiAB.stat, undefined, 3),
      pCell(p.semiAB.p),
    ],
    [
      c(`${p.b} with ${p.a} (adjusted)`),
      c(p.semiBA.r),
      c(p.semiBA.stat, undefined, 3),
      pCell(p.semiBA.p),
    ],
  ]);
  const given = matrixMode
    ? 'each pair controlled for the other variables'
    : `controlled for ${r.controls.join(', ')}`;
  const where = r.engine.desktop ? ` in desktop ${r.engine.desktop}` : '';
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {METHOD_NAME[r.method]} partial correlations, {given}; N = {r.n} (listwise). ppcor{' '}
        {r.engine.version}
        {where}.
      </p>
      {r.vars.length > 2 && (
        <Table
          title={`Partial ${sym}`}
          file="partial-correlation-matrix"
          columns={['', ...r.vars]}
          rows={matrix}
        />
      )}
      <Table
        title="Partial correlations"
        file="partial-correlations"
        columns={['Pair', 'Controlled for', sym, stat, 'p']}
        rows={partialRows}
        note={`Each pair with the controls removed from both variables (ppcor::pcor.test). The test has N − 2 − g degrees of freedom (g controls)${r.method === 'kendall' ? '; Kendall’s uses the normal approximation (z)' : ''}.`}
      />
      <Table
        title="Semi-partial (part) correlations"
        file="semipartial-correlations"
        columns={['Correlation', sym, stat, 'p']}
        rows={semiRows}
        note="The first variable with the second after the controls are removed from the second only (ppcor::spcor.test), in both directions: how much the adjusted second variable still relates to the first. For Pearson, its square is the share of the first variable’s variance the second explains beyond the controls."
      />
      {r.pairs.some((p) => p.n - 2 - p.gp < 1) && (
        <p className="hint">
          Fewer cases than variables: the tests have no degrees of freedom ({fmt(r.n, 0)} cases).
        </p>
      )}
    </div>
  );
}

/** Why the analysis cannot run: too few variables, or variables that are not columns. */
function pcorBlocked(o: PcorOptions, ctx: Parameters<typeof missingColumns>[0]): string | null {
  if (o.vars.length < 2) return 'Choose at least two variables.';
  if (!o.controls.length && o.vars.length < 3)
    return 'Choose control variables, or at least three variables (each pair controlled for the others).';
  if (o.controls.some((x) => o.vars.includes(x)))
    return 'A control variable cannot also be one of the variables.';
  return missingColumns(ctx, [...o.vars, ...o.controls], 'Partial correlation');
}

export const pcorAnalysis: AnalysisType<PcorOptions, PcorResult> = {
  id: 'pcor',
  title: 'Partial correlation',
  sub: 'partial and semi-partial (part) correlations controlling for other variables (ppcor)',
  group: 'Basic statistics',
  cardTitle: (o) => `Partial ${METHOD_NAME[o.method]} correlations`,
  defaults: () => ({ vars: [], controls: [], method: 'pearson' }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          vars: names(raw.vars),
          controls: names(raw.controls),
          method: oneOf(raw.method, PCOR_METHODS, 'pearson'),
        }
      : null,
  Options: PcorForm,
  View: ({ result }) => <PcorView r={result} />,
  blocked: pcorBlocked,
  fingerprint: (o, ctx) =>
    columnsFingerprint(
      ctx,
      [...o.vars, ...o.controls],
      [o.method, `controls:${o.controls.join(',')}`],
    ),
  run: async (o, ctx) => (await import('../rengine/pcor')).pcorR(rawData(ctx)!, o),
  script: async (o, ctx) => (await import('../rengine/pcor')).pcorScriptR(rawData(ctx)!, o),
  summary: (o) => {
    const vars = o.vars.join(', ') || '…';
    const controls = o.controls.length ? ` | ${o.controls.join(', ')}` : '';
    return `${METHOD_NAME[o.method]} · ${vars}${controls}`;
  },
};
