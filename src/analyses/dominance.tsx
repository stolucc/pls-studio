// Dominance analysis (Budescu 1993; Azen & Budescu 2003): how much each predictor of a linear regression contributes
// to R², from the R² of every subset of the predictors. General dominance splits the full R² among the predictors
// (it equals LMG and the Shapley value); conditional dominance shows the contributions by the number of other
// predictors already in the model; complete dominance compares two predictors over every subset of the others.
// Fungible weights (Waller 2008): how far each weight can move when R² may drop a little.

import { OrderedPicker } from '../components/OrderedPicker';
import { c, Table, type Row } from '../components/results/Table';
import type { DominanceInput, DominanceResult } from '../rengine/dominance';
import {
  clampNum,
  ColumnSelect,
  columnsFingerprint,
  isObj,
  missingColumns,
  name,
  names,
  rawData,
} from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export type DominanceOptions = DominanceInput;

/** At most this many predictors: every subset is fitted (2^k). */
export const MAX_DOMINANCE_PREDICTORS = 12;

function DominanceForm({ options: o, set, ctx, disabled }: OptionsProps<DominanceOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data first.</div>;
  const numeric = d.names.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <ColumnSelect
        id="dominance-outcome"
        label="Outcome"
        value={o.outcome}
        columns={numeric}
        exclude={o.predictors}
        onChange={(outcome) => set({ ...o, outcome })}
      />
      <OrderedPicker
        label={`Predictors (2–${MAX_DOMINANCE_PREDICTORS})`}
        columns={numeric.filter((n) => n !== o.outcome)}
        value={o.predictors}
        onChange={(predictors) => set({ ...o, predictors })}
      />
      <div className="field">
        <label htmlFor="dominance-loss">Fungible weights: R² given up</label>
        <input
          id="dominance-loss"
          className="input"
          type="number"
          min={0.001}
          max={0.2}
          step={0.005}
          value={o.loss}
          onChange={(e) => set({ ...o, loss: clampNum(e.target.value, 0.001, 0.2, o.loss) })}
        />
        <div className="hint">
          How far each standardised weight can move if R² may fall by this much (Waller 2008).
        </div>
      </div>
      <div className="hint">
        Every subset of the predictors is fitted by least squares (2^k regressions), and each
        predictor’s contribution to R² is averaged over them. Rows with a missing value in any
        chosen column are left out (listwise).
      </div>
    </fieldset>
  );
}

/** Pairs where one predictor dominates the other completely (adds more to every subset of the rest). */
export function completePairs(r: DominanceResult): [string, string][] {
  const out: [string, string][] = [];
  r.complete.forEach((row, i) =>
    row.forEach((share, j) => {
      if (share === 1) out.push([r.predictors[i], r.predictors[j]]);
    }),
  );
  return out;
}

function DominanceView({ r }: { r: DominanceResult }) {
  const k = r.predictors.length;
  const order = r.predictors.map((_, i) => i).sort((a, b) => r.general[b] - r.general[a]);
  const general: Row[] = order.map((i, rank) => [
    c(r.predictors[i]),
    c(r.general[i]),
    c(`${((100 * r.general[i]) / r.r2).toFixed(1)}%`),
    c(rank + 1, '', 0),
    c(r.r2Alone[i]),
    c(r.beta[i]),
  ]);
  const conditional: Row[] = order.map((i) => [
    c(r.predictors[i]),
    ...r.conditional[i].map((x) => c(x)),
  ]);
  const complete: Row[] = r.predictors.map((p, i) => [
    c(p),
    ...r.complete[i].map((x) => (x === null ? c('—') : c(x))),
  ]);
  const pairs = completePairs(r);
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.outcome} on {k} predictors: R² = {r.r2.toFixed(3)}, N = {r.n} (listwise); {2 ** k}{' '}
        subset regressions (base R {r.engine.version}).
      </p>
      <Table
        title="General dominance"
        file="dominance-general"
        columns={['Predictor', 'General dominance', 'Share of R²', 'Rank', 'R² alone (r²)', 'β']}
        rows={general}
        note="Each predictor’s average increment in R² over all the models, averaged first within each number of other predictors (Azen & Budescu 2003). The weights sum to the full R², so each is the predictor’s share of the explained variance; they equal LMG (Lindeman, Merenda & Gold) and the Shapley value. R² alone: the squared correlation with the outcome; β: the standardised coefficient in the full model."
      />
      <Table
        title="Conditional dominance"
        file="dominance-conditional"
        columns={[
          'Predictor',
          ...Array.from({ length: k }, (_, m) =>
            m === 0 ? 'Alone' : `With ${m} other${m === 1 ? '' : 's'}`,
          ),
        ]}
        rows={conditional}
        note="The predictor’s average increment in R² when added to the models with that many of the other predictors. One predictor conditionally dominates another if its increment is larger in every column."
      />
      {k <= 8 && (
        <Table
          title="Complete dominance"
          file="dominance-complete"
          columns={['Row adds more than column in…', ...r.predictors]}
          rows={complete}
          note="The share of the subsets of the other predictors to which the row predictor adds more R² than the column predictor. 1: the row dominates the column completely (it adds more in every model); 0: the column dominates the row; in between, neither dominates completely."
        />
      )}
      <Table
        title={`Fungible weights: R² lower by ${r.fungible.loss}`}
        file="dominance-fungible"
        columns={['Predictor', 'β (least squares)', 'Smallest', 'Largest', 'Sign can change']}
        rows={r.predictors.map((p, i) => [
          c(p),
          c(r.beta[i]),
          c(r.fungible.lower[i]),
          c(r.fungible.upper[i]),
          c(r.fungible.lower[i] < 0 && r.fungible.upper[i] > 0 ? 'yes' : 'no'),
        ])}
        note={`Waller (2008): every set of standardised weights that predicts ${r.outcome} with R² = ${(r.r2 - r.fungible.loss).toFixed(3)} instead of ${r.r2.toFixed(3)} (each correlating ${r.fungible.r.toFixed(4)} with the least-squares prediction), rescaled by least squares; the smallest and largest value each weight takes among them (Waller & Jones 2009). Wide ranges, or ranges that cross 0, mean the data say little about that weight even though the prediction hardly changes.`}
      />
      <p className="hint">
        {pairs.length
          ? `Complete dominance: ${pairs.map(([a, b]) => `${a} over ${b}`).join('; ')}.`
          : 'No predictor dominates another completely.'}
      </p>
    </div>
  );
}

function dominanceBlocked(o: DominanceOptions, ctx: AnalysisCtx): string | null {
  if (!o.outcome) return 'Choose the outcome.';
  if (o.predictors.length < 2) return 'Choose at least two predictors.';
  if (o.predictors.length > MAX_DOMINANCE_PREDICTORS)
    return `Choose at most ${MAX_DOMINANCE_PREDICTORS} predictors: every subset of them is fitted.`;
  if (o.predictors.includes(o.outcome)) return 'The outcome cannot also be a predictor.';
  return missingColumns(ctx, [o.outcome, ...o.predictors], 'Dominance analysis');
}

export const dominanceAnalysis: AnalysisType<DominanceOptions, DominanceResult> = {
  id: 'dominance',
  title: 'Dominance analysis',
  sub: 'each predictor’s share of R², from every subset regression (relative importance)',
  group: 'Regression and causal inference',
  defaults: () => ({ outcome: '', predictors: [], loss: 0.01 }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          outcome: name(raw.outcome) ?? '',
          predictors: names(raw.predictors),
          loss: clampNum(raw.loss, 0.001, 0.2, 0.01),
        }
      : null,
  Options: DominanceForm,
  View: ({ result }) => <DominanceView r={result} />,
  blocked: dominanceBlocked,
  fingerprint: (o, ctx) => columnsFingerprint(ctx, [o.outcome, ...o.predictors], [o.loss]),
  run: async (o, ctx) => (await import('../rengine/dominance')).dominanceR(rawData(ctx)!, o),
  script: async (o, ctx) =>
    (await import('../rengine/dominance')).dominanceScriptR(rawData(ctx)!, o),
  summary: (o) => `${o.outcome || '…'} on ${o.predictors.length} predictors`,
};
