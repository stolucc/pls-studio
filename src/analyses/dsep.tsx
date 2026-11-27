// Local fit from the independencies a path model implies (Thoemmes, Rosseel & Textor 2018): every pair of variables
// the model does not join must be independent given the parents of both (d-separation). Each claim is tested in the
// data on its own, so a rejected claim points at the arrow or covariance the model misses, which a global χ² does not.

import { c, pCell, Table } from '../components/results/Table';
import { basisSet, dsepProblem } from '../model/dsep';
import type { DsepInput, DsepResult } from '../rengine/dsep';
import { cbModelBlocked } from './cbModel';
import { columnsFingerprint, isObj, rawData } from './common';
import type { AnalysisCtx, AnalysisType } from './types';

export type DsepOptions = Record<string, never>;

export function dsepInput(ctx: AnalysisCtx): DsepInput {
  const model = ctx.model!;
  return {
    variables: model.constructs.map((k) => k.indicators[0]),
    claims: basisSet(model),
  };
}

function DsepView({ r }: { r: DsepResult }) {
  const rejected = r.claims.filter((x) => x.holm < 0.05);
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.claims.length} implied independencies, N = {r.n} (complete cases). Shipley’s Fisher’s C ={' '}
        {r.fisherC.toFixed(2)} on {r.fisherDf} df, p ={' '}
        {r.fisherP < 0.001 ? '< .001' : r.fisherP.toFixed(3)}.
      </p>
      <Table
        title="Implied independencies (d-separation)"
        file="dsep-claims"
        columns={['Claim', 'Given', 'Partial r', '95% CI', 't', 'df', 'p', 'p (Holm)']}
        rows={r.claims.map((x) => [
          c(`${x.y} ⫫ ${x.x}`),
          c(x.given.length ? x.given.join(', ') : '—'),
          c(x.r),
          c(`[${x.lower.toFixed(3)}, ${x.upper.toFixed(3)}]`),
          c(x.t, undefined, 3),
          c(x.df, '', 0),
          pCell(x.p),
          pCell(x.holm),
        ])}
        note="Each pair of variables the model joins by no arrow (nor a free covariance between exogenous variables) must be uncorrelated once the parents of both are held constant (Shipley’s basis set; Thoemmes, Rosseel & Textor 2018). Tested by the t test of the partial correlation, i.e. of x in the regression of y on x and the conditioning variables (as piecewiseSEM::dSep); the interval by Fisher’s z. Fisher’s C = −2 Σ log p combines the claims (χ² on 2k df). Linear relations and normal residuals are assumed."
      />
      <p className="hint">
        {rejected.length
          ? `Rejected after Holm’s correction: ${rejected.map((x) => `${x.y} ⫫ ${x.x}`).join('; ')}. The model may miss an arrow or a common cause between them.`
          : 'No claim is rejected after Holm’s correction.'}
      </p>
    </div>
  );
}

function dsepBlocked(_o: DsepOptions, ctx: AnalysisCtx): string | null {
  const m = cbModelBlocked(ctx, 'The tests of implied independencies');
  if (m) return m;
  const why = dsepProblem(ctx.model!);
  if (why) return `The tests of implied independencies are for recursive path models: ${why}`;
  if (!basisSet(ctx.model!).length)
    return 'The model implies no independencies: every pair of variables is joined by an arrow or a covariance.';
  return null;
}

export const dsepAnalysis: AnalysisType<DsepOptions, DsepResult> = {
  id: 'dsep',
  title: 'Implied independencies (d-separation)',
  sub: 'local fit: each conditional independence a path model implies, tested on its own (base R)',
  group: 'CB-SEM model',
  defaults: () => ({}),
  parseOptions: (raw) => (isObj(raw) ? {} : null),
  Options: ({ ctx }) => {
    const claims = ctx.model && !dsepProblem(ctx.model) ? basisSet(ctx.model) : [];
    return (
      <fieldset className="card-options">
        <p className="hint" style={{ marginTop: 0 }}>
          Which of the model’s missing arrows does the data contradict? Every pair of variables the
          path model on the canvas leaves unjoined must be independent given the parents of both;
          each such claim is tested in the data on its own (no model is fitted).
          {claims.length ? ` This model implies ${claims.length}.` : ''}
        </p>
      </fieldset>
    );
  },
  View: ({ result }) => <DsepView r={result} />,
  blocked: dsepBlocked,
  fingerprint: (_o, ctx) =>
    ctx.model
      ? columnsFingerprint(
          ctx,
          ctx.model.constructs.map((k) => k.indicators[0]),
          [JSON.stringify(basisSet(ctx.model))],
        )
      : null,
  run: async (_o, ctx) => (await import('../rengine/dsep')).dsepR(rawData(ctx)!, dsepInput(ctx)),
  script: async (_o, ctx) =>
    (await import('../rengine/dsep')).dsepScriptR(rawData(ctx)!, dsepInput(ctx)),
  summary: (_o) => 'basis set, partial correlations, Fisher’s C',
};
