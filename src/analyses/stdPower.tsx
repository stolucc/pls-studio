// Power for standard tests (pwr, Champely; Cohen 1988): t-tests (one sample, two independent samples, paired),
// one-way ANOVA, one and two proportions, a correlation, a chi-square test and multiple regression (f²). Each
// solves for the N (a priori), the power at an N (achieved) or the smallest detectable effect (sensitivity), with
// the power curve over N at the effect.

import { ChartFrame } from '../components/ChartFrame';
import { c, Table, type Row } from '../components/results/Table';
import { OTHER_COLOR, POSITIVE_COLOR } from '../figure/palette';
import { fmt } from '../format';
import type { PwrAlternative, PwrInput, PwrResult, PwrSolve, PwrTest } from '../rengine/pwr';
import { Axes, H, pad, W } from './charts';
import { fingerprint } from './codec';
import { Choice, clampNum, isObj, NumField, oneOf } from './common';
import type { AnalysisType, OptionsProps } from './types';

export interface StdPowerOptions {
  test: PwrTest;
  solve: PwrSolve;
  alternative: PwrAlternative;
  alpha: number;
  power: number;
  /** N: per group (two samples, ANOVA, two proportions), pairs (paired), or the total. */
  n: number;
  effect: number;
  /** Proportions: Cohen's h as entered, or from the two proportions under H1. */
  effectFrom: 'es' | 'props';
  prop1: number;
  prop2: number;
  k: number;
  df: number;
  u: number;
}

interface TestInfo {
  label: string;
  /** The effect size's symbol and name, and Cohen's small / medium / large values. */
  es: string;
  esName: string;
  conventions: [number, number, number];
  /** What N counts. */
  nName: string;
  fn: string;
  sided: boolean;
  defaultEffect: number;
}

/** The tests, their effect sizes and what N means for each. */
export const PWR_TESTS: Record<PwrTest, TestInfo> = {
  t1: {
    label: 't-test, one sample',
    es: 'd',
    esName: 'Cohen’s d: (μ − μ₀) / σ',
    conventions: [0.2, 0.5, 0.8],
    nName: 'N',
    fn: 'pwr.t.test (one.sample)',
    sided: true,
    defaultEffect: 0.5,
  },
  t2: {
    label: 't-test, two independent samples',
    es: 'd',
    esName: 'Cohen’s d: (μ₁ − μ₂) / σ',
    conventions: [0.2, 0.5, 0.8],
    nName: 'N per group',
    fn: 'pwr.t.test (two.sample)',
    sided: true,
    defaultEffect: 0.5,
  },
  paired: {
    label: 't-test, paired',
    es: 'd',
    esName: 'Cohen’s d of the differences: μ_d / σ_d',
    conventions: [0.2, 0.5, 0.8],
    nName: 'Pairs',
    fn: 'pwr.t.test (paired)',
    sided: true,
    defaultEffect: 0.5,
  },
  anova: {
    label: 'One-way ANOVA',
    es: 'f',
    esName: 'Cohen’s f: σ_means / σ',
    conventions: [0.1, 0.25, 0.4],
    nName: 'N per group',
    fn: 'pwr.anova.test',
    sided: false,
    defaultEffect: 0.25,
  },
  p1: {
    label: 'One proportion',
    es: 'h',
    esName: 'Cohen’s h: 2 asin √p₁ − 2 asin √p₀',
    conventions: [0.2, 0.5, 0.8],
    nName: 'N',
    fn: 'pwr.p.test',
    sided: true,
    defaultEffect: 0.5,
  },
  p2: {
    label: 'Two proportions',
    es: 'h',
    esName: 'Cohen’s h: 2 asin √p₁ − 2 asin √p₂',
    conventions: [0.2, 0.5, 0.8],
    nName: 'N per group',
    fn: 'pwr.2p.test',
    sided: true,
    defaultEffect: 0.5,
  },
  r: {
    label: 'Correlation',
    es: 'r',
    esName: 'Pearson’s r under H1',
    conventions: [0.1, 0.3, 0.5],
    nName: 'N',
    fn: 'pwr.r.test',
    sided: true,
    defaultEffect: 0.3,
  },
  chisq: {
    label: 'Chi-square test',
    es: 'w',
    esName: 'Cohen’s w: √Σ (p₁ − p₀)² / p₀',
    conventions: [0.1, 0.3, 0.5],
    nName: 'N',
    fn: 'pwr.chisq.test',
    sided: false,
    defaultEffect: 0.3,
  },
  f2: {
    label: 'Multiple regression (F test)',
    es: 'f²',
    esName: 'Cohen’s f²: R² / (1 − R²), or ΔR² / (1 − R²_full)',
    conventions: [0.02, 0.15, 0.35],
    nName: 'N',
    fn: 'pwr.f2.test',
    sided: false,
    defaultEffect: 0.15,
  },
};
/** The card's tests, in menu order (its statistically distinct modes). */
export const TEST_IDS = Object.keys(PWR_TESTS) as PwrTest[];
const SOLVES: [PwrSolve, string][] = [
  ['n', 'A priori (N)'],
  ['power', 'Achieved power'],
  ['effect', 'Sensitivity (effect)'],
];
const ALTERNATIVES: [PwrAlternative, string][] = [
  ['two.sided', 'Two-sided'],
  ['greater', 'Greater'],
  ['less', 'Less'],
];

/** The smallest N each test accepts (pwr's own checks). */
function minN(o: Pick<StdPowerOptions, 'test' | 'u'>): number {
  if (o.test === 'r') return 4;
  if (o.test === 'chisq') return 1;
  if (o.test === 'f2') return o.u + 2;
  return 2;
}

/** The bridge's input: only the quantities the test uses, the solved one left out. */
export function stdPowerInput(o: StdPowerOptions): PwrInput {
  const t = PWR_TESTS[o.test];
  const props = (o.test === 'p1' || o.test === 'p2') && o.effectFrom === 'props';
  const input: PwrInput = { test: o.test, solve: o.solve, alpha: o.alpha };
  if (t.sided) input.alternative = o.alternative;
  if (o.solve !== 'effect') {
    if (props) {
      input.effectFrom = 'props';
      input.prop1 = o.prop1;
      input.prop2 = o.prop2;
    } else {
      input.effect = o.effect;
    }
  }
  if (o.solve !== 'n') input.n = o.n;
  if (o.solve !== 'power') input.power = o.power;
  if (o.test === 'anova') input.k = o.k;
  if (o.test === 'chisq') input.df = o.df;
  if (o.test === 'f2') input.u = o.u;
  return input;
}

function StdPowerForm({ options: o, set, disabled }: OptionsProps<StdPowerOptions>) {
  const t = PWR_TESTS[o.test];
  const s = (p: Partial<StdPowerOptions>) => set({ ...o, ...p });
  const isProp = o.test === 'p1' || o.test === 'p2';
  const [small, medium, large] = t.conventions;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Power analysis for standard tests by pwr (Champely; Cohen 1988): give all but one of N,
        power and effect size, and the card solves for the one left out.
      </p>
      <div className="field">
        <label htmlFor="pwr-test">Test</label>
        <select
          id="pwr-test"
          className="select"
          value={o.test}
          onChange={(e) => {
            const test = e.target.value as PwrTest;
            s({ test, effect: PWR_TESTS[test].defaultEffect });
          }}
        >
          {TEST_IDS.map((id) => (
            <option key={id} value={id}>
              {PWR_TESTS[id].label}
            </option>
          ))}
        </select>
      </div>
      <Choice
        label="Solve for"
        value={o.solve}
        options={SOLVES}
        onChange={(solve) => s({ solve })}
      />
      {t.sided && (
        <Choice
          label="Alternative"
          value={o.alternative}
          options={ALTERNATIVES}
          onChange={(alternative) => s({ alternative })}
        />
      )}
      {o.solve !== 'effect' && isProp && (
        <Choice
          label="Effect size from"
          value={o.effectFrom}
          options={[
            ['es', 'Cohen’s h'],
            ['props', 'Two proportions'],
          ]}
          onChange={(effectFrom) => s({ effectFrom })}
        />
      )}
      <div className="row2">
        {o.solve !== 'effect' && isProp && o.effectFrom === 'props' && (
          <>
            <NumField
              label={o.test === 'p1' ? 'Proportion under H1' : 'Proportion, group 1'}
              value={o.prop1}
              lo={0.000001}
              hi={0.999999}
              step={0.05}
              fallback={0.5}
              onChange={(prop1) => s({ prop1 })}
            />
            <NumField
              label={o.test === 'p1' ? 'Proportion under H0' : 'Proportion, group 2'}
              value={o.prop2}
              lo={0.000001}
              hi={0.999999}
              step={0.05}
              fallback={0.4}
              onChange={(prop2) => s({ prop2 })}
            />
          </>
        )}
        {o.solve !== 'effect' && !(isProp && o.effectFrom === 'props') && (
          <NumField
            label={`Effect size (${t.es})`}
            value={o.effect}
            lo={o.test === 'r' ? -0.999 : -100}
            hi={o.test === 'r' ? 0.999 : 100}
            step={0.05}
            fallback={t.defaultEffect}
            onChange={(effect) => s({ effect })}
          />
        )}
        {o.solve !== 'n' && (
          <NumField
            label={t.nName}
            value={o.n}
            lo={minN(o)}
            hi={1e8}
            step={1}
            fallback={50}
            onChange={(n) => s({ n })}
          />
        )}
        {o.solve !== 'power' && (
          <NumField
            label="Power"
            value={o.power}
            lo={0.01}
            hi={0.9999}
            step={0.05}
            fallback={0.8}
            onChange={(power) => s({ power })}
          />
        )}
        <NumField
          label="α"
          value={o.alpha}
          lo={0.0001}
          hi={0.5}
          step={0.01}
          fallback={0.05}
          onChange={(alpha) => s({ alpha })}
        />
        {o.test === 'anova' && (
          <NumField
            label="Groups (k)"
            value={o.k}
            lo={2}
            hi={1000}
            step={1}
            int
            fallback={3}
            onChange={(k) => s({ k: Math.round(k) })}
          />
        )}
        {o.test === 'chisq' && (
          <NumField
            label="df"
            value={o.df}
            lo={1}
            hi={100000}
            step={1}
            int
            fallback={1}
            onChange={(df) => s({ df: Math.round(df) })}
          />
        )}
        {o.test === 'f2' && (
          <NumField
            label="Predictors tested (u)"
            value={o.u}
            lo={1}
            hi={1000}
            step={1}
            int
            fallback={1}
            onChange={(u) => s({ u: Math.round(u) })}
          />
        )}
      </div>
      <div className="hint">
        {t.esName}. Cohen’s conventions: small {small}, medium {medium}, large {large}.
        {o.test === 'f2' &&
          ' N is the total; u the numerator df (the predictors tested), so the error df is N − u − 1.'}
        {o.test === 'chisq' &&
          ' df: (rows − 1)(columns − 1) for a contingency table, categories − 1 for goodness of fit.'}
      </div>
    </fieldset>
  );
}

function StdPowerCurve({ r }: { r: PwrResult }) {
  const cv = r.curve;
  const t = PWR_TESTS[r.test];
  const xs: [number, number] = [cv.n[0], cv.n[cv.n.length - 1]];
  const sx = (v: number) => pad.l + ((v - xs[0]) / (xs[1] - xs[0] || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const line = cv.n
    .map((n, i) => `${i ? 'L' : 'M'}${sx(n).toFixed(1)},${sy(cv.power[i]).toFixed(1)}`)
    .join(' ');
  const showDot = r.n >= xs[0] && r.n <= xs[1];
  return (
    <ChartFrame
      id={`pwr:curve:${r.test}`}
      name="power-curve"
      width={W}
      height={H}
      defaults={{ x: t.nName, y: 'Power' }}
      caption={
        <span className="hint">
          The power of the {t.label.toLowerCase()} at each N ({t.es} = {fmt(r.effect, 3)}, α ={' '}
          {fmt(r.alpha, 3)}); dashed: power .80; the dot: N = {fmt(r.n, 1)}, power {fmt(r.power, 3)}
          .
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={W}
          height={H}
          role="img"
          aria-label="Power curve"
        >
          <Axes
            xs={xs}
            ys={[0, 1]}
            xTitle={labels.x}
            yTitle={labels.y}
            xTick={(v) => v.toFixed(0)}
          />
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={sy(0.8)}
            y2={sy(0.8)}
            stroke={OTHER_COLOR}
            strokeDasharray="4 3"
          />
          <path d={line} fill="none" stroke={POSITIVE_COLOR} strokeWidth={2} />
          {showDot && (
            <circle cx={sx(r.n)} cy={sy(r.power)} r={4} fill={POSITIVE_COLOR}>
              <title>{`N = ${fmt(r.n, 1)}: power ${fmt(r.power, 3)}`}</title>
            </circle>
          )}
        </svg>
      )}
    </ChartFrame>
  );
}

/** The heading of the result: the solved quantity. */
function stdPowerHead(r: PwrResult): string {
  const t = PWR_TESTS[r.test];
  if (r.solve === 'n') return `${t.nName} needed: ${r.nNeeded} (power ${fmt(r.power, 3)})`;
  if (r.solve === 'power') return `Power at ${t.nName} = ${fmt(r.n, 0)}: ${fmt(r.power, 3)}`;
  return `Smallest detectable ${t.es}: ${fmt(r.effect, 3)} at ${t.nName} = ${fmt(r.n, 0)}`;
}

const ALTERNATIVE_NAME: Record<PwrAlternative, string> = {
  'two.sided': 'two-sided',
  greater: 'greater (one-sided)',
  less: 'less (one-sided)',
};

function StdPowerView({ r }: { r: PwrResult }) {
  const t = PWR_TESTS[r.test];
  const rows: Row[] = [
    [c('Test'), c(t.label)],
    [c(`Effect size (${t.es})`), c(r.effect, undefined, 4)],
    [
      c(r.solve === 'n' ? `${t.nName} (exact)` : t.nName),
      c(r.n, undefined, r.solve === 'n' ? 3 : 0),
    ],
  ];
  if (r.solve === 'n') rows.push([c(`${t.nName} needed (rounded up)`), c(r.nNeeded, undefined, 0)]);
  if (r.test === 't2' || r.test === 'p2' || r.test === 'anova') {
    const groups = r.test === 'anova' ? (r.k ?? 0) : 2;
    rows.push([c('Total N'), c(r.nNeeded * groups, undefined, 0)]);
  }
  if (r.k !== undefined) rows.push([c('Groups (k)'), c(r.k, undefined, 0)]);
  if (r.df !== undefined) rows.push([c('df'), c(r.df, undefined, 0)]);
  if (r.u !== undefined) rows.push([c('Numerator df (u)'), c(r.u, undefined, 0)]);
  if (r.v !== undefined) rows.push([c('Error df (v)'), c(r.v, undefined, 2)]);
  rows.push([c('α'), c(r.alpha, undefined, 4)]);
  rows.push([c('Power'), c(r.power, undefined, 4)]);
  if (t.sided) rows.push([c('Alternative'), c(ALTERNATIVE_NAME[r.alternative])]);
  const where = r.engine.desktop ? ` in desktop ${r.engine.desktop}` : '';
  const note =
    `${r.method} (pwr::${t.fn}; Cohen 1988)${r.note ? `: ${r.note}` : ''}. ` +
    `pwr ${r.engine.version}${where}.`;
  return (
    <div className="tables">
      <Table
        title={stdPowerHead(r)}
        file={`power-${r.test}`}
        columns={['', 'Value']}
        rows={rows}
        note={note}
      />
      {r.curve.n.length > 1 && <StdPowerCurve r={r} />}
    </div>
  );
}

const DEFAULTS: StdPowerOptions = {
  test: 't2',
  solve: 'n',
  alternative: 'two.sided',
  alpha: 0.05,
  power: 0.8,
  n: 50,
  effect: 0.5,
  effectFrom: 'es',
  prop1: 0.5,
  prop2: 0.4,
  k: 3,
  df: 1,
  u: 1,
};

/** The card's options from a project file (every field checked and clamped). */
export function parseStdPowerOptions(raw: unknown): StdPowerOptions | null {
  if (!isObj(raw)) return null;
  const test = oneOf(raw.test, TEST_IDS, 't2');
  const u = Math.round(clampNum(raw.u, 1, 1000, 1));
  const lo = minN({ test, u });
  const rLimit = test === 'r' ? 0.999 : 100;
  return {
    test,
    solve: oneOf(
      raw.solve,
      SOLVES.map(([id]) => id),
      'n',
    ),
    alternative: oneOf(
      raw.alternative,
      ALTERNATIVES.map(([id]) => id),
      'two.sided',
    ),
    alpha: clampNum(raw.alpha, 0.0001, 0.5, 0.05),
    power: clampNum(raw.power, 0.01, 0.9999, 0.8),
    n: clampNum(raw.n, lo, 1e8, Math.max(lo, 50)),
    effect: clampNum(raw.effect, -rLimit, rLimit, PWR_TESTS[test].defaultEffect),
    effectFrom: oneOf(raw.effectFrom, ['es', 'props'] as const, 'es'),
    prop1: clampNum(raw.prop1, 0.000001, 0.999999, 0.5),
    prop2: clampNum(raw.prop2, 0.000001, 0.999999, 0.4),
    k: Math.round(clampNum(raw.k, 2, 1000, 3)),
    df: Math.round(clampNum(raw.df, 1, 100000, 1)),
    u,
  };
}

export const stdPowerAnalysis: AnalysisType<StdPowerOptions, PwrResult> = {
  id: 'pwr',
  title: 'Power (standard tests)',
  group: 'Basic statistics',
  sub: 'a priori N, achieved power or sensitivity for t-tests, one-way ANOVA, proportions, correlation, chi-square and regression (pwr)',
  defaults: () => ({ ...DEFAULTS }),
  parseOptions: parseStdPowerOptions,
  Options: StdPowerForm,
  View: ({ result }) => <StdPowerView r={result} />,
  blocked: (o) => {
    const props = (o.test === 'p1' || o.test === 'p2') && o.effectFrom === 'props';
    if (o.solve !== 'effect' && props && o.prop1 === o.prop2)
      return 'The two proportions are equal: there is no effect to detect.';
    if (o.solve !== 'effect' && !props && o.effect === 0)
      return 'The effect size must not be zero.';
    return null;
  },
  fingerprint: () => fingerprint(['pwr']),
  run: async (o) => (await import('../rengine/pwr')).pwrR(stdPowerInput(o)),
  script: async (o) => (await import('../rengine/pwr')).pwrScriptR(stdPowerInput(o)),
  summary: (o) => {
    const t = PWR_TESTS[o.test];
    const solve = SOLVES.find(([id]) => id === o.solve)![1];
    return `${t.label} · ${solve}`;
  },
};
