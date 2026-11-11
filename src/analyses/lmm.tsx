// Multilevel regression (lme4) as an analysis card: random intercepts and
// slopes, Satterthwaite tests (lmerTest). Also (nlme where lme4 cannot): repeated
// measures in columns, several outcomes stacked, further cluster levels,
// interaction terms, slopes uncorrelated with the other random effects, a
// residual variance per occasion, and Mplus's robust (MLR) standard errors.

import { useState } from 'react';
import { fmt } from '../format';
import {
  lmmColumns,
  type LmmInput,
  type LmmLevel,
  type LmmOutcome,
  type LmmResult,
} from '../rengine/mixed';
import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table } from '../components/results/Table';
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
import type { AnalysisType, OptionsProps } from './types';

/** Cluster-specific regression lines of the focal predictor (other predictors at 0). */
function ClusterLines({ l }: { l: NonNullable<LmmResult['lines']> }) {
  const W = 460,
    H = 260,
    pad = { l: 56, r: 14, t: 12, b: 40 };
  const [x0, x1] = l.range;
  const ends = l.intercepts.flatMap((a, i) => [a + l.slopes[i] * x0, a + l.slopes[i] * x1]);
  const lo = Math.min(...ends),
    hi = Math.max(...ends),
    span = hi - lo || 1;
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi + 0.06 * span - v) / (span * 1.12)) * (H - pad.t - pad.b);
  const shown = l.intercepts.slice(0, 200);
  return (
    <ChartFrame
      id="lmm:lines"
      name="multilevel-cluster-lines"
      width={W}
      height={H}
      defaults={{ x: l.predictor, y: 'Predicted outcome' }}
    >
      {(labels) => (
        <svg
          className="mc-chart"
          width={W}
          height={H}
          role="img"
          aria-label="Regression lines per cluster"
        >
          <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(lo)} y2={sy(lo)} />
          <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(hi)} y2={sy(hi)} />
          <text x={pad.l - 6} y={sy(lo) + 4} textAnchor="end">
            {fmt(lo, 1)}
          </text>
          <text x={pad.l - 6} y={sy(hi) + 4} textAnchor="end">
            {fmt(hi, 1)}
          </text>
          <text x={sx(x0)} y={H - pad.b + 16} textAnchor="middle">
            {fmt(x0, 2)}
          </text>
          <text x={sx(x1)} y={H - pad.b + 16} textAnchor="middle">
            {fmt(x1, 2)}
          </text>
          {shown.map((a, i) => (
            <line
              key={i}
              x1={sx(x0)}
              x2={sx(x1)}
              y1={sy(a + l.slopes[i] * x0)}
              y2={sy(a + l.slopes[i] * x1)}
              stroke="#94a3b8"
              strokeWidth={1}
              opacity={0.7}
            />
          ))}
          <line
            x1={sx(x0)}
            x2={sx(x1)}
            y1={sy(l.fixed[0] + l.fixed[1] * x0)}
            y2={sy(l.fixed[0] + l.fixed[1] * x1)}
            stroke="#6d28d9"
            strokeWidth={2.6}
          />
          <text
            x={pad.l + (W - pad.l - pad.r) / 2}
            y={H - 4}
            textAnchor="middle"
            className="axis-title"
          >
            {labels.x}
          </text>
          <text
            transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`}
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

export function LmmView({ r }: { r: LmmResult }) {
  const re = (x: LmmResult['random'][number]) =>
    x.group === 'Residual'
      ? x.a
        ? `Residual (${x.a})`
        : 'Residual'
      : x.b
        ? `${x.a} ↔ ${x.b} (across ${x.group})`
        : `${x.a} (across ${x.group})`;
  const withSe = r.random.some((x) => x.se !== undefined);
  const units = r.levels?.length
    ? r.levels.map((l) => [`Units: ${l.name}`, l.units, 0] as const)
    : [['Clusters', r.clusters, 0] as const];
  const cards = [
    ['Observations', r.n, 0] as const,
    ...units,
    ...(r.icc !== null ? [['ICC (empty model)', r.icc, 3] as const] : []),
    ...(r.r2
      ? [
          ['R² marginal', r.r2.marginal, 3] as const,
          ['R² conditional', r.r2.conditional, 3] as const,
        ]
      : []),
  ];
  const top = r.levels?.length ? r.levels[r.levels.length - 1].name : 'cluster';
  return (
    <div className="tables">
      <div className="stat-cards">
        {cards.map(([k, v, d]) => (
          <div className="stat-card" key={k}>
            <div className="k">{k}</div>
            <div className="v">{fmt(v, d)}</div>
          </div>
        ))}
      </div>
      <Table
        title="Fixed effects"
        file="lmm-fixed"
        columns={[
          'Term',
          'Estimate',
          'Std. error',
          'df',
          r.robust ? 'z' : 't',
          'p',
          'CI low',
          'CI high',
        ]}
        rows={r.fixed.map((f) => [
          c(f.term),
          c(f.est),
          c(f.se),
          c(f.df, undefined, 1),
          c(f.t, undefined, 2),
          pCell(f.p),
          c(f.ciLow),
          c(f.ciHigh),
        ])}
        note={
          r.robust
            ? `Robust standard errors as Mplus’s MLR: the sandwich over the ${top} units with the observed information, for every parameter; z tests and 95% Wald intervals.`
            : r.engine.package === 'nlme'
              ? 'Degrees of freedom and p-values by nlme’s rule (the number of units at the level where the term varies); 95% intervals from them.'
              : 'Degrees of freedom and p-values by Satterthwaite’s approximation (lmerTest); 95% Wald intervals. A “(cluster mean)” term is the between-cluster effect; the predictor itself is then the within-cluster effect.'
        }
      />
      <Table
        title="Random effects"
        file="lmm-random"
        columns={[
          'Component',
          'Variance / covariance',
          'SD / correlation',
          ...(withSe ? ['Std. error'] : []),
        ]}
        rows={r.random.map((x) => [
          c(re(x)),
          c(x.variance),
          c(x.sd),
          ...(withSe ? [c(x.se ?? null)] : []),
        ])}
        note={`How much clusters differ in their intercepts${r.random.some((x) => x.a && x.a !== 'Intercept' && x.group !== 'Residual') ? ' and slopes' : ''}, and the residual variance within them. ${r.reml ? 'REML estimates.' : 'Maximum likelihood estimates.'}`}
      />
      {r.slopeTest && (
        <Table
          title="Random slopes versus random intercepts only"
          file="lmm-slopes"
          columns={['χ²', 'df', 'p']}
          rows={[
            [
              c(r.slopeTest.chisq, undefined, 2),
              c(r.slopeTest.df, undefined, 0),
              pCell(r.slopeTest.p),
            ],
          ]}
          note="Likelihood-ratio test of the slope variances and covariances. Variances cannot be negative (a boundary), so the p-value is conservative."
        />
      )}
      <Table
        title="Model"
        file="lmm-fit"
        columns={[
          'Log-likelihood',
          ...(r.npar !== undefined ? ['Free parameters'] : []),
          'AIC',
          'BIC',
        ]}
        rows={[
          [
            c(r.logLik, undefined, 3),
            ...(r.npar !== undefined ? [c(r.npar, undefined, 0)] : []),
            c(r.aic, undefined, 3),
            c(r.bic, undefined, 3),
          ],
        ]}
        note={`${r.r2 ? 'R² after Nakagawa & Schielzeth (2013), with Johnson’s (2014) extension for random slopes: marginal = fixed effects, conditional = fixed and random effects. ' : ''}${r.icc !== null ? 'ICC: share of the outcome’s variance between clusters. ' : ''}${r.cases !== undefined && r.cases !== r.n ? `BIC with the number of cases (${r.cases}), the rows of the data, as Mplus.` : ''}`}
      />
      {r.singular && (
        <div className="issue warning">
          The fit is singular: a variance is (near) zero or a correlation is ±1. The random-effects
          structure is probably more complex than the data support; consider fewer random slopes.
        </div>
      )}
      {r.lines && <ClusterLines l={r.lines} />}
      {r.lines && (
        <div className="hint">
          Grey: each cluster’s line for {r.lines.predictor} (other predictors at 0); purple: the
          average (fixed) line.
        </div>
      )}
    </div>
  );
}

/** A group of options (an outcome, a level, a time-varying covariate). */
const SUB = { borderLeft: '2px solid #e2e8f0', paddingLeft: 8 } as const;
type Layout = 'long' | 'wide' | 'stacked';
export const lmmLayout = (o: LmmInput): Layout =>
  o.repeated ? 'wide' : o.outcomes?.length ? 'stacked' : 'long';
/** The names the long data create from wide data: the outcome, the time and the time-varying covariates. */
const createdNames = (o: LmmInput) =>
  o.repeated ? [o.outcome, o.repeated.time, ...o.repeated.varying.map((v) => v.name)] : [];

/** Time scores typed as text; the options keep the numbers once they are valid. */
function TimesInput({
  measures,
  times,
  onChange,
}: {
  measures: string[];
  times: number[];
  onChange: (t: number[]) => void;
}) {
  const [text, setText] = useState(times.join(', '));
  return (
    <div className="field">
      <label htmlFor="lmm-times">Time scores</label>
      <input
        id="lmm-times"
        className="input"
        value={text}
        placeholder={measures.map((_, i) => i).join(', ') || '0, 1, 2, 3'}
        onChange={(e) => {
          setText(e.target.value);
          const v = e.target.value.trim()
            ? e.target.value
                .split(/[,\s]+/)
                .filter(Boolean)
                .map(Number)
            : [];
          if (v.every(Number.isFinite)) onChange(v);
        }}
      />
      <div className="hint">
        One per occasion (empty: 0, 1, 2, …), the values of the time variable.
      </div>
    </div>
  );
}

/** Random-slope checkboxes for one level; “uncorrelated” puts the slope in its own block (at every level). */
function SlopeChecks({
  label,
  predictors,
  slopes,
  independent,
  onChange,
  onIndependent,
}: {
  label: string;
  predictors: string[];
  slopes: string[];
  independent: string[];
  onChange: (s: string[]) => void;
  onIndependent: (s: string[]) => void;
}) {
  if (!predictors.length) return null;
  return (
    <div className="field">
      <label>{label}</label>
      {predictors.map((p) => (
        <div key={p} className="chips" style={{ alignItems: 'center', marginBottom: 4 }}>
          <label className="check">
            <input
              type="checkbox"
              checked={slopes.includes(p)}
              onChange={(e) =>
                onChange(e.target.checked ? [...slopes, p] : slopes.filter((x) => x !== p))
              }
            />{' '}
            <span>{p}</span>
          </label>
          {slopes.includes(p) && (
            <label className="check">
              <input
                type="checkbox"
                checked={independent.includes(p)}
                onChange={(e) =>
                  onIndependent(
                    e.target.checked ? [...independent, p] : independent.filter((x) => x !== p),
                  )
                }
              />{' '}
              <span>uncorrelated with the other random effects</span>
            </label>
          )}
        </div>
      ))}
    </div>
  );
}

function LmmOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<LmmInput>) {
  const [ia, setIa] = useState<string[]>([]);
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length)
    return (
      <div className="empty-results">
        Import raw data with a cluster column first (one row per person or occasion).
      </div>
    );
  const layout = lmmLayout(o);
  const rp = o.repeated;
  const levels = o.levels ?? [];
  const independent = o.independent ?? [];
  const interactions = o.interactions ?? [];
  const wideCols = rp ? [...rp.measures, ...rp.varying.flatMap((v) => v.columns)] : [];
  const clusters = [o.cluster, ...levels.map((l) => l.cluster)].filter(Boolean);
  const created = rp ? [rp.time, ...rp.varying.map((v) => v.name)].filter(Boolean) : [];
  const candidates = [
    ...created,
    ...columns.filter((n) => n !== o.outcome && !clusters.includes(n) && !wideCols.includes(n)),
  ];
  const setLayout = (l: Layout) => {
    const { repeated: _r, outcomes: _o, residuals: _s, ...base } = o;
    if (l === 'long') set({ ...base, levels: levels.map(({ occasions: _x, ...lv }) => lv) });
    else if (l === 'wide')
      set({
        ...base,
        outcome: 'y',
        cluster: '',
        predictors: [],
        slopes: [],
        center: 'none',
        interactions: [],
        repeated: { measures: [], times: [], time: 'time', varying: [] },
      });
    else
      set({
        ...base,
        center: 'none',
        levels: [],
        interactions: [],
        outcomes: [{ outcome: '', predictors: [], slopes: [] }],
      });
  };
  const setRp = (r: Partial<NonNullable<LmmInput['repeated']>>) =>
    set({ ...o, repeated: { ...rp!, ...r } });
  const setOut = (k: number, v: Partial<LmmOutcome>) =>
    set({ ...o, outcomes: (o.outcomes ?? []).map((x, i) => (i === k ? { ...x, ...v } : x)) });
  const setLevel = (k: number, v: Partial<LmmLevel>) =>
    set({ ...o, levels: levels.map((x, i) => (i === k ? { ...x, ...v } : x)) });
  const keepSlopes = (predictors: string[]) => ({
    slopes: o.slopes.filter((x) => predictors.includes(x)),
    levels: levels.map((l) => ({ ...l, slopes: l.slopes.filter((x) => predictors.includes(x)) })),
  });
  const first = layout === 'wide' ? 'person' : o.cluster || 'cluster';
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Choice
        label="Data"
        value={layout}
        onChange={setLayout}
        options={[
          ['long', 'One row per observation'],
          ['wide', 'Repeated measures in columns'],
          ['stacked', 'Several outcomes'],
        ]}
        hint={
          layout === 'wide'
            ? 'Each row is a person; the measures become one outcome, one row per person and occasion (as Mplus reads wide data).'
            : layout === 'stacked'
              ? 'The outcomes are modelled together (stacked): each has its own intercept, effects and residual variance; their random intercepts covary.'
              : undefined
        }
      />
      {rp ? (
        <>
          <OrderedPicker
            label="Repeated measures (in time order)"
            hint="Click columns below in time order."
            columns={columns.filter(
              (n) => !clusters.includes(n) && !rp.varying.some((v) => v.columns.includes(n)),
            )}
            value={rp.measures}
            onChange={(measures) => setRp({ measures })}
          />
          <TimesInput
            measures={rp.measures}
            times={rp.times}
            onChange={(times) => setRp({ times })}
          />
          <div className="row2">
            <div className="field">
              <label htmlFor="lmm-yname">Name of the outcome</label>
              <input
                id="lmm-yname"
                className="input"
                value={o.outcome}
                onChange={(e) => set({ ...o, outcome: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="lmm-tname">Name of the time variable</label>
              <input
                id="lmm-tname"
                className="input"
                value={rp.time}
                onChange={(e) =>
                  set({
                    ...o,
                    predictors: o.predictors.map((x) => (x === rp.time ? e.target.value : x)),
                    repeated: { ...rp, time: e.target.value },
                  })
                }
              />
            </div>
          </div>
          <div className="field">
            <label>Time-varying covariates</label>
            {rp.varying.map((v, k) => (
              <div key={k} className="field" style={SUB}>
                <div className="chips" style={{ alignItems: 'center' }}>
                  <input
                    className="input"
                    aria-label="Name of the time-varying covariate"
                    value={v.name}
                    onChange={(e) =>
                      set({
                        ...o,
                        predictors: o.predictors.map((x) => (x === v.name ? e.target.value : x)),
                        repeated: {
                          ...rp,
                          varying: rp.varying.map((w, i) =>
                            i === k ? { ...w, name: e.target.value } : w,
                          ),
                        },
                      })
                    }
                  />
                  <button
                    className="btn sm ghost"
                    onClick={() =>
                      set({
                        ...o,
                        predictors: o.predictors.filter((x) => x !== v.name),
                        ...keepSlopes(o.predictors.filter((x) => x !== v.name)),
                        repeated: { ...rp, varying: rp.varying.filter((_, i) => i !== k) },
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
                <OrderedPicker
                  label={`Its columns, one per occasion (${rp.measures.length})`}
                  hint="Click columns below in time order."
                  columns={columns.filter((n) => !rp.measures.includes(n) && !clusters.includes(n))}
                  value={v.columns}
                  onChange={(cols) =>
                    setRp({
                      varying: rp.varying.map((w, i) => (i === k ? { ...w, columns: cols } : w)),
                    })
                  }
                />
              </div>
            ))}
            <button
              className="btn sm"
              onClick={() =>
                setRp({
                  varying: [...rp.varying, { name: `v${rp.varying.length + 1}`, columns: [] }],
                })
              }
            >
              Add a time-varying covariate
            </button>
            <div className="hint">
              A covariate measured at every occasion (Mplus: y1 ON a1; y2 ON a2; …), or individually
              varying times of observation (Mplus: AT a11-a14).
            </div>
          </div>
        </>
      ) : (
        <>
          <ColumnSelect
            id="lmm-y"
            label={layout === 'stacked' ? 'First outcome' : 'Outcome'}
            value={o.outcome}
            columns={columns}
            exclude={[...clusters, ...o.predictors]}
            onChange={(outcome) => set({ ...o, outcome })}
          />
          <ColumnSelect
            id="lmm-g"
            label="Clusters (e.g. school, person)"
            value={o.cluster}
            columns={columns}
            exclude={[o.outcome, ...o.predictors, ...levels.map((l) => l.cluster)]}
            onChange={(cluster) => set({ ...o, cluster })}
          />
        </>
      )}
      <OrderedPicker
        label={
          layout === 'stacked' ? `Predictors of ${o.outcome || 'the first outcome'}` : 'Predictors'
        }
        columns={candidates}
        value={o.predictors}
        onChange={(predictors) =>
          set({
            ...o,
            predictors,
            ...keepSlopes(predictors),
            interactions: interactions.filter((t) => t.every((x) => predictors.includes(x))),
          })
        }
      />
      {layout !== 'stacked' && o.predictors.length >= 2 && (
        <div className="field">
          <label>Interaction terms</label>
          {interactions.map((t, i) => (
            <div key={i} className="chips" style={{ alignItems: 'center' }}>
              <span>{t.join(' × ')}</span>
              <button
                className="btn sm ghost"
                onClick={() => set({ ...o, interactions: interactions.filter((_, k) => k !== i) })}
                aria-label={`Remove ${t.join(' × ')}`}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="chips" style={{ alignItems: 'center' }}>
            {o.predictors.map((n) => (
              <label key={n} className="check">
                <input
                  type="checkbox"
                  checked={ia.includes(n)}
                  onChange={(e) => setIa(e.target.checked ? [...ia, n] : ia.filter((x) => x !== n))}
                />{' '}
                {n}
              </label>
            ))}
            <button
              className="btn sm"
              disabled={
                ia.length < 2 ||
                interactions.some((t) => t.length === ia.length && t.every((x) => ia.includes(x)))
              }
              onClick={() => {
                set({
                  ...o,
                  interactions: [...interactions, o.predictors.filter((n) => ia.includes(n))],
                });
                setIa([]);
              }}
            >
              Add term
            </button>
          </div>
          <div className="hint">
            Tick two or more predictors and add their product (a:b in R). A cross-level interaction
            is how a random slope is regressed on a cluster-level variable (Mplus: s ON w).
          </div>
        </div>
      )}
      <SlopeChecks
        label={`Random slopes across ${first}s`}
        predictors={o.predictors}
        slopes={o.slopes}
        independent={independent}
        onChange={(slopes) => set({ ...o, slopes })}
        onIndependent={(x) => set({ ...o, independent: x })}
      />
      {(o.outcomes ?? []).map((out, k) => (
        <div key={k} className="field" style={SUB}>
          <div className="chips" style={{ alignItems: 'center' }}>
            <ColumnSelect
              id={`lmm-y${k + 2}`}
              label={`Outcome ${k + 2}`}
              value={out.outcome}
              columns={columns}
              exclude={[o.outcome, o.cluster, ...(o.outcomes ?? []).map((x) => x.outcome)]}
              onChange={(outcome) => setOut(k, { outcome })}
            />
            {(o.outcomes ?? []).length > 1 && (
              <button
                className="btn sm ghost"
                onClick={() =>
                  set({ ...o, outcomes: (o.outcomes ?? []).filter((_, i) => i !== k) })
                }
              >
                Remove
              </button>
            )}
          </div>
          <OrderedPicker
            label={`Predictors of ${out.outcome || `outcome ${k + 2}`}`}
            columns={columns.filter((n) => n !== out.outcome && n !== o.cluster)}
            value={out.predictors}
            onChange={(predictors) =>
              setOut(k, { predictors, slopes: out.slopes.filter((x) => predictors.includes(x)) })
            }
          />
          <SlopeChecks
            label={`Random slopes across ${first}s`}
            predictors={out.predictors}
            slopes={out.slopes}
            independent={independent}
            onChange={(slopes) => setOut(k, { slopes })}
            onIndependent={(x) => set({ ...o, independent: x })}
          />
        </div>
      ))}
      {layout === 'stacked' && (
        <button
          className="btn sm"
          onClick={() =>
            set({
              ...o,
              outcomes: [...(o.outcomes ?? []), { outcome: '', predictors: [], slopes: [] }],
            })
          }
        >
          Add an outcome
        </button>
      )}
      {layout !== 'stacked' && (
        <div className="field">
          <label>Higher cluster levels</label>
          {levels.map((l, k) => (
            <div key={k} className="field" style={SUB}>
              <div className="chips" style={{ alignItems: 'center' }}>
                <ColumnSelect
                  id={`lmm-l${k + 2}`}
                  label={`Clusters of ${k ? levels[k - 1].cluster || 'the level below' : first + 's'}`}
                  value={l.cluster}
                  columns={columns}
                  exclude={[o.outcome, ...o.predictors, ...wideCols, ...clusters]}
                  onChange={(cluster) => setLevel(k, { cluster })}
                />
                <button
                  className="btn sm ghost"
                  onClick={() => set({ ...o, levels: levels.filter((_, i) => i !== k) })}
                >
                  Remove
                </button>
              </div>
              <SlopeChecks
                label={`Random slopes across ${l.cluster || 'these clusters'}`}
                predictors={o.predictors}
                slopes={l.slopes}
                independent={independent}
                onChange={(slopes) => setLevel(k, { slopes })}
                onIndependent={(x) => set({ ...o, independent: x })}
              />
              {rp && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!l.occasions}
                    onChange={(e) => setLevel(k, { occasions: e.target.checked || undefined })}
                  />{' '}
                  <span>
                    A variance per occasion at this level (the occasions’ residual variances between
                    these clusters)
                  </span>
                </label>
              )}
            </div>
          ))}
          <button
            className="btn sm"
            onClick={() =>
              set({ ...o, center: 'none', levels: [...levels, { cluster: '', slopes: [] }] })
            }
          >
            Add a level
          </button>
          <div className="hint">
            Each level nests the one below (classes in schools; with repeated measures, persons in
            clusters). Every unit gets its own intercept, and its own effect of a predictor with a
            random slope.
          </div>
        </div>
      )}
      {rp && (
        <Choice
          label="Residual variances"
          value={o.residuals ?? 'equal'}
          onChange={(v) => {
            const { residuals: _r, ...rest } = o;
            set(v === 'occasion' ? { ...rest, residuals: 'occasion' } : rest);
          }}
          options={[
            ['equal', 'Equal over occasions'],
            ['occasion', 'One per occasion'],
          ]}
          hint="One per occasion: Mplus’s default for growth models (nlme’s varIdent)."
        />
      )}
      {layout === 'long' && !levels.length && (
        <Choice
          label="Centring of the predictors"
          value={o.center}
          onChange={(center) => set({ ...o, center })}
          options={[
            ['none', 'None'],
            ['grand', 'Grand mean'],
            ['cluster', 'Within / between'],
          ]}
          hint="Within / between: each predictor is split into its cluster mean (the between-cluster effect) and the deviation from it (the within-cluster effect)."
        />
      )}
      <Choice
        label="Estimation"
        value={o.estimation}
        onChange={(estimation) => {
          const { se: _s, ...rest } = o;
          set({ ...(estimation === 'REML' ? rest : o), estimation });
        }}
        options={[
          ['REML', 'REML'],
          ['ML', 'ML'],
        ]}
        hint="REML gives unbiased variance components; ML is needed to compare models that differ in their fixed effects."
      />
      {o.estimation === 'ML' && (
        <Choice
          label="Standard errors"
          value={o.se ?? 'model'}
          onChange={(v) => {
            const { se: _s, ...rest } = o;
            set(v === 'robust' ? { ...rest, se: 'robust' } : rest);
          }}
          options={[
            ['model', 'Model-based'],
            ['robust', 'Robust (MLR)'],
          ]}
          hint="Robust: Mplus’s MLR, the sandwich over the top-level clusters, with standard errors for the variances and covariances too."
        />
      )}
    </fieldset>
  );
}

/** The request: time scores 0, 1, 2, … when none are given; empty further options left out (an older card's request is unchanged). */
export function lmmRequestOptions(o: LmmInput): LmmInput {
  const { interactions, independent, levels, outcomes, repeated, ...base } = o;
  return {
    ...base,
    ...(interactions?.length ? { interactions } : {}),
    ...(independent?.length ? { independent } : {}),
    ...(levels?.length ? { levels } : {}),
    ...(outcomes?.length ? { outcomes } : {}),
    ...(repeated
      ? {
          repeated: {
            ...repeated,
            times: repeated.times.length ? repeated.times : repeated.measures.map((_, i) => i),
          },
        }
      : {}),
  };
}

const parseLevels = (v: unknown, predictors: string[]): LmmLevel[] =>
  (Array.isArray(v) ? v.slice(0, 5) : []).filter(isObj).map((l) => ({
    cluster: name(l.cluster),
    slopes: names(l.slopes).filter((x) => predictors.includes(x)),
    ...(l.occasions === true ? { occasions: true } : {}),
  }));
const parseOutcomes = (v: unknown): LmmOutcome[] =>
  (Array.isArray(v) ? v.slice(0, 10) : []).filter(isObj).map((x) => {
    const predictors = names(x.predictors);
    return {
      outcome: name(x.outcome),
      predictors,
      slopes: names(x.slopes).filter((s) => predictors.includes(s)),
    };
  });

/** Why the further options cannot run (null: they can). */
function lmmBlockedExt(o: LmmInput): string | null {
  const levels = o.levels ?? [];
  const rp = o.repeated;
  if (o.se === 'robust' && o.estimation !== 'ML')
    return 'Robust standard errors (Mplus’s MLR) go with ML estimation.';
  if (rp && o.outcomes?.length)
    return 'Repeated measures in columns and several outcomes are alternatives.';
  if (o.center !== 'none' && (rp || o.outcomes?.length || levels.length))
    return 'Centring is available with one row per observation and one cluster level; centre the predictors as computed columns.';
  if (o.residuals === 'occasion' && !rp)
    return 'A residual variance per occasion needs repeated measures in columns.';
  if (levels.some((l) => l.occasions) && !rp)
    return 'A variance per occasion at a cluster level needs repeated measures in columns.';
  if (o.outcomes?.length && (levels.length || o.interactions?.length))
    return 'Several outcomes are modelled with one cluster level and without interaction terms (add products as computed columns).';
  if (levels.some((l) => !l.cluster)) return 'Choose the cluster column of every level.';
  const clusters = [o.cluster, ...levels.map((l) => l.cluster)].filter(Boolean);
  if (new Set(clusters).size < clusters.length) return 'Each level needs its own cluster column.';
  if (clusters.some((c) => o.predictors.includes(c) || (o.interactions ?? []).flat().includes(c)))
    return 'The outcome, the clusters and the predictors must be different columns.';
  if ((o.interactions ?? []).some((t) => t.length < 2 || t.some((x) => !o.predictors.includes(x))))
    return 'An interaction term needs two or more of the predictors.';
  if (rp) {
    if (o.cluster)
      return 'With repeated measures in columns each row is a person: clusters of persons are a higher level.';
    if (rp.measures.length < 2) return 'Choose two or more repeated measures (in time order).';
    if (rp.times.length && rp.times.length !== rp.measures.length)
      return `Give one time score per occasion (${rp.measures.length}).`;
    const bad = rp.varying.find((v) => v.columns.length !== rp.measures.length);
    if (bad)
      return `The time-varying covariate ${bad.name || '(unnamed)'} needs one column per occasion (${rp.measures.length}).`;
    const made = createdNames(o);
    if (made.some((x) => !x.trim()) || new Set(made).size < made.length)
      return 'The outcome, the time and the time-varying covariates need different names.';
    if (made.some((x) => lmmColumns(o).includes(x)))
      return 'The outcome, the time and the time-varying covariates need names that are not columns in the model.';
  }
  for (const [k, out] of (o.outcomes ?? []).entries()) {
    if (!out.outcome) return `Choose outcome ${k + 2}.`;
    if ([o.outcome, ...(o.outcomes ?? []).slice(0, k).map((x) => x.outcome)].includes(out.outcome))
      return 'Each outcome must be a different column.';
    if (out.predictors.includes(out.outcome) || out.predictors.includes(o.cluster))
      return 'An outcome’s predictors cannot be the outcome itself or the clusters.';
  }
  return null;
}

export const lmmAnalysis: AnalysisType<LmmInput, LmmResult> = {
  id: 'lmm',
  title: 'Multilevel regression',
  sub: 'random intercepts and slopes (lme4)',
  group: 'Regression and causal inference',
  defaults: () => ({
    outcome: '',
    predictors: [],
    cluster: '',
    slopes: [],
    center: 'none',
    estimation: 'REML',
  }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const rp = isObj(raw.repeated) ? raw.repeated : null;
    const repeated = rp
      ? {
          measures: names(rp.measures),
          times: (Array.isArray(rp.times) ? rp.times.slice(0, 500) : [])
            .map(Number)
            .filter(Number.isFinite),
          time: name(rp.time) || 'time',
          varying: (Array.isArray(rp.varying) ? rp.varying.slice(0, 50) : [])
            .filter(isObj)
            .map((v) => ({ name: name(v.name), columns: names(v.columns) })),
        }
      : null;
    // (with repeated measures in columns, a predictor may be the time or a time-varying covariate: names the long data create)
    const predictors = names(raw.predictors);
    const interactions = (Array.isArray(raw.interactions) ? raw.interactions.slice(0, 50) : [])
      .map((t) => names(t))
      .filter((t) => t.length >= 2);
    const levels = parseLevels(raw.levels, predictors);
    const outcomes = parseOutcomes(raw.outcomes);
    const independent = names(raw.independent);
    return {
      outcome: name(raw.outcome),
      predictors,
      cluster: name(raw.cluster),
      slopes: names(raw.slopes).filter((x) => predictors.includes(x)),
      center: oneOf(raw.center, ['none', 'grand', 'cluster'] as const, 'none'),
      estimation: oneOf(raw.estimation, ['REML', 'ML'] as const, 'REML'),
      ...(interactions.length ? { interactions } : {}),
      ...(independent.length ? { independent } : {}),
      ...(levels.length ? { levels } : {}),
      ...(repeated ? { repeated } : {}),
      ...(raw.residuals === 'occasion' ? { residuals: 'occasion' as const } : {}),
      ...(outcomes.length ? { outcomes } : {}),
      ...(raw.se === 'robust' ? { se: 'robust' as const } : {}),
    };
  },
  Options: LmmOptionsForm,
  View: ({ result }) => <LmmView r={result} />,
  blocked: (o, ctx) => {
    if (!o.outcome || (!o.cluster && !o.repeated))
      return o.repeated ? 'Name the outcome.' : 'Choose the outcome and the cluster column.';
    const made = createdNames(o);
    if (
      !o.repeated &&
      (o.outcome === o.cluster ||
        o.predictors.includes(o.outcome) ||
        o.predictors.includes(o.cluster))
    )
      return 'The outcome, the clusters and the predictors must be different columns.';
    if (o.repeated && o.predictors.some((x) => x === o.outcome))
      return 'The outcome cannot be a predictor.';
    const ext = lmmBlockedExt(o);
    if (ext) return ext;
    // (names the long data create are not data columns)
    return missingColumns(
      ctx,
      lmmColumns(o).filter((x) => !made.includes(x)),
      'Multilevel regression',
    );
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, lmmColumns(o)),
  run: async (o, ctx) =>
    (await import('../rengine/mixed')).lmmR(rawData(ctx)!, lmmRequestOptions(o)),
  script: async (o, ctx) =>
    (await import('../rengine/mixed')).lmmScriptR(rawData(ctx)!, lmmRequestOptions(o)),
  summary: (o) => {
    if (!o.outcome) return 'not set up yet';
    const levels = [
      o.repeated ? 'persons' : o.cluster || '…',
      ...(o.levels ?? []).map((l) => l.cluster || '…'),
    ].join(' in ');
    const slopes =
      o.slopes.length +
      (o.levels ?? []).reduce((a, l) => a + l.slopes.length, 0) +
      (o.outcomes ?? []).reduce((a, x) => a + x.slopes.length, 0);
    const ys = [o.outcome, ...(o.outcomes ?? []).map((x) => x.outcome)].join(', ');
    return `${o.predictors.join(', ') || 'intercept only'} → ${ys} | ${levels}${slopes ? ` (random slope${slopes > 1 ? 's' : ''})` : ''} · ${o.estimation}${o.se === 'robust' ? ', MLR' : ''}`;
  },
};
