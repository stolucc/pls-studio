// Meta-analytic SEM card: two-stage SEM (TSSEM; Cheung & Chan 2005) by metaSEM in desktop R. The data are the studies,
// one row each with its N and one column per pair of the canvas model's observed variables (A_B: the correlation of A
// and B, empty where a study did not report it); stage 1 pools the correlation matrices (fixed or random effects),
// stage 2 fits the CB-SEM model drawn on the canvas to the pooled matrix. No raw data needed.

import { c, pCell, Table, type Row } from '../components/results/Table';
import { fmt } from '../format';
import { toSpec } from '../model/project';
import { useCompute } from '../rengine/compute';
import {
  metaColumns,
  metaDataProblem,
  metaVariables,
  type MetaParam,
  type MetaSemOptions,
  type MetaSemResult,
} from '../rengine/metasem';
import { fingerprint } from './codec';
import { Choice, ColumnSelect, isObj, name, oneOf } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

const engine = () => import('../rengine/metasem');
/** Fixed- or random-effects stage 1 (metaSEM::tssem1). */
export const METASEM_METHODS = ['FEM', 'REM'] as const;
const varsOf = (ctx: AnalysisCtx) => (ctx.model ? metaVariables(toSpec(ctx.model)) : []);
const ci = (lo?: number, hi?: number) =>
  lo === undefined || hi === undefined ? c(null) : c(`[${fmt(lo, 3)}, ${fmt(hi, 3)}]`);
const paramName = (p: MetaParam) => {
  if (p.kind === 'covariance') return `${p.from} ↔ ${p.to}`;
  if (p.kind === 'variance') return `${p.from} (variance)`;
  return `${p.from} → ${p.to}`;
};
/** metaSEM's random-effects structure of the stage-1 heterogeneity. */
const heterogeneityName = (reType: string | undefined) => {
  if (reType === 'Diag') return 'diagonal';
  if (reType === 'Symm') return 'symmetric';
  return 'none';
};
const KIND: Record<MetaParam['kind'], string> = {
  loading: 'Loading',
  regression: 'Regression',
  covariance: 'Covariance',
  variance: 'Variance',
  other: 'Other',
};

function MetaForm({ options: o, set, ctx, disabled }: OptionsProps<MetaSemOptions>) {
  const names = ctx.data?.names ?? [];
  const vars = varsOf(ctx);
  const m = vars.length >= 2 ? metaColumns(names, vars) : null;
  const found = m ? m.columns.filter(Boolean).length : 0;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Two-stage meta-analytic SEM (Cheung &amp; Chan 2005) with metaSEM: the data are the studies,
        one row each, with the study’s N and one column per pair of the model’s observed variables,
        named A_B for the correlation of A and B (empty where a study did not report it). Stage 2
        fits the CB-SEM model on the canvas to the pooled correlations. Runs in desktop R (OpenMx).
      </p>
      <ColumnSelect
        id="ms-n"
        label="N of each study"
        value={o.n}
        columns={names}
        onChange={(n) => set({ ...o, n })}
      />
      {m && (
        <div className="hint">
          {found} of {m.columns.length} correlation columns found for the model’s {vars.length}{' '}
          observed variables
          {m.missing.length
            ? `; missing: ${m.missing
                .slice(0, 6)
                .map(([a, b]) => `${a}_${b}`)
                .join(', ')}${m.missing.length > 6 ? ', …' : ''}`
            : ''}
          .
        </div>
      )}
      <Choice
        label="Stage 1"
        value={o.method}
        options={[
          ['REM', 'Random effects'],
          ['FEM', 'Fixed effects'],
        ]}
        onChange={(method) => set({ ...o, method })}
        hint={
          o.method === 'REM'
            ? 'The studies’ correlations vary around the pooled ones (tssem1, method = "REM"): the usual choice.'
            : 'One correlation matrix common to all studies (tssem1, method = "FEM"); its homogeneity is tested.'
        }
      />
      {o.method === 'REM' && (
        <Choice
          label="Heterogeneity"
          value={o.reType}
          options={[
            ['Diag', 'Each correlation (diagonal)'],
            ['Symm', 'With covariances'],
            ['Zero', 'None'],
          ]}
          onChange={(reType) => set({ ...o, reType })}
          hint="The variance of the true correlations across studies (τ²): one per correlation, as metaSEM’s default; with their covariances (many parameters); or none (fixed effects estimated as random)."
        />
      )}
    </fieldset>
  );
}

function MetaView({ r }: { r: MetaSemResult }) {
  const s1 = r.stage1;
  const f = r.stage2.fit;
  const rem = s1.method === 'REM';
  const pooledRows: Row[] = s1.pooled.map((p) => [
    c(`${p.a} – ${p.b}`),
    c(p.r),
    c(p.se),
    ...(rem ? [ci(p.low, p.high), c(p.tau2 ?? null, undefined, 4), c(p.i2 ?? null)] : []),
  ]);
  const byKind = (['loading', 'regression', 'covariance', 'variance', 'other'] as const).flatMap(
    (k) => r.stage2.params.filter((p) => p.kind === k),
  );
  const fitRows: Row[] = (
    [
      ['N (total)', f.n, 0],
      ['χ²', f.chisq, 3],
      ['df', f.df, 0],
      ['RMSEA', f.rmsea, 3],
      ['RMSEA 95% interval', undefined, 3],
      ['SRMR', f.srmr, 3],
      ['CFI', f.cfi, 3],
      ['TLI', f.tli, 3],
      ['AIC', f.aic, 2],
      ['BIC', f.bic, 2],
    ] as [string, number | undefined, number][]
  ).map(
    ([k, v, d]): Row =>
      k === 'RMSEA 95% interval'
        ? [c(k), ci(f.rmseaLow, f.rmseaHigh)]
        : [c(k), c(v ?? null, undefined, d)],
  );
  fitRows.splice(3, 0, [c('p'), pCell(f.p ?? NaN)]);
  const status = Math.max(s1.status ?? 0, r.stage2.status ?? 0);
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {s1.studies} studies, N = {s1.totalN.toLocaleString('en')} in all; stage 1 by{' '}
        {rem ? `random effects (heterogeneity: ${heterogeneityName(s1.reType)})` : 'fixed effects'};
        metaSEM {r.engine.version}
        {r.engine.openmx ? `, OpenMx ${r.engine.openmx}` : ''}
        {r.engine.desktop ? ` in desktop ${r.engine.desktop}` : ''}.
        {status > 1 ? ` OpenMx status ${status}: the optimisation may not have converged.` : ''}
      </p>
      <Table
        title="Stage 2: the model on the canvas fitted to the pooled correlations"
        file="metasem-stage2"
        columns={['Parameter', 'Kind', 'Estimate', 'SE', '95% CI', 'z', 'p']}
        rows={byKind.map((p) => [
          c(paramName(p)),
          c(KIND[p.kind], 'dim'),
          c(p.est),
          c(p.se),
          ci(p.low, p.high),
          c(p.z, undefined, 2),
          pCell(p.p),
        ])}
        note="Weighted least squares on the pooled correlation matrix with its asymptotic covariance as weights (tssem2). The factors have unit variances (lavaan2RAM, std.lv), so the estimates are on the correlation metric; the observed variables’ error variances follow from the unit diagonal and are not parameters. Wald (z) intervals."
      />
      <Table
        title="Stage 2: fit"
        file="metasem-fit"
        columns={['', 'Value']}
        rows={fitRows}
        note="The χ² of the model against the pooled matrix; N is the total over the studies, so χ² rejects small misfit easily: RMSEA, SRMR and CFI as metaSEM reports them."
      />
      <Table
        title={`Stage 1: pooled correlations (${rem ? 'random effects' : 'fixed effects'})`}
        file="metasem-stage1"
        columns={['Pair', 'r', 'SE', ...(rem ? ['95% CI', 'τ²', 'I²'] : [])]}
        rows={pooledRows}
        note={
          rem
            ? `Q = ${fmt(s1.q ?? NaN, 2)} on ${s1.qDf} df, p ${s1.qP !== undefined && s1.qP < 0.001 ? '< .001' : `= ${fmt(s1.qP ?? NaN, 3)}`}: the test of homogeneous correlations across studies. τ²: the variance of the true correlations across studies; I²: the share of the variation in the observed correlations that is heterogeneity rather than sampling error.`
            : `Homogeneity of the correlation matrices: χ² = ${fmt(s1.chisq ?? NaN, 2)} on ${s1.df} df, p ${s1.p !== undefined && s1.p < 0.001 ? '< .001' : `= ${fmt(s1.p ?? NaN, 3)}`}; RMSEA ${fmt(s1.rmsea ?? NaN, 3)}, SRMR ${fmt(s1.srmr ?? NaN, 3)}, CFI ${fmt(s1.cfi ?? NaN, 3)}. A rejected homogeneity argues for random effects.`
        }
      />
    </div>
  );
}

export const metaSemAnalysis: AnalysisType<MetaSemOptions, MetaSemResult> = {
  id: 'metasem',
  title: 'Meta-analytic SEM (metaSEM)',
  group: 'CB-SEM model',
  sub: 'two-stage SEM on the studies’ correlation matrices (TSSEM): pooled correlations by fixed or random effects, then the model on the canvas; desktop R',
  defaults: (ctx) => ({
    n: (ctx.data?.names ?? []).find((x) => /^n$/i.test(x)) ?? '',
    method: 'REM',
    reType: 'Diag',
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          n: name(raw.n),
          method: oneOf(raw.method, METASEM_METHODS, 'REM'),
          reType: oneOf(raw.reType, ['Diag', 'Symm', 'Zero'] as const, 'Diag'),
        }
      : null,
  Options: MetaForm,
  View: ({ result }) => <MetaView r={result} />,
  blocked: (o, ctx) => {
    if (useCompute.getState().backend !== 'helper')
      return 'Meta-analytic SEM runs in desktop R (metaSEM needs OpenMx, which does not run in the browser): choose Desktop R (helper) under R runs in, on the Model tab, with the PLS Studio Helper running.';
    if (ctx.settings.method !== 'cbsem')
      return 'Meta-analytic SEM fits a CB-SEM model: switch the model to CB-SEM (Model tab).';
    const m = ctx.model;
    if (!m?.constructs.length)
      return 'Draw the model to fit on the canvas: its observed variables name the correlation columns.';
    if (m.multigroup || m.multilevel)
      return 'Meta-analytic SEM fits one pooled matrix: remove the grouping or the levels.';
    if (m.moderations.length) return 'Meta-analytic SEM is not available with latent interactions.';
    if (m.ordered?.length)
      return 'Meta-analytic SEM pools correlations: the model cannot have ordinal indicators.';
    if (m.constant)
      return 'Meta-analytic SEM on correlations has no mean structure: remove the constant.';
    if (!ctx.data) return 'Import the studies: one row per study with its N and the correlations.';
    return metaDataProblem(ctx.data, varsOf(ctx), o.n);
  },
  fingerprint: (o, ctx) => {
    if (!ctx.data || !ctx.model) return null;
    const vars = varsOf(ctx);
    const d = ctx.data;
    const cols = [o.n, ...metaColumns(d.names, vars).columns.filter((x): x is string => !!x)];
    if (cols.some((x) => !d.names.includes(x))) return null;
    return fingerprint([
      JSON.stringify(toSpec(ctx.model)),
      ...cols.flatMap((x) => [x, d.cols[d.names.indexOf(x)]]),
    ]);
  },
  run: async (o, ctx) => (await engine()).metaSemR(ctx.data!, toSpec(ctx.model!), o),
  script: async (o, ctx) => (await engine()).metaSemScriptR(ctx.data!, toSpec(ctx.model!), o),
  summary: (o) =>
    `${o.method === 'REM' ? `random effects (${o.reType})` : 'fixed effects'} · N in ${o.n || '?'}`,
};
