// Basic statistics cards (base R stats, R/tests.R): t-tests, ANOVA and ANCOVA,
// repeated-measures ANOVA, MANOVA, correlations, contingency tables, binomial
// and multinomial tests. The confidence level is the project's (Settings).

import { useState } from 'react';
import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { fmt, stars } from '../format';
import type {
  Alternative,
  AnovaInput,
  AnovaResult,
  ContingencyInput,
  ContingencyResult,
  CorrelationInput,
  CorrelationResult,
  EffectSize,
  FreqTestInput,
  FreqTestResult,
  BayesReliabilityResult,
  HTest,
  KappaTable,
  PairedTests,
  GwetWeights,
  KrippLevel,
  ManovaInput,
  PAdjust,
  ManovaResult,
  ReliabilityInput,
  ReliabilityResult,
  RmAnovaInput,
  RmAnovaResult,
  TTestInput,
  TTestResult,
  TTestRow,
  TostBounds,
} from '../rengine/tests';
import {
  Choice,
  clampNum,
  ColumnSelect,
  columnsFingerprint,
  flag,
  isObj,
  missingColumns,
  name,
  names,
  NumField,
  oneOf,
  rawData,
} from './common';
import { clampStrict } from '../parse';
import { withLabelledCategories } from '../data/columns';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';
import {
  AnovaResamplingView,
  bootColumns,
  bootRow,
  permP,
  resampleNote,
  ResamplingFields,
  resamplingFingerprint,
  resamplingPart,
  withResampling,
  type AnovaResampling,
} from './resampling';
import {
  columnLevels,
  emmBlocked,
  EmmFields,
  emmFingerprint,
  emmPart,
  EmmView,
  withEmm,
} from './emm';
import {
  designColumns,
  isMulti,
  parseWithinDesign,
  withinDesignBlocked,
  WithinDesignForm,
  withinFingerprint,
} from './withinDesign';

/** The modes of the t-test, correlation, binomial and reliability cards (validation/cards.ts lists the evidence of each). */
export const TTEST_TYPES = ['one', 'paired', 'independent'] as const;
export const CORRELATION_METHODS = ['pearson', 'spearman', 'kendall', 'polychoric'] as const;
export const FREQTEST_TYPES = ['binomial', 'multinomial', 'cochran'] as const;
export const RELIABILITY_TYPES = [
  'scale',
  'icc',
  'kappa',
  'blandaltman',
  'fleiss',
  'kripp',
  'kendallw',
  'gwet',
] as const;
const ALTS: readonly (readonly [Alternative, string])[] = [
  ['two.sided', 'Two-sided'],
  ['greater', 'Greater'],
  ['less', 'Less'],
];
const ALT_IDS = ALTS.map(([id]) => id);
/** The p-value adjustments of post hoc comparisons (R's p.adjust names). */
const ADJUSTS: readonly (readonly [PAdjust, string])[] = [
  ['holm', 'Holm'],
  ['bonferroni', 'Bonferroni'],
  ['BH', 'Benjamini–Hochberg'],
];
const ADJUST_IDS = ADJUSTS.map(([id]) => id);
const ADJUST_NAME: Record<PAdjust, string> = {
  holm: 'Holm',
  bonferroni: 'Bonferroni',
  BH: 'Benjamini–Hochberg (false discovery rate)',
};
/** The adjustment choice of a post hoc table: Holm is the default, so it leaves no option behind. */
function AdjustChoice<O extends { adjust?: PAdjust }>({
  o,
  set,
  label = 'Post hoc p-value adjustment',
}: {
  o: O;
  set: (o: O) => void;
  label?: string;
}) {
  return (
    <Choice
      label={label}
      value={o.adjust ?? 'holm'}
      options={ADJUSTS}
      onChange={(adjust) => {
        const { adjust: _a, ...rest } = o;
        set((adjust === 'holm' ? rest : { ...rest, adjust }) as O);
      }}
      hint="Holm and Bonferroni control the chance of any false positive; Benjamini–Hochberg the expected share of false positives."
    />
  );
}
const engine = () => import('../rengine/tests');
/**
 * The raw data with the value labels of these (grouping) columns as their categories, so that
 * the results name groups and table rows by their labels (data/columns.ts).
 */
const labelled = (ctx: AnalysisCtx, groupColumns: string[]) =>
  withLabelledCategories(rawData(ctx)!, ctx.info, groupColumns);
const NoData = () => <div className="empty-results">Import raw data first.</div>;
/** The degrees of freedom of a test: blank when absent, a list when there are several, integers without decimals. */
function df(h: HTest | null | undefined): string {
  if (h?.df === undefined || h.df === null) return '';
  if (Array.isArray(h.df)) return h.df.map((x) => fmt(x, 2)).join(', ');
  const decimals = Number.isInteger(h.df) ? 0 : 2;
  return fmt(h.df, decimals);
}
const ci = (lo?: number | null, hi?: number | null) =>
  lo === undefined || lo === null || hi === undefined || hi === null
    ? null
    : `[${fmt(lo)}, ${fmt(hi)}]`;
const pct = (conf: number) => `${Math.round(conf * 100)}%`;
const Engine = ({ e }: { e: { package: string; version: string } }) => (
  <p className="hint" style={{ marginTop: 0 }}>
    Base R ({e.package} {e.version}).
  </p>
);

// ---------------------------------------------------------------- t-tests

export type TTestOptions = Omit<TTestInput, 'confidence' | 'effectSizes' | 'tost' | 'seed'> & {
  /** Effect sizes with confidence intervals (effectsize). */
  effectSizes: boolean;
  /** An equivalence test (TOSTER) with the bounds below. */
  tost: boolean;
  tostLow: number;
  tostHigh: number;
  tostUnits: TostBounds['units'];
};

/** A one-sided interval has an open end (null): shown as −∞ or ∞. */
export function ciText(e: { ciLow: number | null; ciHigh: number | null }): string {
  const lo = e.ciLow === null ? '−∞' : fmt(e.ciLow);
  const hi = e.ciHigh === null ? '∞' : fmt(e.ciHigh);
  return `[${lo}, ${hi}]`;
}

/** A finite number from a project file, or the fallback. */
const finiteOr = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** The effect-size checkbox of the basic test cards. */
function EffectSizeField({
  value,
  onChange,
  what,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  what: string;
}) {
  return (
    <div className="field">
      <label className="check">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />{' '}
        Effect sizes with confidence intervals
      </label>
      <div className="hint">{what} (effectsize), at the confidence level of the settings.</div>
    </div>
  );
}

/** The bounds of a t-test's equivalence test. */
function TostFields({ o, set }: { o: TTestOptions; set: (o: TTestOptions) => void }) {
  const num = (v: string, fallback: number) => {
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) ? n : fallback;
  };
  return (
    <div className="field">
      <label className="check">
        <input
          type="checkbox"
          checked={o.tost}
          onChange={(e) => set({ ...o, tost: e.target.checked })}
        />{' '}
        Equivalence test (TOST)
      </label>
      {o.tost && (
        <>
          <div className="row2">
            <div className="field">
              <label htmlFor="tt-tost-lo">Lower bound</label>
              <input
                id="tt-tost-lo"
                className="input num"
                type="number"
                step="any"
                value={o.tostLow}
                onChange={(e) => set({ ...o, tostLow: num(e.target.value, o.tostLow) })}
              />
            </div>
            <div className="field">
              <label htmlFor="tt-tost-hi">Upper bound</label>
              <input
                id="tt-tost-hi"
                className="input num"
                type="number"
                step="any"
                value={o.tostHigh}
                onChange={(e) => set({ ...o, tostHigh: num(e.target.value, o.tostHigh) })}
              />
            </div>
          </div>
          <Choice
            label="Bounds in"
            value={o.tostUnits}
            onChange={(tostUnits) => set({ ...o, tostUnits })}
            options={[
              ['raw', 'Raw units'],
              ['smd', 'Cohen’s d'],
            ]}
          />
          <div className="hint">
            Two one-sided tests (TOSTER’s t_TOST): is the difference
            {o.type === 'one' ? ' from the test value' : ''} inside the bounds? Equivalence is shown
            when both tests are significant at α = 1 − the confidence level. Bounds in raw units,
            from the smallest difference that matters, are preferable: TOSTER warns that
            standardised bounds give biased tests.
            {o.type === 'independent'
              ? ' Welch’s test when Welch is chosen, Student’s otherwise.'
              : ''}
          </div>
        </>
      )}
    </div>
  );
}

/** What "greater" means for each kind of t-test. */
const TTEST_GREATER_HINT: Record<TTestOptions['type'], string> = {
  independent: 'Greater: the first group’s mean is larger.',
  paired: 'Greater: the first measurement is larger.',
  one: 'Greater: the mean exceeds the test value.',
};

function TTestForm({ options: o, set, ctx, disabled }: OptionsProps<TTestOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  const cols = d.names;
  const numeric = cols.filter((n) => !d.categories?.[n]);
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
                id={`tt-a${i}`}
                label="First"
                value={p[0]}
                columns={numeric}
                onChange={(a) =>
                  set({ ...o, pairs: o.pairs.map((q, k) => (k === i ? [a, q[1]] : q)) })
                }
              />
              <ColumnSelect
                id={`tt-b${i}`}
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
          <div className="hint">
            Each pair: two measurements of the same cases (before and after, two conditions). The
            test is on their differences.
          </div>
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
          id="tt-g"
          label="Grouping variable (two groups)"
          value={o.group}
          columns={cols}
          exclude={o.vars}
          onChange={(group) => set({ ...o, group })}
        />
      )}
      {o.type === 'one' && (
        <div className="field">
          <label htmlFor="tt-mu">Test value</label>
          <input
            id="tt-mu"
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
      <div className="field">
        <label>Tests</label>
        <div className="chips">
          <label className="check">
            <input
              type="checkbox"
              checked={o.student}
              onChange={(e) => set({ ...o, student: e.target.checked })}
            />{' '}
            Student
          </label>
          {o.type === 'independent' && (
            <label className="check">
              <input
                type="checkbox"
                checked={o.welch}
                onChange={(e) => set({ ...o, welch: e.target.checked })}
              />{' '}
              Welch
            </label>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={o.rank}
              onChange={(e) => set({ ...o, rank: e.target.checked })}
            />{' '}
            {o.type === 'independent' ? 'Mann–Whitney' : 'Wilcoxon signed-rank'}
          </label>
        </div>
        <div className="hint">
          Welch does not assume equal variances. The rank tests use the normal approximation (with a
          continuity correction, R’s exact = FALSE).
        </div>
      </div>
      <Choice
        label="Alternative hypothesis"
        value={o.alternative}
        onChange={(alternative) => set({ ...o, alternative })}
        options={ALTS}
        hint={TTEST_GREATER_HINT[o.type]}
      />
      <EffectSizeField
        value={o.effectSizes}
        onChange={(effectSizes) => set({ ...o, effectSizes })}
        what={
          o.type === 'independent'
            ? 'Cohen’s d, Hedges’ g, Glass’s Δ and the rank-biserial correlation'
            : 'Cohen’s d, Hedges’ g and the rank-biserial correlation'
        }
      />
      <TostFields o={o} set={set} />
      <ResamplingFields
        value={o.resampling}
        set={(r) => set(withResampling(o, r))}
        offer={['trimmed', 'bootstrap', 'permutation']}
        labels={{ trimmed: TRIMMED_NAME[o.type] }}
        hint="Trimmed means are robust to outliers and heavy tails (WRS2). The bootstrap interval is of the mean (difference); the permutation test needs no normality (coin)."
      />
    </fieldset>
  );
}

/** The effect size of a test: rank-biserial r for the rank test, Cohen's d (Welch's or pooled) otherwise. */
function ttestEffectSize(x: TTestRow, test: 'student' | 'welch' | 'rank') {
  if (test === 'rank') return x.rankBiserial;
  if (test === 'welch') return x.dWelch;
  return x.d;
}

/** What each effect size of a t-test is. */
function ttestEffectName(id: string, type: TTestResult['type']): string {
  if (id === 'd') return type === 'paired' ? 'Cohen’s d (of the differences, dz)' : 'Cohen’s d';
  if (id === 'g') return 'Hedges’ g';
  if (id === 'dWelch') return 'Cohen’s d (average variance, Welch)';
  if (id === 'glass') return 'Glass’s Δ (SD of the second group)';
  if (id === 'rb') return 'Rank-biserial r';
  return id;
}

/** The effect sizes of a t-test card with their intervals. */
function TTestEffects({ r }: { r: TTestResult }) {
  const rows: Row[] = r.rows.flatMap((x) =>
    (x.effects ?? []).map(
      (e): Row => [c(x.label), c(ttestEffectName(e.id, r.type)), c(e.est), c(ciText(e))],
    ),
  );
  if (!rows.length) return null;
  const oneSided =
    r.alternative !== 'two.sided' ? ` One-sided intervals (${r.alternative}), as the tests.` : '';
  const pooled =
    r.type === 'independent'
      ? ' Cohen’s d and Hedges’ g with the pooled SD; Glass’s Δ without the small-sample correction.'
      : '';
  return (
    <Table
      title="Effect sizes"
      file="ttest-effect-sizes"
      columns={['Variable', 'Effect size', 'Estimate', `${pct(r.confidence)} CI`]}
      rows={rows}
      note={`effectsize: intervals from the noncentral t distribution (d, g, Δ) and Fisher’s z (rank-biserial r).${pooled}${oneSided}`}
    />
  );
}

/** The equivalence tests (TOST) of a t-test card. */
function TTestTost({ r }: { r: TTestResult }) {
  const rows: Row[] = r.rows.flatMap((x): Row[] => {
    const t = x.tost;
    if (!t) return [];
    const alpha = (1 - t.level) / 2;
    const equivalent = t.p < alpha;
    return [
      [
        c(x.label),
        c(`[${fmt(t.low)}, ${fmt(t.high)}]`),
        c(`[${fmt(t.lowSmd)}, ${fmt(t.highSmd)}]`),
        c(`t(${fmt(t.lower.df, 2)}) = ${fmt(t.lower.t)}`),
        pCell(t.lower.p),
        c(`t(${fmt(t.upper.df, 2)}) = ${fmt(t.upper.t)}`),
        pCell(t.upper.p),
        c(`${fmt(t.raw.est)} [${fmt(t.raw.ciLow)}, ${fmt(t.raw.ciHigh)}]`),
        c(`${fmt(t.smd.est)} [${fmt(t.smd.ciLow)}, ${fmt(t.smd.ciHigh)}]`),
        c(equivalent ? 'equivalent' : 'not shown', equivalent ? 'good' : 'dim'),
      ],
    ];
  });
  if (!rows.length) return null;
  const level = r.rows.find((x) => x.tost)?.tost?.level ?? 0.9;
  const smdName = r.rows.find((x) => x.tost)?.tost?.smd.label ?? 'SMD';
  return (
    <Table
      title="Equivalence test (TOST)"
      file="ttest-tost"
      columns={[
        'Variable',
        'Bounds',
        'Bounds (SMD)',
        'Lower test',
        'p',
        'Upper test',
        'p',
        `Difference, ${pct(level)} CI`,
        `${smdName}, ${pct(level)} CI`,
        'Equivalence',
      ]}
      rows={rows}
      note={`TOSTER’s t_TOST: the difference${r.type === 'one' ? ' from the test value' : ''} is equivalent to zero within the bounds when both one-sided tests reject at α = ${fmt((1 - level) / 2, 3)}, that is when the ${pct(level)} interval lies inside the bounds. The standardised difference and its interval are TOSTER’s (an approximation).`}
    />
  );
}

/** The robust test of each t-test type. */
const TRIMMED_NAME: Record<TTestOptions['type'], string> = {
  one: 'Trimmed-mean t-test',
  paired: 'Yuen’s paired trimmed-means test',
  independent: 'Yuen’s trimmed-means test',
};

/** The t-test card's robust, bootstrap and permutation tables (each when it was run). */
function TTestResamplingView({ r }: { r: TTestResult }) {
  const e = r.resampling;
  if (!e) return null;
  const rows = r.rows.filter((x) => x.resampling);
  const trimmed = rows.filter((x) => x.resampling!.trimmed);
  const boot = rows.filter((x) => x.resampling!.bootstrap);
  const perm = rows.filter((x) => x.resampling!.permutation);
  const level = pct(r.confidence);
  const what = r.type === 'one' ? 'Trimmed mean' : 'Difference of trimmed means';
  const bootWhat = {
    one: 'Mean',
    paired: 'Mean difference',
    independent: 'Difference of the means',
  }[r.type];
  const oneSample = r.type === 'one';
  return (
    <>
      {trimmed.length > 0 && (
        <Table
          title={`${TRIMMED_NAME[r.type]} (${fmt(e.trim ?? 0.2, 2)} trimmed from each end)`}
          file="ttest-trimmed"
          columns={[
            'Variable',
            what,
            'SE',
            't',
            'df',
            'p',
            `${level} CI`,
            ...(oneSample ? [] : ['Effect size ξ']),
          ]}
          rows={trimmed.map((x): Row => {
            const t = x.resampling!.trimmed!;
            return [
              c(x.label),
              c(t.estimate),
              c(t.se),
              c(t.t),
              c(t.df),
              pCell(t.p),
              c(ci(t.ciLow, t.ciHigh)),
              ...(oneSample ? [] : [c(t.effsize ?? null)]),
            ];
          })}
          note={
            oneSample
              ? `Tukey–McLaughlin t-test of the trimmed mean against ${r.testValue} (Wilcox’s trimci; its SE by WRS2::trimse). Two-sided.`
              : 'Yuen’s test (WRS2): Welch-type, on trimmed means and winsorised variances; ξ is WRS2’s explanatory measure of effect size. Two-sided.'
          }
        />
      )}
      {boot.length > 0 && (
        <Table
          title="Bootstrap confidence intervals"
          file="ttest-bootstrap"
          columns={['Variable', ...bootColumns(r.confidence, bootWhat).slice(1)]}
          rows={boot.map((x) => bootRow(x.label, x.resampling!.bootstrap!))}
          note={resampleNote(
            e,
            r.type === 'independent'
              ? 'boot, cases resampled within each group'
              : 'boot, cases resampled',
          )}
        />
      )}
      {perm.length > 0 && (
        <Table
          title="Permutation tests"
          file="ttest-permutation"
          columns={['Variable', 'z', 'p (Monte Carlo)']}
          rows={perm.map((x): Row => {
            const p = x.resampling!.permutation!;
            return [c(x.label), c(p.z), permP(p, e.resamples)];
          })}
          note={resampleNote(
            e,
            r.type === 'independent'
              ? 'coin::oneway_test, the group labels permuted (two-sided)'
              : 'coin::symmetry_test, the signs of the differences flipped (two-sided)',
          )}
        />
      )}
    </>
  );
}

function TTestView({ r }: { r: TTestResult }) {
  const tests = (['student', 'welch', 'rank'] as const).filter((k) => r.rows.some((x) => x[k]));
  const tName = {
    student: 'Student',
    welch: 'Welch',
    rank: r.type === 'independent' ? 'Mann–Whitney' : 'Wilcoxon',
  };
  const rows: Row[] = r.rows.flatMap((x) =>
    tests
      .filter((k) => x[k])
      .map((k): Row => {
        const h = x[k]!;
        const es = ttestEffectSize(x, k);
        return [
          c(x.label),
          c(tName[k]),
          c(h.stat),
          c(k === 'rank' ? '' : df(h)),
          pCell(h.p),
          c(es ?? null),
          c(k === 'rank' ? null : ci(h.ciLow, h.ciHigh)),
        ];
      }),
  );
  const groups = r.groups ?? [];
  // The label of the i-th descriptives row: a group, a variable of the pair, or the variable itself.
  const descriptiveLabel = (x: TTestRow, i: number) => {
    if (r.type === 'independent') return `${x.label} · ${groups[i] ?? i + 1}`;
    if (r.type === 'paired') return x.variables[i];
    return x.label;
  };
  const shapiroLabel = (x: TTestRow, i: number) => {
    if (r.type === 'independent') return `${x.label} · ${groups[i] ?? i + 1}`;
    if (r.type === 'paired') return `${x.label} (differences)`;
    return `${x.label}`;
  };
  const desc: Row[] = r.rows.flatMap((x) =>
    x.descriptives.map(
      (d, i): Row => [
        c(descriptiveLabel(x, i)),
        c(d.n, undefined, 0),
        c(d.mean),
        c(d.sd ?? null),
        c(d.se ?? null),
        c(d.median),
      ],
    ),
  );
  const assumptions: Row[] = r.rows.flatMap((x) => [
    ...x.shapiro.map(
      (s, i): Row => [
        c(shapiroLabel(x, i)),
        c('Shapiro–Wilk W'),
        c(s?.stat ?? null),
        pCell(s?.p ?? null),
      ],
    ),
    ...(x.levene
      ? [
          [
            c(x.label),
            c(`Levene F(${x.levene.df1}, ${x.levene.df2})`),
            c(x.levene.stat),
            pCell(x.levene.p),
          ] as Row,
        ]
      : []),
  ]);
  let diffName: string;
  if (r.type === 'one') diffName = `Mean − ${fmt(r.testValue)}`;
  else if (r.type === 'paired') diffName = 'Mean difference';
  else diffName = `${groups[0] ?? 'Group 1'} − ${groups[1] ?? 'group 2'}`;

  let testKind: string;
  if (r.type === 'one') testKind = 'One-sample';
  else if (r.type === 'paired') testKind = 'Paired-samples';
  else testKind = 'Independent-samples';
  const oneSided = r.alternative !== 'two.sided' ? ` (one-sided: ${r.alternative})` : '';

  return (
    <div className="tables">
      <Engine e={r.engine} />
      <Table
        title={`${testKind} t-test${oneSided}`}
        file="ttest"
        columns={[
          'Variable',
          'Test',
          'Statistic',
          'df',
          'p',
          'Effect size',
          `${pct(r.confidence)} CI of ${diffName.toLowerCase()}`,
        ]}
        rows={rows}
        note="Effect size: Cohen’s d for the t-tests (Student: pooled SD; Welch: the average of the two variances; paired: the SD of the differences), the rank-biserial correlation for the rank tests. Statistic: t, or W (V for the signed-rank test)."
      />
      <TTestEffects r={r} />
      <TTestTost r={r} />
      <TTestResamplingView r={r} />
      <Table
        title="Descriptives"
        file="ttest-descriptives"
        columns={['Variable', 'N', 'Mean', 'SD', 'SE', 'Median']}
        rows={desc}
      />
      <Table
        title="Assumption checks"
        file="ttest-assumptions"
        columns={['Variable', 'Test', 'Statistic', 'p']}
        rows={assumptions}
        note="Shapiro–Wilk: a small p speaks against normality (needs 3 to 5,000 values). Levene (median-centred, Brown–Forsythe): a small p speaks against equal variances; then prefer Welch."
      />
    </div>
  );
}

const ttestCols = (o: TTestOptions) =>
  (o.type === 'paired'
    ? o.pairs.flat()
    : [...o.vars, o.type === 'independent' ? o.group : '']
  ).filter(Boolean);
const ttestInput = (o: TTestOptions, ctx: Pick<AnalysisCtx, 'settings'>): TTestInput => {
  const { tost, tostLow, tostHigh, tostUnits, effectSizes, ...rest } = o;
  return {
    ...rest,
    vars: o.type === 'paired' ? [] : o.vars,
    pairs: o.type === 'paired' ? o.pairs : [],
    group: o.type === 'independent' ? o.group : '',
    welch: o.type === 'independent' && o.welch,
    confidence: ctx.settings.confidence,
    ...(effectSizes ? { effectSizes: true } : {}),
    ...(tost ? { tost: { low: tostLow, high: tostHigh, units: tostUnits } } : {}),
    ...(o.resampling ? { seed: ctx.settings.seed } : {}),
  };
};
const T_NAME = {
  one: 'One-sample t-test',
  paired: 'Paired-samples t-test',
  independent: 'Independent-samples t-test',
} as const;

export const ttestAnalysis: AnalysisType<TTestOptions, TTestResult> = {
  id: 'ttest',
  title: 't-tests',
  sub: 'one sample, paired, independent (Student, Welch, Wilcoxon, Mann–Whitney)',
  group: 'Basic statistics',
  entries: [
    {
      title: 'Independent-samples t-test',
      sub: 'two groups; Student, Welch, Mann–Whitney',
      options: (o) => ({ ...o, type: 'independent' }),
    },
    {
      title: 'Paired-samples t-test',
      sub: 'two measurements of the same cases; Wilcoxon signed-rank',
      options: (o) => ({ ...o, type: 'paired' }),
    },
    {
      title: 'One-sample t-test',
      sub: 'a mean against a test value; Wilcoxon signed-rank',
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
    student: true,
    welch: true,
    rank: false,
    alternative: 'two.sided',
    effectSizes: true,
    tost: false,
    tostLow: -0.5,
    tostHigh: 0.5,
    tostUnits: 'smd',
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          type: oneOf(raw.type, TTEST_TYPES, 'independent'),
          vars: names(raw.vars),
          pairs: (Array.isArray(raw.pairs) ? raw.pairs.slice(0, 100) : [])
            .filter(Array.isArray)
            .map((p) => [name(p[0]), name(p[1])] as [string, string]),
          group: name(raw.group),
          testValue:
            typeof raw.testValue === 'number' && Number.isFinite(raw.testValue) ? raw.testValue : 0,
          student: raw.student !== false,
          welch: flag(raw.welch),
          rank: flag(raw.rank),
          alternative: oneOf(raw.alternative, ALT_IDS, 'two.sided'),
          // (absent in projects from before effect sizes: off, so that their results stay as they were)
          effectSizes: flag(raw.effectSizes),
          tost: flag(raw.tost),
          tostLow: finiteOr(raw.tostLow, -0.5),
          tostHigh: finiteOr(raw.tostHigh, 0.5),
          tostUnits: oneOf(raw.tostUnits, ['raw', 'smd'] as const, 'smd'),
          ...resamplingPart(raw),
        }
      : null,
  Options: TTestForm,
  View: ({ result }) => <TTestView r={result} />,
  blocked: (o, ctx) => {
    if (!o.student && !(o.welch && o.type === 'independent') && !o.rank)
      return 'Choose at least one test.';
    if (o.type === 'paired') {
      if (!o.pairs.length || o.pairs.some((p) => !p[0] || !p[1]))
        return 'Choose both variables of each pair.';
      if (o.pairs.some((p) => p[0] === p[1])) return 'A pair needs two different variables.';
    } else if (!o.vars.length) return 'Choose at least one variable.';
    if (o.type === 'independent' && !o.group) return 'Choose the grouping variable.';
    if (o.type === 'independent' && o.vars.includes(o.group))
      return 'The grouping variable cannot be tested.';
    if (o.tost && !(o.tostLow < o.tostHigh))
      return 'The lower equivalence bound must be below the upper one.';
    return missingColumns(ctx, ttestCols(o), 't-test');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, ttestCols(o), [
      o.type,
      o.testValue,
      o.alternative,
      String(o.student),
      String(o.welch),
      String(o.rank),
      ctx.settings.confidence,
      // (only when chosen, so that cards from before these options keep their fingerprint)
      ...(o.effectSizes ? ['es'] : []),
      ...(o.tost ? [`tost:${o.tostLow}:${o.tostHigh}:${o.tostUnits}`] : []),
      ...resamplingFingerprint(o.resampling, ctx.settings.seed),
    ]),
  run: async (o, ctx) => (await engine()).ttestR(labelled(ctx, [o.group]), ttestInput(o, ctx)),
  script: async (o, ctx) =>
    (await engine()).ttestScriptR(labelled(ctx, [o.group]), ttestInput(o, ctx)),
  summary: (o) => {
    const variables =
      o.type === 'paired'
        ? o.pairs.map((p) => p.join(' − ')).join(', ') || '…'
        : o.vars.join(', ') || '…';
    const byGroup = o.type === 'independent' ? ` by ${o.group || '…'}` : '';
    return `${T_NAME[o.type].toLowerCase()} · ${variables}${byGroup}`;
  },
};

// ---------------------------------------------------------------- ANOVA / ANCOVA

export type AnovaOptions = Omit<AnovaInput, 'confidence' | 'effectSizes' | 'seed'> & {
  /** Effect sizes with confidence intervals (effectsize). */
  effectSizes: boolean;
};

/**
 * The request of an ANOVA card: the settings' confidence level, and their seed for the bootstrap of ε² and the
 * resampling.
 */
const anovaInput = (o: AnovaOptions, ctx: Pick<AnalysisCtx, 'settings'>): AnovaInput => {
  const { effectSizes, ...rest } = o;
  return {
    ...rest,
    confidence: ctx.settings.confidence,
    ...(effectSizes ? { effectSizes: true } : {}),
    ...(effectSizes || o.resampling ? { seed: ctx.settings.seed } : {}),
  };
};

function AnovaForm({ options: o, set, ctx, disabled }: OptionsProps<AnovaOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  const cols = d.names;
  const numeric = cols.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <ColumnSelect
        id="an-y"
        label="Dependent variable"
        value={o.dependent}
        columns={numeric}
        exclude={[...o.factors, ...o.covariates]}
        onChange={(dependent) => set({ ...o, dependent })}
      />
      <OrderedPicker
        label="Fixed factors"
        columns={cols.filter((n) => n !== o.dependent && !o.covariates.includes(n))}
        value={o.factors}
        onChange={(factors) => set({ ...o, factors })}
        hint="Grouping variables: text columns, or numeric codes (each distinct value a group)."
      />
      <OrderedPicker
        label="Covariates (ANCOVA, optional)"
        columns={numeric.filter((n) => n !== o.dependent && !o.factors.includes(n))}
        value={o.covariates}
        onChange={(covariates) => set({ ...o, covariates })}
      />
      <div className="row2">
        <Choice
          label="Sums of squares"
          value={o.ssType}
          onChange={(ssType) => set({ ...o, ssType })}
          options={[
            ['III', 'Type III'],
            ['I', 'Type I (sequential)'],
          ]}
        />
        <Choice
          label="Model terms"
          value={o.interactions ? 'full' : 'main'}
          onChange={(v) => set({ ...o, interactions: v === 'full' })}
          options={[
            ['full', 'Full factorial'],
            ['main', 'Main effects only'],
          ]}
        />
      </div>
      <div className="hint">
        Type III (sum-to-zero contrasts) tests each term adjusted for all others, the usual choice
        for unbalanced designs. With one factor and no covariates the card adds Welch’s ANOVA,
        Kruskal–Wallis and Tukey’s comparisons.
      </div>
      <EffectSizeField
        value={o.effectSizes}
        onChange={(effectSizes) => set({ ...o, effectSizes })}
        what="η², partial η², ω² and partial ω² for every term; with one factor, ε² of Kruskal–Wallis"
      />
      {o.factors.length === 1 && !o.covariates.length && (
        <AdjustChoice
          o={o}
          set={set}
          label="Dunn’s test after Kruskal–Wallis: p-value adjustment"
        />
      )}
      <EmmFields value={o.emm} factors={o.factors} games set={(emm) => set(withEmm(o, emm))} />
      <ResamplingFields
        value={o.resampling}
        set={(r) => set(withResampling(o, r))}
        offer={['trimmed', 'permutation']}
        labels={{ trimmed: 'Robust ANOVA on trimmed means', permutation: 'Permutation test' }}
        hint="Robust ANOVA (WRS2): one factor (t1way, with an effect size) or two (t2way), no covariates. Permutation test (coin): one factor, no covariates."
      />
    </fieldset>
  );
}

/** The ANOVA's effect sizes with their intervals, by term, and ε² of Kruskal–Wallis. */
function AnovaEffects({ r, conf }: { r: AnovaResult; conf: number }) {
  if (!r.effects?.length) return null;
  const cell = (e: { est: number; ciLow: number | null; ciHigh: number | null }) =>
    c(`${fmt(e.est)} ${ciText(e)}`);
  const typeIII =
    r.ssType === 'III'
      ? ' With type III sums of squares η² and ω² divide by the sum of the terms’ and the residual sums of squares (effectsize), which can differ a little from the table above (the total sum of squares) in unbalanced designs.'
      : '';
  return (
    <div className="tables">
      <Table
        title="Effect sizes"
        file="anova-effect-sizes"
        columns={['Term', 'η²', 'Partial η²', 'ω²', 'Partial ω²']}
        rows={r.effects.map(
          (e): Row => [
            c(e.term),
            cell(e.eta2),
            cell(e.partialEta2),
            cell(e.omega2),
            cell(e.partialOmega2),
          ],
        )}
        note={`Each: the estimate with its two-sided ${pct(conf)} interval (effectsize, from the noncentral F distribution; a bound below zero is set to 0).${typeIII}`}
      />
      {r.epsilon2 && (
        <Table
          title="Kruskal–Wallis effect size"
          file="anova-epsilon2"
          columns={['Effect size', 'Estimate', `${pct(conf)} CI`]}
          rows={[[c('Rank ε²'), c(r.epsilon2.est), c(ciText(r.epsilon2))]]}
          note="effectsize::rank_epsilon_squared; its interval from 1000 bootstrap samples, seeded by the settings’ seed."
        />
      )}
    </div>
  );
}

function AnovaView({ r, conf }: { r: AnovaResult; conf: number }) {
  const rows: Row[] = [
    ...r.table.map(
      (t): Row => [
        c(t.term),
        c(t.ss),
        c(t.df, undefined, 0),
        c(t.ms),
        c(t.f),
        pCell(t.p),
        c(t.eta2),
        c(t.partialEta2),
        c(t.omega2),
      ],
    ),
    [
      c('Residuals'),
      c(r.residual.ss),
      c(r.residual.df, undefined, 0),
      c(r.residual.ms),
      c(null),
      c(null),
      c(null),
      c(null),
      c(null),
    ],
  ];
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        <code>{r.formula}</code>, n = {r.n}; base R ({r.engine.package} {r.engine.version}).
      </p>
      <Table
        title={`${r.covariates.length ? 'ANCOVA' : 'ANOVA'}: ${r.dependent} (type ${r.ssType} sums of squares)`}
        file="anova"
        columns={[
          'Term',
          'Sum of squares',
          'df',
          'Mean square',
          'F',
          'p',
          'η²',
          'Partial η²',
          'ω²',
        ]}
        rows={rows}
      />
      <AnovaEffects r={r} conf={conf} />
      {(r.welch || r.kruskal) && (
        <Table
          title="One factor: robust and rank-based tests"
          file="anova-robust"
          columns={['Test', 'Statistic', 'df', 'p']}
          rows={[
            ...(r.welch
              ? [[c('Welch’s ANOVA (F)'), c(r.welch.stat), c(df(r.welch)), pCell(r.welch.p)] as Row]
              : []),
            ...(r.kruskal
              ? [
                  [
                    c('Kruskal–Wallis (χ²)'),
                    c(r.kruskal.stat),
                    c(df(r.kruskal)),
                    pCell(r.kruskal.p),
                  ] as Row,
                ]
              : []),
          ]}
          note="Welch’s ANOVA does not assume equal variances; Kruskal–Wallis compares the groups’ ranks."
        />
      )}
      {r.tukey && (
        <Table
          title="Post hoc comparisons (Tukey HSD)"
          file="anova-tukey"
          columns={['Comparison', 'Difference', `${pct(conf)} CI`, 'p (adjusted)']}
          rows={r.tukey.map(
            (t): Row => [c(t.comparison), c(t.diff), c(ci(t.ciLow, t.ciHigh)), pCell(t.p)],
          )}
        />
      )}
      {r.pairwiseRank && r.pairwiseRank.length > 0 && (
        <Table
          title="Post hoc after Kruskal–Wallis (pairwise Wilcoxon rank-sum tests)"
          file="anova-pairwise-rank"
          columns={['Comparison', 'p (Holm)']}
          rows={r.pairwiseRank.map((t): Row => [c(t.comparison), pCell(t.pHolm)])}
          note="Normal approximation; p-values adjusted for the number of comparisons by Holm’s method."
        />
      )}
      {r.dunn && r.dunn.length > 0 && (
        <Table
          title="Post hoc after Kruskal–Wallis (Dunn’s test)"
          file="anova-dunn"
          columns={['Comparison', 'z', 'p', 'p adjusted']}
          rows={r.dunn.map((t): Row => [c(t.comparison), c(t.z), pCell(t.p), pCell(t.pAdjusted)])}
          note={
            'z: the difference of the two groups’ mean ranks (all groups ranked together, as ' +
            'Kruskal–Wallis ranks them) over its standard error, corrected for ties (Dunn 1964). ' +
            `p two-sided, adjusted by ${ADJUST_NAME[r.adjust ?? 'holm']}.`
          }
        />
      )}
      {r.emm && <EmmView e={r.emm} dependent={r.dependent} />}
      {r.resampling && (
        <AnovaResamplingView r={r.resampling as unknown as AnovaResampling} conf={conf} />
      )}
      <Table
        title="Descriptives by cell"
        file="anova-cells"
        columns={['Cell', 'N', 'Mean', 'SD', 'SE']}
        rows={r.cells.map(
          (x): Row => [
            c(x.cell),
            c(x.n, undefined, 0),
            c(x.mean),
            c(x.sd ?? null),
            c(x.se ?? null),
          ],
        )}
      />
      <Table
        title="Assumption checks"
        file="anova-assumptions"
        columns={['Test', 'Statistic', 'p']}
        rows={[
          [
            c(`Levene F(${r.levene.df1}, ${r.levene.df2}), median-centred`),
            c(r.levene.stat),
            pCell(r.levene.p),
          ],
          ...(r.shapiro
            ? [[c('Shapiro–Wilk W (residuals)'), c(r.shapiro.stat), pCell(r.shapiro.p)] as Row]
            : []),
        ]}
      />
    </div>
  );
}

/** The post hoc adjustment from a project file: only when it is not Holm (the default). */
function parseAdjust(raw: Record<string, unknown>): { adjust?: PAdjust } {
  const adjust = oneOf(raw.adjust, ADJUST_IDS, 'holm');
  return adjust === 'holm' ? {} : { adjust };
}
/** Why the robust or permutation ANOVA cannot run (null: it can). */
function anovaResamplingBlocked(o: AnovaOptions): string | null {
  const r = o.resampling;
  if (!r) return null;
  if (o.covariates.length) return 'The robust and permutation ANOVA take no covariates.';
  if (r.trimmed && o.factors.length > 2) return 'The robust ANOVA takes one or two factors.';
  if (r.permutation && o.factors.length > 1) return 'The permutation test takes one factor.';
  return null;
}
const anovaCols = (o: AnovaOptions) => [o.dependent, ...o.factors, ...o.covariates].filter(Boolean);
export const anovaAnalysis: AnalysisType<AnovaOptions, AnovaResult & { confidence?: number }> = {
  id: 'anova',
  title: 'ANOVA',
  sub: 'between-subjects factors, ANCOVA with covariates; type III or I; Kruskal–Wallis with Dunn’s test',
  group: 'Basic statistics',
  entries: [
    {
      title: 'ANOVA',
      sub: 'one or more between-subjects factors; post hoc, Welch, Kruskal–Wallis',
      options: (o) => o,
    },
    { title: 'ANCOVA', sub: 'factors and covariates', options: (o) => o },
  ],
  cardTitle: (o) =>
    `${o.covariates.length ? 'ANCOVA' : 'ANOVA'}${o.dependent ? `: ${o.dependent}` : ''}`,
  defaults: () => ({
    dependent: '',
    factors: [],
    covariates: [],
    ssType: 'III',
    interactions: true,
    effectSizes: true,
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          dependent: name(raw.dependent),
          factors: names(raw.factors),
          covariates: names(raw.covariates),
          ssType: oneOf(raw.ssType, ['III', 'I'] as const, 'III'),
          interactions: raw.interactions !== false,
          effectSizes: flag(raw.effectSizes),
          ...parseAdjust(raw),
          ...emmPart(raw),
          ...resamplingPart(raw),
        }
      : null,
  Options: AnovaForm,
  View: ({ result }) => <AnovaView r={result} conf={result.confidence ?? 0.95} />,
  blocked: (o, ctx) => {
    if (!o.dependent) return 'Choose the dependent variable.';
    if (!o.factors.length) return 'Choose at least one factor.';
    if (o.factors.includes(o.dependent) || o.covariates.includes(o.dependent))
      return 'The dependent variable cannot also be a factor or covariate.';
    if (o.emm) {
      const levels = (f: string) => columnLevels(rawData(ctx), f);
      const emm = emmBlocked(o.emm, o.factors, levels);
      if (emm) return emm;
    }
    const rs = anovaResamplingBlocked(o);
    if (rs) return rs;
    return missingColumns(ctx, anovaCols(o), 'ANOVA');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, anovaCols(o), [
      o.ssType,
      String(o.interactions),
      ...o.factors,
      '|',
      ...o.covariates,
      ctx.settings.confidence,
      // (only when set: earlier fingerprints are unchanged)
      ...(o.effectSizes ? ['es', ctx.settings.seed] : []),
      ...(o.adjust ? [o.adjust] : []),
      emmFingerprint(o.emm),
      ...resamplingFingerprint(o.resampling, ctx.settings.seed),
    ]),
  run: async (o, ctx) => ({
    ...(await (await engine()).anovaR(labelled(ctx, o.factors), anovaInput(o, ctx))),
    confidence: ctx.settings.confidence,
  }),
  script: async (o, ctx) =>
    (await engine()).anovaScriptR(labelled(ctx, o.factors), anovaInput(o, ctx)),
  summary: (o) =>
    `${o.dependent || '…'} by ${o.factors.join(' × ') || '…'}${o.covariates.length ? ` + ${o.covariates.join(', ')}` : ''} · type ${o.ssType}`,
};

// ---------------------------------------------------------------- repeated measures

export type RmAnovaOptions = RmAnovaInput;

function RmForm({ options: o, set, ctx, disabled }: OptionsProps<RmAnovaOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  const numeric = d.names.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <WithinDesignForm id="rm" o={o} set={set} numeric={numeric} />
      <ColumnSelect
        id="rm-b"
        label="Between-subjects factor (optional)"
        optional="None"
        value={o.between}
        columns={d.names}
        exclude={[...designColumns({ ...o, between: '' }), ...(o.moreBetween ?? [])]}
        onChange={(between) => set(between ? { ...o, between } : withoutMore({ ...o, between }))}
      />
      {o.between && (
        <OrderedPicker
          label="Further between-subjects factors (optional; crossed with the first: type II tests, car::Anova)"
          columns={d.names.filter((n) => !designColumns(o).includes(n))}
          value={o.moreBetween ?? []}
          onChange={(more) => set(more.length ? { ...o, moreBetween: more } : withoutMore(o))}
        />
      )}
      {!isMulti(o) && !o.between && (
        <AdjustChoice o={o} set={set} label="Conover’s test after Friedman: p-value adjustment" />
      )}
      <EmmFields value={o.emm} factors={rmFactors(o)} set={(emm) => set(withEmm(o, emm))} />
    </fieldset>
  );
}

function RmView({ r }: { r: RmAnovaResult }) {
  const multi = !!r.factors && r.factors.length >= 2;
  // (several within factors: each effect has its own error stratum, so its residual row is named after it)
  const row = (x: RmAnovaResult['within'][number]): Row => [
    c(
      multi && x.term === 'Residuals' && x.stratum && x.stratum !== 'subject'
        ? `Residuals (${x.stratum})`
        : x.term,
    ),
    c(x.ss),
    c(x.df, undefined, 0),
    c(x.ms),
    c(x.f ?? null),
    x.p === undefined || x.p === null ? c(null) : pCell(x.p),
    c(x.partialEta2 ?? null),
  ];
  const cols = ['Term', 'Sum of squares', 'df', 'Mean square', 'F', 'p', 'Partial η²'];
  const SPHERICITY_NOTE =
    'A small p of Mauchly’s test speaks against sphericity: then read the corrected p-values below (Greenhouse–Geisser is the more conservative).';
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {multi
          ? `${r.factors!.map((f) => `${f.name} (${f.levels.length} levels)`).join(' × ')}: ${r.levels.length} cells`
          : `${r.levels.length} levels of ${r.factorName}`}
        , {r.n} subjects
        {r.betweenFactors
          ? `; between ${r.betweenFactors.join(' × ')}, type II tests with sum-to-zero contrasts`
          : ''}
        ; {r.betweenFactors ? '' : 'base R '}({r.engine.package} {r.engine.version}).
      </p>
      <Table
        title="Within-subjects effects"
        file="rmanova-within"
        columns={cols}
        rows={r.within.map(row)}
      />
      {r.betweenTable.length > 0 && (
        <Table
          title="Between-subjects effects"
          file="rmanova-between"
          columns={cols}
          rows={r.betweenTable.map(row)}
        />
      )}
      {r.sphericity && (
        <Table
          title="Sphericity"
          file="rmanova-sphericity"
          columns={['Statistic', 'Value']}
          rows={[
            [c('Mauchly’s W'), c(r.sphericity.w)],
            [c('p'), pCell(r.sphericity.p)],
            [c('Greenhouse–Geisser ε'), c(r.sphericity.gg)],
            [c('Huynh–Feldt ε'), c(r.sphericity.hf)],
          ]}
          note={SPHERICITY_NOTE}
        />
      )}
      {multi &&
        (r.sphericityTable?.length ? (
          <Table
            title="Sphericity"
            file="rmanova-sphericity"
            columns={['Effect', 'df', 'Mauchly’s W', 'p', 'Greenhouse–Geisser ε', 'Huynh–Feldt ε']}
            rows={r.sphericityTable.map(
              (x): Row => [c(x.term), c(x.df, undefined, 0), c(x.w), pCell(x.p), c(x.gg), c(x.hf)],
            )}
            note={`${SPHERICITY_NOTE} Effects with one degree of freedom (two levels) are spherical and are not tested.`}
          />
        ) : (
          <p className="hint">
            Every within effect has one degree of freedom (two levels): sphericity holds, and no
            correction is needed.
          </p>
        ))}
      <Table
        title="Sphericity-corrected p-values"
        file="rmanova-corrected"
        columns={['Term', 'p (uncorrected)', 'p (Greenhouse–Geisser)', 'p (Huynh–Feldt)']}
        rows={r.corrected.map((x): Row => [c(x.term), pCell(x.p), pCell(x.pGG), pCell(x.pHF)])}
      />
      {r.posthoc && r.posthoc.length > 0 && (
        <Table
          title="Post hoc comparisons (paired t-tests)"
          file="rmanova-posthoc"
          columns={['Comparison', 'Mean difference', 't', 'df', 'p', 'p (Holm)']}
          rows={r.posthoc.map(
            (x): Row => [
              c(x.comparison),
              c(x.diff),
              c(x.t),
              c(x.df, undefined, 0),
              pCell(x.p),
              pCell(x.pHolm),
            ],
          )}
          note={
            multi
              ? 'Every pair of a factor’s levels, on every subject’s mean over the other factors’ levels; Holm’s adjustment within each factor.'
              : 'Every pair of levels, over all subjects; Holm’s adjustment for the number of comparisons.'
          }
        />
      )}
      {r.friedman && (
        <Table
          title="Friedman’s rank test"
          file="rmanova-friedman"
          columns={['χ²', 'df', 'p']}
          rows={[[c(r.friedman.stat), c(df(r.friedman)), pCell(r.friedman.p)]]}
        />
      )}
      {r.conover && r.conover.length > 0 && (
        <Table
          title="Post hoc after Friedman (Conover’s test)"
          file="rmanova-conover"
          columns={['Comparison', 't', 'df', 'p', 'p adjusted']}
          rows={r.conover.map(
            (x): Row => [
              c(x.comparison),
              c(x.t),
              c(x.df, undefined, 0),
              pCell(x.p),
              pCell(x.pAdjusted),
            ],
          )}
          note={
            'The difference of two levels’ rank sums (each subject’s levels ranked) as a t statistic on ' +
            '(n − 1)(k − 1) df, with the variance of Friedman’s ranks (Conover 1999). ' +
            `p two-sided, adjusted by ${ADJUST_NAME[r.adjust ?? 'holm']}.`
          }
        />
      )}
      {r.friedmanTable && r.friedmanTable.length > 0 && (
        <Table
          title="Friedman’s rank tests"
          file="rmanova-friedman"
          columns={['Factor', 'χ²', 'df', 'p']}
          rows={r.friedmanTable.map(
            (x): Row => [c(x.term), c(x.stat), c(x.df, undefined, 0), pCell(x.p)],
          )}
          note="Each within factor on every subject’s mean of its levels over the other factors’ levels."
        />
      )}
      {r.emm && <EmmView e={r.emm} dependent="the repeated measures" />}
      <Table
        title="Descriptives"
        file="rmanova-cells"
        columns={['Level', 'N', 'Mean', 'SD', 'SE']}
        rows={r.cells.map(
          (x): Row => [
            c(x.cell),
            c(x.n, undefined, 0),
            c(x.mean),
            c(x.sd ?? null),
            c(x.se ?? null),
          ],
        )}
      />
    </div>
  );
}

/** The request: the settings' confidence level when marginal means are asked for (an older card's request is unchanged). */
const rmInput = (o: RmAnovaOptions, ctx: Pick<AnalysisCtx, 'settings'>): RmAnovaInput =>
  o.emm ? { ...o, confidence: ctx.settings.confidence } : o;
const rmCols = (o: RmAnovaOptions) => [...designColumns(o), ...(o.moreBetween ?? [])];
const withoutMore = (o: RmAnovaOptions): RmAnovaOptions => {
  const { moreBetween: _m, ...rest } = o;
  return rest;
};
/** The factors of the marginal means: the within factors, then the between factors. */
function rmFactors(o: RmAnovaOptions): string[] {
  const within = isMulti(o) ? o.factors!.map((f) => f.name) : [o.factorName];
  const between = o.between ? [o.between, ...(o.moreBetween ?? [])] : [];
  return [...within, ...between].filter(Boolean);
}
/** The number of levels of a factor of the marginal means. */
function rmLevels(o: RmAnovaOptions, ctx: AnalysisCtx, f: string): number | undefined {
  if (isMulti(o)) {
    const w = o.factors!.find((x) => x.name === f);
    if (w) return w.levels.length;
  } else if (f === o.factorName) {
    return o.levels.length;
  }
  return columnLevels(rawData(ctx), f);
}
/** The within factors' names, for titles and summaries. */
const rmName = (o: RmAnovaOptions) =>
  isMulti(o) ? o.factors!.map((f) => f.name || '…').join(' × ') : o.factorName || '…';
export const rmAnovaAnalysis: AnalysisType<RmAnovaOptions, RmAnovaResult> = {
  id: 'rmanova',
  title: 'Repeated-measures ANOVA',
  sub: 'within-subject factors (wide columns), optional between factor; sphericity corrections, Friedman with Conover’s test',
  group: 'Basic statistics',
  cardTitle: (o) => `Repeated-measures ANOVA: ${rmName(o)}`,
  defaults: () => ({ levels: [], factorName: 'condition', between: '' }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const more = names(raw.moreBetween, 3);
    return {
      ...parseWithinDesign(raw),
      ...(more.length ? { moreBetween: more } : {}),
      ...parseAdjust(raw),
      ...emmPart(raw),
    };
  },
  Options: RmForm,
  View: ({ result }) => <RmView r={result} />,
  blocked: (o, ctx) => {
    if (isMulti(o)) {
      const b = withinDesignBlocked(o);
      if (b) return b;
    } else {
      if (o.levels.length < 2) return 'Choose at least two columns, one per level.';
      if (!/^[A-Za-z][A-Za-z0-9_.]{0,30}$/.test(o.factorName))
        return 'The factor name must start with a letter and use letters, digits, _ or . only.';
      if (o.levels.includes(o.between)) return 'The between factor cannot be one of the levels.';
    }
    if (o.moreBetween?.length) {
      if (!o.between) return 'Choose the first between-subjects factor before further ones.';
      const all = [o.between, ...o.moreBetween];
      if (
        new Set(all).size !== all.length ||
        all.some((b) => designColumns({ ...o, between: '' }).includes(b))
      )
        return 'The between-subjects factors must be different columns, none of them a within-subject column.';
    }
    if (o.emm) {
      const emm = emmBlocked(o.emm, rmFactors(o), (f) => rmLevels(o, ctx, f));
      if (emm) return emm;
    }
    return missingColumns(ctx, rmCols(o), 'Repeated-measures ANOVA');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, rmCols(o), [
      o.factorName,
      o.between,
      ...withinFingerprint(o),
      ...(o.moreBetween?.length ? ['|', ...o.moreBetween] : []),
      // (only when set: earlier fingerprints are unchanged)
      ...(o.adjust ? ['adjust', o.adjust] : []),
      ...(o.emm ? [emmFingerprint(o.emm), ctx.settings.confidence] : []),
    ]),
  run: async (o, ctx) =>
    (await engine()).rmAnovaR(
      labelled(ctx, [o.between, ...(o.moreBetween ?? [])]),
      rmInput(o, ctx),
    ),
  script: async (o, ctx) =>
    (await engine()).rmAnovaScriptR(
      labelled(ctx, [o.between, ...(o.moreBetween ?? [])]),
      rmInput(o, ctx),
    ),
  summary: (o) =>
    (isMulti(o)
      ? `${rmName(o)}: ${(o.cells ?? []).filter(Boolean).length} cells`
      : `${o.factorName}: ${o.levels.join(', ') || '…'}`) +
    (o.between ? ` · between ${[o.between, ...(o.moreBetween ?? [])].join(' × ')}` : ''),
};

// ---------------------------------------------------------------- MANOVA

export type ManovaOptions = ManovaInput;

function ManovaForm({ options: o, set, ctx, disabled }: OptionsProps<ManovaOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  const numeric = d.names.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <OrderedPicker
        label="Dependent variables (two or more)"
        columns={numeric.filter((n) => !o.factors.includes(n))}
        value={o.dependents}
        onChange={(dependents) => set({ ...o, dependents })}
      />
      <OrderedPicker
        label="Fixed factors"
        columns={d.names.filter((n) => !o.dependents.includes(n))}
        value={o.factors}
        onChange={(factors) => set({ ...o, factors })}
      />
      <Choice
        label="Model terms"
        value={o.interactions ? 'full' : 'main'}
        onChange={(v) => set({ ...o, interactions: v === 'full' })}
        options={[
          ['full', 'Full factorial'],
          ['main', 'Main effects only'],
        ]}
      />
    </fieldset>
  );
}

const manovaCols = (o: ManovaOptions) => [...o.dependents, ...o.factors];
export const manovaAnalysis: AnalysisType<ManovaOptions, ManovaResult> = {
  id: 'manova',
  title: 'MANOVA',
  sub: 'several dependent variables; Pillai, Wilks, Hotelling–Lawley, Roy',
  group: 'Basic statistics',
  cardTitle: () => 'MANOVA',
  defaults: () => ({ dependents: [], factors: [], interactions: true }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          dependents: names(raw.dependents),
          factors: names(raw.factors),
          interactions: raw.interactions !== false,
        }
      : null,
  Options: ManovaForm,
  View: ({ result: r }) => (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.dependents.join(', ')} by {r.factors.join(', ')}, n = {r.n}; base R ({r.engine.package}{' '}
        {r.engine.version}).
      </p>
      <Table
        title="Multivariate tests"
        file="manova"
        columns={['Term', 'Test', 'Value', 'Approx. F', 'df1', 'df2', 'p']}
        rows={r.tests.flatMap((t) =>
          t.rows.map(
            (x): Row => [
              c(x.term),
              c(t.test),
              c(x.value),
              c(x.f),
              c(x.df1, undefined, 0),
              c(x.df2, undefined, 0),
              pCell(x.p),
            ],
          ),
        )}
        note="Pillai’s trace is the most robust to unequal covariance matrices; Roy’s largest root gives an upper bound for F."
      />
    </div>
  ),
  blocked: (o, ctx) => {
    if (o.dependents.length < 2) return 'Choose at least two dependent variables.';
    if (!o.factors.length) return 'Choose at least one factor.';
    return missingColumns(ctx, manovaCols(o), 'MANOVA');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, manovaCols(o), [String(o.interactions), ...o.factors]),
  run: async (o, ctx) => (await engine()).manovaR(labelled(ctx, o.factors), o),
  script: async (o, ctx) => (await engine()).manovaScriptR(labelled(ctx, o.factors), o),
  summary: (o) => `${o.dependents.join(', ') || '…'} by ${o.factors.join(' × ') || '…'}`,
};

// ---------------------------------------------------------------- correlation

export type CorrelationOptions = Omit<CorrelationInput, 'confidence' | 'tostBound' | 'seed'> & {
  /** Equivalence tests (TOSTER) of every pair: is |r| below tostBound? Absent in older projects. */
  tost?: boolean;
  tostBound?: number;
};
const TOST_COR_BOUND = 0.3;
const METHOD_NAME = {
  pearson: 'Pearson',
  spearman: 'Spearman',
  kendall: 'Kendall',
  polychoric: 'Polychoric',
} as const;

function CorrelationForm({ options: o, set, ctx, disabled }: OptionsProps<CorrelationOptions>) {
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
        label="Coefficient"
        value={o.method}
        onChange={(method) => set({ ...o, method })}
        options={[
          ['pearson', 'Pearson’s r'],
          ['spearman', 'Spearman’s ρ'],
          ['kendall', 'Kendall’s τ-b'],
          ['polychoric', 'Polychoric'],
        ]}
      />
      <div className="row2">
        <Choice
          label="Alternative hypothesis"
          value={o.alternative}
          onChange={(alternative) => set({ ...o, alternative })}
          options={ALTS}
        />
        <Choice
          label="Missing values"
          value={o.deletion}
          onChange={(deletion) => set({ ...o, deletion })}
          options={[
            ['pairwise', 'Pairwise'],
            ['listwise', 'Listwise'],
          ]}
        />
      </div>
      <div className="hint">
        {o.method === 'polychoric'
          ? 'For ordinal (Likert) variables: the correlation of the continuous responses assumed to underlie the categories (lavaan’s lavCor, as CB-SEM with ordinal indicators). Variables with integer values and at most 8 categories are ordinal: polychoric between two of them (tetrachoric when both are binary), polyserial with a continuous variable, Pearson between continuous ones. Standard errors, z tests and Wald intervals; each ordinal pair is also tested for the bivariate normal model the polychoric correlation assumes.'
          : `Each pair is tested with cor.test; Spearman and Kendall use the normal approximation (exact = FALSE), as with ties${o.method === 'spearman' || o.method === 'kendall' ? ', unless exact p-values are chosen' : ''}. A confidence interval is given for Pearson’s r (Fisher’s z).`}
      </div>
      {(o.method === 'spearman' || o.method === 'kendall') && (
        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={!!o.exact}
              onChange={(e) => {
                const { exact: _e, ...rest } = o;
                set(e.target.checked ? { ...rest, exact: true } : rest);
              }}
            />{' '}
            Exact p-values
          </label>
          <div className="hint">
            R’s exact = TRUE: the exact null distribution of{' '}
            {o.method === 'kendall'
              ? 'T (Kendall, up to 200 cases)'
              : 'S (Spearman, up to 1,289 cases; AS 89)'}
            . It exists only without ties; a pair with ties keeps the normal approximation.
          </div>
        </div>
      )}
      {o.method !== 'polychoric' && (
        <>
          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                checked={!!o.tost}
                onChange={(e) =>
                  set({ ...o, tost: e.target.checked, tostBound: o.tostBound ?? TOST_COR_BOUND })
                }
              />{' '}
              Equivalence tests (TOST)
            </label>
            {o.tost && (
              <NumField
                id="cor-tost"
                label="Equivalence bound |r| <"
                value={o.tostBound ?? TOST_COR_BOUND}
                lo={0.01}
                hi={0.99}
                step={0.05}
                onChange={(tostBound) => set({ ...o, tostBound })}
              />
            )}
            <div className="hint">
              Two one-sided tests of each pair (TOSTER’s z_cor_test, Fisher’s z): is the correlation
              between −bound and bound? Equivalence is shown when both reject at α = 1 − the
              confidence level.
            </div>
          </div>
          <ResamplingFields
            value={o.resampling}
            set={(r) => set(withResampling(o, r))}
            offer={o.method === 'kendall' ? ['bootstrap'] : ['bootstrap', 'permutation']}
            labels={{ bootstrap: 'Bootstrap intervals of each correlation' }}
            hint="Bootstrap: the cases of each pair resampled (boot). Permutation: one variable’s values shuffled against the other’s (coin; Pearson: independence_test, Spearman: spearman_test)."
          />
        </>
      )}
    </fieldset>
  );
}

/** The equivalence tests of a correlation card. */
function CorrelationTostTable({ r }: { r: CorrelationResult }) {
  const tested = r.pairs.filter((p) => p.tost);
  if (!tested.length || r.tostBound === undefined || r.tostBound === null) return null;
  const level = tested[0].tost!.level;
  const alpha = (1 - level) / 2;
  return (
    <Table
      title={`Equivalence tests: |correlation| < ${fmt(r.tostBound)}`}
      file="correlation-tost"
      columns={['Pair', 'Estimate', `${pct(level)} CI`, 'z', 'p (TOST)', 'Equivalence']}
      rows={tested.map((p): Row => {
        const t = p.tost!;
        const equivalent = t.p < alpha;
        return [
          c(`${p.a} – ${p.b}`),
          c(t.r),
          c(ci(t.ciLow, t.ciHigh)),
          c(t.z),
          pCell(t.p),
          c(equivalent ? 'equivalent' : 'not shown', equivalent ? 'good' : 'dim'),
        ];
      })}
      note={`TOSTER’s z_cor_test (Fisher’s z${r.method === 'spearman' ? ', Bonett–Wright standard error' : ''}${r.method === 'kendall' ? ', Fieller standard error' : ''}): equivalent when both one-sided tests reject at α = ${fmt(alpha, 3)}, that is when the ${pct(level)} interval lies within ±${fmt(r.tostBound)}. z and p of the less significant of the two tests.`}
    />
  );
}

/** The correlation card's bootstrap intervals and permutation tests (each when it was run). */
function CorrelationResamplingView({ r, sym }: { r: CorrelationResult; sym: string }) {
  const e = r.resampling;
  if (!e) return null;
  const boot = r.pairs.filter((p) => p.bootstrap);
  const perm = r.pairs.filter((p) => p.permutation);
  const test = r.method === 'spearman' ? 'coin::spearman_test' : 'coin::independence_test';
  return (
    <>
      {boot.length > 0 && (
        <Table
          title="Bootstrap confidence intervals"
          file="correlation-bootstrap"
          columns={['Pair', ...bootColumns(r.confidence, sym).slice(1)]}
          rows={boot.map((p) => bootRow(`${p.a} – ${p.b}`, p.bootstrap!))}
          note={resampleNote(e, 'boot, the complete cases of each pair resampled')}
        />
      )}
      {perm.length > 0 && (
        <Table
          title="Permutation tests"
          file="correlation-permutation"
          columns={['Pair', 'z', 'p (Monte Carlo)']}
          rows={perm.map(
            (p): Row => [
              c(`${p.a} – ${p.b}`),
              c(p.permutation!.z),
              permP(p.permutation, e.resamples),
            ],
          )}
          note={resampleNote(e, `${test}, two-sided`)}
        />
      )}
    </>
  );
}

function CorrelationView({ r }: { r: CorrelationResult }) {
  let sym = 'τ';
  if (r.method === 'pearson' || r.method === 'polychoric') sym = 'r';
  else if (r.method === 'spearman') sym = 'ρ';
  const poly = r.method === 'polychoric';
  const withCi = r.method === 'pearson' || poly;
  const exact = !!r.exact;
  const at = (a: string, b: string) =>
    r.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  // Lower triangle of the correlation matrix: a dash on the diagonal, blanks above it.
  const matrixCell = (a: string, i: number, b: string, j: number) => {
    if (j === i) return c('—');
    if (j > i) return c(null);
    const p = at(a, b)!;
    return { v: `${fmt(p.r)}${stars(p.p)}` };
  };
  const matrix: Row[] = r.vars.map((a, i) => [
    c(a),
    ...r.vars.map((b, j) => matrixCell(a, i, b, j)),
  ]);

  const deletion = r.deletion === 'pairwise' ? 'Pairwise' : 'Listwise';
  const oneSided = r.alternative !== 'two.sided' ? `; one-sided (${r.alternative})` : '';
  const ordinalNote = poly
    ? ` Ordinal (integer values, at most 8 categories): ${r.ordinal?.join(', ') || 'none'}; the others are treated as continuous. z tests and Wald intervals from lavaan’s standard errors.`
    : '';
  const exactLimit =
    r.method === 'kendall' ? ' or more than 200 cases' : ' or more than 1,289 cases';
  const exactNote = exact
    ? ` Exact p-values (R’s exact = TRUE) where they exist; pairs with ties${exactLimit} keep the normal approximation (approx.; Kendall’s statistic is then z).`
    : '';
  const pairsNote = `${deletion} deletion of missing values${oneSided}.${ordinalNote}${exactNote}`;

  return (
    <div className="tables">
      <Engine e={r.engine} />
      <Table
        title={`${METHOD_NAME[r.method]} correlations`}
        file="correlation-matrix"
        columns={['', ...r.vars]}
        rows={matrix}
        note="* p < .05, ** p < .01, *** p < .001."
      />
      <Table
        title="Every pair"
        file="correlation-pairs"
        columns={[
          'Pair',
          ...(poly ? ['Type'] : []),
          sym,
          ...(poly ? ['SE'] : []),
          'N',
          ...(exact ? [r.method === 'kendall' ? 'T or z' : 'S', 'p (exact)'] : ['p']),
          ...(withCi ? [`${pct(r.confidence)} CI`] : []),
        ]}
        rows={r.pairs.map(
          (p): Row => [
            c(`${p.a} – ${p.b}`),
            ...(poly ? [c(p.kind ?? '', 'dim')] : []),
            c(p.r),
            ...(poly ? [c(p.se ?? null)] : []),
            c(p.n, undefined, 0),
            ...(exact
              ? [c(p.stat), p.exact === false ? { v: `${fmt(p.p, 3)} (approx.)` } : pCell(p.p)]
              : [pCell(p.p)]),
            ...(withCi ? [c(ci(p.ciLow, p.ciHigh))] : []),
          ],
        )}
        note={pairsNote}
      />
      <CorrelationTostTable r={r} />
      <CorrelationResamplingView r={r} sym={sym} />
      {poly &&
        !!r.normality?.length &&
        (() => {
          const bonferroni = 0.05 / r.normality.length;
          const flag = (p: number) => {
            if (p < bonferroni) return 'bad';
            if (p < 0.05) return 'warn';
            return '';
          };
          return (
            <Table
              title="Bivariate normality of the ordinal pairs"
              file="correlation-normality"
              columns={['Pair', 'Pearson X²', 'p', 'LR G²', 'p', 'df']}
              rows={r.normality.map(
                (t): Row => [
                  c(`${t.a} – ${t.b}`),
                  c(t.x2),
                  c(t.x2p, flag(t.x2p), 3),
                  c(t.g2),
                  c(t.g2p, flag(t.g2p), 3),
                  c(t.df, undefined, 0),
                ],
              )}
              note={`A polychoric correlation assumes that the two variables’ categories cut a bivariate normal distribution. Each test compares the observed two-way table with the one that model implies (lavaan::lavTables). A rejection (amber below .05, red below the Bonferroni level for ${r.normality.length} pairs) means the correlation summarises the table less well: skewed, floor or ceiling answers, a non-linear relation, or a subgroup answering differently. In large samples the tests reject easily; compare the pairs with each other.`}
            />
          );
        })()}
    </div>
  );
}

/** Exact p-values apply to Spearman and Kendall only. */
const exactRank = (o: CorrelationOptions) =>
  !!o.exact && (o.method === 'spearman' || o.method === 'kendall');
/** Equivalence tests apply to Pearson, Spearman and Kendall. */
const corTost = (o: CorrelationOptions) => !!o.tost && o.method !== 'polychoric';
const corInput = (o: CorrelationOptions, ctx: Pick<AnalysisCtx, 'settings'>): CorrelationInput => {
  const { exact: _e, tost: _t, tostBound, ...rest } = o;
  return {
    ...rest,
    confidence: ctx.settings.confidence,
    ...(exactRank(o) ? { exact: true } : {}),
    ...(corTost(o) ? { tostBound: tostBound ?? TOST_COR_BOUND } : {}),
    ...(o.resampling ? { seed: ctx.settings.seed } : {}),
  };
};
export const correlationAnalysis: AnalysisType<CorrelationOptions, CorrelationResult> = {
  id: 'correlation',
  title: 'Correlation',
  sub: 'Pearson, Spearman, Kendall, polychoric with tests and intervals',
  group: 'Basic statistics',
  cardTitle: (o) => `${METHOD_NAME[o.method]} correlations`,
  defaults: () => ({ vars: [], method: 'pearson', alternative: 'two.sided', deletion: 'pairwise' }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          vars: names(raw.vars),
          method: oneOf(raw.method, CORRELATION_METHODS, 'pearson'),
          alternative: oneOf(raw.alternative, ALT_IDS, 'two.sided'),
          deletion: oneOf(raw.deletion, ['pairwise', 'listwise'] as const, 'pairwise'),
          ...(raw.exact === true ? { exact: true } : {}),
          ...(raw.tost === true
            ? { tost: true, tostBound: clampNum(raw.tostBound, 0.01, 0.99, TOST_COR_BOUND) }
            : {}),
          ...resamplingPart(raw),
        }
      : null,
  Options: CorrelationForm,
  View: ({ result }) => <CorrelationView r={result} />,
  blocked: (o, ctx) => {
    if (o.vars.length < 2) return 'Choose at least two variables.';
    if (o.resampling && o.method === 'polychoric')
      return 'Bootstrap intervals and permutation tests are for Pearson, Spearman and Kendall correlations.';
    if (o.resampling?.permutation && o.method === 'kendall')
      return 'Permutation tests are for Pearson and Spearman correlations.';
    return missingColumns(ctx, o.vars, 'Correlation');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, o.vars, [
      o.method,
      o.alternative,
      o.deletion,
      ctx.settings.confidence,
      ...(exactRank(o) ? ['exact'] : []),
      ...(corTost(o) ? [`tost:${o.tostBound ?? TOST_COR_BOUND}`] : []),
      ...resamplingFingerprint(o.resampling, ctx.settings.seed),
    ]),
  run: async (o, ctx) => (await engine()).correlationR(rawData(ctx)!, corInput(o, ctx)),
  script: async (o, ctx) => (await engine()).correlationScriptR(rawData(ctx)!, corInput(o, ctx)),
  summary: (o) =>
    `${METHOD_NAME[o.method]}${exactRank(o) ? ' (exact p)' : ''}${corTost(o) ? ' + TOST' : ''} · ${o.vars.join(', ') || '…'}`,
};

// ---------------------------------------------------------------- contingency tables

export type ContingencyOptions = Omit<ContingencyInput, 'confidence' | 'effectSizes'> & {
  /** Cramér's V and φ with confidence intervals (effectsize). */
  effectSizes: boolean;
};
const ctInput = (o: ContingencyOptions, ctx: Pick<AnalysisCtx, 'settings'>): ContingencyInput => {
  const { effectSizes, ...rest } = o;
  return {
    ...rest,
    confidence: ctx.settings.confidence,
    ...(effectSizes ? { effectSizes: true } : {}),
  };
};

function ContingencyForm({ options: o, set, ctx, disabled }: OptionsProps<ContingencyOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <div className="row2">
        <ColumnSelect
          id="ct-r"
          label="Rows"
          value={o.rows}
          columns={d.names}
          exclude={[o.columns, o.counts]}
          onChange={(rows) => set({ ...o, rows })}
        />
        <ColumnSelect
          id="ct-c"
          label="Columns"
          value={o.columns}
          columns={d.names}
          exclude={[o.rows, o.counts]}
          onChange={(columns) => set({ ...o, columns })}
        />
      </div>
      <ColumnSelect
        id="ct-w"
        label="Counts (optional: one row per cell with its frequency)"
        optional="None: one row per case"
        value={o.counts}
        columns={d.names.filter((n) => !d.categories?.[n])}
        exclude={[o.rows, o.columns]}
        onChange={(counts) => set({ ...o, counts })}
      />
      <EffectSizeField
        value={o.effectSizes}
        onChange={(effectSizes) => set({ ...o, effectSizes })}
        what="Cramér’s V and (2 × 2) φ with intervals"
      />
      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={!!o.paired}
            onChange={(e) => {
              const { paired: _p, ...rest } = o;
              set(e.target.checked ? { ...rest, paired: true } : rest);
            }}
          />{' '}
          Paired measurements (McNemar, Bowker)
        </label>
        <div className="hint">
          The rows and columns are the same subjects measured twice on the same categories (before
          and after, two raters): McNemar’s test for two categories, Bowker’s test of symmetry for
          more.
        </div>
      </div>
    </fieldset>
  );
}

/** McNemar's tests of a paired 2 × 2 table, or Bowker's test of symmetry. */
function PairedTable({ p }: { p: PairedTests }) {
  if (p.bowker) {
    return (
      <Table
        title="Bowker’s test of symmetry"
        file="contingency-bowker"
        columns={['Test', 'χ²', 'df', 'p']}
        rows={[[c('Bowker'), c(p.bowker.stat), c(p.bowker.df, undefined, 0), pCell(p.bowker.p)]]}
        note={
          'Whether the subjects move from category i to j as often as from j to i, over every pair of ' +
          'categories. Pairs of cells without any subjects are left out (their count is the df).'
        }
      />
    );
  }
  const rows: Row[] = [];
  if (p.mcnemar)
    rows.push([c('McNemar χ²'), c(p.mcnemar.stat), c(1, undefined, 0), pCell(p.mcnemar.p)]);
  if (p.mcnemarCorrected) {
    rows.push([
      c('McNemar χ², continuity correction'),
      c(p.mcnemarCorrected.stat),
      c(1, undefined, 0),
      pCell(p.mcnemarCorrected.p),
    ]);
  }
  if (p.exact) rows.push([c('Exact (binomial)'), c(null), c(null), pCell(p.exact.p)]);
  const exactNote = p.exact
    ? ` The exact test: the ${fmt(p.exact.b, 0)} subjects who moved one way against the ` +
      `${fmt(p.exact.c, 0)} who moved the other, binomial with p = ½.`
    : '';
  return (
    <Table
      title="McNemar’s test (paired)"
      file="contingency-mcnemar"
      columns={['Test', 'χ²', 'df', 'p']}
      rows={rows}
      note={
        'Whether the share in the first category changed between the two measurements: only the ' +
        `subjects who changed category count.${exactNote} Prefer the exact test when they are few.`
      }
    />
  );
}

function ContingencyView({ r }: { r: ContingencyResult }) {
  const pctRow = (i: number, j: number) => {
    const s = r.counts[i].reduce((a, b) => a + b, 0);
    return s ? `${fmt((100 * r.counts[i][j]) / s, 1)}%` : '';
  };
  const rows: Row[] = [
    ...r.rowLevels.map(
      (l, i): Row => [
        c(l),
        ...r.colLevels.map((_, j): { v: string } => ({
          v: `${r.counts[i][j]} (${fmt(r.expected[i][j], 1)}; ${pctRow(i, j)})`,
        })),
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
  ];
  const small = r.expected.flat().filter((e) => e < 5).length;
  const effect = (id: string): EffectSize | undefined => r.effects?.find((e) => e.id === id);
  const vCi = effect('cramerV');
  const phiCi = effect('phi');
  return (
    <div className="tables">
      <Engine e={r.engine} />
      <Table
        title={`${r.rows} × ${r.columns}`}
        file="contingency-table"
        columns={[`${r.rows} \\ ${r.columns}`, ...r.colLevels, 'Total']}
        rows={rows}
        note="Each cell: count (expected count; row percentage)."
      />
      {r.paired && <PairedTable p={r.paired} />}
      <Table
        title="Tests of independence"
        file="contingency-tests"
        columns={['Test', 'Value', 'df', 'p']}
        rows={[
          [c('Pearson χ²'), c(r.chisq.stat), c(df(r.chisq)), pCell(r.chisq.p)],
          ...(r.yates
            ? [
                [
                  c('χ² with continuity correction'),
                  c(r.yates.stat),
                  c(df(r.yates)),
                  pCell(r.yates.p),
                ] as Row,
              ]
            : []),
          [
            c('Likelihood ratio G²'),
            c(r.likelihoodRatio.stat),
            c(r.likelihoodRatio.df, undefined, 0),
            pCell(r.likelihoodRatio.p),
          ],
          ...(r.fisher
            ? [[c('Fisher’s exact test'), c(null), c(''), pCell(r.fisher.p)] as Row]
            : []),
        ]}
        note={
          small
            ? `${small} cell${small === 1 ? ' has' : 's have'} an expected count below 5: prefer Fisher’s exact test.`
            : undefined
        }
      />
      <Table
        title="Association"
        file="contingency-association"
        columns={['Measure', 'Value', `${pct(r.confidence)} CI`]}
        rows={[
          [c('Cramér’s V'), c(r.cramerV), c(vCi ? ciText(vCi) : null)],
          ...(r.phi !== null
            ? [[c('φ'), c(r.phi), c(phiCi ? `|φ|: ${ciText(phiCi)}` : null)] as Row]
            : []),
          ...(r.oddsRatio
            ? [
                [
                  c('Odds ratio (sample)'),
                  c(r.oddsRatio.est),
                  c(ci(r.oddsRatio.ciLow, r.oddsRatio.ciHigh)),
                ] as Row,
              ]
            : []),
          ...(r.fisher?.estimate !== undefined && r.fisher?.estimate !== null
            ? [
                [
                  c('Odds ratio (conditional ML, Fisher)'),
                  c(r.fisher.estimate),
                  c(ci(r.fisher.ciLow, r.fisher.ciHigh)),
                ] as Row,
              ]
            : []),
        ]}
        note={
          vCi
            ? 'Intervals of V and |φ| by effectsize (unadjusted, two-sided, from the noncentral χ² distribution); φ’s sign is that of the 2 × 2 table’s diagonal.'
            : undefined
        }
      />
    </div>
  );
}

const ctCols = (o: ContingencyOptions) => [o.rows, o.columns, o.counts].filter(Boolean);
export const contingencyAnalysis: AnalysisType<ContingencyOptions, ContingencyResult> = {
  id: 'contingency',
  title: 'Contingency table',
  sub: 'χ², likelihood ratio, Fisher’s exact test, Cramér’s V, odds ratio; McNemar and Bowker (paired)',
  group: 'Basic statistics',
  cardTitle: (o) => `Contingency table${o.rows && o.columns ? `: ${o.rows} × ${o.columns}` : ''}`,
  defaults: () => ({ rows: '', columns: '', counts: '', effectSizes: true }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          rows: name(raw.rows),
          columns: name(raw.columns),
          counts: name(raw.counts),
          effectSizes: flag(raw.effectSizes),
          ...(raw.paired === true ? { paired: true as const } : {}),
        }
      : null,
  Options: ContingencyForm,
  View: ({ result }) => <ContingencyView r={result} />,
  blocked: (o, ctx) => {
    if (!o.rows || !o.columns) return 'Choose the row and the column variables.';
    if (o.rows === o.columns) return 'Choose two different variables.';
    return missingColumns(ctx, ctCols(o), 'Contingency table');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, ctCols(o), [
      o.rows,
      o.columns,
      o.counts,
      ctx.settings.confidence,
      // (only when set: earlier fingerprints are unchanged)
      ...(o.effectSizes ? ['es'] : []),
      ...(o.paired ? ['paired'] : []),
    ]),
  run: async (o, ctx) =>
    (await engine()).contingencyR(labelled(ctx, [o.rows, o.columns]), ctInput(o, ctx)),
  script: async (o, ctx) =>
    (await engine()).contingencyScriptR(labelled(ctx, [o.rows, o.columns]), ctInput(o, ctx)),
  summary: (o) =>
    `${o.rows || '…'} × ${o.columns || '…'}${o.counts ? ` (counts ${o.counts})` : ''}`,
};

// ---------------------------------------------------------------- binomial and multinomial

export type FreqTestOptions = Omit<FreqTestInput, 'confidence'>;

function FreqForm({ options: o, set, ctx, disabled }: OptionsProps<FreqTestOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Choice
        label="Test"
        value={o.type}
        onChange={(type) => set({ ...o, type })}
        options={[
          ['binomial', 'Binomial test'],
          ['multinomial', 'Multinomial (goodness of fit)'],
          ['cochran', 'Cochran’s Q'],
        ]}
      />
      {o.type === 'cochran' ? (
        <>
          <OrderedPicker
            label="Binary measures"
            columns={d.names}
            value={o.vars ?? []}
            onChange={(vars) => set({ ...o, vars })}
          />
          <div className="hint">
            One column per measure (occasion, condition, item), one row per subject, two values in
            all (yes / no, 1 / 0): whether the share of the second value differs between the
            measures.
          </div>
          <AdjustChoice o={o} set={set} />
        </>
      ) : (
        <ColumnSelect
          id="fq-x"
          label="Variable"
          value={o.variable}
          columns={d.names}
          onChange={(variable) => set({ ...o, variable })}
        />
      )}
      {o.type === 'cochran' ? null : o.type === 'binomial' ? (
        <>
          <div className="field">
            <label htmlFor="fq-p">Test proportion</label>
            <input
              id="fq-p"
              className="input num"
              type="number"
              min={0.001}
              max={0.999}
              step={0.01}
              value={o.testValue}
              onChange={(e) => {
                const v = Number(e.target.value);
                set({ ...o, testValue: Number.isFinite(v) ? v : 0.5 });
              }}
            />
          </div>
          <Choice
            label="Alternative hypothesis"
            value={o.alternative}
            onChange={(alternative) => set({ ...o, alternative })}
            options={ALTS}
          />
        </>
      ) : (
        <div className="field">
          <label htmlFor="fq-props">Expected proportions (optional)</label>
          <input
            id="fq-props"
            className="input"
            placeholder="Equal: leave empty; else e.g. 1, 1, 2"
            value={o.proportions.join(', ')}
            onChange={(e) =>
              set({
                ...o,
                proportions: e.target.value
                  .split(/[,\s]+/)
                  .filter(Boolean)
                  .map(Number)
                  .filter((x) => Number.isFinite(x)),
              })
            }
          />
          <div className="hint">
            One positive number per category, in the order of the categories; they are rescaled to
            sum to 1.
          </div>
        </div>
      )}
    </fieldset>
  );
}

/** Cochran's Q and the pairwise McNemar tests. */
function CochranTables({ r }: { r: FreqTestResult }) {
  const vars = r.vars ?? [];
  const q = r.cochran!;
  const adjust = ADJUST_NAME[r.adjust ?? 'holm'];
  return (
    <>
      <Table
        title={`Cochran’s Q: ${vars.length} measures, ${r.n} subjects`}
        file="cochran"
        columns={['Measure', `Share of “${r.success}”`]}
        rows={vars.map((v, i): Row => [c(v), c(r.proportions?.[i] ?? null)])}
      />
      <Table
        title="Cochran’s Q test"
        file="cochran-test"
        columns={['Q', 'df', 'p']}
        rows={[[c(q.stat), c(q.df, undefined, 0), pCell(q.p)]]}
        note="Whether the share of the second value is the same on all the measures (χ² approximation). Subjects with a missing value are left out."
      />
      <Table
        title="Post hoc: pairs of measures (McNemar)"
        file="cochran-posthoc"
        columns={['Pair', 'b', 'c', 'χ²', 'p', 'p adjusted', 'Exact p', 'Exact p adjusted']}
        rows={(r.posthoc ?? []).map(
          (x): Row => [
            c(x.comparison),
            c(x.b, undefined, 0),
            c(x.c, undefined, 0),
            c(x.chisq),
            pCell(x.p),
            pCell(x.pAdjusted),
            pCell(x.pExact),
            pCell(x.pExactAdjusted),
          ],
        )}
        note={
          'b: subjects with the second value on the first measure of the pair and the first value on the ' +
          'other; c: the reverse. χ²: McNemar’s test with the continuity correction (R’s default); exact: ' +
          `the binomial test of b against c. p adjusted over the pairs by ${adjust}.`
        }
      />
    </>
  );
}

function FreqView({ r }: { r: FreqTestResult }) {
  if (r.cochran) {
    return (
      <div className="tables">
        <Engine e={r.engine} />
        <CochranTables r={r} />
      </div>
    );
  }
  return (
    <div className="tables">
      <Engine e={r.engine} />
      {r.binomial ? (
        <Table
          title={`Binomial test: ${r.variable} (test proportion ${fmt(r.testValue ?? 0.5)})`}
          file="binomial"
          columns={['Category', 'Count', 'Total', 'Proportion', 'p', `${pct(r.confidence)} CI`]}
          rows={r.levels.map(
            (l, i): Row => [
              c(l),
              c(r.counts[i], undefined, 0),
              c(r.n, undefined, 0),
              c(r.binomial![i].proportion),
              pCell(r.binomial![i].p),
              c(ci(r.binomial![i].ciLow, r.binomial![i].ciHigh)),
            ],
          )}
          note={`Each category against the rest (exact test; Clopper–Pearson interval)${r.alternative !== 'two.sided' ? `, one-sided (${r.alternative})` : ''}.`}
        />
      ) : r.multinomial ? (
        <>
          <Table
            title={`Multinomial test: ${r.variable}`}
            file="multinomial-counts"
            columns={['Category', 'Observed', 'Expected']}
            rows={r.levels.map(
              (l, i): Row => [c(l), c(r.counts[i], undefined, 0), c(r.multinomial!.expected[i])],
            )}
          />
          <Table
            title="Goodness of fit"
            file="multinomial-test"
            columns={['χ²', 'df', 'p']}
            rows={[[c(r.multinomial.stat), c(df(r.multinomial)), pCell(r.multinomial.p)]]}
          />
        </>
      ) : null}
    </div>
  );
}

function freqCardTitle(o: FreqTestOptions): string {
  if (o.type === 'cochran') {
    const vars = o.vars ?? [];
    return `Cochran’s Q${vars.length ? `: ${vars.join(', ')}` : ''}`;
  }
  const test = o.type === 'binomial' ? 'Binomial' : 'Multinomial';
  return `${test} test${o.variable ? `: ${o.variable}` : ''}`;
}
/** The columns of a frequency test: the variable, or Cochran's measures. */
const freqCols = (o: FreqTestOptions) => (o.type === 'cochran' ? (o.vars ?? []) : [o.variable]);
/**
 * The data of a frequency test: the tested variable with its value labels as categories; Cochran's
 * measures as they are (their two values are compared as numbers across all the measures).
 */
const freqData = (o: FreqTestOptions, ctx: AnalysisCtx) =>
  o.type === 'cochran' ? rawData(ctx)! : labelled(ctx, [o.variable]);
/** Cochran's options from a project file (only when set: earlier options are unchanged). */
function parseCochranOptions(raw: Record<string, unknown>): Partial<FreqTestOptions> {
  const out: Partial<FreqTestOptions> = {};
  if (raw.vars !== undefined) out.vars = names(raw.vars);
  const adjust = oneOf(raw.adjust, ADJUST_IDS, 'holm');
  if (adjust !== 'holm') out.adjust = adjust;
  return out;
}

export const freqTestAnalysis: AnalysisType<FreqTestOptions, FreqTestResult> = {
  id: 'freqtest',
  title: 'Binomial and multinomial tests',
  sub: 'a proportion against a value; counts against expected proportions; Cochran’s Q of related binary measures',
  group: 'Basic statistics',
  entries: [
    {
      title: 'Binomial test',
      sub: 'each category’s proportion against a value (exact)',
      options: (o) => ({ ...o, type: 'binomial' }),
    },
    {
      title: 'Multinomial test',
      sub: 'counts against equal or given proportions (χ²)',
      options: (o) => ({ ...o, type: 'multinomial' }),
    },
    {
      title: 'Cochran’s Q',
      sub: 'k related binary measures (the same subjects), with pairwise McNemar tests',
      options: (o) => ({ ...o, type: 'cochran' }),
    },
  ],
  cardTitle: freqCardTitle,
  defaults: () => ({
    type: 'binomial',
    variable: '',
    testValue: 0.5,
    proportions: [],
    alternative: 'two.sided',
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          type: oneOf(raw.type, FREQTEST_TYPES, 'binomial'),
          variable: name(raw.variable),
          testValue:
            typeof raw.testValue === 'number' && raw.testValue > 0 && raw.testValue < 1
              ? raw.testValue
              : 0.5,
          proportions: (Array.isArray(raw.proportions) ? raw.proportions.slice(0, 200) : []).filter(
            (x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0,
          ),
          alternative: oneOf(raw.alternative, ALT_IDS, 'two.sided'),
          ...parseCochranOptions(raw),
        }
      : null,
  Options: FreqForm,
  View: ({ result }) => <FreqView r={result} />,
  blocked: (o, ctx) => {
    if (o.type === 'cochran') {
      if ((o.vars ?? []).length < 2) return 'Choose at least two binary measures.';
      return missingColumns(ctx, freqCols(o), 'Cochran’s Q');
    }
    if (!o.variable) return 'Choose the variable.';
    if (o.type === 'binomial' && !(o.testValue > 0 && o.testValue < 1))
      return 'The test proportion must be between 0 and 1.';
    if (o.type === 'multinomial' && o.proportions.some((x) => !(x > 0)))
      return 'Expected proportions must be positive.';
    return missingColumns(ctx, [o.variable], 'Frequency test');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, freqCols(o), [
      o.type,
      o.testValue,
      o.alternative,
      o.proportions.join(','),
      ctx.settings.confidence,
      // (Cochran only: earlier fingerprints are unchanged)
      ...(o.type === 'cochran' ? [(o.vars ?? []).join(','), o.adjust ?? 'holm'] : []),
    ]),
  run: async (o, ctx) =>
    (await engine()).freqTestR(freqData(o, ctx), {
      ...o,
      confidence: ctx.settings.confidence,
    }),
  script: async (o, ctx) =>
    (await engine()).freqTestScriptR(freqData(o, ctx), {
      ...o,
      confidence: ctx.settings.confidence,
    }),
  summary: (o) => {
    if (o.type === 'cochran') return `Cochran’s Q · ${(o.vars ?? []).join(', ') || '…'}`;
    return `${o.type} · ${o.variable || '…'}${o.type === 'binomial' ? ` vs ${o.testValue}` : ''}`;
  },
};

// ---------------------------------------------------------------- reliability and agreement

export type ReliabilityOptions = Omit<ReliabilityInput, 'confidence' | 'seed'>;
const REL_NAME = {
  scale: 'Scale reliability',
  icc: 'Intraclass correlation',
  kappa: 'Cohen’s kappa',
  blandaltman: 'Bland–Altman agreement',
  fleiss: 'Fleiss’ kappa',
  kripp: 'Krippendorff’s alpha',
  kendallw: 'Kendall’s W',
  gwet: 'Gwet’s AC1 / AC2',
} as const;
/** Krippendorff's levels of measurement (as rengine/tests, which is loaded on demand). */
const KRIPP_LEVELS: readonly KrippLevel[] = ['nominal', 'ordinal', 'interval', 'ratio'];
/** Gwet's weights (irrCAC): unweighted is AC1, the others AC2. */
const GWET_WEIGHT_OPTIONS: readonly (readonly [GwetWeights, string])[] = [
  ['unweighted', 'Unweighted (AC1)'],
  ['linear', 'Linear'],
  ['quadratic', 'Quadratic'],
  ['ordinal', 'Ordinal'],
];
const GWET_WEIGHTS = GWET_WEIGHT_OPTIONS.map(([id]) => id);
/** Krippendorff's alpha: bootstrap samples by default. */
export const KRIPP_BOOTSTRAP = 1000;
const REL_HINT = {
  scale:
    'The items of one scale, scored in the same direction (reverse-code items first, in the data panel).',
  icc: 'One column per rater (or occasion), one row per subject rated.',
  kappa: 'Two raters’ category codes for the same subjects.',
  blandaltman: 'Two methods measuring the same quantity on the same subjects.',
  fleiss: 'One column per rater, one row per subject: each rater’s category for the subject.',
  kripp:
    'One column per rater, one row per subject; missing ratings are allowed (a subject needs two ratings to count).',
  kendallw:
    'One column per rater, one row per subject: each rater’s score or rank of the subjects.',
  gwet: 'One column per rater, one row per subject: each rater’s category; missing ratings are allowed.',
} as const;

/** A weight matrix typed as rows of numbers (one line per row); kept as typed while it is edited. */
function WeightMatrixInput({
  value,
  onChange,
}: {
  value: number[][];
  onChange: (m: number[][]) => void;
}) {
  const [text, setText] = useState(() => value.map((r) => r.join(' ')).join('\n'));
  return (
    <div className="field">
      <label htmlFor="rel-w">Weights (one line per category of the first rater)</label>
      <textarea
        id="rel-w"
        className="input"
        rows={Math.max(3, value.length)}
        value={text}
        placeholder={'0 1 3\n1 0 6\n3 6 0'}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseWeightMatrix(e.target.value));
        }}
      />
      <div className="hint">
        Agreement weights (1 on the diagonal: full agreement), or disagreement weights (0 on the
        diagonal, as Cohen 1968), which are taken as 1 − w / max(w): the same weighted κ.
      </div>
    </div>
  );
}
export const parseWeightMatrix = (text: string): number[][] =>
  text
    .split(/[\n;]+/)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => r.split(/[\s,]+/).map(Number));
const squareMatrix = (m: number[][]) =>
  m.length >= 2 &&
  m.length <= 20 &&
  m.every((r) => r.length === m.length && r.every((x) => Number.isFinite(x)));
const WEIGHT_NAME = {
  squared: 'squared distances',
  linear: 'linear distances',
  custom: 'the given weights',
} as const;

/** Bayesrel's iterations per chain by default (strel's n.iter). */
export const BAYESREL_ITERATIONS = 1000;

/** The Bayesian reliability options of the scale analysis (Bayesrel). */
function BayesReliabilityFields({
  o,
  set,
}: {
  o: ReliabilityOptions;
  set: (o: ReliabilityOptions) => void;
}) {
  const toggle = (on: boolean) => {
    const { bayes: _b, bayesGlb: _g, iterations: _i, ...rest } = o;
    set(on ? { ...rest, bayes: true } : rest);
  };
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={!!o.bayes} onChange={(e) => toggle(e.target.checked)} />
        <span>
          Bayesian reliability with credible intervals
          <br />
          <span className="hint">
            Posterior means and credible intervals of α, Guttman’s λ2 and McDonald’s ω (Bayesrel,
            Pfadt et al. 2022), at the confidence level of the settings, seeded by the settings’
            seed.
          </span>
        </span>
      </label>
      {o.bayes && (
        <div className="row2">
          <NumField
            id="rel-iter"
            label="Iterations per chain"
            value={o.iterations ?? BAYESREL_ITERATIONS}
            lo={100}
            hi={20000}
            step={100}
            int
            onChange={(iterations) => set({ ...o, iterations })}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={!!o.bayesGlb}
              onChange={(e) => {
                const { bayesGlb: _g, ...rest } = o;
                set(e.target.checked ? { ...rest, bayesGlb: true } : rest);
              }}
            />
            <span>
              Also the greatest lower bound
              <br />
              <span className="hint">
                Slow: one glb per posterior draw (about 20 s for five items in desktop R, several
                times longer in the browser).
              </span>
            </span>
          </label>
        </div>
      )}
    </>
  );
}

const BAYES_NAME = {
  alpha: 'Cronbach’s α',
  lambda2: 'Guttman’s λ2',
  glb: 'Greatest lower bound (glb)',
  omega: 'McDonald’s ω (one factor)',
} as const;

const BAYESREL_SOURCE =
  'Pfadt, J. M., van den Bergh, D., Sijtsma, K., Moshagen, M., & Wagenmakers, E.-J. (2022). ' +
  'Bayesian estimation of single-test reliability coefficients. Multivariate Behavioral Research, 57(4), 620–641. ' +
  'https://doi.org/10.1080/00273171.2021.1891855';

/** Bayesrel's posterior summaries, with the chains' convergence. */
function BayesReliabilityTable({ b }: { b: BayesReliabilityResult }) {
  const level = pct(b.interval);
  const rows: Row[] = b.estimates.map((e) => [
    c(BAYES_NAME[e.estimate] ?? e.estimate),
    c(e.mean),
    c(ci(e.low, e.high)),
    { ...c(e.rhat, undefined, 3), cls: e.rhat > 1.01 ? 'bad' : undefined },
    c(e.ess, undefined, 0),
  ]);
  return (
    <Table
      title="Bayesian reliability (posterior)"
      file="reliability-bayes"
      columns={[
        'Coefficient',
        'Posterior mean',
        `${level} credible interval`,
        'R-hat',
        'Effective draws',
      ]}
      rows={rows}
      note={
        `Bayesrel ${b.version} (strel): ${b.chains} chains of ${b.iterations.toLocaleString('en')} ` +
        `iterations, the first ${b.burnin} discarded, seed ${b.seed}. α, λ2 and the glb from the posterior of the ` +
        'covariance matrix (inverse Wishart), ω from a Bayesian one-factor model. An R-hat above 1.01 (red) means the ' +
        `chains have not mixed: raise the iterations. Source: ${BAYESREL_SOURCE}.`
      }
    />
  );
}

/** The columns a reliability analysis can use: category columns too for the categorical ones. */
function raterColumns(
  o: ReliabilityOptions,
  d: { names: string[]; categories?: object },
): string[] {
  const categorical =
    o.type === 'kappa' || o.type === 'fleiss' || o.type === 'kripp' || o.type === 'gwet';
  if (categorical) return d.names;
  const cats = (d.categories ?? {}) as Record<string, unknown>;
  return d.names.filter((n) => !cats[n]);
}

/** Krippendorff's alpha: the level of measurement and the bootstrap samples. */
function KrippFields({ o, set }: { o: ReliabilityOptions; set: (o: ReliabilityOptions) => void }) {
  return (
    <>
      <Choice
        label="Level of measurement"
        value={o.krippLevel ?? 'nominal'}
        options={[
          ['nominal', 'Nominal'],
          ['ordinal', 'Ordinal'],
          ['interval', 'Interval'],
          ['ratio', 'Ratio'],
        ]}
        onChange={(level) => {
          const { krippLevel: _l, ...rest } = o;
          // Nominal is the default, so it leaves no option behind.
          set(level === 'nominal' ? rest : { ...rest, krippLevel: level });
        }}
        hint="How far apart two different values are: not at all (nominal), by their ranks (ordinal), by their differences (interval) or by their ratios (ratio)."
      />
      <NumField
        id="rel-boot"
        label="Bootstrap samples (0: no interval)"
        value={o.bootstrap ?? KRIPP_BOOTSTRAP}
        lo={0}
        hi={20000}
        step={100}
        int
        onChange={(bootstrap) => {
          const { bootstrap: _b, ...rest } = o;
          set(bootstrap === KRIPP_BOOTSTRAP ? rest : { ...rest, bootstrap });
        }}
      />
      <div className="hint">
        Subjects drawn with replacement, α recomputed each time: the percentile interval at the
        project’s confidence level, seeded by the project’s seed.
      </div>
    </>
  );
}

function ReliabilityForm({ options: o, set, ctx, disabled }: OptionsProps<ReliabilityOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  const pair = o.type === 'kappa' || o.type === 'blandaltman';
  const kt = o.type === 'kappa' ? o.kappaTable : undefined;
  const setTable = (t: Partial<KappaTable>) => set({ ...o, kappaTable: { ...kt!, ...t } });
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Choice
        label="Analysis"
        value={o.type}
        onChange={(type) =>
          set({
            ...o,
            type,
            vars: type === 'kappa' || type === 'blandaltman' ? o.vars.slice(0, 2) : o.vars,
          })
        }
        options={[
          ['scale', 'Scale'],
          ['icc', 'ICC'],
          ['kappa', 'Kappa'],
          ['blandaltman', 'Bland–Altman'],
          ['fleiss', 'Fleiss’ κ'],
          ['kripp', 'Krippendorff’s α'],
          ['kendallw', 'Kendall’s W'],
          ['gwet', 'Gwet’s AC'],
        ]}
        hint={REL_HINT[o.type]}
      />
      {o.type === 'kappa' && (
        <Choice
          label="Data"
          value={kt ? 'table' : 'raters'}
          options={[
            ['raters', 'Two raters’ columns'],
            ['table', 'Agreement table'],
          ]}
          onChange={(v) => {
            const { kappaTable: _t, ...rest } = o;
            set(
              v === 'table' ? { ...rest, kappaTable: { rows: '', columns: '', counts: '' } } : rest,
            );
          }}
          hint={
            kt
              ? 'One row per cell of the table: the first rater’s category, the second rater’s, and the count or proportion of subjects (as Cohen’s tables).'
              : undefined
          }
        />
      )}
      {kt ? (
        <>
          <div className="row2">
            <ColumnSelect
              id="rel-tr"
              label="First rater (rows)"
              value={kt.rows}
              columns={d.names}
              exclude={[kt.columns, kt.counts]}
              onChange={(rows) => setTable({ rows })}
            />
            <ColumnSelect
              id="rel-tc"
              label="Second rater (columns)"
              value={kt.columns}
              columns={d.names}
              exclude={[kt.rows, kt.counts]}
              onChange={(columns) => setTable({ columns })}
            />
          </div>
          <ColumnSelect
            id="rel-tw"
            label="Counts or proportions"
            optional="None: one row per subject"
            value={kt.counts}
            columns={d.names.filter((n) => !d.categories?.[n])}
            exclude={[kt.rows, kt.columns]}
            onChange={(counts) => setTable({ counts })}
          />
          <div className="field">
            <label htmlFor="rel-tn">Number of subjects (for proportions)</label>
            <input
              id="rel-tn"
              className="input num"
              type="number"
              min={2}
              step={1}
              value={kt.nObs ?? ''}
              placeholder="the counts’ total"
              onChange={(e) => {
                const v = Number(e.target.value);
                const { nObs: _n, ...t } = kt;
                set({
                  ...o,
                  kappaTable:
                    e.target.value && Number.isFinite(v) && v >= 2 ? { ...t, nObs: v } : t,
                });
              }}
            />
            <div className="hint">
              The standard errors need the number of subjects rated: give it when the table holds
              proportions (psych’s n.obs).
            </div>
          </div>
        </>
      ) : (
        <OrderedPicker
          label={pair ? 'Two variables' : 'Variables'}
          columns={raterColumns(o, d)}
          value={o.vars}
          onChange={(vars) => set({ ...o, vars: pair ? vars.slice(-2) : vars })}
        />
      )}
      {o.type === 'kappa' && (
        <>
          <Choice
            label="Weighted κ"
            value={o.kappaWeights ?? 'squared'}
            options={[
              ['squared', 'Squared distances'],
              ['linear', 'Linear distances'],
              ['custom', 'Weight matrix'],
            ]}
            onChange={(w) => {
              const { kappaWeights: _w, weightMatrix: _m, ...rest } = o;
              // Squared distances are the default, so they leave no option behind.
              if (w === 'squared') set(rest);
              else if (w === 'linear') set({ ...rest, kappaWeights: w });
              else set({ ...rest, kappaWeights: w, weightMatrix: o.weightMatrix ?? [] });
            }}
            hint="Categories in their order: a near miss counts as partial agreement. Squared distances are psych’s default."
          />
          {o.kappaWeights === 'custom' && (
            <WeightMatrixInput
              value={o.weightMatrix ?? []}
              onChange={(weightMatrix) => set({ ...o, weightMatrix })}
            />
          )}
        </>
      )}
      {o.type === 'scale' && <BayesReliabilityFields o={o} set={set} />}
      {o.type === 'kripp' && <KrippFields o={o} set={set} />}
      {o.type === 'gwet' && (
        <Choice
          label="Weights"
          value={o.gwetWeights ?? 'unweighted'}
          options={GWET_WEIGHT_OPTIONS}
          onChange={(w) => {
            const { gwetWeights: _w, ...rest } = o;
            // Unweighted (AC1) is the default, so it leaves no option behind.
            set(w === 'unweighted' ? rest : { ...rest, gwetWeights: w });
          }}
          hint="Unweighted: Gwet’s AC1, categories without order. Weighted: AC2, ordered categories where a near miss counts as partial agreement (irrCAC’s weights)."
        />
      )}
    </fieldset>
  );
}

function BlandAltman({ r }: { r: ReliabilityResult }) {
  const pts = r.points!;
  const W = 520;
  const H = 300;
  const pad = { l: 56, r: 16, t: 14, b: 44 };
  const lo = (a: number[]) => a.reduce((m, v) => Math.min(m, v), Infinity);
  const hi = (a: number[]) => a.reduce((m, v) => Math.max(m, v), -Infinity);
  const x0 = lo(pts.mean);
  const x1 = hi(pts.mean);
  const ys = [Math.min(lo(pts.diff), r.lower!), Math.max(hi(pts.diff), r.upper!)];
  const m = (ys[1] - ys[0] || 1) * 0.08;
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) =>
    pad.t + ((ys[1] + m - v) / (ys[1] - ys[0] + 2 * m)) * (H - pad.t - pad.b);
  const ticks = (a: number, b: number) =>
    Array.from({ length: 6 }, (_, i) => a + ((b - a) * i) / 5);
  return (
    <ChartFrame
      id="blandaltman"
      name="bland-altman"
      width={W}
      height={H}
      defaults={{ x: `Mean of ${r.vars[0]} and ${r.vars[1]}`, y: `${r.vars[0]} − ${r.vars[1]}` }}
      caption={
        <span className="hint">
          Each subject’s difference against its mean. Solid line: the mean difference (bias);
          dashed: the limits of agreement, bias ± 1.96 SD.
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={W}
          height={H}
          role="img"
          aria-label="Bland–Altman plot"
        >
          {ticks(ys[0] - m, ys[1] + m).map((v) => (
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
          {pts.mean.map((x, i) => (
            <circle key={i} className="dot" cx={sx(x)} cy={sy(pts.diff[i])} r={2.5} />
          ))}
          <line className="fit-line" x1={pad.l} x2={W - pad.r} y1={sy(r.bias!)} y2={sy(r.bias!)} />
          {[r.lower!, r.upper!].map((v) => (
            <line
              key={v}
              className="fit-line"
              strokeDasharray="5 4"
              x1={pad.l}
              x2={W - pad.r}
              y1={sy(v)}
              y2={sy(v)}
            />
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

const ICC_NAME: Record<string, string> = {
  ICC1: 'ICC(1): single rater, one-way random',
  ICC2: 'ICC(2,1): single rater, absolute agreement (two-way random)',
  ICC3: 'ICC(3,1): single rater, consistency (two-way mixed)',
  ICC1k: 'ICC(1,k): mean of k raters, one-way random',
  ICC2k: 'ICC(2,k): mean of k raters, absolute agreement',
  ICC3k: 'ICC(3,k): mean of k raters, consistency',
};

const SCALE_NOTE =
  'α assumes equal loadings (tau-equivalence); ω total uses a one-factor model’s loadings; the glb is the ' +
  'largest reliability consistent with the inter-item correlations (psych’s factor-analytic estimate, ' +
  'glb.fa). psych::alpha, omega and glb.fa.';
const ICC_NOTE =
  'Absolute agreement counts systematic differences between raters against agreement; consistency ' +
  'ignores them. Use the k-rater forms when the mean of the raters is what is used.';

/** How the scale's standard errors of measurement were computed (absent in results from before they were added). */
function scaleSemNote(r: ReliabilityResult): string {
  if (r.scoreSd === undefined) return '';
  return (
    ' SEM: the standard error of measurement of the scale score (the item mean), ' +
    `SD × √(1 − reliability), with SD = ${fmt(r.scoreSd)}.`
  );
}

/** How the ICCs' standard errors of measurement were computed. */
function iccSemNote(r: ReliabilityResult): string {
  if (r.sdSingle === undefined || r.sdMean === undefined) return '';
  return (
    ' SEM: SD × √(1 − ICC), with the SD of all ratings for a single rater ' +
    `(${fmt(r.sdSingle)}) and the SD of the subjects’ mean ratings for k raters (${fmt(r.sdMean)}).`
  );
}

function ReliabilityView({ r }: { r: ReliabilityResult }) {
  const conf = pct(r.confidence);
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        n = {r.n} complete cases; {r.engine.package} {r.engine.version}.
      </p>
      {r.type === 'scale' && (
        <>
          <Table
            title="Scale reliability"
            file="reliability-scale"
            columns={['Coefficient', 'Value', 'SEM']}
            rows={[
              [c('Cronbach’s α'), c(r.alpha ?? null), c(r.sem?.alpha ?? null)],
              [c('Standardised α'), c(r.stdAlpha ?? null), c(null)],
              [
                c('McDonald’s ω total (one factor)'),
                c(r.omegaTotal ?? null),
                c(r.sem?.omega ?? null),
              ],
              [c('Greatest lower bound (glb)'), c(r.glb ?? null), c(r.sem?.glb ?? null)],
              [c('Average inter-item correlation'), c(r.averageR ?? null), c(null)],
            ]}
            note={SCALE_NOTE + scaleSemNote(r)}
          />
          <Table
            title="Items"
            file="reliability-items"
            columns={['Item', 'Mean', 'SD', 'Item–rest correlation', 'α if dropped']}
            rows={(r.items ?? []).map(
              (x): Row => [c(x.item), c(x.mean), c(x.sd), c(x.itemRest), c(x.alphaIfDropped)],
            )}
            note="A negative item–rest correlation usually means the item needs reverse coding."
          />
          {r.bayes && <BayesReliabilityTable b={r.bayes} />}
        </>
      )}
      {r.type === 'icc' && (
        <Table
          title="Intraclass correlations (Shrout & Fleiss)"
          file="reliability-icc"
          columns={['Type', 'ICC', 'F', 'df1', 'df2', 'p', `${conf} CI`, 'SEM']}
          rows={(r.icc ?? []).map(
            (x): Row => [
              c(ICC_NAME[x.type] ?? x.type),
              c(x.icc),
              c(x.f),
              c(x.df1, undefined, 0),
              c(x.df2, undefined, 0),
              pCell(x.p),
              c(ci(x.ciLow, x.ciHigh)),
              c(x.sem ?? null),
            ],
          )}
          note={ICC_NOTE + iccSemNote(r)}
        />
      )}
      {r.type === 'kappa' && (
        <Table
          title={`Cohen’s kappa: ${r.vars.join(' and ')}`}
          file="reliability-kappa"
          columns={['Coefficient', 'Estimate', `${conf} CI`]}
          rows={[
            [c('Unweighted κ'), c(r.kappa!.est), c(ci(r.kappa!.ciLow, r.kappa!.ciHigh))],
            [
              c(`Weighted κ (${WEIGHT_NAME[r.weights ?? 'squared']})`),
              c(r.weighted!.est),
              c(ci(r.weighted!.ciLow, r.weighted!.ciHigh)),
            ],
          ]}
          note="Weighted κ treats the categories as ordered: a near miss counts as partial agreement. Interval limits beyond ±1 are set to ±1 (psych::cohen.kappa)."
        />
      )}
      {r.type === 'kappa' && r.table && r.levels && r.counts && (
        <Table
          title="Agreement table"
          file="reliability-kappa-table"
          columns={[`${r.vars[0]} \\ ${r.vars[1]}`, ...r.levels]}
          rows={r.levels.map((l, i): Row => [c(l), ...r.counts![i].map((x) => c(x))])}
          note={`Scaled to the ${fmt(r.n, 0)} subjects of the standard errors.`}
        />
      )}
      {r.type === 'blandaltman' && (
        <>
          <Table
            title={`Bland–Altman: ${r.vars[0]} − ${r.vars[1]}`}
            file="reliability-blandaltman"
            columns={['Statistic', 'Value', `${conf} CI`]}
            rows={[
              [c('Mean difference (bias)'), c(r.bias!), c(ci(r.biasCiLow, r.biasCiHigh))],
              [c('SD of the differences'), c(r.sd ?? null), c(null)],
              [c('Lower limit of agreement'), c(r.lower!), c(null)],
              [c('Upper limit of agreement'), c(r.upper!), c(null)],
            ]}
          />
          {r.points && <BlandAltman r={r} />}
        </>
      )}
      <AgreementTables r={r} />
    </div>
  );
}

const IRR_SOURCE = 'irr::kappam.fleiss, kripp.alpha and kendall (Gamer, Lemon, Fellows & Singh).';

/** Fleiss' kappa: overall (with Conger's exact kappa) and per category. */
function FleissTables({ r }: { r: ReliabilityResult }) {
  const f = r.fleiss!;
  return (
    <>
      <Table
        title={`Fleiss’ kappa: ${r.raters} raters, ${r.n} subjects`}
        file="reliability-fleiss"
        columns={['Coefficient', 'Estimate', 'z', 'p']}
        rows={[
          [c('Fleiss’ κ'), c(f.kappa), c(f.z), pCell(f.p)],
          [c('Conger’s exact κ'), c(f.exact), c(null), c(null)],
        ]}
        note={
          'Fleiss’ κ compares the agreement of the raters with that expected from the categories’ overall ' +
          'shares; the z test is of κ = 0. Conger’s (1980) exact κ uses each rater’s own shares and reduces ' +
          `to Cohen’s κ for two raters. Subjects with a missing rating are left out. ${IRR_SOURCE}`
        }
      />
      <Table
        title="Kappa of each category"
        file="reliability-fleiss-categories"
        columns={['Category', 'κ', 'z', 'p']}
        rows={(r.fleissCategories ?? []).map(
          (x): Row => [c(x.category), c(x.kappa), c(x.z), pCell(x.p)],
        )}
        note="The agreement on one category against all others (Fleiss 1971)."
      />
    </>
  );
}

/** Krippendorff's alpha with its bootstrap interval. */
function KrippTable({ r }: { r: ReliabilityResult }) {
  const k = r.kripp!;
  const boot = k.bootstrap > 0;
  const rows: Row[] = [[c('Krippendorff’s α'), c(k.alpha), c(boot ? ci(k.ciLow, k.ciHigh) : null)]];
  if (boot) {
    rows.push([c('Bootstrap share of α < .667'), c(k.below667 ?? null), c(null)]);
    rows.push([c('Bootstrap share of α < .800'), c(k.below800 ?? null), c(null)]);
  }
  const bootNote = boot
    ? ` The interval: ${k.bootstrap.toLocaleString('en')} bootstrap samples of the subjects, ` +
      `seed ${k.seed}, percentiles. Krippendorff suggests α ≥ .800, and α ≥ .667 for tentative conclusions.`
    : '';
  return (
    <Table
      title={`Krippendorff’s alpha (${k.level}): ${r.raters} raters, ${r.n} subjects`}
      file="reliability-kripp"
      columns={['Coefficient', 'Estimate', `${pct(r.confidence)} CI`]}
      rows={rows}
      note={
        `1 − observed / expected disagreement over ${fmt(k.pairable, 0)} pairable values; ` +
        `missing ratings are allowed.${bootNote} ${IRR_SOURCE}`
      }
    />
  );
}

/** Kendall's W, without and with the correction for ties. */
function KendallTable({ r }: { r: ReliabilityResult }) {
  return (
    <Table
      title={`Kendall’s W: ${r.raters} raters, ${r.n} subjects`}
      file="reliability-kendall"
      columns={['Coefficient', 'W', 'χ²', 'df', 'p']}
      rows={(r.kendall ?? []).map(
        (x): Row => [
          c(x.corrected ? 'W, corrected for ties' : 'W'),
          c(x.w),
          c(x.chisq),
          c(x.df, undefined, 0),
          pCell(x.p),
        ],
      )}
      note={
        'The concordance of the raters’ rankings of the subjects: 0 none, 1 complete. The χ² test is of ' +
        `W = 0. With tied ranks prefer the corrected W. ${IRR_SOURCE}`
      }
    />
  );
}

/** Gwet's AC1 or AC2 with irrCAC's standard error. */
function GwetTable({ r }: { r: ReliabilityResult }) {
  const g = r.gwet!;
  return (
    <Table
      title={`Gwet’s ${g.name} (${g.weights}): ${r.raters} raters, ${r.n} subjects`}
      file="reliability-gwet"
      columns={['Coefficient', 'Estimate', 'SE', `${pct(r.confidence)} CI`, 'p (one-sided)']}
      rows={[
        [c(`Gwet’s ${g.name}`), c(g.value), c(g.se), c(ci(g.ciLow, g.ciHigh)), pCell(g.p)],
        [c('Percent agreement'), c(g.pa), c(null), c(null), c(null)],
        [c('Chance agreement'), c(g.pe), c(null), c(null), c(null)],
      ]}
      note={
        'Gwet’s coefficient corrects the agreement for chance like κ, but its chance agreement stays small ' +
        'when one category dominates (κ’s paradox). SE: irrCAC’s, to five decimals; the interval is the ' +
        'coefficient ± t(n − 1) SE, at most 1; p tests AC > 0 (one-sided), as irrCAC does. ' +
        `${fmt(g.ratings, 0)} ratings; missing ratings are allowed. irrCAC::gwet.ac1.raw (Gwet 2014).`
      }
    />
  );
}

/** The tables of the several-rater agreement analyses. */
function AgreementTables({ r }: { r: ReliabilityResult }) {
  if (r.type === 'fleiss' && r.fleiss) return <FleissTables r={r} />;
  if (r.type === 'kripp' && r.kripp) return <KrippTable r={r} />;
  if (r.type === 'kendallw' && r.kendall) return <KendallTable r={r} />;
  if (r.type === 'gwet' && r.gwet) return <GwetTable r={r} />;
  return null;
}

/** The Bayesian options' part of the fingerprint (the seed too: the draws depend on it). */
const bayesParts = (o: ReliabilityOptions, seed: number): (string | number)[] => [
  'bayes',
  o.bayesGlb ? 'glb' : '',
  o.iterations ?? BAYESREL_ITERATIONS,
  seed,
];
/** Krippendorff's options' part of the fingerprint (the seed too, with a bootstrap). */
const krippParts = (o: ReliabilityOptions, seed: number): (string | number)[] => {
  const boot = o.bootstrap ?? KRIPP_BOOTSTRAP;
  return [o.krippLevel ?? 'nominal', boot, boot > 0 ? seed : ''];
};
/** The kappa options apply to kappa only (they stay in the options when the analysis changes, unused). */
const relCols = (o: ReliabilityOptions) =>
  o.type === 'kappa' && o.kappaTable
    ? [o.kappaTable.rows, o.kappaTable.columns, o.kappaTable.counts].filter(Boolean)
    : o.vars;
const kappaParts = (o: ReliabilityOptions): (string | number)[] => [
  ...(o.kappaTable
    ? [
        'table',
        o.kappaTable.rows,
        o.kappaTable.columns,
        o.kappaTable.counts,
        o.kappaTable.nObs ?? '',
      ]
    : []),
  ...(o.kappaWeights && o.kappaWeights !== 'squared'
    ? [o.kappaWeights, JSON.stringify(o.weightMatrix ?? [])]
    : []),
];
export const relInput = (
  o: ReliabilityOptions,
  ctx: Pick<AnalysisCtx, 'settings'>,
): ReliabilityInput => {
  const { kappaTable, kappaWeights, weightMatrix, ...rest } = o;
  const { bayes, bayesGlb, iterations, krippLevel, bootstrap, gwetWeights, ...plain } = rest;
  const kripp =
    o.type === 'kripp'
      ? {
          ...(krippLevel ? { krippLevel } : {}),
          bootstrap: bootstrap ?? KRIPP_BOOTSTRAP,
          seed: ctx.settings.seed,
        }
      : {};
  const bayesian =
    o.type === 'scale' && bayes
      ? {
          bayes,
          ...(bayesGlb ? { bayesGlb } : {}),
          iterations: iterations ?? BAYESREL_ITERATIONS,
          seed: ctx.settings.seed,
        }
      : {};
  return {
    ...plain,
    ...bayesian,
    ...kripp,
    ...(o.type === 'gwet' && gwetWeights ? { gwetWeights } : {}),
    confidence: ctx.settings.confidence,
    ...(o.type === 'kappa'
      ? {
          ...(kappaTable ? { kappaTable } : {}),
          ...(kappaWeights && kappaWeights !== 'squared' ? { kappaWeights } : {}),
          ...(kappaWeights === 'custom' ? { weightMatrix } : {}),
        }
      : {}),
  };
};
/** Krippendorff's options from a project file: only when set (the defaults leave nothing behind). */
function parseKrippOptions(raw: Record<string, unknown>): Partial<ReliabilityOptions> {
  const level = oneOf(raw.krippLevel, KRIPP_LEVELS, 'nominal');
  const out: Partial<ReliabilityOptions> = {};
  if (level !== 'nominal') out.krippLevel = level;
  const weights = oneOf(raw.gwetWeights, GWET_WEIGHTS, 'unweighted');
  if (weights !== 'unweighted') out.gwetWeights = weights;
  if (raw.bootstrap !== undefined) {
    out.bootstrap = clampStrict(raw.bootstrap, 0, 20000, KRIPP_BOOTSTRAP, true);
  }
  return out;
}

export const reliabilityAnalysis: AnalysisType<ReliabilityOptions, ReliabilityResult> = {
  id: 'reliability',
  title: 'Reliability and agreement',
  sub:
    'α, ω, glb (also Bayesian); ICC; Cohen’s and Fleiss’ kappa; Krippendorff’s α; Gwet’s AC1/AC2; ' +
    'Kendall’s W; Bland–Altman (psych, Bayesrel, irr, irrCAC)',
  group: 'Basic statistics',
  entries: [
    {
      title: 'Scale reliability',
      sub: 'Cronbach’s α, McDonald’s ω, greatest lower bound, item statistics; Bayesian credible intervals (Bayesrel)',
      options: (o) => ({ ...o, type: 'scale' }),
    },
    {
      title: 'Intraclass correlation',
      sub: 'agreement of raters on a continuous rating (Shrout & Fleiss)',
      options: (o) => ({ ...o, type: 'icc' }),
    },
    {
      title: 'Cohen’s kappa',
      sub: 'agreement of two raters on categories',
      options: (o) => ({ ...o, type: 'kappa' }),
    },
    {
      title: 'Bland–Altman',
      sub: 'agreement of two measurement methods',
      options: (o) => ({ ...o, type: 'blandaltman' }),
    },
    {
      title: 'Fleiss’ kappa',
      sub: 'agreement of several raters on categories, with Conger’s exact kappa (irr)',
      options: (o) => ({ ...o, type: 'fleiss' }),
    },
    {
      title: 'Krippendorff’s alpha',
      sub: 'agreement of several raters, nominal to ratio, missing ratings allowed; bootstrap interval (irr)',
      options: (o) => ({ ...o, type: 'kripp' }),
    },
    {
      title: 'Gwet’s AC1 / AC2',
      sub: 'chance-corrected agreement of several raters, robust to a dominant category; weighted for ordered categories (irrCAC)',
      options: (o) => ({ ...o, type: 'gwet' }),
    },
    {
      title: 'Kendall’s W',
      sub: 'concordance of several raters’ rankings, with the correction for ties (irr)',
      options: (o) => ({ ...o, type: 'kendallw' }),
    },
  ],
  cardTitle: (o) => REL_NAME[o.type],
  defaults: () => ({ type: 'scale', vars: [] }),
  // (the kappa fields only when set: earlier options, and their fingerprints, are unchanged)
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const kt = isObj(raw.kappaTable) ? raw.kappaTable : null;
    const n =
      kt && typeof kt.nObs === 'number' && Number.isFinite(kt.nObs) && kt.nObs >= 2
        ? kt.nObs
        : null;
    const w = oneOf(raw.kappaWeights, ['squared', 'linear', 'custom'] as const, 'squared');
    const m = Array.isArray(raw.weightMatrix)
      ? raw.weightMatrix
          .slice(0, 20)
          .filter(Array.isArray)
          .map((r) => r.slice(0, 20).map((x) => (typeof x === 'number' ? x : NaN)))
      : [];
    return {
      type: oneOf(raw.type, RELIABILITY_TYPES, 'scale'),
      vars: names(raw.vars),
      ...(kt
        ? {
            kappaTable: {
              rows: name(kt.rows),
              columns: name(kt.columns),
              counts: name(kt.counts),
              ...(n !== null ? { nObs: n } : {}),
            },
          }
        : {}),
      ...(w !== 'squared' ? { kappaWeights: w } : {}),
      ...(w === 'custom' ? { weightMatrix: m } : {}),
      ...(raw.bayes === true ? { bayes: true as const } : {}),
      ...(raw.bayesGlb === true ? { bayesGlb: true as const } : {}),
      ...(raw.iterations !== undefined
        ? { iterations: clampStrict(raw.iterations, 100, 20000, BAYESREL_ITERATIONS, true) }
        : {}),
      ...parseKrippOptions(raw),
    };
  },
  Options: ReliabilityForm,
  View: ({ result }) => <ReliabilityView r={result} />,
  blocked: (o, ctx) => {
    if (o.type === 'kappa' && o.kappaWeights === 'custom' && !squareMatrix(o.weightMatrix ?? []))
      return 'Type the weights as a square matrix of numbers: one line per category, at least two.';
    if (o.type === 'kappa' && o.kappaTable) {
      const t = o.kappaTable;
      if (!t.rows || !t.columns)
        return 'Choose the two raters’ variables (rows and columns of the table).';
      if (t.rows === t.columns) return 'Choose two different variables for the two raters.';
      return missingColumns(ctx, relCols(o), REL_NAME.kappa);
    }
    if ((o.type === 'kappa' || o.type === 'blandaltman') && o.vars.length !== 2)
      return 'Choose exactly two variables.';
    if (o.vars.length < 2) return 'Choose at least two variables.';
    const boot = o.bootstrap ?? KRIPP_BOOTSTRAP;
    if (o.type === 'kripp' && boot > 0 && boot < 100)
      return 'Use 0 bootstrap samples (no interval) or at least 100.';
    if (o.type === 'scale' && o.bayes && o.vars.length < 3)
      return 'Bayesian reliability needs at least three items.';
    return missingColumns(ctx, o.vars, REL_NAME[o.type]);
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, relCols(o), [
      o.type,
      ctx.settings.confidence,
      ...(o.type === 'kappa' ? kappaParts(o) : []),
      ...(o.type === 'scale' && o.bayes ? bayesParts(o, ctx.settings.seed) : []),
      ...(o.type === 'kripp' ? krippParts(o, ctx.settings.seed) : []),
      ...(o.type === 'gwet' ? [o.gwetWeights ?? 'unweighted'] : []),
    ]),
  run: async (o, ctx) => (await engine()).reliabilityR(rawData(ctx)!, relInput(o, ctx)),
  script: async (o, ctx) => (await engine()).reliabilityScriptR(rawData(ctx)!, relInput(o, ctx)),
  summary: (o) =>
    `${REL_NAME[o.type].toLowerCase()} · ${o.type === 'kappa' && o.kappaTable ? `table ${o.kappaTable.rows || '…'} × ${o.kappaTable.columns || '…'}` : o.vars.join(', ') || '…'}`,
};

export const BASIC_TEST_TYPES = [
  ttestAnalysis,
  anovaAnalysis,
  rmAnovaAnalysis,
  manovaAnalysis,
  correlationAnalysis,
  contingencyAnalysis,
  freqTestAnalysis,
  reliabilityAnalysis,
];
