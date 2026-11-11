// Regression card: linear, logistic / probit (also binomial counts), Poisson
// and negative binomial (also zero-inflated or hurdle), Gamma, ordinal, multinomial,
// censored (tobit, also censored-inflated) and survival (Cox, piecewise
// exponential), with categorical predictors, interaction terms, weights and
// robust standard errors.

import { useState } from 'react';
import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { fmt, fmtP, pIs } from '../format';
import {
  isZeroModel,
  type Coefficient,
  type DurbinWatson,
  type Family,
  type RegressionCurve,
  type RegressionInput,
  type RegressionResult,
} from '../rengine/regression';
import { confirmDialog } from '../components/Overlays';
import { newId, type Construct, type ModelState, type Path } from '../model/project';
import { useStore } from '../store';
import {
  Choice,
  ColumnSelect,
  columnsFingerprint,
  isObj,
  missingColumns,
  name,
  names,
  oneOf,
  rawData,
} from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';
import { seriesColor } from '../figure/palette';

/** `plot`: which predictor's partial-effect curve to show (display only). */
export interface RegressionOptions
  extends Pick<
    RegressionInput,
    | 'censoring'
    | 'inflated'
    | 'reference'
    | 'status'
    | 'statusCensored'
    | 'cuts'
    | 'randomSlope'
    | 'zeroModel'
    | 'zeroPart'
    | 'zeroPredictors'
  > {
  outcome: string;
  predictors: string[];
  categorical: string[];
  interactions: string[][];
  family: Family;
  link: string;
  trials: string;
  weights: string;
  se: RegressionInput['se'];
  cluster: string;
  plot: string;
}
type Result = RegressionResult & { input: RegressionInput };

export const FAMILIES: readonly (readonly [Family, string, string])[] = [
  ['gaussian', 'Linear (Gaussian)', 'Ordinary least squares for a continuous outcome (lm).'],
  [
    'binomial',
    'Logistic / probit',
    'A 0/1 outcome, or counts of successes with the number of trials (glm, binomial).',
  ],
  ['poisson', 'Poisson', 'A count outcome; check the dispersion (glm, poisson).'],
  ['negbin', 'Negative binomial', 'An over-dispersed count outcome (MASS::glm.nb).'],
  ['gamma', 'Gamma', 'A positive, right-skewed outcome; inverse link (glm, Gamma).'],
  ['ordinal', 'Ordinal (proportional odds)', 'An ordered categorical outcome (MASS::polr).'],
  [
    'multinomial',
    'Multinomial logistic',
    'An unordered categorical outcome, one equation per level against a reference level (nnet::multinom).',
  ],
  [
    'censored',
    'Censored (tobit)',
    'A continuous outcome censored at its lowest (or highest) value: a normal model for the latent outcome (survival::survreg); optionally censored-inflated.',
  ],
  [
    'survival',
    'Survival (Cox, piecewise exponential)',
    'Time to an event, with censored times: Cox regression (survival::coxph), or a piecewise-constant baseline hazard with cut points.',
  ],
];
/** The count models' zero parts (pscl): zero-inflated or hurdle. */
export const ZERO_MODELS = ['zeroinfl', 'hurdle'] as const;
/** Models whose standard errors are model-based or HC0 (the maximum-likelihood sandwich, Mplus MLR) only. */
const ownSe = (o: Pick<RegressionOptions, 'family' | 'inflated' | 'randomSlope' | 'zeroModel'>) =>
  o.family === 'multinomial' ||
  o.family === 'censored' ||
  o.family === 'survival' ||
  (o.family === 'poisson' && !!o.inflated) ||
  (o.family === 'gaussian' && !!o.randomSlope) ||
  isZeroModel(o);
/** The zero part's predictors when chosen (y ~ x | z), otherwise none of its own. */
const zeroPreds = (o: RegressionOptions) =>
  isZeroModel(o) && o.zeroPart === 'chosen' ? (o.zeroPredictors ?? []) : [];
/** The count models' treatment of zeros: none, pscl's zero-inflated or hurdle model, or (Poisson) the zero-inflated Poisson written out. */
type ZeroChoice = 'none' | 'zeroinfl' | 'hurdle' | 'mplus';
const zeroChoice = (o: RegressionOptions): ZeroChoice => {
  if (o.family === 'poisson' && o.inflated) return 'mplus';
  if (isZeroModel(o)) return o.zeroModel!;
  return 'none';
};
const ZERO_HINT: Record<ZeroChoice, string> = {
  none: 'Every zero comes from the count distribution.',
  zeroinfl:
    'Zero-inflated (pscl::zeroinfl): a share of the cases are structural zeros, with a logit model for their probability; the others follow the count distribution, which can produce zeros too. Vuong’s test compares it with the standard model.',
  hurdle:
    'Hurdle (pscl::hurdle): a logit model for whether the count is above zero (crossing the hurdle), and a zero-truncated count distribution for the positive counts. Vuong’s test compares it with the standard model.',
  mplus:
    'The zero-inflated Poisson as Mplus estimates it (COUNT = u (i)): the inflation on the same predictors, maximum likelihood written out in R (optim). It agrees with pscl::zeroinfl on the same predictors.',
};
/** Cut points typed as a list ("1, 2, 3") or ranges ("1:20"). */
export function parseCuts(text: string): number[] {
  const out: number[] = [];
  for (const piece of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(-?[\d.]+):(-?[\d.]+)$/.exec(piece);
    if (m) {
      const a = Number(m[1]),
        b = Number(m[2]);
      if (Number.isFinite(a) && Number.isFinite(b) && b - a <= 1000)
        for (let x = Math.ceil(a); x <= b; x++) out.push(x);
    } else if (Number.isFinite(Number(piece))) out.push(Number(piece));
  }
  return [...new Set(out.filter((x) => x > 0))].sort((a, b) => a - b).slice(0, 200);
}
const FAMILY_NAME = Object.fromEntries(FAMILIES.map(([id, l]) => [id, l])) as Record<
  Family,
  string
>;
export const LINKS: Record<string, readonly (readonly [string, string])[]> = {
  binomial: [
    ['logit', 'Logit'],
    ['probit', 'Probit'],
    ['cloglog', 'Complementary log-log'],
  ],
  ordinal: [
    ['logistic', 'Logit'],
    ['probit', 'Probit'],
    ['cloglog', 'Complementary log-log'],
  ],
};

function RegressionOptionsForm({
  options: o,
  set,
  ctx,
  disabled,
}: OptionsProps<RegressionOptions>) {
  const d = rawData(ctx);
  const columns = d?.names ?? [];
  const [ia, setIa] = useState<string[]>([]);
  if (!d || !columns.length) return <div className="empty-results">Import raw data first.</div>;
  const taken = [
    o.outcome,
    o.trials,
    o.weights,
    o.cluster,
    o.family === 'survival' ? (o.status ?? '') : '',
  ];
  const text = (n: string) => !!d.categories?.[n];
  const links = LINKS[o.family];
  return (
    <fieldset className="card-options" disabled={disabled}>
      <div className="field">
        <label htmlFor="reg-family">Model</label>
        <select
          id="reg-family"
          className="select"
          value={o.family}
          onChange={(e) => {
            const family = e.target.value as Family;
            const own =
              family === 'ordinal' ||
              (ownSe({ family, inflated: o.inflated, randomSlope: o.randomSlope }) &&
                o.se !== 'HC0');
            set({
              ...o,
              family,
              link: family === 'ordinal' ? 'logistic' : 'logit',
              trials: family === 'binomial' ? o.trials : '',
              ...(own ? { se: 'model', cluster: '' } : {}),
            });
          }}
        >
          {FAMILIES.map(([id, l]) => (
            <option key={id} value={id}>
              {l}
            </option>
          ))}
        </select>
        <div className="hint">{FAMILIES.find(([id]) => id === o.family)![2]}</div>
      </div>
      {links && (
        <Choice
          label="Link"
          value={o.link}
          onChange={(link) => set({ ...o, link })}
          options={links}
        />
      )}
      <ColumnSelect
        id="reg-y"
        label={o.family === 'binomial' && o.trials ? 'Outcome (successes)' : 'Outcome'}
        value={o.outcome}
        columns={columns}
        exclude={[...o.predictors, ...taken.filter((x) => x !== o.outcome)]}
        onChange={(outcome) => set({ ...o, outcome })}
      />
      {o.family === 'survival' && (
        <>
          <ColumnSelect
            id="reg-status"
            label="Status (0/1)"
            value={o.status ?? ''}
            columns={columns}
            exclude={[o.outcome, ...o.predictors]}
            onChange={(status) => set({ ...o, status })}
          />
          <Choice
            label="Status coding"
            value={o.statusCensored ? 'censored' : 'event'}
            onChange={(v) => set({ ...o, statusCensored: v === 'censored' })}
            options={[
              ['event', '1 = event'],
              ['censored', '1 = censored (Mplus TIMECENSORED)'],
            ]}
          />
          <div className="field">
            <label htmlFor="reg-cuts">Baseline hazard</label>
            <input
              id="reg-cuts"
              className="input"
              placeholder="Cox (none); or cut points, e.g. 1:20"
              defaultValue={(o.cuts ?? []).join(', ')}
              onBlur={(e) => set({ ...o, cuts: parseCuts(e.target.value) })}
            />
            <div className="hint">
              Empty: Cox regression (the baseline hazard left unspecified). Cut points (a list, or a
              range such as 1:20): a constant baseline hazard within each interval, the last
              open-ended (piecewise exponential; Mplus SURVIVAL = t (20*1) with BASEHAZARD = ON).
            </div>
          </div>
        </>
      )}
      {o.family === 'censored' && (
        <Choice
          label="Censored"
          value={o.censoring ?? 'below'}
          onChange={(censoring) => set({ ...o, censoring })}
          options={[
            ['below', 'From below (at the lowest value)'],
            ['above', 'From above (at the highest value)'],
          ]}
        />
      )}
      {o.family === 'censored' && (
        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={!!o.inflated}
              onChange={(e) =>
                set({
                  ...o,
                  inflated: e.target.checked,
                  ...(e.target.checked && o.se !== 'model' && o.se !== 'HC0'
                    ? { se: 'model', cluster: '' }
                    : {}),
                })
              }
            />{' '}
            Censored-inflated
          </label>
          <div className="hint">
            Extra values at the censoring point: a logistic model (the inflation) for their
            probability, on the same predictors (Mplus CENSORED = y (bi)). Maximum likelihood
            written out in R (optim).
          </div>
        </div>
      )}
      {(o.family === 'poisson' || o.family === 'negbin') && (
        <div className="field">
          <label htmlFor="reg-zero">Excess zeros</label>
          <select
            id="reg-zero"
            className="select"
            value={zeroChoice(o)}
            onChange={(e) => {
              const z = e.target.value as ZeroChoice;
              const { inflated: _i, zeroModel: _m, ...rest } = o;
              const robustOk = o.se === 'model' || o.se === 'HC0';
              let zeroOptions = {};
              if (z === 'mplus') zeroOptions = { inflated: true };
              else if (z !== 'none') zeroOptions = { zeroModel: z, zeroPart: o.zeroPart ?? 'same' };
              // The zero models take no weights, and of the robust standard errors only HC0.
              let restrictions = {};
              if (z !== 'none')
                restrictions = {
                  weights: '',
                  ...(robustOk ? {} : { se: 'model' as const, cluster: '' }),
                };
              set({ ...rest, ...zeroOptions, ...restrictions });
            }}
          >
            <option value="none">None (the standard count model)</option>
            <option value="zeroinfl">Zero-inflated (pscl::zeroinfl)</option>
            <option value="hurdle">Hurdle (pscl::hurdle)</option>
            {o.family === 'poisson' && (
              <option value="mplus">Zero-inflated, as Mplus COUNT (i) (same predictors)</option>
            )}
          </select>
          <div className="hint">{ZERO_HINT[zeroChoice(o)]}</div>
        </div>
      )}
      {isZeroModel(o) && (
        <>
          <Choice
            label={o.zeroModel === 'hurdle' ? 'Zero hurdle on' : 'Zero inflation on'}
            value={o.zeroPart ?? 'same'}
            onChange={(zeroPart) => set({ ...o, zeroPart })}
            options={[
              ['same', 'The count part’s predictors'],
              ['intercept', 'An intercept only'],
              ['chosen', 'Its own predictors'],
            ]}
          />
          {o.zeroPart === 'chosen' && (
            <OrderedPicker
              label={`Predictors of the zero part (${o.zeroModel === 'hurdle' ? 'the logit model for a count above zero' : 'the logit model for a structural zero'})`}
              columns={columns.filter((n) => !taken.includes(n))}
              value={o.zeroPredictors ?? []}
              onChange={(zeroPredictors) =>
                set({
                  ...o,
                  zeroPredictors,
                  categorical: o.categorical.filter(
                    (x) =>
                      o.predictors.includes(x) ||
                      zeroPredictors.includes(x) ||
                      o.interactions.some((t) => t.includes(x)),
                  ),
                })
              }
            />
          )}
        </>
      )}
      {o.family === 'multinomial' && (
        <Choice
          label="Reference level"
          value={o.reference ?? 'first'}
          onChange={(reference) => set({ ...o, reference })}
          options={[
            ['first', 'First (R)'],
            ['last', 'Last (Mplus)'],
          ]}
        />
      )}
      {o.family === 'binomial' && (
        <ColumnSelect
          id="reg-n"
          label="Trials (optional: for counts of successes)"
          optional="None: the outcome is 0/1"
          value={o.trials}
          columns={columns}
          exclude={[o.outcome, ...o.predictors]}
          onChange={(trials) => set({ ...o, trials })}
        />
      )}
      <OrderedPicker
        label={
          isZeroModel(o) ? 'Predictors (main effects; the count part)' : 'Predictors (main effects)'
        }
        columns={columns.filter((n) => !taken.includes(n))}
        value={o.predictors}
        onChange={(predictors) =>
          set({
            ...o,
            predictors,
            categorical: o.categorical.filter(
              (x) =>
                predictors.includes(x) ||
                zeroPreds(o).includes(x) ||
                o.interactions.some((t) => t.includes(x)),
            ),
          })
        }
      />
      {[...new Set([...o.predictors, ...o.interactions.flat(), ...zeroPreds(o)])].some(
        (n) => !text(n),
      ) && (
        <div className="field">
          <label>Treat as categorical</label>
          <div className="chips">
            {[...new Set([...o.predictors, ...o.interactions.flat(), ...zeroPreds(o)])]
              .filter((n) => !text(n))
              .map((n) => (
                <label key={n} className="check">
                  <input
                    type="checkbox"
                    checked={o.categorical.includes(n)}
                    onChange={(e) =>
                      set({
                        ...o,
                        categorical: e.target.checked
                          ? [...o.categorical, n]
                          : o.categorical.filter((x) => x !== n),
                      })
                    }
                  />{' '}
                  {n}
                </label>
              ))}
          </div>
          <div className="hint">
            Numeric codes that stand for groups: one dummy per level, the lowest value as reference.
            Text columns are categorical anyway.
          </div>
        </div>
      )}
      {o.predictors.length >= 1 && (
        <div className="field">
          <label>Interaction terms</label>
          {o.interactions.map((t, i) => (
            <div key={i} className="chips" style={{ alignItems: 'center' }}>
              <span>{t.join(' × ')}</span>
              <button
                className="btn sm ghost"
                onClick={() =>
                  set({ ...o, interactions: o.interactions.filter((_, k) => k !== i) })
                }
                aria-label={`Remove ${t.join(' × ')}`}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="chips" style={{ alignItems: 'center' }}>
            {columns
              .filter((n) => !taken.includes(n))
              .map((n) => (
                <label key={n} className="check">
                  <input
                    type="checkbox"
                    checked={ia.includes(n)}
                    onChange={(e) =>
                      setIa(e.target.checked ? [...ia, n] : ia.filter((x) => x !== n))
                    }
                  />{' '}
                  {n}
                </label>
              ))}
            <button
              className="btn sm"
              disabled={
                ia.length < 2 ||
                o.interactions.some((t) => t.length === ia.length && t.every((x) => ia.includes(x)))
              }
              onClick={() => {
                set({
                  ...o,
                  interactions: [...o.interactions, columns.filter((n) => ia.includes(n))],
                });
                setIa([]);
              }}
            >
              Add term
            </button>
          </div>
          <div className="hint">
            Tick two or more variables and add their product (a:b in R). A variable that is not
            among the predictors enters through the term only (nested effects, as R’s a/b).
          </div>
        </div>
      )}
      {o.family === 'gaussian' && (
        <div className="field">
          <ColumnSelect
            id="reg-slope"
            label="Random slope (optional)"
            optional="None"
            value={o.randomSlope ?? ''}
            columns={o.predictors.filter((n) => !text(n) && !o.categorical.includes(n))}
            onChange={(v) => {
              const { randomSlope: _s, ...rest } = o;
              set(
                v
                  ? {
                      ...rest,
                      randomSlope: v,
                      weights: '',
                      ...(o.se !== 'model' && o.se !== 'HC0'
                        ? { se: 'model' as const, cluster: '' }
                        : {}),
                    }
                  : rest,
              );
            }}
          />
          <div className="hint">
            The slope of this predictor varies across cases, with a variance and a covariance with
            the residual: the residual variance becomes σ² + 2c·x + τ·x² (Mplus TYPE = RANDOM: s | y
            ON x; s WITH y; a regression of the slope on w is the interaction x × w). Maximum
            likelihood written out in R (optim).
          </div>
        </div>
      )}
      <div className="row2">
        <ColumnSelect
          id="reg-w"
          label="Frequency weights (optional)"
          optional="None"
          value={o.weights}
          columns={isZeroModel(o) ? [] : columns}
          exclude={[o.outcome, ...o.predictors, o.trials, o.cluster]}
          onChange={(weights) => set({ ...o, weights })}
        />
        <div className="field">
          <label htmlFor="reg-se">Standard errors</label>
          <select
            id="reg-se"
            className="select"
            value={o.se}
            disabled={o.family === 'ordinal'}
            onChange={(e) => {
              const se = e.target.value as RegressionInput['se'];
              set({ ...o, se, cluster: se === 'cluster' ? o.cluster : '' });
            }}
          >
            <option value="model">Model-based</option>
            {!ownSe(o) && <option value="HC3">Robust (HC3; small samples)</option>}
            <option value="HC0">
              {isZeroModel(o) ? 'Robust (HC0, sandwich)' : 'Robust (HC0, White; as Mplus MLR)'}
            </option>
            {!ownSe(o) && <option value="cluster">Cluster-robust</option>}
          </select>
        </div>
      </div>
      {o.se === 'cluster' && (
        <ColumnSelect
          id="reg-cl"
          label="Cluster"
          value={o.cluster}
          columns={columns}
          exclude={[o.outcome, ...o.predictors, o.trials, o.weights]}
          onChange={(cluster) => set({ ...o, cluster })}
        />
      )}
      {o.predictors.filter((n) => !text(n) && !o.categorical.includes(n)).length > 1 && (
        <ColumnSelect
          id="reg-plot"
          label="Curve over (display)"
          optional="The first numeric predictor"
          value={o.plot}
          columns={o.predictors.filter((n) => !text(n) && !o.categorical.includes(n))}
          onChange={(plot) => set({ ...o, plot })}
        />
      )}
      <div className="hint">
        The curve is a partial-effect plot: the fitted response over one predictor, the other
        predictors at their means (categorical ones at their reference level). For the raw relation
        between two columns use a Chart card.
      </div>
    </fieldset>
  );
}

const coefRow = (e: Coefficient, ratio: boolean): Row => [
  c(e.term),
  c(e.est),
  c(e.se),
  c(e.stat),
  pCell(e.p),
  c(`[${fmt(e.ciLow)}, ${fmt(e.ciHigh)}]`),
  ...(ratio ? [c(e.ratio ?? null)] : []),
];

/** Diagnostics rows of the Durbin–Watson test (lmtest::dwtest), when it ran. */
export function durbinWatsonRows(dw: DurbinWatson | undefined): Row[] {
  if (!dw) return [];
  const method = dw.exact ? 'exact (Pan)' : 'normal approximation';
  return [
    [c('Durbin–Watson d'), c(dw.stat)],
    [c(`p (H1: positive autocorrelation; ${method})`), pCell(dw.p)],
    [c('Lag-1 autocorrelation of the residuals'), c(dw.r1)],
  ];
}

function diagnosticsNote(dw: DurbinWatson | undefined): string {
  const base =
    'VIF above 5 (or 10) signals collinear predictors. ' +
    'Hosmer–Lemeshow: a small p means the fitted probabilities do not match the observed rates.';
  if (!dw) return base;
  return (
    `${base} Durbin–Watson (lmtest::dwtest): residuals in the order of the data rows; ` +
    'd near 2 means no first-order autocorrelation (d ≈ 2(1 − r₁)), below 2 positive. ' +
    'It is meaningful only when the row order means something (time, sequence).'
  );
}

function Curve({ r, cv }: { r: RegressionResult; cv: RegressionCurve }) {
  const W = 520,
    H = 300,
    pad = { l: 56, r: 16, t: 14, b: 44 };
  const probs = cv.probs;
  const ys = probs
    ? [0, 1]
    : (() => {
        let lo = Infinity,
          hi = -Infinity;
        for (const v of [...(cv.y ?? []), ...(cv.points?.y ?? [])]) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const m = (hi - lo || 1) * 0.05;
        return [lo - m, hi + m];
      })();
  const x0 = cv.grid[0],
    x1 = cv.grid[cv.grid.length - 1];
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((ys[1] - v) / (ys[1] - ys[0] || 1)) * (H - pad.t - pad.b);
  const ticks = (lo: number, hi: number) =>
    Array.from({ length: 6 }, (_, i) => lo + ((hi - lo) * i) / 5);
  return (
    <ChartFrame
      id={`regression:${cv.x}`}
      name={`regression-${cv.x}`}
      width={W}
      height={H}
      defaults={{
        x: cv.x,
        y: probs || r.family === 'binomial' ? 'Probability' : 'Predicted outcome',
      }}
      caption={
        <span className="hint">
          Partial effect of {cv.x}: the fitted {probs ? 'probability of each level' : 'response'}{' '}
          over it, the other predictors at their means (categorical ones at their reference level).
          {cv.points ? ' Dots: the observed values.' : ''}
          {r.curves.length > 1 ? ' Another predictor: Curve over, in the options.' : ''}
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={W}
          height={H}
          role="img"
          aria-label="Fitted curve"
        >
          {ticks(ys[0], ys[1]).map((v) => (
            <g key={v}>
              <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} />
              <text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">
                {fmt(v, 2)}
              </text>
            </g>
          ))}
          {ticks(x0, x1).map((v) => (
            <text key={`x${v}`} x={sx(v)} y={H - pad.b + 16} textAnchor="middle">
              {fmt(v, 2)}
            </text>
          ))}
          {cv.points &&
            cv.points.x.map((x, i) => (
              <circle key={i} className="dot" cx={sx(x)} cy={sy(cv.points!.y[i])} r={2.5} />
            ))}
          {cv.y && (
            <polyline
              className="fit-line"
              fill="none"
              points={cv.grid.map((x, i) => `${sx(x)},${sy(cv.y![i])}`).join(' ')}
            />
          )}
          {probs &&
            probs.map((p, j) => (
              <polyline
                key={j}
                className="fit-line"
                fill="none"
                style={{ stroke: seriesColor(j) }}
                points={cv.grid.map((x, i) => `${sx(x)},${sy(p[i])}`).join(' ')}
              />
            ))}
          {probs &&
            cv.levels!.map((l, j) => (
              <g key={l}>
                <line
                  x1={W - pad.r - 110}
                  x2={W - pad.r - 96}
                  y1={pad.t + 10 + j * 14}
                  y2={pad.t + 10 + j * 14}
                  style={{ stroke: seriesColor(j), strokeWidth: 2 }}
                />
                <text x={W - pad.r - 92} y={pad.t + 14 + j * 14}>
                  {l}
                </text>
              </g>
            ))}
          <text
            x={pad.l + (W - pad.l - pad.r) / 2}
            y={H - 4}
            textAnchor="middle"
            className="axis-title"
          >
            {labels.x}
          </text>
          <text
            transform={`translate(12 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`}
            textAnchor="middle"
            className="axis-title"
          >
            {labels.y}
          </text>
        </svg>
      )}
    </ChartFrame>
  );
}

/** A result as stored by this version, or by the one before it (one `curve`, no `curves`). */
const curvesOf = (r: Result): RegressionCurve[] => {
  if (Array.isArray(r.curves)) return r.curves;
  const older = (r as unknown as { curve?: RegressionCurve | null }).curve;
  return older ? [older] : [];
};

/**
 * A linear regression as a path model: the predictors as observed covariates (fixed.x), the outcome
 * a single indicator without error, one path per predictor; the same coefficients under ML, and a
 * diagram to grow (indicators, mediators, groups). Returns why it cannot be drawn otherwise.
 */
export function regressionModel(o: RegressionOptions): ModelState | string {
  if (o.family !== 'gaussian')
    return 'Only a linear regression is a path model with the same estimates; the other families have no CB-SEM counterpart.';
  if (o.randomSlope) return 'A random slope has no path-model counterpart.';
  if (o.categorical.length)
    return `Categorical predictors (${o.categorical.join(', ')}) enter as dummy variables: add them as computed columns (e.g. g == 2) first.`;
  if (o.interactions.length)
    return 'Interaction terms are not drawn: draw the main effects, then add a moderation arrow on the canvas.';
  if (o.trials) return 'Trials apply to a binomial outcome only.';
  if (o.weights)
    return 'Weighted regression is not a path model; CB-SEM has sampling weights under the Model inspector instead.';
  if (!o.outcome || !o.predictors.length) return 'Choose the outcome and at least one predictor.';
  const gap = 180;
  const predictors: Construct[] = o.predictors.map((x, i) => ({
    id: newId('c'),
    name: x,
    type: 'factor',
    mode: 'A',
    indicators: [x],
    x: 0,
    y: Math.round((i - (o.predictors.length - 1) / 2) * gap),
    side: 'left',
    covariate: true,
  }));
  const outcome: Construct = {
    id: newId('c'),
    name: o.outcome,
    type: 'factor',
    mode: 'A',
    indicators: [o.outcome],
    x: 520,
    y: 0,
    side: 'right',
  };
  const paths: Path[] = predictors.map((p) => ({ id: newId('p'), from: p.id, to: outcome.id }));
  return {
    constructs: [...predictors, outcome],
    paths,
    moderations: [],
    ...(o.se === 'cluster' && o.cluster ? { cluster: o.cluster } : {}),
  };
}

/** Replace the diagram by the regression's path model and switch to CB-SEM (ML). */
export async function drawRegressionModel(o: RegressionOptions): Promise<boolean> {
  const st = useStore.getState();
  const m = regressionModel(o);
  if (typeof m === 'string') {
    st.toast('error', m);
    return false;
  }
  if (
    st.model.constructs.length &&
    !(await confirmDialog({
      title: 'Replace the diagram?',
      body: 'The regression becomes the diagram on the Model tab; the current constructs and paths are replaced (undo restores them).',
      confirmLabel: 'Replace',
    }))
  )
    return false;
  st.commit(() => m);
  st.setSettings({ method: 'cbsem', estimator: 'ML' });
  st.setWorkspace('model');
  let seNote = '';
  if (o.se === 'cluster' && o.cluster) seNote = ` Sampling clusters: ${o.cluster}.`;
  else if (o.se === 'HC3' || o.se === 'HC0')
    seNote = ` ${o.se} errors are not carried over; choose MLR for robust ones.`;
  st.toast(
    'success',
    `${o.outcome} on ${o.predictors.join(', ')} as a path model: the predictors as observed covariates, the outcome a single indicator. CB-SEM with ML gives the regression's coefficients (standard errors divide by N rather than N − p). Add indicators, mediators or groups from here.${seNote}`,
  );
  return true;
}

function DrawModel({ o }: { o: RegressionOptions }) {
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const why = regressionModel(o);
  return (
    <button
      className="btn sm"
      disabled={readOnly || typeof why === 'string'}
      title={
        typeof why === 'string'
          ? why
          : 'Draw this regression as a path model on the Model tab (CB-SEM)'
      }
      onClick={() => void drawRegressionModel(o)}
    >
      Draw as SEM
    </button>
  );
}

const VUONG_VERSION = { raw: 'Raw', aic: 'AIC-corrected', bic: 'BIC-corrected' } as const;

function robustSeName(se: string) {
  if (se === 'HC3') return 'Heteroskedasticity-consistent (HC3)';
  if (se === 'HC0') return 'Heteroskedasticity-consistent (HC0, White; Mplus MLR)';
  return 'Cluster-robust';
}

function RegressionView({ r, plot, o }: { r: Result; plot: string; o: RegressionOptions }) {
  const curves = curvesOf(r);
  const cv = curves.find((k) => k.x === plot) ?? curves[0];
  const f = r.fit,
    pct = Math.round(r.input.confidence * 100);
  const ratio = (r.coefficients ?? []).some((e) => e.ratio !== undefined && e.ratio !== null);
  const oddsFamily = r.family === 'binomial' || r.family === 'ordinal';
  let ratioName = 'Rate ratio';
  if (oddsFamily || r.family === 'multinomial') ratioName = 'Odds ratio';
  else if (r.family === 'survival') ratioName = 'Hazard ratio';
  const cols = [
    'Term',
    'Estimate',
    'Std. error',
    r.family === 'gaussian' || r.family === 'gamma' ? 't' : 'z',
    'p',
    `${pct}% CI`,
    ...(ratio ? [ratioName] : []),
  ];
  const cards: [string, string][] = [
    ['n', String(f.n)],
    ...(f.r2 !== undefined && f.r2 !== null
      ? ([
          ['R²', fmt(f.r2)],
          ['Adj. R²', fmt(f.adjR2!)],
        ] as [string, string][])
      : []),
    ...(r.lrt?.pseudoR2 !== undefined && r.lrt?.pseudoR2 !== null
      ? ([['Pseudo R² (McFadden)', fmt(r.lrt.pseudoR2)]] as [string, string][])
      : []),
    ['AIC', fmt(f.aic, 1)],
    ['BIC', fmt(f.bic, 1)],
    ...(f.dispersion !== undefined && f.dispersion !== null
      ? ([['Dispersion', fmt(f.dispersion, 2)]] as [string, string][])
      : []),
    ...(f.theta !== undefined && f.theta !== null
      ? ([['θ', fmt(f.theta, 2)]] as [string, string][])
      : []),
    ...(f.residualVariance !== undefined && f.residualVariance !== null
      ? ([
          ['Residual variance', `${fmt(f.residualVariance)} (SE ${fmt(f.residualVarianceSe!)})`],
        ] as [string, string][])
      : []),
    ...(f.censored !== undefined && f.censored !== null
      ? ([['Censored', String(f.censored)]] as [string, string][])
      : []),
    ...(f.zeros !== undefined && f.zeros !== null
      ? ([['Zeros', String(f.zeros)]] as [string, string][])
      : []),
    ...(f.zerosPredicted !== undefined && f.zerosPredicted !== null
      ? ([
          ['Zeros predicted', fmt(f.zerosPredicted, 1)],
          ['… by the standard model', fmt(f.zerosStandard!, 1)],
        ] as [string, string][])
      : []),
    ...(f.events !== undefined && f.events !== null
      ? ([['Events', String(f.events)]] as [string, string][])
      : []),
  ];
  const main = (r.coefficients ?? []).filter((e) => !e.part),
    inflation = (r.coefficients ?? []).filter((e) => e.part === 'inflation'),
    baseline = (r.coefficients ?? []).filter((e) => e.part === 'baseline');
  const zero = (r.coefficients ?? []).filter((e) => e.part === 'zero'),
    hurdle = r.zeroModel === 'hurdle';
  const std = r.family === 'negbin' ? 'negative binomial' : 'Poisson';
  // What a ratio multiplies: the odds, the hazard, or (count models) an expected count.
  let ratioScale = 'expected count';
  if (oddsFamily) ratioScale = 'odds';
  else if (r.family === 'survival') ratioScale = 'hazard';
  else if (r.zeroModel && hurdle) ratioScale = 'expected positive count';
  else if (r.zeroModel) ratioScale = 'expected count of the cases that are not structural zeros';
  const random = (r.coefficients ?? []).filter((e) => e.part === 'random');
  const dg = r.diagnostics;
  return (
    <div className="tables">
      <div className="stat-cards">
        {cards.map(([k, v]) => (
          <div className="stat-card" key={k}>
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
      {r.family === 'gaussian' && (
        <div className="table-tools">
          <DrawModel o={o} />
          <span className="hint">
            A linear regression is a saturated path model: draw it to extend it into an SEM.
          </span>
        </div>
      )}
      <p className="hint" style={{ marginTop: 0 }}>
        {FAMILY_NAME[r.family]}
        {r.link && r.link !== 'logit' && r.link !== 'logistic' ? ` (${r.link} link)` : ''}:{' '}
        <code>{r.formula}</code>; {r.engine.package} {r.engine.version}.
        {r.se !== 'model' && ` ${robustSeName(r.se)} standard errors.`}
        {r.lrt && (
          <>
            {' '}
            Likelihood-ratio test against the intercept-only model: χ²({r.lrt.df}) ={' '}
            {fmt(r.lrt.stat, 2)}, p {pIs(r.lrt.p)}.
          </>
        )}
        {f.dispersion !== undefined &&
          f.dispersion !== null &&
          f.dispersion > 1.5 &&
          r.family === 'poisson' &&
          ' Dispersion well above 1: consider the negative binomial.'}
      </p>
      {r.family === 'multinomial' && r.levels ? (
        r.levels.others.map((l) => (
          <Table
            key={l}
            title={`${l} versus ${r.levels!.reference}`}
            file={`regression-${l}`}
            columns={cols}
            rows={r.coefficients.filter((e) => e.level === l).map((e) => coefRow(e, ratio))}
          />
        ))
      ) : (
        <Table
          title={
            r.zeroModel
              ? `Count part (${hurdle ? 'zero-truncated ' : ''}${std}, log link)`
              : 'Coefficients'
          }
          file="regression-coefficients"
          columns={cols}
          rows={main.map((e) => coefRow(e, ratio))}
          note={
            ratio
              ? `${ratioName}s: exp(estimate), the multiplicative change in the ${ratioScale} per unit of the predictor.`
              : undefined
          }
        />
      )}
      {zero.length > 0 && (
        <Table
          title={
            hurdle
              ? 'Zero hurdle (logit model for a count above zero)'
              : 'Zero inflation (logit model for a structural zero)'
          }
          file="regression-zero-part"
          columns={[...cols.slice(0, 6), 'Odds ratio']}
          rows={zero.map((e) => coefRow(e, true))}
          note={
            hurdle
              ? 'The log-odds that the count is above zero (crossing the hurdle); odds ratios: exp(estimate).'
              : 'The log-odds that a case is a structural zero (always zero, whatever its count distribution); odds ratios: exp(estimate).'
          }
        />
      )}
      {r.vuong && (
        <Table
          title={`Vuong’s test against the standard ${std} model`}
          file="regression-vuong"
          columns={['Version', 'z', 'p (one-sided)', 'Favours']}
          rows={(['raw', 'aic', 'bic'] as const).map(
            (k): Row => [
              c(VUONG_VERSION[k]),
              c(r.vuong![k].z),
              pCell(r.vuong![k].p),
              c(
                r.vuong![k].z > 0
                  ? `the ${hurdle ? 'hurdle' : 'zero-inflated'} model`
                  : `the standard ${std} model`,
              ),
            ],
          )}
          note="Vuong’s non-nested test (as pscl::vuong): the mean difference of the cases’ log-likelihoods over its standard error, asymptotically N(0, 1) when the models fit equally well; the corrected versions penalise the zero part’s extra parameters. Compare the predicted zeros above with the observed."
        />
      )}
      {inflation.length > 0 && (
        <Table
          title="Inflation (logistic model for the extra values)"
          file="regression-inflation"
          columns={cols.slice(0, 6)}
          rows={inflation.map((e) => coefRow(e, false))}
          note={
            r.family === 'poisson'
              ? 'The log-odds of a structural zero (Mplus: u#1 ON …).'
              : 'The log-odds of a value at the censoring point beyond the censored-normal model (Mplus: y#1 ON …).'
          }
        />
      )}
      {random.length > 0 && (
        <Table
          title={`Random slope of ${r.input.randomSlope ?? ''}: variances and covariance`}
          file="regression-random-slope"
          columns={cols.slice(0, 6)}
          rows={random.map((e) => coefRow(e, false))}
          note="The residual variance σ² (Mplus: y), the slope’s variance τ (s) and its covariance c with the residual (s WITH y): the outcome’s variance given x is σ² + 2c·x + τ·x². The slope’s mean is the predictor’s coefficient above."
        />
      )}
      {baseline.length > 0 && (
        <Table
          title="Baseline hazard by interval"
          file="regression-baseline-hazard"
          columns={cols.slice(0, 6)}
          rows={baseline.map((e) => coefRow(e, false))}
          note="The hazard in each interval for a person with all predictors at zero; z and p test its logarithm against 0; the interval is exp(log hazard ± z × SE)."
        />
      )}
      {r.thresholds.length > 0 && (
        <Table
          title="Thresholds (cut points between the ordered levels)"
          file="regression-thresholds"
          columns={cols.slice(0, 6)}
          rows={r.thresholds.map((e) => coefRow(e, false))}
        />
      )}
      {dg.vif?.length || dg.auc !== undefined || dg.hosmerLemeshow || dg.durbinWatson ? (
        <Table
          title="Diagnostics"
          file="regression-diagnostics"
          columns={['Statistic', 'Value']}
          rows={[
            ...(dg.vif ?? []).map((v): Row => [c(`VIF ${v.term}`), c(v.vif)]),
            ...(dg.accuracy !== undefined
              ? [[c('Classification accuracy (cut-off 0.5)'), c(dg.accuracy)] as Row]
              : []),
            ...(dg.auc !== undefined && dg.auc !== null
              ? [[c('Area under the ROC curve'), c(dg.auc)] as Row]
              : []),
            ...(dg.hosmerLemeshow
              ? [
                  [
                    c(`Hosmer–Lemeshow χ²(${dg.hosmerLemeshow.df})`),
                    c(`${fmt(dg.hosmerLemeshow.stat, 2)}, p ${fmtP(dg.hosmerLemeshow.p)}`),
                  ] as Row,
                ]
              : []),
            ...durbinWatsonRows(dg.durbinWatson),
          ]}
          note={diagnosticsNote(dg.durbinWatson)}
        />
      ) : null}
      {cv && <Curve r={{ ...r, curves }} cv={cv} />}
    </div>
  );
}

export const regressionInput = (
  o: RegressionOptions,
  ctx: Pick<AnalysisCtx, 'settings'>,
): RegressionInput => ({ ...o, confidence: ctx.settings.confidence });
export const regressionColumns = (o: RegressionOptions) => [
  ...new Set(
    [
      o.outcome,
      ...o.predictors,
      ...o.interactions.flat(),
      ...zeroPreds(o),
      o.trials,
      o.weights,
      o.se === 'cluster' ? o.cluster : '',
      o.family === 'survival' ? (o.status ?? '') : '',
    ].filter(Boolean),
  ),
];
const FAMILY_IDS = FAMILIES.map(([id]) => id);

export const regressionAnalysis: AnalysisType<RegressionOptions, Result> = {
  id: 'regression',
  title: 'Regression',
  sub: 'linear, logistic, Poisson, negative binomial (also zero-inflated, hurdle), Gamma, ordinal, multinomial, censored, survival (lm, glm, MASS, nnet, pscl, survival)',
  group: 'Regression and causal inference',
  entries: [
    {
      title: 'Linear regression',
      sub: 'a continuous outcome (lm)',
      options: (o) => ({ ...o, family: 'gaussian' }),
    },
    {
      title: 'Logistic regression',
      sub: 'a 0/1 outcome or counts of successes (glm)',
      options: (o) => ({ ...o, family: 'binomial', link: 'logit' }),
    },
    {
      title: 'Count regression',
      sub: 'Poisson or negative binomial (glm, MASS)',
      options: (o) => ({ ...o, family: 'poisson' }),
    },
    {
      title: 'Zero-inflated and hurdle count models',
      sub: 'Poisson or negative binomial with excess zeros (pscl)',
      options: (o) => ({ ...o, family: 'negbin', zeroModel: 'zeroinfl', zeroPart: 'same' }),
    },
    {
      title: 'Ordinal regression',
      sub: 'proportional odds (MASS::polr)',
      options: (o) => ({ ...o, family: 'ordinal', link: 'logistic' }),
    },
    {
      title: 'Multinomial regression',
      sub: 'an unordered categorical outcome (nnet)',
      options: (o) => ({ ...o, family: 'multinomial' }),
    },
    {
      title: 'Censored (tobit) regression',
      sub: 'an outcome censored at a limit (survival::survreg)',
      options: (o) => ({ ...o, family: 'censored' }),
    },
    {
      title: 'Survival analysis',
      sub: 'Cox or piecewise exponential (survival)',
      options: (o) => ({ ...o, family: 'survival' }),
    },
  ],
  cardTitle: (o) => {
    let model = FAMILY_NAME[o.family];
    if (isZeroModel(o)) {
      const zeroKind = o.zeroModel === 'hurdle' ? 'Hurdle' : 'Zero-inflated';
      model = `${zeroKind} ${FAMILY_NAME[o.family].toLowerCase()}`;
    }
    return `${model}${o.outcome ? `: ${o.outcome}` : ''}`;
  },
  defaults: () => ({
    outcome: '',
    predictors: [],
    categorical: [],
    interactions: [],
    family: 'gaussian',
    link: 'logit',
    trials: '',
    weights: '',
    se: 'model',
    cluster: '',
    plot: '',
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          outcome: name(raw.outcome),
          predictors: names(raw.predictors),
          categorical: names(raw.categorical),
          interactions: (Array.isArray(raw.interactions) ? raw.interactions.slice(0, 50) : [])
            .map((t) => names(t))
            .filter((t) => t.length >= 2),
          family: oneOf(raw.family, FAMILY_IDS, 'gaussian'),
          link: name(raw.link, 20) || 'logit',
          trials: name(raw.trials),
          weights: name(raw.weights),
          se: oneOf(raw.se, ['model', 'HC0', 'HC3', 'cluster'] as const, 'model'),
          cluster: name(raw.cluster),
          plot: name(raw.plot),
          // (the options of censored, inflated, multinomial and survival models only when set)
          ...(raw.censoring === 'above' ? { censoring: 'above' as const } : {}),
          ...(raw.inflated === true ? { inflated: true } : {}),
          ...(raw.reference === 'last' ? { reference: 'last' as const } : {}),
          ...(name(raw.status) ? { status: name(raw.status) } : {}),
          ...(raw.statusCensored === true ? { statusCensored: true } : {}),
          ...(Array.isArray(raw.cuts) && raw.cuts.length
            ? { cuts: parseCuts(raw.cuts.filter((x) => typeof x === 'number').join(',')) }
            : {}),
          ...(name(raw.randomSlope) ? { randomSlope: name(raw.randomSlope) } : {}),
          ...((ZERO_MODELS as readonly unknown[]).includes(raw.zeroModel)
            ? {
                zeroModel: raw.zeroModel as (typeof ZERO_MODELS)[number],
                zeroPart: oneOf(raw.zeroPart, ['same', 'intercept', 'chosen'] as const, 'same'),
              }
            : {}),
          ...((raw.zeroModel === 'zeroinfl' || raw.zeroModel === 'hurdle') &&
          names(raw.zeroPredictors).length
            ? { zeroPredictors: names(raw.zeroPredictors) }
            : {}),
        }
      : null,
  Options: RegressionOptionsForm,
  View: ({ result, options }) => <RegressionView r={result} plot={options.plot} o={options} />,
  display: ['plot'],
  blocked: (o, ctx) => {
    if (!o.outcome) return 'Choose the outcome.';
    if (!o.predictors.length && !o.interactions.length) return 'Choose at least one predictor.';
    if (o.predictors.includes(o.outcome) || o.interactions.some((t) => t.includes(o.outcome)))
      return 'The outcome cannot be a predictor.';
    const levels = rawData(ctx)?.categories?.[o.outcome];
    if (
      levels &&
      !['ordinal', 'multinomial'].includes(o.family) &&
      !(o.family === 'binomial' && levels.length === 2 && !o.trials)
    )
      return `“${o.outcome}” is a text column: choose ordinal or multinomial regression${levels.length === 2 ? ', or logistic regression (its second level counts as the event)' : ''}.`;
    if (o.se === 'cluster' && !o.cluster) return 'Choose the cluster column.';
    if (o.se !== 'model' && o.family === 'ordinal')
      return 'Robust standard errors apply to linear and generalised linear models; choose model-based errors for ordinal models.';
    if ((o.se === 'HC3' || o.se === 'cluster') && ownSe(o))
      return 'Choose model-based or HC0 (Mplus MLR) standard errors for this model.';
    if (o.family === 'survival' && !o.status)
      return 'Choose the status column (0/1: which times are events, which censored).';
    if (o.family === 'survival' && o.status && o.status === o.outcome)
      return 'The status column cannot be the survival time.';
    if (
      (o.family === 'survival' ||
        (o.family === 'poisson' && o.inflated) ||
        (o.family === 'censored' && o.inflated) ||
        isZeroModel(o)) &&
      o.weights
    )
      return 'Weights are not available for survival, inflated and hurdle models.';
    if (isZeroModel(o) && o.zeroPart === 'chosen') {
      if (!zeroPreds(o).length)
        return 'Choose the predictors of the zero part (or an intercept only).';
      if (zeroPreds(o).includes(o.outcome)) return 'The outcome cannot be a predictor.';
    }
    if (o.randomSlope && o.family === 'gaussian') {
      if (!o.predictors.includes(o.randomSlope))
        return `The random slope (${o.randomSlope}) must be one of the predictors.`;
      if (o.categorical.includes(o.randomSlope) || rawData(ctx)?.categories?.[o.randomSlope])
        return 'A random slope needs a numeric predictor.';
      if (o.weights) return 'Weights are not available with a random slope.';
    }
    return missingColumns(ctx, regressionColumns(o), 'Regression');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, regressionColumns(o), [
      o.family,
      o.link,
      o.se,
      ...o.categorical,
      ...o.interactions.map((t) => t.join(':')),
      ctx.settings.confidence,
      // (only options that differ from the defaults: earlier results keep their fingerprint)
      ...(o.family === 'censored' && o.censoring === 'above' ? ['above'] : []),
      ...((o.family === 'censored' || o.family === 'poisson') && o.inflated ? ['inflated'] : []),
      ...(o.family === 'multinomial' && o.reference === 'last' ? ['last'] : []),
      ...(o.family === 'survival'
        ? [o.statusCensored ? 'censored' : 'event', (o.cuts ?? []).join(',')]
        : []),
      ...(o.family === 'gaussian' && o.randomSlope ? [`slope:${o.randomSlope}`] : []),
      ...(isZeroModel(o)
        ? [`zero:${o.zeroModel}:${o.zeroPart ?? 'same'}:${zeroPreds(o).join(',')}`]
        : []),
    ]),
  run: async (o, ctx) => {
    const input = regressionInput(o, ctx);
    return {
      ...(await (await import('../rengine/regression')).regressionR(rawData(ctx)!, input)),
      input,
    };
  },
  script: async (o, ctx) =>
    (await import('../rengine/regression')).regressionScriptR(
      rawData(ctx)!,
      regressionInput(o, ctx),
    ),
  summary: (o) => {
    const zero = isZeroModel(o);
    const zeroKind = zero ? `${o.zeroModel === 'hurdle' ? 'hurdle' : 'zero-inflated'} ` : '';
    const predictors = o.predictors.length ? o.predictors.join(', ') : '…';
    // The zero part's predictors, after a bar as in pscl's formulas.
    let zeroPart = '';
    if (zero && o.zeroPart === 'intercept') zeroPart = ' | 1';
    else if (zero && o.zeroPart === 'chosen') zeroPart = ` | ${zeroPreds(o).join(', ') || '…'}`;
    const slope =
      o.family === 'gaussian' && o.randomSlope ? ` · random slope of ${o.randomSlope}` : '';
    const se = o.se !== 'model' ? ` · ${o.se} SEs` : '';
    return `${zeroKind}${FAMILY_NAME[o.family].toLowerCase()} · ${o.outcome || '…'} on ${predictors}${zeroPart}${slope}${se}`;
  },
};
