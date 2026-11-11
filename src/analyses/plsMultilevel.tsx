// Multilevel PLS-SEM card (plssem 0.2.0; MC-PLSc for two-level models): the model on the canvas within clusters, the
// project's Clusters setting between them (Same model, Factors or As written), optional random slopes on paths, and
// optionally the cluster bootstrap. MC-PLSc simulates, so the estimates depend on the seed (the project's). Results by
// level: loadings, paths, (co)variances, R², ICCs, random-slope SDs and plssem's fit measures (under development).
// Desktop R only (the browser's R has plssem 0.1.5).

import { c, pCell, Table, type Row } from '../components/results/Table';
import type { WeightingScheme } from '../engine/types';
import { toSpec } from '../model/project';
import { plsMultilevelIssues } from '../model/validate';
import { useCompute } from '../rengine/compute';
import type { PlssemLevel, PlssemResult, PlssemRow, RandomSlope } from '../rengine/plssem';
import { fingerprint } from './codec';
import { Choice, clampNum, columnsFingerprint, flag, isObj, name, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export interface PlsMultilevelOptions {
  slopes: RandomSlope[];
  consistent: boolean;
  scheme: WeightingScheme;
  bootstrap: boolean;
  bootR: number;
}

/** The canvas's paths by construct names. */
export const pathPairs = (ctx: AnalysisCtx): RandomSlope[] => {
  const nm = new Map((ctx.model?.constructs ?? []).map((k) => [k.id, k.name]));
  return (ctx.model?.paths ?? [])
    .map((p) => ({ from: nm.get(p.from) ?? '', to: nm.get(p.to) ?? '' }))
    .filter((p) => p.from && p.to);
};
const same = (a: RandomSlope, b: RandomSlope) => a.from === b.from && a.to === b.to;
const BETWEEN: Record<string, string> = {
  same: 'the same factors and paths (Same model)',
  factors:
    'each factor measured by its indicators and regressed on the cluster-level covariates (Factors)',
  model: 'the model as written (As written)',
};

const KINDS: [string, string, (r: PlssemRow) => boolean][] = [
  ['Loadings', '=~', (r) => r.op === '=~'],
  ['Paths', '~', (r) => r.op === '~'],
  ['Variances and covariances', '~~', (r) => r.op === '~~'],
];

function LevelTables({ l, boot }: { l: PlssemLevel; boot: boolean }) {
  const what = l.level === 1 ? 'Level 1 (within clusters)' : 'Level 2 (between clusters)';
  const cols = ['Parameter', 'Estimate', ...(boot ? ['Std. error', 'z', 'p', '95% CI'] : [])];
  const row = (r: PlssemRow): Row => [
    c(
      r.op === '~~' && r.lhs === r.rhs
        ? `${r.lhs} (variance)`
        : `${r.lhs} ${r.op === '=~' ? '→' : r.op === '~' ? '←' : '↔'} ${r.rhs}`,
    ),
    c(r.est),
    ...(boot
      ? [
          c(r.se),
          c(r.z, undefined, 2),
          pCell(r.p),
          c(r.lo === null || r.hi === null ? null : `[${r.lo.toFixed(3)}, ${r.hi.toFixed(3)}]`),
        ]
      : []),
  ];
  return (
    <>
      {KINDS.map(([title, op, pick]) => {
        const rows = l.rows.filter(pick);
        return rows.length ? (
          <Table
            key={op}
            title={`${what}: ${title.toLowerCase()}`}
            file={`plssem-level${l.level}-${title.split(' ')[0].toLowerCase()}`}
            columns={cols}
            rows={rows.map(row)}
            note={
              op === '=~'
                ? 'Standardised loadings (construct → indicator).'
                : op === '~'
                  ? 'Standardised path coefficients (outcome ← predictor).'
                  : 'Variances (residual for endogenous constructs and indicators) and covariances, standardised.'
            }
          />
        ) : null;
      })}
      {(l.r2.length > 0 || l.r2Indicators.length > 0) && (
        <Table
          title={`${what}: R²`}
          file={`plssem-level${l.level}-r2`}
          columns={['Variable', 'R²']}
          rows={[
            ...l.r2.map((x) => [c(x.name), c(x.value)]),
            ...l.r2Indicators.map((x) => [c(`${x.name} (indicator)`), c(x.value)]),
          ]}
        />
      )}
    </>
  );
}

export function PlsMultilevelView({ r }: { r: PlssemResult }) {
  const boot = r.bootR > 0;
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.n} cases in {r.clusters} clusters; {r.estimator} (plssem {r.engine.version}
        {r.engine.desktop ? ` in desktop ${r.engine.desktop}` : ''}),{' '}
        {r.converged
          ? `converged after ${r.iterations} iterations`
          : `not converged after ${r.iterations} iterations`}
        {r.admissible ? '' : '; the solution is not admissible'}. MC-PLSc is a Monte Carlo
        estimator: the estimates depend on the seed ({r.seed}, the project’s; another seed moves
        them by about 0.005).{' '}
        {boot
          ? `Standard errors from ${r.bootR} cluster bootstrap samples (plssem’s delta method).`
          : 'No standard errors (turn on the cluster bootstrap for them).'}
        {r.ordered.length ? ` Ordinal indicators: ${r.ordered.join(', ')}.` : ''}
      </p>
      {r.levels.map((l) => (
        <LevelTables key={l.level} l={l} boot={boot} />
      ))}
      {r.thresholds.length > 0 && (
        <Table
          title="Thresholds (ordinal variables)"
          file="plssem-thresholds"
          columns={['Variable', 'Threshold', 'Estimate', ...(boot ? ['Std. error'] : [])]}
          rows={r.thresholds.map((x) => [
            c(x.variable),
            c(x.threshold),
            c(x.est),
            ...(boot ? [c(x.se)] : []),
          ])}
          note="On the scale of the latent normal responses; one set for both levels (plssem)."
        />
      )}
      {r.icc.length > 0 && (
        <Table
          title="Intraclass correlations"
          file="plssem-icc"
          columns={['Indicator', 'ICC']}
          rows={r.icc.map((x) => [c(x.name), c(x.value)])}
          note="The share of each indicator’s variance that lies between clusters."
        />
      )}
      {r.slopes.length > 0 && (
        <Table
          title="Random slopes"
          file="plssem-slopes"
          columns={['Slope', 'Standard deviation']}
          rows={r.slopes.map((x) => [c(x.name), c(x.sd)])}
          note="How much each path’s coefficient varies across clusters (standard deviation of the random slope); between clusters the slopes are latent variables."
        />
      )}
      {r.levels.some((l) => l.fit) && (
        <Table
          title="Fit measures (under development)"
          file="plssem-fit"
          columns={['Level', 'χ²', 'df', 'SRMR', 'RMSEA']}
          rows={r.levels.map((l) => [
            c(l.level === 1 ? 'Within' : 'Between'),
            c(l.fit?.chisq ?? null, undefined, 3),
            c(l.fit?.df ?? null, undefined, 0),
            c(l.fit?.srmr ?? null),
            c(l.fit?.rmsea ?? null),
          ])}
          note={`plssem: “${r.fitNote}” They are simulated (after the fit, with the same seed) and not validated criteria: report them, if at all, as descriptive.`}
        />
      )}
      <div>
        <h3>Model syntax (plssem)</h3>
        <pre className="hint" style={{ whiteSpace: 'pre-wrap' }}>
          {r.syntax.join('\n')}
        </pre>
      </div>
    </div>
  );
}

function PlsMultilevelForm({ options: o, set, ctx, disabled }: OptionsProps<PlsMultilevelOptions>) {
  const ml = ctx.model?.multilevel;
  const paths = pathPairs(ctx);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Two-level PLS-SEM by plssem’s Monte Carlo consistent PLS (MC-PLSc). Within clusters: the
        model on the canvas. Between clusters:{' '}
        {ml
          ? `${BETWEEN[ml.between] ?? 'set under Clusters'}, clusters by ${ml.column}`
          : 'choose the cluster column under Clusters (two-level) on the Model tab'}
        . The estimates depend on the seed (the project’s). Runs in desktop R (plssem 0.2.0).
      </p>
      <div className="field">
        <label>Random slopes</label>
        {paths.length ? (
          paths.map((p) => {
            const on = o.slopes.some((s) => same(s, p));
            return (
              <label key={`${p.from}>${p.to}`} className="check">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    set({
                      ...o,
                      slopes: e.target.checked
                        ? [...o.slopes, p]
                        : o.slopes.filter((s) => !same(s, p)),
                    })
                  }
                />{' '}
                {p.from} → {p.to}
              </label>
            );
          })
        ) : (
          <div className="hint">The model has no paths.</div>
        )}
        <div className="hint">
          A random slope lets the path’s coefficient vary across clusters (plssem’s rv()); between
          clusters the slope is a latent variable, regressed on the cluster-level covariates with
          Factors.
        </div>
      </div>
      <Choice
        label="Inner weighting"
        value={o.scheme}
        options={[
          ['path', 'Path'],
          ['centroid', 'Centroid'],
          ['factor', 'Factorial'],
        ]}
        onChange={(scheme) => set({ ...o, scheme })}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={o.consistent}
          onChange={(e) => set({ ...o, consistent: e.target.checked })}
        />{' '}
        PLSc correction in the base fits (plssem’s consistent = TRUE)
      </label>
      <div className="hint">
        Off by default, as in plssem: MC-PLSc corrects for measurement error by simulation.
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={o.bootstrap}
          onChange={(e) => set({ ...o, bootstrap: e.target.checked })}
        />{' '}
        Cluster bootstrap (standard errors, p values, confidence intervals)
      </label>
      {o.bootstrap && (
        <div className="field">
          <label>Bootstrap samples</label>
          <input
            className="input num"
            type="number"
            aria-label="Bootstrap samples"
            min={10}
            max={10000}
            value={o.bootR}
            onChange={(e) => set({ ...o, bootR: clampNum(e.target.value, 10, 10000, 500, true) })}
          />
          <div className="hint">
            Clusters are resampled (plssem’s boot.R); the seed is the project’s.
          </div>
        </div>
      )}
    </fieldset>
  );
}

// (ordinal columns as marked, cluster-level ones too: plssem's ordered takes both; the Model tab's spec keeps indicators only)
const modelOf = (ctx: AnalysisCtx) => ({
  data: rawData(ctx)!,
  spec: {
    ...toSpec(ctx.model!),
    ...(ctx.model!.ordered?.length ? { ordered: ctx.model!.ordered } : {}),
  },
  missing: ctx.settings.missing,
});
/** The slopes still drawn as paths (a removed path's slope is dropped). */
const liveSlopes = (o: PlsMultilevelOptions, ctx: AnalysisCtx) =>
  o.slopes.filter((s) => pathPairs(ctx).some((p) => same(p, s)));
const inputOf = (o: PlsMultilevelOptions, ctx: AnalysisCtx) => ({
  slopes: liveSlopes(o, ctx),
  consistent: o.consistent,
  scheme: o.scheme,
  bootR: o.bootstrap ? o.bootR : 0,
  seed: ctx.settings.seed,
});

export const plsMultilevelAnalysis: AnalysisType<PlsMultilevelOptions, PlssemResult> = {
  id: 'plsmultilevel',
  title: 'Multilevel PLS-SEM (plssem)',
  group: 'PLS-SEM model',
  sub: 'the model on the canvas within and between clusters by MC-PLSc, with random slopes; desktop R',
  defaults: () => ({ slopes: [], consistent: false, scheme: 'path', bootstrap: false, bootR: 500 }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          slopes: (Array.isArray(raw.slopes) ? raw.slopes.slice(0, 20) : [])
            .filter(isObj)
            .map((x) => ({ from: name(x.from), to: name(x.to) }))
            .filter((x, i, all) => x.from && x.to && all.findIndex((y) => same(x, y)) === i),
          consistent: flag(raw.consistent),
          scheme: oneOf(raw.scheme, ['path', 'centroid', 'factor'] as const, 'path'),
          bootstrap: flag(raw.bootstrap),
          bootR: clampNum(raw.bootR, 10, 10000, 500, true),
        }
      : null,
  Options: PlsMultilevelForm,
  View: ({ result }) => <PlsMultilevelView r={result} />,
  blocked: (o, ctx) => {
    if (useCompute.getState().backend !== 'helper')
      return 'Multilevel PLS-SEM runs in desktop R (plssem 0.2.0; the browser’s R has 0.1.5, whose multilevel interface differs): choose Desktop R (helper) under R runs in, on the Model tab, with the PLS Studio Helper running.';
    if (ctx.settings.method !== 'pls')
      return 'Multilevel PLS-SEM estimates the model as PLS-SEM: choose PLS-SEM as the method on the Model tab.';
    if (!ctx.model) return 'Draw the within-cluster model on the canvas first.';
    const issues = plsMultilevelIssues(ctx.model, rawData(ctx), ctx.settings, liveSlopes(o, ctx));
    return issues.length ? issues.join(' ') : null;
  },
  fingerprint: (o, ctx) => {
    if (!ctx.model?.multilevel) return null;
    const spec = toSpec(ctx.model),
      ml = spec.multilevel!;
    const cols = columnsFingerprint(
      ctx,
      [
        ...new Set([
          ...spec.constructs.flatMap((k) => k.indicators),
          ml.column,
          ...(ml.betweenCovariates ?? []),
          ...(ml.betweenModel ?? []).flatMap((st) => [st.lhs, ...st.rhs.map((t) => t.name)]),
        ]),
      ].filter((x) => rawData(ctx)?.names.includes(x)),
    );
    return (
      cols &&
      fingerprint([
        cols,
        JSON.stringify(spec),
        JSON.stringify(ctx.model.ordered ?? []),
        ctx.settings.missing,
        ctx.settings.seed,
        JSON.stringify(liveSlopes(o, ctx)),
      ])
    );
  },
  run: async (o, ctx) => (await import('../rengine/plssem')).plssemR(modelOf(ctx), inputOf(o, ctx)),
  script: async (o, ctx) =>
    (await import('../rengine/plssem')).plssemScriptR(modelOf(ctx), inputOf(o, ctx)),
  summary: (o) =>
    `${o.slopes.length ? `random slopes: ${o.slopes.map((s) => `${s.from} → ${s.to}`).join(', ')}` : 'random intercepts'}${o.bootstrap ? ` · bootstrap ${o.bootR}` : ''}`,
};
