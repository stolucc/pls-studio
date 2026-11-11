// Bayesian tests (R/bayes.R) with JASP's default priors: the JZS t-tests and
// Pearson correlations (BayesFactor), the binomial test (beta prior, base R).
// The posterior sampling uses the project's seed; the credible level is the
// project's confidence level.

import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, Table, type Row } from '../components/results/Table';
import { fmt } from '../format';
import type {
  Alternative,
  BAnovaInput,
  BAnovaResult,
  BayesCurves,
  BayesEffect,
  BayesModel,
  BBinomialInput,
  BBinomialResult,
  BContingencyInput,
  BContingencyResult,
  BCorrelationInput,
  BCorrelationResult,
  BRegressionInput,
  BRegressionResult,
  BRmAnovaInput,
  BRmAnovaResult,
  BTTestInput,
  BTTestResult,
} from '../rengine/tests';
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
import {
  designColumns,
  isMulti,
  parseWithinDesign,
  withinDesignBlocked,
  WithinDesignForm,
  withinFingerprint,
} from './withinDesign';

const engine = () => import('../rengine/tests');
const ALT_IDS = ['two.sided', 'greater', 'less'] as const;
/** The Bayesian t-test's designs (validation/cards.ts lists the evidence of each). */
export const BTTEST_TYPES = ['one', 'paired', 'independent'] as const;
const pct = (conf: number) => `${Math.round(conf * 100)}%`;
const NoData = () => <div className="empty-results">Import raw data first.</div>;
const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v > lo && v <= hi ? v : fallback;

/** A Bayes factor for reading: plain between 0.001 and 10,000, otherwise in powers of ten. */
export function fmtBF(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '—';
  if (v === 0) return '0';
  return v >= 1e4 || v < 1e-3
    ? v.toExponential(2).replace('e+', ' × 10^').replace('e-', ' × 10^-')
    : fmt(v, v >= 100 ? 1 : 3);
}
/** Evidence categories of Lee & Wagenmakers (2013), after Jeffreys (1961), for BF10 (below 1: for H0). */
export function evidence(bf10: number): string {
  const b = bf10 >= 1 ? bf10 : 1 / bf10,
    side = bf10 >= 1 ? 'for H1' : 'for H0';
  if (!Number.isFinite(b)) return `extreme ${side}`;
  if (b < 1.0001) return 'none';
  let word = 'extreme';
  if (b < 3) word = 'anecdotal';
  else if (b < 10) word = 'moderate';
  else if (b < 30) word = 'strong';
  else if (b < 100) word = 'very strong';
  return `${word} ${side}`;
}
const bfName = (alt: Alternative) => {
  if (alt === 'two.sided') return 'BF₁₀';
  return alt === 'greater' ? 'BF₊₀' : 'BF₋₀';
};
const bfCells = (bf10: number): Row => [c(fmtBF(bf10)), c(fmtBF(1 / bf10)), c(evidence(bf10))];
const altHint = (o: { alternative: Alternative }, what: string) => {
  if (o.alternative === 'two.sided') return `H1: ${what} differs from zero.`;
  const side = o.alternative === 'greater' ? 'positive' : 'negative';
  return `H1 is one-sided: ${what} ${side} (the prior restricted to that side).`;
};
const ALTS: readonly (readonly [Alternative, string])[] = [
  ['two.sided', 'Two-sided'],
  ['greater', 'Positive'],
  ['less', 'Negative'],
];
const EVIDENCE_NOTE =
  'BF₁₀: how many times more likely the data are under H1 than under H0; BF₀₁ = 1/BF₁₀. Evidence categories after Jeffreys (Lee & Wagenmakers 2013): 1–3 anecdotal, 3–10 moderate, 10–30 strong, 30–100 very strong, above 100 extreme.';

function PriorWidth({
  id = 'bayes-width',
  value,
  onChange,
  label,
  hint,
}: {
  id?: string;
  value: number;
  onChange: (v: number) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input num"
        type="number"
        min={0.01}
        max={100}
        step={0.001}
        value={Number(value.toFixed(4))}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v > 0) onChange(v);
        }}
      />
      <div className="hint">{hint}</div>
    </div>
  );
}

/** BF10 on a log scale over the prior width (robustness) or the number of cases (sequential), with the evidence bands. */
function BFCurve({
  id,
  x: xAll,
  y: yAll,
  xLabel,
  mark,
  title,
}: {
  id: string;
  x: number[];
  y: (number | null)[];
  xLabel: string;
  mark?: number;
  title: string;
}) {
  const W = 520,
    H = 280,
    pad = { l: 64, r: 16, t: 14, b: 44 };
  // Points without a Bayes factor (R's NA: too few or constant cases at the start of a sequential analysis) are left out.
  const keep = yAll.map((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  const x = xAll.filter((_, i) => keep[i]),
    y = yAll.filter((_, i) => keep[i]) as number[];
  if (!x.length) return null;
  const ly = y.map((v) => Math.log10(v));
  const lo = Math.min(-1, Math.floor(Math.min(...ly))),
    hi = Math.max(1, Math.ceil(Math.max(...ly)));
  const x0 = Math.min(...x),
    x1 = Math.max(...x);
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi - v) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const step = Math.max(1, Math.ceil((hi - lo) / 8));
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += step) ticks.push(t);
  const xt = Array.from({ length: 6 }, (_, i) => x0 + ((x1 - x0) * i) / 5);
  return (
    <ChartFrame
      id={id}
      name={id}
      width={W}
      height={H}
      defaults={{ x: xLabel, y: 'BF₁₀ (log scale)' }}
      caption={
        <span className="hint">
          {title} Dashed lines: BF₁₀ = 1/3, 1 and 3 (moderate evidence for H0, none, moderate for
          H1).{mark !== undefined ? ' The dot: the chosen prior width.' : ''}
        </span>
      }
    >
      {(labels) => (
        <svg className="mc-chart data-chart" width={W} height={H} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} />
              <text x={pad.l - 6} y={sy(t) + 4} textAnchor="end">
                {t === 0 ? '1' : `10^${t}`}
              </text>
            </g>
          ))}
          {[-Math.log10(3), 0, Math.log10(3)]
            .filter((t) => t >= lo && t <= hi)
            .map((t) => (
              <line
                key={t}
                className="fit-line"
                strokeDasharray="4 4"
                opacity={0.5}
                x1={pad.l}
                x2={W - pad.r}
                y1={sy(t)}
                y2={sy(t)}
              />
            ))}
          {xt.map((v) => (
            <text key={`x${v}`} x={sx(v)} y={H - pad.b + 16} textAnchor="middle">
              {fmt(v, x1 - x0 > 20 ? 0 : 2)}
            </text>
          ))}
          <polyline
            className="fit-line"
            fill="none"
            points={x.map((v, i) => `${sx(v)},${sy(ly[i])}`).join(' ')}
          />
          {mark !== undefined &&
            (() => {
              const i = x.findIndex((v) => Math.abs(v - mark) < 1e-9);
              return i >= 0 ? <circle className="dot" cx={sx(x[i])} cy={sy(ly[i])} r={4} /> : null;
            })()}
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

function CurveChecks({
  o,
  set,
}: {
  o: { robustness?: boolean; sequential?: boolean };
  set: (p: { robustness?: boolean; sequential?: boolean }) => void;
}) {
  return (
    <div className="field">
      <label>Plots</label>
      <div className="chips">
        <label className="check">
          <input
            type="checkbox"
            checked={!!o.robustness}
            onChange={(e) => set({ robustness: e.target.checked })}
          />{' '}
          Robustness check
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={!!o.sequential}
            onChange={(e) => set({ sequential: e.target.checked })}
          />{' '}
          Sequential analysis
        </label>
      </div>
      <div className="hint">
        Robustness: BF₁₀ for other prior widths. Sequential: BF₁₀ as the cases accumulate, in the
        order of the rows.
      </div>
    </div>
  );
}

function Curves({
  id,
  label,
  c,
  width,
  widthName,
}: {
  id: string;
  label: string;
  c: BayesCurves;
  width: number;
  widthName: string;
}) {
  return (
    <>
      {c.robustness && (
        <BFCurve
          id={`${id}-robustness`}
          x={c.robustness.widths}
          y={c.robustness.bf10}
          xLabel={`Prior width ${widthName}`}
          mark={width}
          title={`${label}: Bayes factor robustness check.`}
        />
      )}
      {c.sequential && (
        <BFCurve
          id={`${id}-sequential`}
          x={c.sequential.n}
          y={c.sequential.bf10}
          xLabel="Number of cases"
          title={`${label}: sequential analysis (the first n cases in row order).`}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- t-tests

export type BTTestOptions = Omit<BTTestInput, 'confidence' | 'seed'>;
const T_NAME = {
  one: 'Bayesian one-sample t-test',
  paired: 'Bayesian paired-samples t-test',
  independent: 'Bayesian independent-samples t-test',
} as const;

/** The effect H1 is about, for each kind of t-test. */
const BT_EFFECT: Record<BTTestOptions['type'], string> = {
  independent: 'the effect (first group minus second)',
  paired: 'the effect (first minus second)',
  one: 'the effect (mean minus test value)',
};

function BTTestForm({ options: o, set, ctx, disabled }: OptionsProps<BTTestOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  const numeric = d.names.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Choice
        label="Design"
        value={o.type}
        onChange={(type) => set({ ...o, type })}
        options={[
          ['one', 'One sample'],
          ['paired', 'Paired samples'],
          ['independent', 'Independent samples'],
        ]}
      />
      {o.type === 'paired' ? (
        <div className="field">
          <label>Pairs</label>
          {o.pairs.map((p, i) => (
            <div key={i} className="row2">
              <ColumnSelect
                id={`bt-a${i}`}
                label="First"
                value={p[0]}
                columns={numeric}
                onChange={(a) =>
                  set({ ...o, pairs: o.pairs.map((q, k) => (k === i ? [a, q[1]] : q)) })
                }
              />
              <ColumnSelect
                id={`bt-b${i}`}
                label="Second"
                value={p[1]}
                columns={numeric}
                exclude={[p[0]]}
                onChange={(b) =>
                  set({ ...o, pairs: o.pairs.map((q, k) => (k === i ? [q[0], b] : q)) })
                }
              />
              <button
                className="btn sm ghost"
                onClick={() => set({ ...o, pairs: o.pairs.filter((_, k) => k !== i) })}
                aria-label={`Remove pair ${i + 1}`}
              >
                Remove
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={() => set({ ...o, pairs: [...o.pairs, ['', '']] })}>
            Add pair
          </button>
        </div>
      ) : (
        <OrderedPicker
          label="Variables"
          columns={numeric.filter((n) => n !== o.group)}
          value={o.vars}
          onChange={(vars) => set({ ...o, vars })}
        />
      )}
      {o.type === 'independent' && (
        <ColumnSelect
          id="bt-g"
          label="Grouping variable (two groups)"
          value={o.group}
          columns={d.names}
          exclude={o.vars}
          onChange={(group) => set({ ...o, group })}
        />
      )}
      {o.type === 'one' && (
        <div className="field">
          <label htmlFor="bt-mu">Test value</label>
          <input
            id="bt-mu"
            className="input num"
            type="number"
            step="any"
            value={o.testValue}
            onChange={(e) => {
              const v = Number(e.target.value);
              set({ ...o, testValue: Number.isFinite(v) ? v : 0 });
            }}
          />
        </div>
      )}
      <Choice
        label="Alternative hypothesis"
        value={o.alternative}
        onChange={(alternative) => set({ ...o, alternative })}
        options={ALTS}
        hint={altHint(o, BT_EFFECT[o.type])}
      />
      <PriorWidth
        label="Cauchy prior width (r)"
        value={o.priorWidth}
        onChange={(priorWidth) => set({ ...o, priorWidth })}
        hint="The prior on the standardised effect δ under H1: Cauchy(0, r). √2/2 ≈ 0.707 is the default of JASP and BayesFactor (“medium”); 1 is “wide”."
      />
      <CurveChecks o={o} set={(p) => set({ ...o, ...p })} />
    </fieldset>
  );
}

function BTTestView({ r }: { r: BTTestResult }) {
  const cri = pct(r.confidence);
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        Cauchy prior width r = {fmt(r.priorWidth)}
        {r.type === 'one' ? `, test value ${fmt(r.testValue)}` : ''}
        {r.groups ? `; ${r.groups[0]} − ${r.groups[1]}` : ''}; BayesFactor {r.engine.version}.
      </p>
      <Table
        title={T_NAME[r.type]}
        file="bayes-ttest"
        columns={['Variable', bfName(r.alternative), 'BF₀₁', 'Evidence', 'Error %']}
        rows={r.rows.map(
          (x): Row => [
            c(x.label),
            ...bfCells(x.bf10),
            c(x.error === null || x.error === undefined ? null : x.error * 100, undefined, 4),
          ],
        )}
        note={EVIDENCE_NOTE}
      />
      <Table
        title="Posterior of the standardised effect δ"
        file="bayes-ttest-posterior"
        columns={['Variable', 'Median', `${cri} credible interval`]}
        rows={r.rows.map(
          (x): Row => [
            c(x.label),
            c(x.delta.median),
            c(`[${fmt(x.delta.low)}, ${fmt(x.delta.high)}]`),
          ],
        )}
        note={`From ${r.iterations.toLocaleString('en')} posterior samples under H1${r.alternative === 'two.sided' ? '' : ' (restricted to the one-sided alternative)'}, seed ${r.seed}.`}
      />
      {r.rows.map((x, i) => (
        <Curves
          key={i}
          id={`bayes-ttest-${i}`}
          label={x.label}
          c={x}
          width={r.priorWidth}
          widthName="r"
        />
      ))}
    </div>
  );
}

const btCols = (o: BTTestOptions) =>
  (o.type === 'paired'
    ? o.pairs.flat()
    : [...o.vars, o.type === 'independent' ? o.group : '']
  ).filter(Boolean);
const btInput = (o: BTTestOptions, ctx: Pick<AnalysisCtx, 'settings'>): BTTestInput => ({
  ...o,
  vars: o.type === 'paired' ? [] : o.vars,
  pairs: o.type === 'paired' ? o.pairs : [],
  group: o.type === 'independent' ? o.group : '',
  seed: ctx.settings.seed,
  confidence: ctx.settings.confidence,
});

export const bayesTtestAnalysis: AnalysisType<BTTestOptions, BTTestResult> = {
  id: 'bttest',
  title: 'Bayesian t-tests',
  sub: 'Bayes factors for one sample, paired, independent (JZS; BayesFactor)',
  group: 'Basic statistics',
  entries: [
    {
      title: 'Bayesian independent-samples t-test',
      sub: 'two groups; Bayes factor and posterior effect size',
      options: (o) => ({ ...o, type: 'independent' }),
    },
    {
      title: 'Bayesian paired-samples t-test',
      sub: 'two measurements of the same cases',
      options: (o) => ({ ...o, type: 'paired' }),
    },
    {
      title: 'Bayesian one-sample t-test',
      sub: 'a mean against a test value',
      options: (o) => ({ ...o, type: 'one' }),
    },
  ],
  cardTitle: (o) => T_NAME[o.type],
  defaults: () => ({
    type: 'independent',
    vars: [],
    pairs: [['', '']],
    group: '',
    testValue: 0,
    alternative: 'two.sided',
    priorWidth: Math.SQRT1_2,
    iterations: 10000,
    robustness: false,
    sequential: false,
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          type: oneOf(raw.type, BTTEST_TYPES, 'independent'),
          vars: names(raw.vars),
          pairs: (Array.isArray(raw.pairs) ? raw.pairs.slice(0, 100) : [])
            .filter(Array.isArray)
            .map((p) => [name(p[0]), name(p[1])] as [string, string]),
          group: name(raw.group),
          testValue:
            typeof raw.testValue === 'number' && Number.isFinite(raw.testValue) ? raw.testValue : 0,
          alternative: oneOf(raw.alternative, ALT_IDS, 'two.sided'),
          priorWidth: num(raw.priorWidth, 0, 100, Math.SQRT1_2),
          iterations: Math.round(num(raw.iterations, 999, 1e6, 10000)),
          robustness: raw.robustness === true,
          sequential: raw.sequential === true,
        }
      : null,
  Options: BTTestForm,
  View: ({ result }) => <BTTestView r={result} />,
  blocked: (o, ctx) => {
    if (o.type === 'paired') {
      if (!o.pairs.length || o.pairs.some((p) => !p[0] || !p[1]))
        return 'Choose both variables of each pair.';
      if (o.pairs.some((p) => p[0] === p[1])) return 'A pair needs two different variables.';
    } else if (!o.vars.length) return 'Choose at least one variable.';
    if (o.type === 'independent' && !o.group) return 'Choose the grouping variable.';
    return missingColumns(ctx, btCols(o), 'Bayesian t-test');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, btCols(o), [
      o.type,
      o.testValue,
      o.alternative,
      o.priorWidth,
      o.iterations,
      String(!!o.robustness),
      String(!!o.sequential),
      ctx.settings.seed,
      ctx.settings.confidence,
    ]),
  run: async (o, ctx) => (await engine()).bttestR(rawData(ctx)!, btInput(o, ctx)),
  script: async (o, ctx) => (await engine()).bttestScriptR(rawData(ctx)!, btInput(o, ctx)),
  summary: (o) => {
    const variables =
      o.type === 'paired'
        ? o.pairs.map((p) => p.join(' − ')).join(', ') || '…'
        : o.vars.join(', ') || '…';
    const byGroup = o.type === 'independent' ? ` by ${o.group || '…'}` : '';
    return `${T_NAME[o.type].toLowerCase()} · ${variables}${byGroup} · r = ${fmt(o.priorWidth)}`;
  },
};

// ---------------------------------------------------------------- correlation

export type BCorrelationOptions = Omit<BCorrelationInput, 'confidence' | 'seed'>;

export const bayesCorrelationAnalysis: AnalysisType<BCorrelationOptions, BCorrelationResult> = {
  id: 'bcorrelation',
  title: 'Bayesian correlation',
  sub: 'Pearson’s r with Bayes factors and the posterior of ρ (BayesFactor)',
  group: 'Basic statistics',
  cardTitle: () => 'Bayesian Pearson correlations',
  defaults: () => ({
    vars: [],
    alternative: 'two.sided',
    priorWidth: 1,
    iterations: 10000,
    robustness: false,
    sequential: false,
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          vars: names(raw.vars),
          alternative: oneOf(raw.alternative, ALT_IDS, 'two.sided'),
          priorWidth: num(raw.priorWidth, 0, 100, 1),
          iterations: Math.round(num(raw.iterations, 999, 1e6, 10000)),
          robustness: raw.robustness === true,
          sequential: raw.sequential === true,
        }
      : null,
  Options: ({ options: o, set, ctx, disabled }) => {
    const d = rawData(ctx);
    if (!d) return <NoData />;
    return (
      <fieldset className="card-options" disabled={disabled}>
        <OrderedPicker
          label="Variables"
          columns={d.names.filter((n) => !d.categories?.[n])}
          value={o.vars}
          onChange={(vars) => set({ ...o, vars })}
        />
        <Choice
          label="Alternative hypothesis"
          value={o.alternative}
          onChange={(alternative) => set({ ...o, alternative })}
          options={ALTS}
          hint={altHint(o, 'the correlation')}
        />
        <PriorWidth
          label="Stretched beta prior width (κ)"
          value={o.priorWidth}
          onChange={(priorWidth) => set({ ...o, priorWidth })}
          hint="The prior on ρ: a beta(1/κ, 1/κ) stretched to −1…1. κ = 1 (uniform) is JASP’s default; smaller κ puts more weight near zero."
        />
        <CurveChecks o={o} set={(p) => set({ ...o, ...p })} />
      </fieldset>
    );
  },
  View: ({ result: r }) => (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        Stretched beta prior width κ = {fmt(r.priorWidth)}; pairwise complete cases; BayesFactor{' '}
        {r.engine.version}.
      </p>
      <Table
        title="Bayesian Pearson correlations"
        file="bayes-correlation"
        columns={[
          'Pair',
          'r',
          'N',
          bfName(r.alternative),
          'BF₀₁',
          'Evidence',
          'Posterior median ρ',
          `${pct(r.confidence)} credible interval`,
        ]}
        rows={r.pairs.map(
          (p): Row => [
            c(`${p.a} – ${p.b}`),
            c(p.r),
            c(p.n, undefined, 0),
            ...bfCells(p.bf10),
            c(p.rho.median),
            c(`[${fmt(p.rho.low)}, ${fmt(p.rho.high)}]`),
          ],
        )}
        note={`${EVIDENCE_NOTE} Posterior from ${r.iterations.toLocaleString('en')} samples, seed ${r.seed}.`}
      />
      {r.pairs.map((p, i) => (
        <Curves
          key={i}
          id={`bayes-correlation-${i}`}
          label={`${p.a} – ${p.b}`}
          c={p}
          width={r.priorWidth}
          widthName="κ"
        />
      ))}
    </div>
  ),
  blocked: (o, ctx) =>
    o.vars.length < 2
      ? 'Choose at least two variables.'
      : missingColumns(ctx, o.vars, 'Bayesian correlation'),
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, o.vars, [
      o.alternative,
      o.priorWidth,
      o.iterations,
      String(!!o.robustness),
      String(!!o.sequential),
      ctx.settings.seed,
      ctx.settings.confidence,
    ]),
  run: async (o, ctx) =>
    (await engine()).bcorrelationR(rawData(ctx)!, {
      ...o,
      seed: ctx.settings.seed,
      confidence: ctx.settings.confidence,
    }),
  script: async (o, ctx) =>
    (await engine()).bcorrelationScriptR(rawData(ctx)!, {
      ...o,
      seed: ctx.settings.seed,
      confidence: ctx.settings.confidence,
    }),
  summary: (o) => `${o.vars.join(', ') || '…'} · κ = ${fmt(o.priorWidth)}`,
};

// ---------------------------------------------------------------- binomial

export type BBinomialOptions = Omit<BBinomialInput, 'confidence' | 'seed'>;
const logistic = (o: BBinomialOptions) => o.prior === 'logistic';
/** The prior fields: none for the beta prior (the card's original options), the logistic prior's scale and samples otherwise. */
const binomialPrior = (raw: Record<string, unknown>): Partial<BBinomialOptions> =>
  raw.prior === 'logistic'
    ? {
        prior: 'logistic',
        priorScale: num(raw.priorScale, 0, 100, 0.5),
        iterations: Math.round(num(raw.iterations, 999, 1e6, 10000)),
      }
    : {};
const bbInput = (o: BBinomialOptions, ctx: Pick<AnalysisCtx, 'settings'>): BBinomialInput => ({
  ...o,
  confidence: ctx.settings.confidence,
  ...(logistic(o) ? { seed: ctx.settings.seed } : {}),
});

export const bayesBinomialAnalysis: AnalysisType<BBinomialOptions, BBinomialResult> = {
  id: 'bbinomial',
  title: 'Bayesian binomial test',
  sub: 'a proportion against a value, beta prior (Bayes factor, posterior)',
  group: 'Basic statistics',
  cardTitle: (o) => `Bayesian binomial test${o.variable ? `: ${o.variable}` : ''}`,
  defaults: () => ({
    variable: '',
    testValue: 0.5,
    alternative: 'two.sided',
    priorA: 1,
    priorB: 1,
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          variable: name(raw.variable),
          testValue:
            typeof raw.testValue === 'number' && raw.testValue > 0 && raw.testValue < 1
              ? raw.testValue
              : 0.5,
          alternative: oneOf(raw.alternative, ALT_IDS, 'two.sided'),
          priorA: num(raw.priorA, 0, 1e4, 1),
          priorB: num(raw.priorB, 0, 1e4, 1),
          ...binomialPrior(raw),
        }
      : null,
  Options: ({ options: o, set, ctx, disabled }) => {
    const d = rawData(ctx);
    if (!d) return <NoData />;
    const setNum = (k: 'testValue' | 'priorA' | 'priorB') => (e: { target: { value: string } }) => {
      const v = Number(e.target.value);
      if (Number.isFinite(v) && v > 0) set({ ...o, [k]: v });
    };
    return (
      <fieldset className="card-options" disabled={disabled}>
        <ColumnSelect
          id="bb-x"
          label="Variable"
          value={o.variable}
          columns={d.names}
          onChange={(variable) => set({ ...o, variable })}
        />
        <div className="field">
          <label htmlFor="bb-p">Test proportion</label>
          <input
            id="bb-p"
            className="input num"
            type="number"
            min={0.001}
            max={0.999}
            step={0.01}
            value={o.testValue}
            onChange={setNum('testValue')}
          />
        </div>
        <Choice
          label="Alternative hypothesis"
          value={o.alternative}
          onChange={(alternative) => set({ ...o, alternative })}
          options={[
            ['two.sided', 'Two-sided'],
            ['greater', 'Greater'],
            ['less', 'Less'],
          ]}
          hint={
            o.alternative === 'two.sided'
              ? 'H1: the proportion differs from the test value.'
              : `H1: the proportion is ${o.alternative === 'greater' ? 'above' : 'below'} the test value (the prior restricted to that side).`
          }
        />
        <Choice
          label="Prior under H1"
          value={logistic(o) ? 'logistic' : 'beta'}
          options={[
            ['beta', 'Beta on the proportion'],
            ['logistic', 'Logistic on the log odds'],
          ]}
          onChange={(p) => {
            const { prior: _p, priorScale: _s, iterations: _i, ...beta } = o;
            set(p === 'logistic' ? { ...beta, ...binomialPrior({ prior: 'logistic' }) } : beta);
          }}
        />
        {logistic(o) ? (
          <>
            <PriorWidth
              id="bb-r"
              label="Prior scale (r)"
              value={o.priorScale ?? 0.5}
              onChange={(priorScale) => set({ ...o, priorScale })}
              hint="BayesFactor’s proportionBF: the log odds under H1 are logistic, centred on the test proportion’s log odds, with scale r; 0.5 is its default (“medium”), 1 “wide”. The posterior of the proportion is sampled (the project’s seed)."
            />
          </>
        ) : (
          <>
            <div className="row2">
              <div className="field">
                <label htmlFor="bb-a">Beta prior a</label>
                <input
                  id="bb-a"
                  className="input num"
                  type="number"
                  min={0.01}
                  step={0.1}
                  value={o.priorA}
                  onChange={setNum('priorA')}
                />
              </div>
              <div className="field">
                <label htmlFor="bb-b">Beta prior b</label>
                <input
                  id="bb-b"
                  className="input num"
                  type="number"
                  min={0.01}
                  step={0.1}
                  value={o.priorB}
                  onChange={setNum('priorB')}
                />
              </div>
            </div>
            <div className="hint">
              The prior on the proportion under H1: beta(a, b). a = b = 1 (uniform) is JASP’s
              default.
            </div>
          </>
        )}
      </fieldset>
    );
  },
  View: ({ result: r }) => (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.prior === 'logistic' ? (
          <>
            Logistic prior on the log odds, scale r = {fmt(r.priorScale ?? 0.5)}; test proportion{' '}
            {fmt(r.testValue)}; BayesFactor {r.engine.version} (proportionBF), posterior from{' '}
            {(r.iterations ?? 0).toLocaleString('en')} samples, seed {r.seed}.
          </>
        ) : (
          <>
            Beta({fmt(r.priorA, 2)}, {fmt(r.priorB, 2)}) prior; test proportion {fmt(r.testValue)};
            closed form (base R {r.engine.version}).
          </>
        )}
      </p>
      <Table
        title={`Bayesian binomial test: ${r.variable}`}
        file="bayes-binomial"
        columns={[
          'Category',
          'Count',
          'Total',
          'Proportion',
          bfName(r.alternative),
          'BF₀₁',
          'Evidence',
          'Posterior median',
          `${pct(r.confidence)} credible interval`,
        ]}
        rows={r.levels.map(
          (l, i): Row => [
            c(l),
            c(r.counts[i], undefined, 0),
            c(r.n, undefined, 0),
            c(r.counts[i] / r.n),
            ...bfCells(r.rows[i].bf10),
            c(r.rows[i].median),
            c(`[${fmt(r.rows[i].low)}, ${fmt(r.rows[i].high)}]`),
          ],
        )}
        note={`Each category against the rest. ${EVIDENCE_NOTE} ${r.prior === 'logistic' ? 'The posterior is sampled under H1 (restricted to the one-sided alternative).' : 'The posterior (beta) is the unrestricted one.'}`}
      />
    </div>
  ),
  blocked: (o, ctx) =>
    !o.variable
      ? 'Choose the variable.'
      : missingColumns(ctx, [o.variable], 'Bayesian binomial test'),
  fingerprint: (o, ctx) =>
    columnsFingerprint(
      ctx,
      [o.variable],
      [
        o.testValue,
        o.alternative,
        o.priorA,
        o.priorB,
        ctx.settings.confidence,
        ...(logistic(o)
          ? ['logistic', o.priorScale ?? 0.5, o.iterations ?? 10000, ctx.settings.seed]
          : []),
      ],
    ),
  run: async (o, ctx) => (await engine()).bbinomialR(rawData(ctx)!, bbInput(o, ctx)),
  script: async (o, ctx) => (await engine()).bbinomialScriptR(rawData(ctx)!, bbInput(o, ctx)),
  summary: (o) =>
    `${o.variable || '…'} vs ${o.testValue} · ${logistic(o) ? `logistic prior, r = ${fmt(o.priorScale ?? 0.5)}` : `beta(${o.priorA}, ${o.priorB})`}`,
};

// ---------------------------------------------------------------- ANOVA / ANCOVA

export type BAnovaOptions = Omit<BAnovaInput, 'seed'>;

function BAnovaForm({ options: o, set, ctx, disabled }: OptionsProps<BAnovaOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  const numeric = d.names.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <ColumnSelect
        id="ba-y"
        label="Dependent variable"
        value={o.dependent}
        columns={numeric}
        exclude={[...o.factors, ...o.covariates]}
        onChange={(dependent) => set({ ...o, dependent })}
      />
      <OrderedPicker
        label="Fixed factors"
        columns={d.names.filter((n) => n !== o.dependent && !o.covariates.includes(n))}
        value={o.factors}
        onChange={(factors) => set({ ...o, factors })}
      />
      <OrderedPicker
        label="Covariates (ANCOVA, optional)"
        columns={numeric.filter((n) => n !== o.dependent && !o.factors.includes(n))}
        value={o.covariates}
        onChange={(covariates) => set({ ...o, covariates })}
      />
      <Choice
        label="Model terms"
        value={o.interactions ? 'full' : 'main'}
        onChange={(v) => set({ ...o, interactions: v === 'full' })}
        options={[
          ['full', 'With interactions'],
          ['main', 'Main effects only'],
        ]}
        hint="Every model that keeps an interaction’s main effects is compared with the null model (BayesFactor’s “withmain”, as JASP)."
      />
      {o.interactions && o.covariates.length > 0 && (
        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={!!o.covariateInteractions}
              onChange={(e) => {
                const { covariateInteractions: _c, ...rest } = o;
                set(e.target.checked ? { ...rest, covariateInteractions: true } : rest);
              }}
            />{' '}
            Interactions with the covariates
          </label>
          <div className="hint">
            The covariates enter the factorial too: a factor × covariate interaction lets the
            covariate’s slope differ between groups (as BayesFactor’s manual fits supp × log₂ dose).
          </div>
        </div>
      )}
      <div className="row2">
        <PriorWidth
          id="ba-rf"
          label="Prior width, fixed effects"
          value={o.priorFixed}
          onChange={(priorFixed) => set({ ...o, priorFixed })}
          hint="JASP’s default 0.5 (BayesFactor’s “medium”)."
        />
        <PriorWidth
          id="ba-rc"
          label="Prior width, covariates"
          value={o.priorCovariates}
          onChange={(priorCovariates) => set({ ...o, priorCovariates })}
          hint="JASP’s default √2/4 ≈ 0.354."
        />
      </div>
    </fieldset>
  );
}

function BAnovaView({ r }: { r: BAnovaResult }) {
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.dependent}, n = {r.n}; prior widths {fmt(r.priorFixed)} (factors)
        {r.covariates.length ? `, ${fmt(r.priorCovariates)} (covariates)` : ''}
        {r.covariateInteractions ? '; with the covariates’ interactions' : ''};{' '}
        {r.iterations.toLocaleString('en')} samples, seed {r.seed}; BayesFactor {r.engine.version}.
      </p>
      <ModelTables
        file="bayes-anova"
        title={`Bayesian ${r.covariates.length ? 'ANCOVA' : 'ANOVA'}: model comparison`}
        models={r.models}
        effects={r.effects}
        priorNote="BF₁₀: each model against the null model (intercept only); equal prior model probabilities. Error: the proportional error of BayesFactor’s numerical integration or sampling."
      />
    </div>
  );
}

const baCols = (o: BAnovaOptions) => [o.dependent, ...o.factors, ...o.covariates].filter(Boolean);
/** Factor × covariate interactions apply only with interactions and covariates. */
const withCovInteractions = (o: BAnovaOptions) =>
  !!o.covariateInteractions && o.interactions && o.covariates.length > 0;
export const bayesAnovaAnalysis: AnalysisType<BAnovaOptions, BAnovaResult> = {
  id: 'banova',
  title: 'Bayesian ANOVA',
  sub: 'model comparison and inclusion Bayes factors; ANCOVA with covariates (BayesFactor)',
  group: 'Basic statistics',
  entries: [
    {
      title: 'Bayesian ANOVA',
      sub: 'between-subjects factors; models and effects',
      options: (o) => o,
    },
    { title: 'Bayesian ANCOVA', sub: 'factors and covariates', options: (o) => o },
  ],
  cardTitle: (o) =>
    `Bayesian ${o.covariates.length ? 'ANCOVA' : 'ANOVA'}${o.dependent ? `: ${o.dependent}` : ''}`,
  defaults: () => ({
    dependent: '',
    factors: [],
    covariates: [],
    interactions: true,
    priorFixed: 0.5,
    priorCovariates: Math.SQRT2 / 4,
    iterations: 10000,
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          dependent: name(raw.dependent),
          factors: names(raw.factors),
          covariates: names(raw.covariates),
          interactions: raw.interactions !== false,
          priorFixed: num(raw.priorFixed, 0, 100, 0.5),
          priorCovariates: num(raw.priorCovariates, 0, 100, Math.SQRT2 / 4),
          iterations: Math.round(num(raw.iterations, 999, 1e6, 10000)),
          ...(raw.covariateInteractions === true ? { covariateInteractions: true } : {}),
        }
      : null,
  Options: BAnovaForm,
  View: ({ result }) => <BAnovaView r={result} />,
  blocked: (o, ctx) => {
    if (!o.dependent) return 'Choose the dependent variable.';
    if (!o.factors.length) return 'Choose at least one factor.';
    if (o.factors.length + o.covariates.length > 6)
      return 'At most six factors and covariates: the number of models grows quickly.';
    return missingColumns(ctx, baCols(o), 'Bayesian ANOVA');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, baCols(o), [
      String(o.interactions),
      o.priorFixed,
      o.priorCovariates,
      o.iterations,
      ...o.factors,
      '|',
      ...o.covariates,
      ctx.settings.seed,
      ...(withCovInteractions(o) ? ['covariate interactions'] : []),
    ]),
  run: async (o, ctx) => (await engine()).banovaR(rawData(ctx)!, { ...o, seed: ctx.settings.seed }),
  script: async (o, ctx) =>
    (await engine()).banovaScriptR(rawData(ctx)!, { ...o, seed: ctx.settings.seed }),
  summary: (o) =>
    `${o.dependent || '…'} by ${o.factors.join(' × ') || '…'}${o.covariates.length ? ` ${withCovInteractions(o) ? '×' : '+'} ${o.covariates.join(', ')}` : ''}`,
};

// ---------------------------------------------------------------- contingency tables

export type BContingencyOptions = BContingencyInput;
const SAMPLING: readonly (readonly [BContingencyInput['sampling'], string])[] = [
  ['jointMulti', 'Joint multinomial'],
  ['indepRows', 'Independent multinomial, rows fixed'],
  ['indepCols', 'Independent multinomial, columns fixed'],
  ['poisson', 'Poisson'],
  ['hypergeom', 'Hypergeometric (2 × 2)'],
];
const SAMPLING_HINT: Record<BContingencyInput['sampling'], string> = {
  jointMulti: 'Only the total N was fixed by the design (JASP’s default).',
  indepRows: 'The number of cases in each row was fixed by the design.',
  indepCols: 'The number of cases in each column was fixed by the design.',
  poisson: 'Nothing was fixed: the total itself is random.',
  hypergeom: 'Both margins were fixed (2 × 2 tables only).',
};

export const bayesContingencyAnalysis: AnalysisType<BContingencyOptions, BContingencyResult> = {
  id: 'bcontingency',
  title: 'Bayesian contingency table',
  sub: 'independence against association (Gunel & Dickey; BayesFactor)',
  group: 'Basic statistics',
  cardTitle: (o) =>
    `Bayesian contingency table${o.rows && o.columns ? `: ${o.rows} × ${o.columns}` : ''}`,
  defaults: () => ({
    rows: '',
    columns: '',
    counts: '',
    sampling: 'jointMulti',
    priorConcentration: 1,
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          rows: name(raw.rows),
          columns: name(raw.columns),
          counts: name(raw.counts),
          sampling: oneOf(
            raw.sampling,
            ['jointMulti', 'indepRows', 'indepCols', 'poisson', 'hypergeom'] as const,
            'jointMulti',
          ),
          priorConcentration: num(raw.priorConcentration, 0, 1e4, 1),
        }
      : null,
  Options: ({ options: o, set, ctx, disabled }) => {
    const d = rawData(ctx);
    if (!d) return <NoData />;
    return (
      <fieldset className="card-options" disabled={disabled}>
        <div className="row2">
          <ColumnSelect
            id="bc-r"
            label="Rows"
            value={o.rows}
            columns={d.names}
            exclude={[o.columns, o.counts]}
            onChange={(rows) => set({ ...o, rows })}
          />
          <ColumnSelect
            id="bc-c"
            label="Columns"
            value={o.columns}
            columns={d.names}
            exclude={[o.rows, o.counts]}
            onChange={(columns) => set({ ...o, columns })}
          />
        </div>
        <ColumnSelect
          id="bc-w"
          label="Counts (optional)"
          optional="None: one row per case"
          value={o.counts}
          columns={d.names.filter((n) => !d.categories?.[n])}
          exclude={[o.rows, o.columns]}
          onChange={(counts) => set({ ...o, counts })}
        />
        <div className="field">
          <label htmlFor="bc-s">Sampling plan</label>
          <select
            id="bc-s"
            className="select"
            value={o.sampling}
            onChange={(e) =>
              set({ ...o, sampling: e.target.value as BContingencyInput['sampling'] })
            }
          >
            {SAMPLING.map(([id, l]) => (
              <option key={id} value={id}>
                {l}
              </option>
            ))}
          </select>
          <div className="hint">
            {SAMPLING_HINT[o.sampling]} The Bayes factor depends on what the design fixed.
          </div>
        </div>
        <PriorWidth
          label="Prior concentration (a)"
          value={o.priorConcentration}
          onChange={(priorConcentration) => set({ ...o, priorConcentration })}
          hint="The Dirichlet prior on the cell probabilities; 1 is JASP’s default."
        />
      </fieldset>
    );
  },
  View: ({ result: r }) => (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {SAMPLING.find(([id]) => id === r.sampling)?.[1]} sampling, prior concentration{' '}
        {fmt(r.priorConcentration)}; n = {r.n}; BayesFactor {r.engine.version}.
      </p>
      <Table
        title={`${r.rows} × ${r.columns}`}
        file="bayes-contingency-table"
        columns={[`${r.rows} \\ ${r.columns}`, ...r.colLevels, 'Total']}
        rows={[
          ...r.rowLevels.map(
            (l, i): Row => [
              c(l),
              ...r.counts[i].map((x) => c(x, undefined, 0)),
              c(
                r.counts[i].reduce((a, b) => a + b, 0),
                undefined,
                0,
              ),
            ],
          ),
          [
            c('Total'),
            ...r.colLevels.map((_, j) =>
              c(
                r.counts.reduce((a, row) => a + row[j], 0),
                undefined,
                0,
              ),
            ),
            c(r.n, undefined, 0),
          ],
        ]}
      />
      <Table
        title="Bayesian test of association"
        file="bayes-contingency"
        columns={['BF₁₀', 'BF₀₁', 'Evidence', 'Error %']}
        rows={[[...bfCells(r.bf10), c(r.error ? r.error * 100 : null, undefined, 4)]]}
        note={`H0: the row and column variables are independent; H1: they are associated. ${EVIDENCE_NOTE}`}
      />
    </div>
  ),
  blocked: (o, ctx) => {
    if (!o.rows || !o.columns) return 'Choose the row and the column variables.';
    if (o.rows === o.columns) return 'Choose two different variables.';
    const columns = [o.rows, o.columns, o.counts].filter(Boolean);
    return missingColumns(ctx, columns, 'Bayesian contingency table');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, [o.rows, o.columns, o.counts].filter(Boolean), [
      o.rows,
      o.columns,
      o.counts,
      o.sampling,
      o.priorConcentration,
    ]),
  run: async (o, ctx) => (await engine()).bcontingencyR(rawData(ctx)!, o),
  script: async (o, ctx) => (await engine()).bcontingencyScriptR(rawData(ctx)!, o),
  summary: (o) =>
    `${o.rows || '…'} × ${o.columns || '…'} · ${SAMPLING.find(([id]) => id === o.sampling)?.[1].toLowerCase()}`,
};

// ---------------------------------------------------------------- shared: model comparison

function ModelTables({
  file,
  title,
  models,
  effects,
  effectName = 'Effect',
  r2 = false,
  priorNote,
}: {
  file: string;
  title: string;
  models: BayesModel[];
  effects: BayesEffect[];
  effectName?: string;
  r2?: boolean;
  priorNote: string;
}) {
  const best = models.reduce((a, m) => (m.posterior > a.posterior ? m : a), models[0]);
  return (
    <>
      <Table
        title={title}
        file={`${file}-models`}
        columns={['Model', 'P(M)', 'P(M | data)', 'BF_M', 'BF₁₀', ...(r2 ? ['R²'] : []), 'Error %']}
        rows={[...models]
          .sort((a, b) => b.posterior - a.posterior)
          .slice(0, 50)
          .map(
            (m): Row => [
              { v: m.model, bold: m === best },
              c(m.prior),
              c(m.posterior),
              c(fmtBF(m.bfM)),
              c(fmtBF(m.bf10)),
              ...(r2 ? [c(m.r2 ?? null)] : []),
              c(m.error ? m.error * 100 : null, undefined, 4),
            ],
          )}
        note={`${priorNote} BF_M: a model’s posterior odds over its prior odds.${models.length > 50 ? ` The 50 most probable of ${models.length} models.` : ''}`}
      />
      <Table
        title={`Analysis of ${effectName === 'Effect' ? 'effects' : 'predictors'} (across all models)`}
        file={`${file}-effects`}
        columns={[effectName, 'P(incl)', 'P(incl | data)', 'BF_incl', 'Evidence']}
        rows={effects.map(
          (e): Row => [
            c(e.effect),
            c(e.priorInclusion),
            c(e.posteriorInclusion),
            c(fmtBF(e.bfInclusion)),
            c(evidence(e.bfInclusion)),
          ],
        )}
        note="Inclusion Bayes factor: the posterior odds of the models with the term over those without, by their prior odds."
      />
    </>
  );
}

// ---------------------------------------------------------------- repeated-measures ANOVA

export type BRmAnovaOptions = Omit<BRmAnovaInput, 'seed'>;
const rmCols = (o: BRmAnovaOptions) => designColumns(o);
const rmName = (o: BRmAnovaOptions) =>
  isMulti(o) ? o.factors!.map((f) => f.name || '…').join(' × ') : o.factorName || '…';

export const bayesRmAnovaAnalysis: AnalysisType<BRmAnovaOptions, BRmAnovaResult> = {
  id: 'brmanova',
  title: 'Bayesian repeated-measures ANOVA',
  sub: 'within-subject factors (wide columns), subjects random; models and effects (BayesFactor)',
  group: 'Basic statistics',
  cardTitle: (o) => `Bayesian repeated-measures ANOVA: ${rmName(o)}`,
  defaults: () => ({
    levels: [],
    factorName: 'condition',
    between: '',
    priorFixed: 0.5,
    priorRandom: 1,
    iterations: 10000,
  }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const { factors, cells, ...design } = parseWithinDesign(raw);
    return {
      ...design,
      priorFixed: num(raw.priorFixed, 0, 100, 0.5),
      priorRandom: num(raw.priorRandom, 0, 100, 1),
      iterations: Math.round(num(raw.iterations, 999, 1e6, 10000)),
      ...(factors ? { factors, cells } : {}),
    };
  },
  Options: ({ options: o, set, ctx, disabled }) => {
    const d = rawData(ctx);
    if (!d) return <NoData />;
    return (
      <fieldset className="card-options" disabled={disabled}>
        <WithinDesignForm
          id="brm"
          o={o}
          set={set}
          numeric={d.names.filter((n) => !d.categories?.[n])}
        />
        <ColumnSelect
          id="brm-b"
          label="Between-subjects factor (optional)"
          optional="None"
          value={o.between}
          columns={d.names}
          exclude={designColumns({ ...o, between: '' })}
          onChange={(between) => set({ ...o, between })}
        />
        <div className="row2">
          <PriorWidth
            id="brm-rf"
            label="Prior width, fixed effects"
            value={o.priorFixed}
            onChange={(priorFixed) => set({ ...o, priorFixed })}
            hint="JASP’s default 0.5."
          />
          <PriorWidth
            id="brm-rr"
            label="Prior width, subjects"
            value={o.priorRandom}
            onChange={(priorRandom) => set({ ...o, priorRandom })}
            hint="The random effect of the subjects; JASP’s default 1."
          />
        </div>
      </fieldset>
    );
  },
  View: ({ result: r }) => (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.factors && r.factors.length >= 2
          ? `${r.factors.map((f) => `${f.name} (${f.levels.length} levels)`).join(' × ')}: ${r.levels.length} cells`
          : `${r.levels.length} levels of ${r.factorName}`}
        {r.between ? `, between ${r.between}` : ''}; {r.n} subjects; prior widths{' '}
        {fmt(r.priorFixed)} (fixed), {fmt(r.priorRandom)} (subjects);{' '}
        {r.iterations.toLocaleString('en')} samples, seed {r.seed}; BayesFactor {r.engine.version}.
      </p>
      <ModelTables
        file="bayes-rmanova"
        title="Bayesian repeated-measures ANOVA: model comparison"
        models={r.models}
        effects={r.effects}
        priorNote="Every model includes the subjects as a random effect; BF₁₀ against the null model of the subjects alone, as JASP. Equal prior model probabilities."
      />
    </div>
  ),
  blocked: (o, ctx) => {
    if (isMulti(o)) {
      const b = withinDesignBlocked(o);
      if (b) return b;
    } else {
      if (o.levels.length < 2) return 'Choose at least two columns, one per level.';
      if (
        !/^[A-Za-z][A-Za-z0-9_.]{0,30}$/.test(o.factorName) ||
        ['subject', 'y'].includes(o.factorName)
      )
        return 'The factor name must start with a letter, use letters, digits, _ or . only, and not be subject or y.';
      if (o.levels.includes(o.between)) return 'The between factor cannot be one of the levels.';
    }
    return missingColumns(ctx, rmCols(o), 'Bayesian repeated-measures ANOVA');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, rmCols(o), [
      o.factorName,
      o.between,
      o.priorFixed,
      o.priorRandom,
      o.iterations,
      ctx.settings.seed,
      ...withinFingerprint(o),
    ]),
  run: async (o, ctx) =>
    (await engine()).brmanovaR(rawData(ctx)!, { ...o, seed: ctx.settings.seed }),
  script: async (o, ctx) =>
    (await engine()).brmanovaScriptR(rawData(ctx)!, { ...o, seed: ctx.settings.seed }),
  summary: (o) =>
    (isMulti(o)
      ? `${rmName(o)}: ${(o.cells ?? []).filter(Boolean).length} cells`
      : `${o.factorName}: ${o.levels.join(', ') || '…'}`) +
    (o.between ? ` · between ${o.between}` : ''),
};

// ---------------------------------------------------------------- linear regression

export type BRegressionOptions = Omit<BRegressionInput, 'seed' | 'confidence'>;
const brCols = (o: BRegressionOptions) => [o.outcome, ...o.predictors].filter(Boolean);

export const bayesRegressionAnalysis: AnalysisType<BRegressionOptions, BRegressionResult> = {
  id: 'bregression',
  title: 'Bayesian linear regression',
  sub: 'every subset of the predictors; inclusion probabilities, coefficients (BayesFactor)',
  group: 'Basic statistics',
  cardTitle: (o) => `Bayesian linear regression${o.outcome ? `: ${o.outcome}` : ''}`,
  defaults: () => ({
    outcome: '',
    predictors: [],
    priorWidth: Math.SQRT2 / 4,
    modelPrior: 'betabinomial',
    iterations: 10000,
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          outcome: name(raw.outcome),
          predictors: names(raw.predictors),
          priorWidth: num(raw.priorWidth, 0, 100, Math.SQRT2 / 4),
          modelPrior: oneOf(raw.modelPrior, ['betabinomial', 'uniform'] as const, 'betabinomial'),
          iterations: Math.round(num(raw.iterations, 999, 1e6, 10000)),
        }
      : null,
  Options: ({ options: o, set, ctx, disabled }) => {
    const d = rawData(ctx);
    if (!d) return <NoData />;
    const numeric = d.names.filter((n) => !d.categories?.[n]);
    return (
      <fieldset className="card-options" disabled={disabled}>
        <ColumnSelect
          id="br-y"
          label="Outcome"
          value={o.outcome}
          columns={numeric}
          exclude={o.predictors}
          onChange={(outcome) => set({ ...o, outcome })}
        />
        <OrderedPicker
          label="Predictors (numeric, at most ten)"
          columns={numeric.filter((n) => n !== o.outcome)}
          value={o.predictors}
          onChange={(predictors) => set({ ...o, predictors })}
        />
        <Choice
          label="Model prior"
          value={o.modelPrior}
          onChange={(modelPrior) => set({ ...o, modelPrior })}
          options={[
            ['betabinomial', 'Beta-binomial (1, 1)'],
            ['uniform', 'Uniform'],
          ]}
          hint={
            o.modelPrior === 'betabinomial'
              ? 'Every model size is equally likely, shared by the models of that size (JASP’s default): guards against favouring many predictors.'
              : 'Every model equally likely.'
          }
        />
        <PriorWidth
          label="Prior width of the coefficients (r)"
          value={o.priorWidth}
          onChange={(priorWidth) => set({ ...o, priorWidth })}
          hint="The Zellner–Siow (JZS) prior’s scale; √2/4 ≈ 0.354 is JASP’s default (BayesFactor’s “medium”)."
        />
      </fieldset>
    );
  },
  View: ({ result: r }) => (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.outcome} on {r.predictors.join(', ')}, n = {r.n}; JZS prior r = {fmt(r.priorWidth)};{' '}
        {r.modelPrior === 'betabinomial' ? 'beta-binomial (1, 1)' : 'uniform'} model prior;
        BayesFactor {r.engine.version}.
      </p>
      <ModelTables
        file="bayes-regression"
        title="Bayesian linear regression: model comparison"
        models={r.models}
        effects={r.effects}
        effectName="Predictor"
        r2
        priorNote="BF₁₀ against the intercept-only model (exact, by quadrature)."
      />
      {r.coefficients.length > 0 && (
        <Table
          title={`Coefficients of the most probable model (${r.best})`}
          file="bayes-regression-coefficients"
          columns={['Predictor', 'Posterior mean', 'SD', `${pct(r.confidence)} credible interval`]}
          rows={r.coefficients.map(
            (x): Row => [c(x.term), c(x.mean), c(x.sd), c(`[${fmt(x.low)}, ${fmt(x.high)}]`)],
          )}
          note={`From ${r.iterations.toLocaleString('en')} posterior samples, seed ${r.seed}.`}
        />
      )}
    </div>
  ),
  blocked: (o, ctx) => {
    if (!o.outcome) return 'Choose the outcome.';
    if (!o.predictors.length) return 'Choose at least one predictor.';
    if (o.predictors.length > 10) return 'At most ten predictors (1,024 models).';
    return missingColumns(ctx, brCols(o), 'Bayesian linear regression');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, brCols(o), [
      o.priorWidth,
      o.modelPrior,
      o.iterations,
      ctx.settings.seed,
      ctx.settings.confidence,
    ]),
  run: async (o, ctx) =>
    (await engine()).bregressionR(rawData(ctx)!, {
      ...o,
      seed: ctx.settings.seed,
      confidence: ctx.settings.confidence,
    }),
  script: async (o, ctx) =>
    (await engine()).bregressionScriptR(rawData(ctx)!, {
      ...o,
      seed: ctx.settings.seed,
      confidence: ctx.settings.confidence,
    }),
  summary: (o) =>
    `${o.outcome || '…'} on ${o.predictors.join(', ') || '…'} · ${o.modelPrior === 'betabinomial' ? 'beta-binomial' : 'uniform'} prior`,
};

export const BAYES_TYPES = [
  bayesTtestAnalysis,
  bayesAnovaAnalysis,
  bayesRmAnovaAnalysis,
  bayesRegressionAnalysis,
  bayesCorrelationAnalysis,
  bayesContingencyAnalysis,
  bayesBinomialAnalysis,
];
