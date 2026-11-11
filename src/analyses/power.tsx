// Analytic power analysis (semPower, Moshagen & Bader): the N a test of model fit needs (a priori), its power at an
// N (post hoc) and the critical χ² that balances α and β (compromise), for misfit given as an RMSEA, F0, Mc, GFI or
// AGFI on the model's df or any df; the power to detect one parameter of the CB-SEM model on the canvas (the model as
// fitted is the population, H0 fixes the parameter); and the RMSEA equivalence test (Yuan et al. 2016: the T-size
// RMSEA against cutoffs adjusted for df and N).

import { ChartFrame } from '../components/ChartFrame';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { POSITIVE_COLOR, OTHER_COLOR } from '../figure/palette';
import { fmt } from '../format';
import type {
  EffectMeasure,
  PowerAnalysis,
  PowerInput,
  PowerParam,
  PowerResult,
} from '../rengine/power';
import { Axes, H, pad, W } from './charts';
import { fingerprint } from './codec';
import { cbCall, cbFingerprint, cbModelBlocked } from './cbModel';
import { Choice, clampNum, isObj, name, NumField, oneOf } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export interface PowerOptions {
  analysis: PowerAnalysis;
  measure: EffectMeasure;
  effect: number;
  /** The df of the test of fit: the canvas model's (its CB-SEM results) or as entered. */
  dfSource: 'model' | 'manual';
  df: number;
  p: number;
  alpha: number;
  power: number;
  n: number;
  abratio: number;
  /** A parameter: lavaan's lhs op rhs by app names; H0's value; a priori (N) or post hoc (power at n). */
  param: Omit<PowerParam, 'value'> | null;
  value: number;
  paramType: 'apriori' | 'posthoc';
  /** The equivalence test: the canvas model's fit or χ², df and N as entered. */
  equivSource: 'model' | 'manual';
  chisq: number;
  edf: number;
  en: number;
}

const ANALYSES: [PowerAnalysis, string][] = [
  ['apriori', 'A priori (N)'],
  ['posthoc', 'Post hoc (power)'],
  ['compromise', 'Compromise'],
  ['parameter', 'A parameter'],
  ['equivalence', 'RMSEA equivalence test'],
];
const MEASURES: EffectMeasure[] = ['RMSEA', 'F0', 'Mc', 'GFI', 'AGFI'];
const MEASURE_DEFAULT: Record<EffectMeasure, number> = {
  RMSEA: 0.05,
  F0: 0.1,
  Mc: 0.9,
  GFI: 0.95,
  AGFI: 0.95,
};
const OPS = ['=~', '~', '~~'] as const;
const misfit = (a: PowerAnalysis) => a === 'apriori' || a === 'posthoc' || a === 'compromise';
const usesModel = (o: PowerOptions) =>
  o.analysis === 'parameter' ||
  (o.analysis === 'equivalence' && o.equivSource === 'model') ||
  (misfit(o.analysis) && o.dfSource === 'model');
const modelVars = (ctx: AnalysisCtx) =>
  new Set((ctx.model?.constructs ?? []).flatMap((k) => k.indicators)).size;
const paramName = (p: Omit<PowerParam, 'value'>) => `${p.lhs} ${p.op} ${p.rhs}`;

/** The model's free parameters a test can fix (loadings, regressions, covariances and variances), from its CB-SEM results. */
export function powerParams(ctx: AnalysisCtx): Omit<PowerParam, 'value'>[] {
  return (ctx.cb?.estimates ?? [])
    .filter((e) => e.se !== null && (OPS as readonly string[]).includes(e.op) && !e.label)
    .map((e) => ({ lhs: e.lhs, op: e.op as PowerParam['op'], rhs: e.rhs }));
}

/** The bridge's input for these options (the df and p of the canvas model when chosen). */
export function powerInput(o: PowerOptions, ctx: AnalysisCtx): PowerInput {
  if (misfit(o.analysis)) {
    const df = o.dfSource === 'model' ? ctx.cb?.fit.df : o.df;
    if (!df || df < 1)
      throw new Error(
        o.dfSource === 'model'
          ? 'The CB-SEM model has no degrees of freedom to test: enter the df instead.'
          : 'Enter the degrees of freedom.',
      );
    return {
      analysis: o.analysis,
      alpha: o.alpha,
      measure: o.measure,
      effect: o.effect,
      df,
      ...(o.measure === 'GFI' || o.measure === 'AGFI'
        ? { p: o.dfSource === 'model' ? modelVars(ctx) : o.p }
        : {}),
      ...(o.analysis === 'apriori' ? { power: o.power } : { n: o.n }),
      ...(o.analysis === 'compromise' ? { abratio: o.abratio } : {}),
    };
  }
  if (o.analysis === 'parameter')
    return {
      analysis: 'parameter',
      alpha: o.alpha,
      type: o.paramType,
      param: { ...o.param!, value: o.value },
      ...(o.paramType === 'apriori' ? { power: o.power } : { n: o.n }),
    };
  return o.equivSource === 'model'
    ? { analysis: 'equivalence', alpha: 0.05, source: 'model' }
    : {
        analysis: 'equivalence',
        alpha: 0.05,
        source: 'manual',
        chisq: o.chisq,
        df: o.edf,
        n: o.en,
      };
}

const num = (
  label: string,
  value: number,
  lo: number,
  hi: number,
  onChange: (v: number) => void,
  step = 1,
  fallback = value,
) => (
  <NumField
    label={label}
    value={value}
    lo={lo}
    hi={hi}
    step={step}
    fallback={fallback}
    onChange={onChange}
  />
);

function PowerForm({ options: o, set, ctx, disabled }: OptionsProps<PowerOptions>) {
  const params = powerParams(ctx);
  const choices =
    o.param && !params.some((p) => paramName(p) === paramName(o.param!))
      ? [o.param, ...params]
      : params;
  const s = (p: Partial<PowerOptions>) => set({ ...o, ...p });
  const modelDfHint = () => {
    const df = ctx.cb ? ` (${ctx.cb.fit.df})` : ' (calculated when you run)';
    // GFI and AGFI also depend on the number of observed variables.
    const vars =
      o.measure === 'GFI' || o.measure === 'AGFI'
        ? `, and its ${modelVars(ctx)} observed variables`
        : '';
    return `The df of the CB-SEM model on the canvas${df}${vars}.`;
  };
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Analytic power analysis by semPower (Moshagen &amp; Bader): for a test of model fit against
        misfit of a given size, or for one parameter of the CB-SEM model on the canvas; and the
        RMSEA equivalence test of the model’s fit.
      </p>
      <Choice
        label="Analysis"
        value={o.analysis}
        options={ANALYSES}
        onChange={(analysis) => s({ analysis })}
      />
      {misfit(o.analysis) && (
        <>
          <div className="row2">
            <div className="field">
              <label htmlFor="pw-m">Misfit as</label>
              <select
                id="pw-m"
                className="select"
                value={o.measure}
                onChange={(e) => {
                  const measure = e.target.value as EffectMeasure;
                  s({ measure, effect: MEASURE_DEFAULT[measure] });
                }}
              >
                {MEASURES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            {num(
              o.measure === 'RMSEA' ? 'RMSEA under H1' : `${o.measure} under H1`,
              o.effect,
              0.0001,
              o.measure === 'F0' ? 100 : 0.9999,
              (effect) => s({ effect }),
              0.01,
              MEASURE_DEFAULT[o.measure],
            )}
          </div>
          <Choice
            label="Degrees of freedom"
            value={o.dfSource}
            options={[
              ['model', 'The canvas model’s'],
              ['manual', 'Enter'],
            ]}
            onChange={(dfSource) => s({ dfSource })}
            hint={o.dfSource === 'model' ? modelDfHint() : undefined}
          />
          {o.dfSource === 'manual' && (
            <div className="row2">
              {num('df', o.df, 1, 1e6, (df) => s({ df: Math.round(df) }))}
              {(o.measure === 'GFI' || o.measure === 'AGFI') &&
                num('Observed variables (p)', o.p, 1, 10000, (p) => s({ p: Math.round(p) }))}
            </div>
          )}
        </>
      )}
      {o.analysis === 'parameter' && (
        <>
          <div className="field">
            <label htmlFor="pw-par">Parameter</label>
            <select
              id="pw-par"
              className="select"
              value={o.param ? paramName(o.param) : ''}
              onChange={(e) =>
                s({ param: choices.find((p) => paramName(p) === e.target.value) ?? null })
              }
            >
              <option value="">
                {choices.length ? 'Choose…' : 'Calculate the CB-SEM model first'}
              </option>
              {choices.map((p) => (
                <option key={paramName(p)} value={paramName(p)}>
                  {paramName(p)}
                </option>
              ))}
            </select>
            <div className="hint">
              The model as fitted is the population; H0 fixes this parameter. The likelihood-ratio
              test (df = 1) as semPower.powerLav computes it. ML, one group, continuous indicators.
            </div>
          </div>
          <div className="row2">
            {num('Value under H0', o.value, -1e6, 1e6, (value) => s({ value }), 0.1, 0)}
          </div>
          <Choice
            label="Find"
            value={o.paramType}
            options={[
              ['apriori', 'The N needed'],
              ['posthoc', 'The power at N'],
            ]}
            onChange={(paramType) => s({ paramType })}
          />
        </>
      )}
      {o.analysis === 'equivalence' && (
        <>
          <Choice
            label="Fit"
            value={o.equivSource}
            options={[
              ['model', 'The canvas model’s'],
              ['manual', 'Enter χ², df, N'],
            ]}
            onChange={(equivSource) => s({ equivSource })}
            hint="Yuan, Chan, Marcoulides & Bentler (2016): the T-size RMSEA, the smallest misfit the data can rule out at α = .05, against cutoffs adjusted for df and N (McNeish & Wolf’s dynamic::equivTest uses the same). Neither semPower nor semTools provides it; computed from the formulas."
          />
          {o.equivSource === 'manual' && (
            <div className="row2">
              {num('χ²', o.chisq, 0, 1e9, (chisq) => s({ chisq }), 0.1, 0)}
              {num('df ', o.edf, 1, 1e6, (edf) => s({ edf: Math.round(edf) }))}
              {num('N ', o.en, 2, 1e8, (en) => s({ en: Math.round(en) }))}
            </div>
          )}
        </>
      )}
      {o.analysis !== 'equivalence' && (
        <div className="row2">
          {o.analysis !== 'compromise' &&
            num('α', o.alpha, 0.0001, 0.5, (alpha) => s({ alpha }), 0.01, 0.05)}
          {(o.analysis === 'apriori' ||
            (o.analysis === 'parameter' && o.paramType === 'apriori')) &&
            num('Power', o.power, 0.01, 0.9999, (power) => s({ power }), 0.05, 0.8)}
          {(o.analysis === 'posthoc' ||
            o.analysis === 'compromise' ||
            (o.analysis === 'parameter' && o.paramType === 'posthoc')) &&
            num('N', o.n, 2, 1e8, (n) => s({ n: Math.round(n) }), 10, 250)}
          {o.analysis === 'compromise' &&
            num('α / β', o.abratio, 0.0001, 10000, (abratio) => s({ abratio }), 0.5, 1)}
        </div>
      )}
    </fieldset>
  );
}

function PowerCurve({ r, title }: { r: PowerResult; title: string }) {
  const cv = r.curve!;
  const xs: [number, number] = [cv.n[0], cv.n[cv.n.length - 1]];
  const sx = (v: number) => pad.l + ((v - xs[0]) / (xs[1] - xs[0] || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const line = cv.n
    .map((n, i) => `${i ? 'L' : 'M'}${sx(n).toFixed(1)},${sy(cv.power[i]).toFixed(1)}`)
    .join(' ');
  const at = r.n;
  return (
    <ChartFrame
      id={`power:curve:${r.analysis}`}
      name="power-curve"
      width={W}
      height={H}
      defaults={{ x: 'N', y: 'Power' }}
      caption={
        <span className="hint">
          {title}: the power of the χ² test at each N (α = {fmt(r.alpha ?? 0.05, 3)}, df = {r.df},
          F0 = {fmt(r.fmin ?? 0, 4)}); the dot: N = {at}, power {fmt(r.power ?? 0, 3)}.
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
          {at !== undefined && r.power !== undefined && at >= xs[0] && at <= xs[1] && (
            <circle cx={sx(at)} cy={sy(r.power)} r={4} fill={POSITIVE_COLOR}>
              <title>{`N = ${at}: power ${fmt(r.power, 3)}`}</title>
            </circle>
          )}
        </svg>
      )}
    </ChartFrame>
  );
}

const BANDS = ['Excellent', 'Close', 'Fair', 'Mediocre', 'Poor'];
const CONVENTIONAL = ['≤ .01', '.01 – .05', '.05 – .08', '.08 – .10', '> .10'];

function PowerView({ r, o }: { r: PowerResult; o: PowerOptions }) {
  const eng = `semPower ${r.engine.version}${r.engine.desktop ? ` in desktop ${r.engine.desktop}` : ''}.`;
  if (r.analysis === 'equivalence') {
    const cut = r.cutoffs ?? [];
    // The RMSEA range of the i-th band: up to the first cutoff, between two, or beyond the last.
    const range = (i: number) => {
      if (i === 0) return `≤ ${fmt(cut[0], 3)}`;
      if (i === 4) return `> ${fmt(cut[3], 3)}`;
      return `${fmt(cut[i - 1], 3)} – ${fmt(cut[i], 3)}`;
    };
    let verdictClass = 'warn';
    if (r.verdict === 'excellent' || r.verdict === 'close') verdictClass = 'good';
    else if (r.verdict === 'poor') verdictClass = 'bad';
    const bands: Row[] = BANDS.map((b, i) => [
      c(b, r.verdict === b.toLowerCase() ? 'good' : ''),
      c(range(i)),
      c(CONVENTIONAL[i], 'dim'),
    ]);
    return (
      <div className="tables">
        <Table
          title={`RMSEA equivalence test: ${r.verdict} fit`}
          file="power-equivalence"
          columns={['χ²', 'df', 'N', 'RMSEA', 'T-size RMSEA', 'Fit']}
          rows={[
            [
              c(r.chisq ?? null),
              c(r.df ?? null, undefined, 0),
              c(r.n ?? null, undefined, 0),
              c(r.rmsea ?? null),
              c(r.rmseaT ?? null, undefined, 3),
              c(r.verdict ?? '', verdictClass),
            ],
          ]}
          note={`Equivalence testing (Yuan, Chan, Marcoulides & Bentler 2016): the null hypothesis is a misfit at least as large as a cutoff, rejected when the T-size RMSEA is below it. The T-size RMSEA is the noncentrality at which χ² would be the 5% quantile of the noncentral χ² (λ = ${fmt(r.ncpT ?? 0, 3)}), scaled as √(λ / (df·N)): the smallest misfit the data can rule out at α = .05, equal to the upper limit of the 90% RMSEA interval. RMSEA as lavaan, √(max(0, χ² − df) / (df·N)).${o.equivSource === 'model' ? ' χ²: the ML statistic of the CB-SEM model on the canvas.' : ''}`}
        />
        <Table
          title="Adjusted cutoffs for this df and N"
          file="power-equivalence-cutoffs"
          columns={['Fit', 'T-size RMSEA', 'Conventional']}
          rows={bands}
          note="Yuan et al.’s (2016) cutoffs, the counterparts of the conventional .01, .05, .08 and .10 adjusted for the model’s df and N (their regression equations; the same as McNeish & Wolf’s dynamic::equivTest). The CFI counterpart is on the Dynamic fit cutoffs card (equivTest)."
        />
      </div>
    );
  }
  if (r.analysis === 'parameter') {
    const p = r.param!;
    const apriori = r.type === 'apriori';
    return (
      <div className="tables">
        <Table
          title={
            apriori
              ? `N needed to detect ${paramName(p)}: ${r.n}`
              : `Power to detect ${paramName(p)} at N = ${r.n}: ${fmt(r.power ?? 0, 3)}`
          }
          file="power-parameter"
          columns={[
            'Parameter',
            'Estimate (population)',
            'Under H0',
            'F0',
            'α',
            apriori ? 'N needed' : 'N',
            'Power',
            'NCP',
            'This sample',
          ]}
          rows={[
            [
              c(paramName(p)),
              c(r.estimate ?? null),
              c(p.value),
              c(r.fmin ?? null, undefined, 5),
              c(r.alpha ?? null),
              c(r.n ?? null, undefined, 0),
              c(r.power ?? null),
              c(r.ncp ?? null),
              c(r.sampleN ?? null, undefined, 0),
            ],
          ]}
          note={`The CB-SEM model on the canvas as fitted (ML) is the population; H0 is the same model with ${paramName(p)} fixed at ${p.value}. F0 is the ML discrepancy of H0 from the population, the noncentrality (N − 1)·F0, the test the likelihood ratio on 1 df: semPower on the two models’ implied matrices, as semPower.powerLav computes it. The estimate is taken as the true value, so the power of a post hoc analysis at the sample’s own N is the “observed power” and adds nothing to the test’s p value. ${eng}`}
        />
        {r.curve && <PowerCurve r={r} title={`Detecting ${paramName(p)}`} />}
      </div>
    );
  }
  const measure = o.measure;
  const df = r.df;
  let head: string;
  let what: string;
  let fn: string;
  if (r.analysis === 'apriori') {
    head = `N needed: ${r.n} (power ${fmt(r.power ?? 0, 3)})`;
    what =
      'The smallest N at which the χ² test of fit rejects a model with this misfit with the power asked for';
    fn = 'aPriori';
  } else if (r.analysis === 'posthoc') {
    head = `Power at N = ${r.n}: ${fmt(r.power ?? 0, 3)}`;
    what = 'The power of the χ² test of fit at this N against a model with this misfit';
    fn = 'postHoc';
  } else {
    head = `Critical χ²: ${fmt(r.chiCrit ?? 0, 3)} (α = β = ${fmt(r.alpha ?? 0, 4)})`;
    what = 'The critical χ² at which α and β stand in the ratio asked for, at this N';
    fn = 'compromise';
  }
  const dfNote = o.dfSource === 'model' ? ' df: the CB-SEM model on the canvas.' : '';
  return (
    <div className="tables">
      <Table
        title={head}
        file={`power-${r.analysis}`}
        columns={['', 'Value']}
        rows={(
          [
            ['Misfit under H1', `${measure} = ${fmt(o.effect, 4)}`],
            ['df', df],
            ['N', r.n],
            ['α', r.alpha],
            ['β', r.beta],
            ['Power', r.power],
            ['Critical χ²', r.chiCrit],
            ['Noncentrality (N − 1)·F0', r.ncp],
            ['F0', r.fmin],
            ['RMSEA', r.rmsea],
            ['Mc', r.mc],
            ['GFI', r.gfi],
            ['AGFI', r.agfi],
            ...(r.analysis === 'compromise' ? [['α / β', r.abratio]] : []),
          ] as [string, number | string | undefined][]
        )
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [
            c(k),
            typeof v === 'number' && k === 'α'
              ? pCell(v)
              : c(v as number | string, undefined, k === 'df' || k === 'N' ? 0 : 4),
          ])}
        note={`${what} (semPower.${fn}; Moshagen & Erdfelder 2016). The misfit converts to F0, and the noncentrality is (N − 1)·F0; the other indices are its equivalents.${dfNote} ${eng}`}
      />
      {r.curve && <PowerCurve r={r} title={`${measure} = ${fmt(o.effect, 4)}, df = ${df}`} />}
    </div>
  );
}

const DEFAULTS: PowerOptions = {
  analysis: 'apriori',
  measure: 'RMSEA',
  effect: 0.05,
  dfSource: 'manual',
  df: 100,
  p: 20,
  alpha: 0.05,
  power: 0.8,
  n: 250,
  abratio: 1,
  param: null,
  value: 0,
  paramType: 'apriori',
  equivSource: 'model',
  chisq: 0,
  edf: 1,
  en: 200,
};

export const powerAnalysis: AnalysisType<PowerOptions, PowerResult> = {
  id: 'sempower',
  title: 'Power analysis (semPower)',
  group: 'CB-SEM model',
  sub: 'a priori, post hoc and compromise power for misfit (RMSEA, F0, Mc, GFI, AGFI) or a parameter of the model; RMSEA equivalence test',
  fitsModel: usesModel,
  defaults: (ctx) => ({
    ...DEFAULTS,
    ...(ctx.cb && ctx.cb.fit.df > 0 ? { dfSource: 'model' as const } : {}),
  }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const measure = oneOf(raw.measure, MEASURES, 'RMSEA');
    const pr = isObj(raw.param) ? raw.param : null;
    const lhs = pr ? name(pr.lhs) : '';
    const rhs = pr ? name(pr.rhs) : '';
    return {
      analysis: oneOf(
        raw.analysis,
        ANALYSES.map(([a]) => a),
        'apriori',
      ),
      measure,
      effect: clampNum(
        raw.effect,
        0.0001,
        measure === 'F0' ? 100 : 0.9999,
        MEASURE_DEFAULT[measure],
      ),
      dfSource: oneOf(raw.dfSource, ['model', 'manual'] as const, 'manual'),
      df: Math.round(clampNum(raw.df, 1, 1e6, 100)),
      p: Math.round(clampNum(raw.p, 1, 10000, 20)),
      alpha: clampNum(raw.alpha, 0.0001, 0.5, 0.05),
      power: clampNum(raw.power, 0.01, 0.9999, 0.8),
      n: Math.round(clampNum(raw.n, 2, 1e8, 250)),
      abratio: clampNum(raw.abratio, 0.0001, 10000, 1),
      param:
        pr && lhs && rhs && (OPS as readonly unknown[]).includes(pr.op)
          ? { lhs, op: pr.op as PowerParam['op'], rhs }
          : null,
      value: clampNum(raw.value, -1e6, 1e6, 0),
      paramType: oneOf(raw.paramType, ['apriori', 'posthoc'] as const, 'apriori'),
      equivSource: oneOf(raw.equivSource, ['model', 'manual'] as const, 'model'),
      chisq: clampNum(raw.chisq, 0, 1e9, 0),
      edf: Math.round(clampNum(raw.edf, 1, 1e6, 1)),
      en: Math.round(clampNum(raw.en, 2, 1e8, 200)),
    };
  },
  Options: PowerForm,
  View: ({ result, options }) => <PowerView r={result} o={options} />,
  blocked: (o, ctx) => {
    if (o.analysis === 'parameter' && !o.param)
      return 'Choose the parameter (calculate the CB-SEM model first to list them).';
    if (usesModel(o)) return cbModelBlocked(ctx, modelUse(o.analysis), false);
    return null;
  },
  fingerprint: (o, ctx) =>
    usesModel(o)
      ? cbFingerprint(ctx, [
          o.dfSource === 'model' && misfit(o.analysis) ? (ctx.cb?.fit.df ?? null) : null,
        ])
      : fingerprint(['manual']),
  run: async (o, ctx) =>
    (await import('../rengine/power')).powerR(powerInput(o, ctx), modelOf(o, ctx)),
  script: async (o, ctx) =>
    (await import('../rengine/power')).powerScriptR(powerInput(o, ctx), modelOf(o, ctx)),
  summary: (o) => {
    if (o.analysis === 'parameter') {
      const param = o.param ? paramName(o.param) : 'no parameter';
      const target = o.paramType === 'apriori' ? `power ${o.power}` : `N ${o.n}`;
      return `${param} · ${target}`;
    }
    if (o.analysis === 'equivalence') {
      const source =
        o.equivSource === 'model' ? 'the canvas model' : `χ² ${o.chisq}, df ${o.edf}, N ${o.en}`;
      return `RMSEA equivalence test · ${source}`;
    }
    const analysisName = ANALYSES.find(([a]) => a === o.analysis)![1];
    const df = o.dfSource === 'model' ? 'of the model' : o.df;
    return `${analysisName} · ${o.measure} ${o.effect} · df ${df}`;
  },
};

/** What the canvas model is needed for, for the message when it cannot be used. */
function modelUse(analysis: PowerOptions['analysis']) {
  if (analysis === 'parameter') return 'Power for a parameter';
  if (analysis === 'equivalence') return 'The RMSEA equivalence test of the model';
  return 'The model’s df';
}

const modelOf = (o: PowerOptions, ctx: AnalysisCtx) =>
  o.analysis === 'parameter' || (o.analysis === 'equivalence' && o.equivSource === 'model')
    ? cbCall(ctx)
    : null;
