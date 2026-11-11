// Score-based invariance tests along a covariate (R/scoretest.R): is the CB-SEM model on the canvas the same across
// a continuous, ordinal or categorical variable (age, income, age group) without splitting the sample into groups?
// The model is fitted once; the casewise scores of the chosen parameters, ordered by the covariate, form an empirical
// fluctuation process (strucchange), which stays flat when the parameters are invariant (Merkle & Zeileis 2013;
// Merkle, Fan & Zeileis 2014; Wang, Merkle & Zeileis 2014).

import { ChartFrame } from '../components/ChartFrame';
import { c, pCell, Table } from '../components/results/Table';
import { fmt } from '../format';
import {
  SCORE_FNS,
  SCORE_SETS,
  SCORE_TESTS,
  type ScoreArgs,
  type ScoreFn,
  type ScoreScale,
  type ScoreSet,
  type ScoreTestResult,
} from '../rengine/scoretest';
import { Axes, H, pad, W } from './charts';
import { cbCall, cbFingerprint, cbModelBlocked } from './cbModel';
import {
  Choice,
  clampNum,
  ColumnSelect,
  columnsFingerprint,
  isObj,
  name,
  oneOf,
  rawData,
} from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';
import { SERIES_COLORS } from '../figure/palette';

export type ScoreOptions = Omit<ScoreArgs, 'seed'>;
/** The result with the covariate's category labels (a text column's), for the chart and the peak. */
export type ScoreView = ScoreTestResult & { categoryLabels?: string[] };

export const SCORE_FN_NAMES: Record<ScoreFn, string> = {
  DM: 'Double maximum (DM)',
  CvM: 'Cramér–von Mises (CvM)',
  maxLM: 'Maximum LM (maxLM)',
  WDMo: 'Weighted double maximum (WDMo)',
  maxLMo: 'Ordinal maximum LM (maxLMo)',
  LMuo: 'Unordered LM (LMuo)',
};
const SCORE_FN_HINT: Record<ScoreFn, string> = {
  DM: 'Finds a change in a single parameter best, and shows which one (each parameter’s own maximum against the same critical value).',
  CvM: 'Averages the fluctuation over the whole range of the covariate: power against gradual change in several parameters.',
  maxLM:
    'The likelihood-ratio-like test of one split point anywhere between the 10% and 90% of the covariate (sup-LM): power against an abrupt change.',
  WDMo: 'Respects the order of the categories: one split between adjacent categories, the parameter that changes most.',
  maxLMo:
    'Respects the order of the categories: the best split between adjacent categories, all tested parameters together (critical values simulated).',
  LMuo: 'Ignores any order: the categories as groups, like a multiple-group LR test of the chosen parameters but from one fit.',
};
const SET_NAMES: Record<ScoreSet, string> = {
  loadings: 'Loadings',
  intercepts: 'Intercepts of the indicators',
  residuals: 'Residual variances',
  rescov: 'Residual covariances',
  lvvar: 'Factor variances',
  lvcov: 'Factor covariances',
  means: 'Factor means',
  regressions: 'Regressions (paths)',
  all: 'All free parameters',
};

const argsOf = (o: ScoreOptions, ctx: AnalysisCtx): ScoreArgs => ({
  ...o,
  seed: ctx.settings.seed,
});
const WHAT = 'Score-based invariance tests';

/** Why the card cannot run with these options (beyond the model itself). */
export function scoreBlocked(o: ScoreOptions, ctx: AnalysisCtx): string | null {
  if (!['ML', 'MLR'].includes(ctx.settings.estimator))
    return `${WHAT} use the casewise scores of maximum likelihood: choose ML or MLR (Model settings).`;
  if (!['casewise', 'mean', 'fiml'].includes(ctx.settings.missing))
    return `${WHAT} need casewise deletion, mean replacement or FIML for missing values (Model settings).`;
  if (ctx.model?.ordered?.length)
    return `${WHAT} are for continuous indicators; the model has ordinal indicators.`;
  if (!o.covariate) return 'Choose the covariate to test along.';
  if (!rawData(ctx)?.names.includes(o.covariate))
    return `The covariate ${o.covariate} is not in the data.`;
  if (!SCORE_TESTS[o.scale].includes(o.fn)) return `Choose a test for a ${o.scale} covariate.`;
  if (!o.sets.length) return 'Choose which parameters to test.';
  return null;
}

function ScoreOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<ScoreOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  const setScale = (scale: ScoreScale) =>
    set({ ...o, scale, fn: SCORE_TESTS[scale].includes(o.fn) ? o.fn : SCORE_TESTS[scale][0] });
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Do the model’s parameters change along a variable such as age, without splitting the sample
        into groups? The CB-SEM model on the canvas is fitted once ({ctx.settings.estimator}, Model
        settings); its casewise scores, ordered by the covariate, fluctuate around zero when the
        parameters are invariant.
      </p>
      <ColumnSelect
        id="score-covariate"
        label="Covariate"
        value={o.covariate}
        columns={columns}
        onChange={(covariate) => set({ ...o, covariate })}
      />
      <Choice
        label="The covariate is"
        value={o.scale}
        onChange={setScale}
        options={[
          ['continuous', 'Continuous'],
          ['ordinal', 'Ordinal'],
          ['categorical', 'Categorical'],
        ]}
        hint="Ordinal and categorical: its distinct values are the categories (at most 50), in numeric order."
      />
      <Choice
        label="Test"
        value={o.fn}
        onChange={(fn) => set({ ...o, fn })}
        options={SCORE_TESTS[o.scale].map((f) => [f, SCORE_FN_NAMES[f]] as const)}
        hint={SCORE_FN_HINT[o.fn]}
      />
      <div className="field">
        <label>Parameters tested</label>
        {SCORE_SETS.map((id) => (
          <label key={id} className="check" style={{ marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={o.sets.includes(id)}
              onChange={(e) =>
                set({
                  ...o,
                  sets: e.target.checked
                    ? SCORE_SETS.filter((k) => k === id || o.sets.includes(k))
                    : o.sets.filter((k) => k !== id),
                })
              }
            />
            <span>{SET_NAMES[id]}</span>
          </label>
        ))}
        <div className="hint">
          The others are estimated but not tested. Parameters held equal (labels, or across groups)
          are tested once. Intercepts and means need the mean structure.
        </div>
      </div>
      {o.fn === 'maxLMo' && (
        <div className="field">
          <label htmlFor="score-nrep">Simulated replications (critical values)</label>
          <input
            id="score-nrep"
            className="input num"
            type="number"
            min={1000}
            max={200000}
            step={1000}
            value={o.nrep}
            onChange={(e) =>
              set({ ...o, nrep: clampNum(e.target.value, 1000, 200000, 50000, true) })
            }
          />
          <div className="hint">Seed from the Model settings.</div>
        </div>
      )}
    </fieldset>
  );
}

/** A category's label: the text column's category, else the value. */
const catLabel = (r: ScoreView, code: string) => r.categoryLabels?.[Number(code) - 1] ?? code;

/** The y axis of the process chart for each statistic. */
function processAxisName(fn: ScoreFn) {
  if (fn === 'LMuo') return 'Contribution to LMuo';
  if (fn === 'WDMo') return 'Weighted max statistic';
  if (fn === 'DM') return 'max |fluctuation|';
  if (fn === 'CvM') return 'Squared fluctuation';
  return 'LM statistic';
}

/** The aggregated empirical fluctuation process with its 5% boundary, as strucchange plots it. */
function ProcessChart({ r }: { r: ScoreView }) {
  const s = r.series;
  if (!s.y.length) return null;
  const cat = s.labels !== null;
  const bound = Array.isArray(s.boundary) ? s.boundary : s.x.map(() => s.boundary as number);
  const ys: [number, number] = [
    0,
    Math.max(...s.y.filter(Number.isFinite), ...bound.filter(Number.isFinite)) * 1.08 || 1,
  ];
  const xs: [number, number] = cat ? [0.5, s.x.length + 0.5] : [Math.min(...s.x), Math.max(...s.x)];
  const sx = (v: number) => pad.l + ((v - xs[0]) / (xs[1] - xs[0] || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((ys[1] - v) / (ys[1] - ys[0] || 1)) * (H - pad.t - pad.b);
  const yName = processAxisName(r.fn);
  let what = 'The process along the covariate; ';
  if (r.fn === 'LMuo') what = 'Each category’s contribution to the statistic; ';
  else if (cat) what = 'Each split: the categories up to this one against those above; ';
  let critical = 'dashed: the 5% critical value (the test rejects when the process crosses it).';
  if (r.fn === 'LMuo') critical = 'the dashed line is the 5% critical value of their sum.';
  else if (r.fn === 'CvM')
    critical = 'CvM is its mean (dotted); the dashed line is the 5% critical value of the mean.';
  const line = SERIES_COLORS[0];
  return (
    <ChartFrame
      id="scoretest:process"
      name="score-test-process"
      width={W}
      height={H}
      defaults={{ x: r.covariate, y: yName }}
      caption={
        <span className="hint">
          {what}
          {critical}
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={W}
          height={H}
          role="img"
          aria-label="Empirical fluctuation process"
        >
          <Axes
            xs={xs}
            ys={ys}
            xTitle={labels.x}
            yTitle={labels.y}
            xTick={cat ? () => '' : undefined}
          />
          {cat &&
            s.labels!.map((l, i) => (
              <text key={i} x={sx(i + 1)} y={H - pad.b + 16} textAnchor="middle">
                {catLabel(r, l)}
              </text>
            ))}
          {r.fn === 'LMuo' ? (
            s.y.map((v, i) => (
              <rect
                key={i}
                x={sx(i + 1) - 14}
                y={sy(v)}
                width={28}
                height={sy(0) - sy(v)}
                fill={line}
                fillOpacity={0.75}
              />
            ))
          ) : (
            <path
              d={s.x.map((x, i) => `${i ? 'L' : 'M'} ${sx(x)} ${sy(s.y[i])}`).join(' ')}
              stroke={line}
              strokeWidth={cat ? 2 : 1.6}
              fill="none"
            />
          )}
          {cat &&
            r.fn !== 'LMuo' &&
            s.x.map((x, i) => <circle key={i} cx={sx(x)} cy={sy(s.y[i])} r={3.5} fill={line} />)}
          {r.fn === 'LMuo' ? (
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={sy(bound[0])}
              y2={sy(bound[0])}
              stroke="currentColor"
              strokeDasharray="6 4"
              strokeWidth={1.4}
            />
          ) : (
            <path
              d={s.x.map((x, i) => `${i ? 'L' : 'M'} ${sx(x)} ${sy(bound[i])}`).join(' ')}
              stroke="currentColor"
              strokeDasharray="6 4"
              strokeWidth={1.4}
              fill="none"
            />
          )}
          {r.fn === 'CvM' && (
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={sy(r.statistic)}
              y2={sy(r.statistic)}
              stroke="currentColor"
              strokeDasharray="2 3"
              strokeWidth={1.2}
            />
          )}
        </svg>
      )}
    </ChartFrame>
  );
}

export function ScoreTestView({ r }: { r: ScoreView }) {
  let peak: string | null = null;
  if (typeof r.peak === 'number') peak = fmt(r.peak, 3);
  else if (r.peak !== null) peak = catLabel(r, r.peak);
  const name = SCORE_FN_NAMES[r.fn];
  return (
    <div className="tables">
      <div className="stat-cards">
        <div className="stat-card">
          <div className="k">{r.fn}</div>
          <div className="v">{fmt(r.statistic, 3)}</div>
        </div>
        <div className="stat-card">
          <div className="k">p</div>
          <div className="v">{r.p < 0.001 ? '< .001' : fmt(r.p, 3)}</div>
        </div>
        <div className="stat-card">
          <div className="k">5% critical value</div>
          <div className="v">{fmt(r.critical, 3)}</div>
        </div>
        <div className="stat-card">
          <div className="k">N</div>
          <div className="v">{r.n}</div>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        {name} along {r.covariate} ({r.scale}), {r.params.length} parameter
        {r.params.length === 1 ? '' : 's'} tested{r.nGroups > 1 ? `, ${r.nGroups} groups` : ''}.{' '}
        {r.p < 0.05
          ? `The tested parameters are not invariant along ${r.covariate} (p < .05)`
          : `No evidence that the tested parameters change along ${r.covariate} (p ≥ .05)`}
        {peak !== null
          ? `; the process peaks at ${peak}${r.scale === 'continuous' ? '' : ' (the split after this category)'}.`
          : '.'}
        {r.fn === 'maxLMo' && r.nrep
          ? ` Critical values from ${r.nrep} simulated replications (seed ${r.seed}).`
          : ''}
        {r.fn === 'WDMo'
          ? ` Its p-value is a multivariate normal probability by randomised quadrature (seed ${r.seed}): its last digits vary with the seed.`
          : ''}
      </p>
      <ProcessChart r={r} />
      <Table
        title="Parameters tested"
        file="score-test-parameters"
        columns={[
          'Parameter',
          'max |fluctuation|',
          ...(r.fn === 'DM' ? ['Beyond the 5% critical value'] : []),
        ]}
        rows={r.params.map((p, i) => [
          c(p),
          c(r.componentMax[i]),
          ...(r.fn === 'DM' ? [c(r.componentMax[i] > r.critical ? 'yes' : 'no')] : []),
        ])}
        note={`Each parameter’s own fluctuation process: its largest absolute value, the double-maximum statistic of that parameter alone (Merkle & Zeileis 2013).${r.fn === 'DM' ? ' DM is the largest of them; a parameter beyond the critical value is one that changes.' : ' Compared with DM’s critical value it shows which parameters drive the result.'}`}
      />
      <Table
        title="Test"
        file="score-test"
        columns={['Statistic', 'Value', 'p', '5% critical value', 'N']}
        rows={[[c(name), c(r.statistic), pCell(r.p), c(r.critical), c(r.n, '', 0)]]}
        note={`strucchange ${r.engine?.version ?? ''} on lavaan ${r.engine?.lavaan ?? ''}: sctest of the empirical fluctuation process of the scores (gefp, decorrelated by the information matrix). The model was fitted once to all observations with the covariate.`}
      />
    </div>
  );
}

/** What else a run depends on: the seed for maxLMo and WDMo, which simulate, and maxLMo's replications. */
function randomInputs(o: ScoreOptions, ctx: AnalysisCtx) {
  if (o.fn === 'maxLMo') return [o.nrep, ctx.settings.seed];
  if (o.fn === 'WDMo') return [ctx.settings.seed];
  return [];
}

export const scoreTestAnalysis: AnalysisType<ScoreOptions, ScoreView> = {
  id: 'scoretest',
  title: 'Score-based invariance test',
  sub: 'parameter instability along a continuous or ordinal covariate (strucchange)',
  group: 'Measurement',
  fitsModel: true,
  defaults: () => ({
    covariate: '',
    scale: 'continuous',
    fn: 'DM',
    sets: ['loadings'],
    nrep: 50000,
  }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const scale = oneOf(raw.scale, ['continuous', 'ordinal', 'categorical'] as const, 'continuous');
    const fn = oneOf(raw.fn, SCORE_FNS, SCORE_TESTS[scale][0]);
    const sets = [
      ...new Set(
        (Array.isArray(raw.sets) ? raw.sets : []).filter((k): k is ScoreSet =>
          (SCORE_SETS as readonly unknown[]).includes(k),
        ),
      ),
    ];
    return {
      covariate: name(raw.covariate),
      scale,
      fn: SCORE_TESTS[scale].includes(fn) ? fn : SCORE_TESTS[scale][0],
      sets,
      nrep: clampNum(raw.nrep, 1000, 200000, 50000, true),
    };
  },
  Options: ScoreOptionsForm,
  View: ({ result }) => <ScoreTestView r={result} />,
  blocked: (o, ctx) => cbModelBlocked(ctx, WHAT) ?? scoreBlocked(o, ctx),
  fingerprint: (o, ctx) =>
    cbFingerprint(ctx, [
      o.covariate,
      o.scale,
      o.fn,
      ...o.sets,
      ...randomInputs(o, ctx),
      columnsFingerprint(ctx, [o.covariate]),
    ]),
  run: async (o, ctx) => {
    const r = await (await import('../rengine/scoretest')).scoreTestR(cbCall(ctx), argsOf(o, ctx));
    const labels = ctx.data?.categories?.[o.covariate];
    return labels ? { ...r, categoryLabels: labels } : r;
  },
  script: async (o, ctx) =>
    (await import('../rengine/scoretest')).scoreTestScriptR(cbCall(ctx), argsOf(o, ctx)),
  summary: (o) =>
    `${o.fn} along ${o.covariate || '…'} · ${o.sets.map((k) => SET_NAMES[k].toLowerCase()).join(', ') || 'no parameters'}`,
};
