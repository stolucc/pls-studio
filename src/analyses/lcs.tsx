// Latent change score (LCS) models as an analysis card (ps_lcs in R/longitudinal.R): univariate and bivariate dual
// change score models (McArdle 2009; Kievit et al. 2018) generated from the occasions chosen, with lcsm's
// specification and parameter labels (Wiedemann et al.), fitted with lavaan and reported in LCS terms: the initial true
// score, constant change, proportional change, the autoregression of the changes, and between two variables the coupling.

import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { fmt } from '../format';
import type {
  LcsComponents,
  LcsCoupling,
  LcsEstimate,
  LcsInput,
  LcsResult,
} from '../rengine/longitudinal';
import { seriesColor } from '../figure/palette';
import { columnsFingerprint, flag, isObj, missingColumns, names, rawData } from './common';
import { fitCards, IN_TIME_ORDER, lavaanOf, MISSING_NOTE } from './longitudinal';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

/** `y` empty: univariate. */
export interface LcsOptions {
  x: string[];
  y: string[];
  modelX: LcsComponents;
  modelY: LcsComponents;
  coupling: LcsCoupling;
}
type LcsView = LcsResult & { input: LcsInput };

const DUAL: LcsComponents = { constant: true, proportional: true, autoregressive: false };
const NO_COUPLING: LcsCoupling = { deltaXY: false, deltaYX: false, xiXY: false, xiYX: false };
const components = (v: unknown, d: LcsComponents): LcsComponents =>
  isObj(v)
    ? {
        constant: flag(v.constant),
        proportional: flag(v.proportional),
        autoregressive: flag(v.autoregressive),
      }
    : { ...d };

/** A variable's name from its first occasion's column ("anx_1" → "anx"), else X or Y. */
export const lcsName = (cols: string[], fallback: string) =>
  cols[0]?.replace(/[\s._-]*(t|w|time|wave)?[\s._-]*\d+$/i, '') || fallback;

export const lcsInput = (
  o: LcsOptions,
  ctx: Pick<AnalysisCtx, 'settings' | 'model'>,
): LcsInput => ({ ...o, coupling: o.y.length ? o.coupling : NO_COUPLING, ...lavaanOf(ctx) });

/** The parameters in LCS terms, each with lcsm's label: what it is, by row group. */
export function lcsRows(
  r: LcsResult,
): { title: string; file: string; rows: [string, LcsEstimate][]; note: string }[] {
  const [X, Y] = [lcsName(r.x, 'X'), lcsName(r.y, 'Y')];
  const by = new Map(r.estimates.map((e) => [e.label, e] as const));
  const pick = (pairs: [string, string][]) =>
    pairs.flatMap(([label, what]) =>
      by.has(label) ? [[what, by.get(label)!] as [string, LcsEstimate]] : [],
    );
  const of = (v: 'x' | 'y', N: string, g: string): [string, string][] => [
    [`gamma_l${v}1`, `${N}: initial true score, mean`],
    [`sigma2_l${v}1`, `${N}: initial true score, variance`],
    [`alpha_${g}2`, `${N}: constant change, mean (α)`],
    [`sigma2_${g}2`, `${N}: constant change, variance`],
    [`sigma_${g}2l${v}1`, `${N}: constant change ↔ initial true score`],
    [`beta_${v}`, `${N}: proportional change (β), change on the previous true score`],
    [`phi_${v}`, `${N}: autoregression of the changes (φ), change on the previous change`],
    [`sigma2_u${v}`, `${N}: residual variance (each occasion)`],
  ];
  return [
    {
      title: 'Change components',
      file: 'lcs-components',
      rows: pick([...of('x', X, 'g'), ...(r.bivariate ? of('y', Y, 'j') : [])]),
      note: 'Each latent change is the constant change (the same for every interval, varying between persons) plus β times the previous true score (proportional change: positive β accelerates, negative β slows change towards an equilibrium) plus φ times the previous change. Residual variances are held equal over time, as in lcsm.',
    },
    ...(r.bivariate
      ? [
          {
            title: 'Coupling between the variables',
            file: 'lcs-coupling',
            rows: pick([
              ['delta_lag_xy', `${Y} (true score, t−1) → change in ${X} (δ)`],
              ['delta_lag_yx', `${X} (true score, t−1) → change in ${Y} (δ)`],
              ['xi_lag_xy', `${Y} (change, t−1) → change in ${X} (ξ)`],
              ['xi_lag_yx', `${X} (change, t−1) → change in ${Y} (ξ)`],
            ]),
            note: 'Coupling: a variable’s level (δ) or its previous change (ξ) shapes the other variable’s next change (Kievit et al. 2018). Held equal over time.',
          },
          {
            title: 'Covariances between the variables',
            file: 'lcs-covariances',
            rows: pick([
              ['sigma_ly1lx1', `${X} ↔ ${Y}: initial true scores`],
              ['sigma_g2ly1', `${X} constant change ↔ ${Y} initial true score`],
              ['sigma_j2lx1', `${Y} constant change ↔ ${X} initial true score`],
              ['sigma_j2g2', `${X} ↔ ${Y}: constant changes`],
              ['sigma_su', `${X} ↔ ${Y}: residuals at each occasion`],
            ]),
            note: 'Standardised: correlations.',
          },
        ]
      : []),
  ].filter((t) => t.rows.length);
}

function LcsOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<LcsOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length)
    return <div className="empty-results">Import raw data with repeated measures first.</div>;
  const l = lavaanOf(ctx);
  const bi = o.y.length > 0;
  const [X, Y] = [lcsName(o.x, 'X'), lcsName(o.y, 'Y')];
  const parts = (k: 'modelX' | 'modelY', N: string) => (
    <div className="field">
      <label>Change in {N}</label>
      {(
        [
          ['constant', 'Constant change (α): a change factor, the same for every interval'],
          ['proportional', 'Proportional change (β): change depends on the previous true score'],
          [
            'autoregressive',
            'Autoregression of the changes (φ): change depends on the previous change',
          ],
        ] as const
      ).map(([key, text]) => (
        <label key={key} className="check" style={{ marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={o[k][key]}
            onChange={(e) => set({ ...o, [k]: { ...o[k], [key]: e.target.checked } })}
          />
          <span>{text}</span>
        </label>
      ))}
    </div>
  );
  return (
    <fieldset className="card-options" disabled={disabled}>
      <OrderedPicker
        label="Variable at each occasion (in time order)"
        hint={IN_TIME_ORDER}
        columns={columns.filter((n) => !o.y.includes(n))}
        value={o.x}
        onChange={(x) => set({ ...o, x })}
      />
      <OrderedPicker
        label="Second variable at the same occasions (optional: a bivariate model)"
        hint={IN_TIME_ORDER}
        columns={columns.filter((n) => !o.x.includes(n))}
        value={o.y}
        onChange={(y) => set({ ...o, y })}
      />
      {parts('modelX', X)}
      {bi && parts('modelY', Y)}
      {bi && (
        <div className="field">
          <label>Coupling</label>
          {(
            [
              ['deltaXY', `${Y}’s previous true score → change in ${X} (δ)`],
              ['deltaYX', `${X}’s previous true score → change in ${Y} (δ)`],
              ['xiXY', `${Y}’s previous change → change in ${X} (ξ)`],
              ['xiYX', `${X}’s previous change → change in ${Y} (ξ)`],
            ] as const
          ).map(([key, text]) => (
            <label key={key} className="check" style={{ marginBottom: 4 }}>
              <input
                type="checkbox"
                checked={o.coupling[key]}
                onChange={(e) =>
                  set({ ...o, coupling: { ...o.coupling, [key]: e.target.checked } })
                }
              />
              <span>{text}</span>
            </label>
          ))}
        </div>
      )}
      <div className="hint">
        One observed score per occasion and equally spaced occasions (each change is one interval).
        lavaan {l.estimator}
        {MISSING_NOTE[l.missing] ?? ''}
        {l.information ? ', observed-information standard errors' : ''} (from the Model settings);
        lcsm fits with MLR and FIML.
      </div>
    </fieldset>
  );
}

/** Observed (dots) and model-implied (lines) means of each variable at each occasion. */
function LcsTrajectory({ r }: { r: LcsResult }) {
  const W = 460;
  const H = 240;
  const pad = { l: 56, r: 14, t: 12, b: 40 };
  const series = [
    { name: lcsName(r.x, 'X'), imp: r.impliedMeans.x, obs: r.observedMeans.x },
    ...(r.bivariate
      ? [{ name: lcsName(r.y, 'Y'), imp: r.impliedMeans.y, obs: r.observedMeans.y }]
      : []),
  ];
  const all = series.flatMap((s) => [...s.imp, ...s.obs]).filter(Number.isFinite);
  if (!all.length) return null;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const T = r.occasions;
  const sx = (i: number) => pad.l + (i / (T - 1 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi + 0.08 * span - v) / (span * 1.16)) * (H - pad.t - pad.b);
  return (
    <ChartFrame
      id="lcs:trajectory"
      name="lcs-trajectory"
      width={W}
      height={H}
      defaults={{ x: 'Occasion', y: 'Mean' }}
      caption={
        <span className="hint">
          Lines: model-implied means; dots: observed means
          {series.length > 1
            ? `; ${series.map((s, k) => `${s.name} in ${k ? 'the second' : 'the first'} colour`).join(', ')}`
            : ''}
          .
        </span>
      }
    >
      {(labels) => (
        <svg className="mc-chart" width={W} height={H} role="img" aria-label="Mean trajectories">
          <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(lo)} y2={sy(lo)} />
          <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(hi)} y2={sy(hi)} />
          <text x={pad.l - 6} y={sy(lo) + 4} textAnchor="end">
            {fmt(lo, 2)}
          </text>
          <text x={pad.l - 6} y={sy(hi) + 4} textAnchor="end">
            {fmt(hi, 2)}
          </text>
          {Array.from({ length: T }, (_, i) => (
            <text key={i} x={sx(i)} y={H - pad.b + 16} textAnchor="middle">
              {i + 1}
            </text>
          ))}
          {series.map((s, k) => (
            <g key={k}>
              <path
                d={s.imp.map((v, i) => `${i ? 'L' : 'M'} ${sx(i)} ${sy(v)}`).join(' ')}
                stroke={seriesColor(k)}
                strokeWidth={2.2}
                fill="none"
              />
              {s.obs.map(
                (v, i) =>
                  Number.isFinite(v) && (
                    <circle key={i} cx={sx(i)} cy={sy(v)} r={4} fill={seriesColor(k)} />
                  ),
              )}
              <text
                x={W - pad.r}
                y={sy(s.imp[s.imp.length - 1]) - 6}
                textAnchor="end"
                fill={seriesColor(k)}
              >
                {s.name}
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

export function LcsResultView({ r }: { r: LcsView }) {
  const se = r.input?.estimator === 'MLR' ? 'Robust SE' : 'Std. error';
  const cols = ['Parameter', 'Label', 'Estimate', se, 'z', 'p', 'Standardised'];
  const row = ([what, e]: [string, LcsEstimate]): Row => [
    c(what),
    c(e.label),
    c(e.est),
    c(e.se),
    c(e.z),
    pCell(e.p),
    c(e.std),
  ];
  return (
    <div className="tables">
      {fitCards(r.fit)}
      <p className="hint" style={{ marginTop: 0 }}>
        {r.bivariate ? 'Bivariate' : 'Univariate'} latent change score model, {r.occasions}{' '}
        occasions, N = {r.n}
        {r.bivariate ? `: ${lcsName(r.x, 'X')} and ${lcsName(r.y, 'Y')}` : ''}.
      </p>
      {lcsRows(r).map((t) => (
        <Table
          key={t.file}
          title={t.title}
          file={t.file}
          columns={cols}
          rows={t.rows.map(row)}
          note={t.note}
        />
      ))}
      <LcsTrajectory r={r} />
    </div>
  );
}

export const lcsAnalysis: AnalysisType<LcsOptions, LcsView> = {
  id: 'lcs',
  title: 'Latent change score model',
  sub: 'univariate or bivariate dual change scores, coupling (lavaan)',
  group: 'Longitudinal',
  defaults: () => ({
    x: [],
    y: [],
    modelX: { ...DUAL },
    modelY: { ...DUAL },
    coupling: { ...NO_COUPLING, deltaXY: true, deltaYX: true },
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          x: names(raw.x),
          y: names(raw.y),
          modelX: components(raw.modelX, DUAL),
          modelY: components(raw.modelY, DUAL),
          coupling: isObj(raw.coupling)
            ? {
                deltaXY: flag(raw.coupling.deltaXY),
                deltaYX: flag(raw.coupling.deltaYX),
                xiXY: flag(raw.coupling.xiXY),
                xiYX: flag(raw.coupling.xiYX),
              }
            : { ...NO_COUPLING },
        }
      : null,
  Options: LcsOptionsForm,
  View: ({ result }) => <LcsResultView r={result} />,
  blocked: (o, ctx) => {
    if (o.x.length < 3) return 'Choose the variable at three or more occasions.';
    if (o.y.length && o.y.length !== o.x.length)
      return 'Choose the second variable at the same number of occasions.';
    return missingColumns(ctx, [...o.x, ...o.y], 'A latent change score model');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(
      ctx,
      [...o.x, ...o.y],
      [
        lavaanOf(ctx).estimator,
        lavaanOf(ctx).missing,
        lavaanOf(ctx).information ?? '',
        JSON.stringify([o.modelX, o.y.length ? o.modelY : null, o.y.length ? o.coupling : null]),
      ],
    ),
  run: async (o, ctx) => {
    const input = lcsInput(o, ctx);
    return {
      ...(await (await import('../rengine/longitudinal')).lcsR(rawData(ctx)!, input)),
      input,
    };
  },
  script: async (o, ctx) =>
    (await import('../rengine/longitudinal')).lcsScriptR(rawData(ctx)!, lcsInput(o, ctx)),
  summary: (o) => {
    const parts = (m: LcsComponents) =>
      [m.constant && 'α', m.proportional && 'β', m.autoregressive && 'φ']
        .filter(Boolean)
        .join('') || 'no change';
    const cp = o.y.length
      ? (Object.entries(o.coupling) as [keyof LcsCoupling, boolean][])
          .filter(([, v]) => v)
          .map(([k]) => k.replace('delta', 'δ').replace('xi', 'ξ'))
          .join(', ')
      : '';
    return o.y.length
      ? `bivariate · ${o.x.length} occasions · ${parts(o.modelX)} / ${parts(o.modelY)}${cp ? ` · ${cp}` : ''}`
      : `${o.x.length} occasions · ${parts(o.modelX)}`;
  },
};
