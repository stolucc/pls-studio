// Dynamic panel models with fixed effects by maximum likelihood (ML-SEM; Allison, Williams & Moral-Benito 2017):
// the outcome at each wave on its own previous value and on the predictors' previous waves, with a fixed effect that
// absorbs every stable difference between units, observed or not, as the dpm package writes the model in lavaan.

import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table } from '../components/results/Table';
import { dpmColumns, type DpmInput, type DpmPredictor, type DpmResult } from '../rengine/dpm';
import { columnsFingerprint, flag, isObj, missingColumns, names, rawData } from './common';
import { fitCards, IN_TIME_ORDER, lavaanOf, MISSING_NOTE } from './longitudinal';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export type DpmOptions = Pick<DpmInput, 'y' | 'x' | 'constant' | 'equalErrors'>;

/** At most this many time-varying predictors. */
const MAX_PREDICTORS = 6;

export const dpmInput = (
  o: DpmOptions,
  ctx: Pick<AnalysisCtx, 'settings' | 'model'>,
): DpmInput => ({
  ...o,
  ...lavaanOf(ctx),
});

function DpmForm({ options: o, set, ctx, disabled }: OptionsProps<DpmOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data with repeated measures first.</div>;
  const used = dpmColumns(o);
  const free = (own: string[]) => d.names.filter((n) => own.includes(n) || !used.includes(n));
  const setX = (k: number, p: DpmPredictor) =>
    set({ ...o, x: o.x.map((q, j) => (j === k ? p : q)) });
  const l = lavaanOf(ctx);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <OrderedPicker
        label="Outcome at each wave"
        hint={IN_TIME_ORDER}
        columns={free(o.y)}
        value={o.y}
        onChange={(y) => set({ ...o, y })}
      />
      {o.x.map((p, k) => (
        <div key={k} className="field">
          <OrderedPicker
            label={`Time-varying predictor ${k + 1}, at the same waves`}
            hint={IN_TIME_ORDER}
            columns={free(p.waves)}
            value={p.waves}
            onChange={(waves) => setX(k, { ...p, waves })}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={p.predetermined}
              onChange={(e) => setX(k, { ...p, predetermined: e.target.checked })}
            />
            <span>Predetermined: it may respond to earlier values of the outcome</span>
          </label>
          <button
            className="btn sm ghost"
            onClick={() => set({ ...o, x: o.x.filter((_, j) => j !== k) })}
          >
            Remove predictor {k + 1}
          </button>
        </div>
      ))}
      {o.x.length < MAX_PREDICTORS && (
        <button
          className="btn sm"
          onClick={() => set({ ...o, x: [...o.x, { waves: [], predetermined: false }] })}
        >
          Add a time-varying predictor
        </button>
      )}
      <OrderedPicker
        label="Time-invariant predictors (optional)"
        columns={free(o.constant)}
        value={o.constant}
        onChange={(constant) => set({ ...o, constant })}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={o.equalErrors}
          onChange={(e) => set({ ...o, equalErrors: e.target.checked })}
        />
        <span>Equal error variances at every wave</span>
      </label>
      <div className="hint">
        Each wave of the outcome is regressed on its previous wave and on the previous wave of each
        predictor, with the same coefficients at every wave, and a fixed effect (loadings 1 from
        wave 2) free to covary with the lagged predictors and the first wave: the effects are
        estimated within units, controlling for everything about them that does not change. lavaan{' '}
        {l.estimator}
        {MISSING_NOTE[l.missing] ?? ''}
        {l.information ? ', observed-information standard errors' : ''} (from the Model settings).
      </div>
    </fieldset>
  );
}

function DpmView({ r }: { r: DpmResult }) {
  return (
    <div className="tables">
      {fitCards(r.fit)}
      <Table
        title="Effects (equal over waves)"
        file="dpm-effects"
        columns={['Predictor', 'Estimate', 'Std. error', 'z', 'p']}
        rows={r.coefficients.map((x) => [
          c(x.name),
          c(x.est),
          c(x.se),
          c(x.z, undefined, 3),
          pCell(x.p),
        ])}
        note="Lagged effects are within-unit: the change in the outcome one wave after a change in the predictor, the unit’s stable characteristics held constant by the fixed effect (Allison, Williams & Moral-Benito 2017). A time-invariant predictor’s effect is identified only because the fixed effect is not allowed to covary with it."
      />
      <Table
        title="Variances"
        file="dpm-variances"
        columns={['Parameter', 'Estimate', 'Std. error']}
        rows={[
          [c('Fixed effect (alpha)'), c(r.alphaVariance.est), c(r.alphaVariance.se)],
          ...(r.errorVariance
            ? [[c('Error variance (every wave)'), c(r.errorVariance.est), c(r.errorVariance.se)]]
            : []),
        ]}
      />
      <p className="hint">
        N = {r.n} units, {r.waves} waves; lavaan {r.engine.version}, the model as the dpm package
        writes it.
      </p>
    </div>
  );
}

function dpmBlocked(o: DpmOptions, ctx: AnalysisCtx): string | null {
  if (o.y.length < 3) return 'Choose the outcome at three or more waves.';
  if (o.x.some((p) => p.waves.length !== o.y.length))
    return 'Choose each time-varying predictor at the same waves as the outcome.';
  const cols = dpmColumns(o);
  if (new Set(cols).size !== cols.length) return 'A column is used twice.';
  return missingColumns(ctx, cols, 'The dynamic panel model');
}

const parsePredictors = (v: unknown): DpmPredictor[] =>
  Array.isArray(v)
    ? v
        .filter(isObj)
        .slice(0, MAX_PREDICTORS)
        .map((p) => ({ waves: names(p.waves), predetermined: flag(p.predetermined) }))
    : [];

export const dpmAnalysis: AnalysisType<DpmOptions, DpmResult> = {
  id: 'dpm',
  title: 'Dynamic panel model with fixed effects (ML-SEM)',
  sub: 'lagged effects within units, a fixed effect for everything stable (lavaan, as dpm)',
  group: 'Longitudinal',
  defaults: () => ({
    y: [],
    x: [{ waves: [], predetermined: false }],
    constant: [],
    equalErrors: false,
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          y: names(raw.y),
          x: parsePredictors(raw.x),
          constant: names(raw.constant),
          equalErrors: flag(raw.equalErrors),
        }
      : null,
  Options: DpmForm,
  View: ({ result }) => <DpmView r={result} />,
  blocked: dpmBlocked,
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, dpmColumns(o), [
      o.x.map((p) => (p.predetermined ? 'p' : 'x')).join(''),
      o.x.map((p) => p.waves.length).join(','),
      o.constant.length,
      o.equalErrors ? 'eq' : '',
      lavaanOf(ctx).estimator,
      lavaanOf(ctx).missing,
      lavaanOf(ctx).information ?? '',
    ]),
  run: async (o, ctx) => (await import('../rengine/dpm')).dpmR(rawData(ctx)!, dpmInput(o, ctx)),
  script: async (o, ctx) =>
    (await import('../rengine/dpm')).dpmScriptR(rawData(ctx)!, dpmInput(o, ctx)),
  summary: (o) =>
    `${o.y.length} waves · ${o.x.length} time-varying predictor${o.x.length === 1 ? '' : 's'}${o.equalErrors ? ' · equal errors' : ''}`,
};
