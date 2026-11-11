// Integration card: maximum likelihood by numerical integration (Mplus's ALGORITHM = INTEGRATION) for structural
// equation models written in Mplus's syntax whose outcomes are censored, counts, categorical, survival times or normal
// outcomes of products of factors (XWITH), with factors, growth factors or random effects; continuous outcomes and
// continuous mediators missing for some cases are integrated over where missing. analyses/quadmlSyntax.ts reads the
// syntax with Mplus's defaults; R/quadml.R fits the likelihood (MLR standard errors). With `source: 'model'` the card
// estimates the CB-SEM diagram instead (its count indicators: model/countModel.ts writes it in the same syntax).

import { c, Table } from '../components/results/Table';
import { fmt } from '../format';
import type { QuadParam, QuadResult } from '../rengine/quadml';
import type { Dataset } from '../engine/types';
import { countIndicators, countModelSyntax, type CountSyntax } from '../model/countModel';
import { buildQuad, QuadSyntaxError } from './quadmlSyntax';
import { columnsFingerprint, isObj, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

/** syntax: Mplus-style input (VARIABLE and ANALYSIS options; MODEL: …); source 'model': the CB-SEM diagram instead (count indicators). */
export interface QuadOptions {
  syntax: string;
  source?: 'model';
}
/** A result of the diagram: the constructs' names (the syntax's factor names mapped back). */
type Result = QuadResult & { fromModel?: boolean };

const EXAMPLE = 'CATEGORICAL = u1-u4;\nMODEL:\nf BY u1-u4;\nf ON x;';

/** The diagram in the card's syntax, or why it cannot be estimated by integration. */
export function diagramSyntax(ctx: AnalysisCtx): CountSyntax {
  if (!ctx.model) throw new QuadSyntaxError('Draw the model first.');
  const r = countModelSyntax(ctx.model, ctx.settings, ctx.data?.names ?? null, {
    moments: !!ctx.data?.moments && ctx.data.cols.length === 0,
  });
  if ('error' in r) throw new QuadSyntaxError(r.error);
  return r;
}
/** Only the cases observed on every column the model uses (casewise deletion). */
function complete(data: Dataset, columns: string[]): Dataset {
  const idx = columns.map((c) => data.names.indexOf(c)).filter((i) => i >= 0);
  const keep = Array.from({ length: data.cols[0]?.length ?? 0 }, (_, r) => r).filter((r) =>
    idx.every((i) => Number.isFinite(data.cols[i][r])),
  );
  return { ...data, cols: data.cols.map((c) => Float64Array.from(keep, (r) => c[r])) };
}

/** The specification for R, or the syntax error. */
export function quadSpec(o: QuadOptions, ctx: AnalysisCtx) {
  const data = rawData(ctx);
  if (!data) throw new QuadSyntaxError('Import raw data first.');
  if (o.source !== 'model')
    return {
      ...buildQuad(o.syntax, data),
      syntax: o.syntax,
      names: {} as Record<string, string>,
      data,
    };
  const d = diagramSyntax(ctx);
  const first = buildQuad(d.syntax, data);
  if (!d.casewise) return { ...first, syntax: d.syntax, names: d.names, data };
  const cut = complete(data, first.spec.columns);
  if (!cut.cols[0]?.length)
    throw new QuadSyntaxError(
      'No case is observed on every variable of the model (casewise deletion): choose FIML.',
    );
  return { ...buildQuad(d.syntax, cut), syntax: d.syntax, names: d.names, data: cut };
}
/** The result with the factors under the constructs' names. */
const renamed = (r: QuadResult, names: Record<string, string>): QuadResult =>
  Object.keys(names).length
    ? {
        ...r,
        params: r.params.map((p) => ({
          ...p,
          lhs: names[p.lhs] ?? p.lhs,
          rhs: names[p.rhs] ?? p.rhs,
        })),
      }
    : r;

function DiagramForm({
  set,
  ctx,
  disabled,
}: {
  set: (o: QuadOptions) => void;
  ctx: AnalysisCtx;
  disabled: boolean;
}) {
  let d: CountSyntax | null = null,
    why = '';
  try {
    d = diagramSyntax(ctx);
  } catch (e) {
    if (e instanceof QuadSyntaxError) why = e.message;
    else throw e;
  }
  const counts = ctx.model ? countIndicators(ctx.model) : [];
  return (
    <fieldset className="card-options" disabled={disabled}>
      <div className="field">
        <label htmlFor="quad-diagram">The diagram (CB-SEM), as the card’s syntax</label>
        {d ? (
          <textarea
            id="quad-diagram"
            className="input"
            readOnly
            rows={Math.min(30, Math.max(6, d.syntax.split('\n').length + 1))}
            value={d.syntax}
            style={{
              fontFamily: 'var(--mono, monospace)',
              fontSize: 12,
              width: '100%',
              resize: 'vertical',
            }}
          />
        ) : (
          <div className="hint" role="alert">
            {why}
          </div>
        )}
        <div className="hint">
          The model on the Model tab
          {counts.length ? `, with its count indicators (${counts.join(', ')})` : ''}, estimated by
          maximum likelihood with numerical integration over the factors the counts load on (lavaan
          has no count outcomes). Written with the diagram’s fixed values, labels and covariances
          (the pairs of factors it leaves uncorrelated held at 0); ordinal indicators are logit
          (ML), the estimator (ML or MLR) and missing values (casewise or FIML) come from the Model
          inspector. Changes on the canvas show here.
        </div>
      </div>
      {d && (
        <button
          className="btn sm"
          onClick={() => set({ syntax: d!.syntax })}
          title="Copy this syntax into the card and edit it there (it no longer follows the diagram)"
        >
          Edit as syntax
        </button>
      )}
    </fieldset>
  );
}

function QuadForm({ options: o, set, ctx, disabled }: OptionsProps<QuadOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) return <div className="empty-results">Import raw data first.</div>;
  if (o.source === 'model') return <DiagramForm set={set} ctx={ctx} disabled={disabled} />;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <div className="field">
        <label htmlFor="quad-syntax">Model (Mplus syntax)</label>
        <textarea
          id="quad-syntax"
          className="input"
          rows={Math.min(30, Math.max(8, o.syntax.split('\n').length + 1))}
          spellCheck={false}
          maxLength={40000}
          value={o.syntax}
          placeholder={EXAMPLE}
          onChange={(e) => set({ ...o, syntax: e.target.value })}
          style={{
            fontFamily: 'var(--mono, monospace)',
            fontSize: 12,
            width: '100%',
            resize: 'vertical',
          }}
        />
        <div className="hint">
          Mplus’s VARIABLE and ANALYSIS options: CATEGORICAL (ordered, logit or LINK = PROBIT),
          COUNT (Poisson; (i) zero-inflated; (nb) negative binomial; (nbi) zero-inflated negative
          binomial), CENSORED with (a) or (b) and inflated (ai) or (bi), SURVIVAL = t (intervals,
          e.g. 20*1) with TIMECENSORED (continuous-time survival, the baseline hazard of each
          interval), ESTIMATOR = ML or MLR, INTEGRATION = n, STANDARD (n), GAUSSHERMITE (n) or
          MONTECARLO (n), ADAPTIVE = OFF. MODEL: BY, growth (i s | y1@0 y2@1 …; the inflation of
          zero-inflated counts or censored-inflated outcomes: ii si | y1#1@0 …), XWITH (f2 | f XWITH
          f), ON, WITH, [means, thresholds u$1, inflations u#1, base hazards t#1-t#21], u#1 ON x
          (the inflation’s regressions), variances, @ fixed values, * starting values, (labels) for
          equality. Mplus’s defaults: the first loading of a factor fixed at 1, factor means 0
          (growth factor means free), independent factors and growth factors correlated, thresholds
          of a growth model equal over time. Continuous variables that predict another outcome and
          are missing are integrated over. Variables are the data’s columns; a range y1-y4 runs in
          column order.
        </div>
      </div>
    </fieldset>
  );
}

type Group = { title: string; test: (p: QuadParam) => boolean; label: (p: QuadParam) => string };
const GROUPS: Group[] = [
  { title: 'Loadings (BY)', test: (p) => p.op === '=~', label: (p) => `${p.lhs} BY ${p.rhs}` },
  { title: 'Regressions (ON)', test: (p) => p.op === '~', label: (p) => `${p.lhs} ON ${p.rhs}` },
  { title: 'Means and intercepts', test: (p) => p.op === '~1', label: (p) => `[${p.lhs}]` },
  { title: 'Thresholds', test: (p) => p.op === '|', label: (p) => `${p.lhs}$${p.rhs.slice(1)}` },
  {
    title: 'Variances and covariances',
    test: (p) => p.op === '~~',
    label: (p) => (p.lhs === p.rhs ? `${p.lhs} (variance)` : `${p.lhs} WITH ${p.rhs}`),
  },
  { title: 'Base hazards', test: (p) => p.op === 'hazard', label: (p) => p.lhs },
  { title: 'Dispersion', test: (p) => p.op === 'dispersion', label: (p) => p.lhs },
];
const RULE = {
  rect: 'rectangular (Mplus’s STANDARD)',
  gh: 'Gauss–Hermite',
  mc: 'Monte Carlo',
} as const;

function QuadView({ r }: { r: Result }) {
  const z = (p: QuadParam) => (p.se && !p.fixed ? p.est / p.se : null);
  return (
    <div className="tables">
      <div className="stat-cards">
        {(
          [
            ['n', r.n, 0],
            ['Log-likelihood', r.logLik, 3],
            ['Parameters', r.npar, 0],
            ['AIC', r.aic, 3],
            ['BIC', r.bic, 3],
            ['Dimensions', r.dims, 0],
          ] as const
        ).map(([k, v, d]) => (
          <div className="stat-card" key={k}>
            <div className="k">{k}</div>
            <div className="v">{Number.isFinite(v) ? fmt(v, d) : '—'}</div>
          </div>
        ))}
      </div>
      {GROUPS.map((g) => {
        const rows = r.params.filter(g.test);
        return rows.length ? (
          <Table
            key={g.title}
            title={g.title}
            file={`quadml-${g.title.replace(/\W+/g, '-').toLowerCase()}`}
            columns={['Parameter', 'Estimate', r.se === 'mlr' ? 'Robust SE' : 'Std. error', 'z']}
            rows={rows.map((p) => [
              c(g.label(p)),
              c(p.est),
              p.fixed ? c('fixed', 'dim') : c(p.se),
              c(z(p)),
            ])}
            note={
              g.title === 'Thresholds'
                ? 'Mplus’s parameterization: P(u ≤ category j) = F(threshold j − linear predictor), F logistic (or normal with LINK = PROBIT).'
                : g.title === 'Base hazards'
                  ? 'The baseline hazard in each interval of the survival time; the regressions of the time multiply it by exp(slope × predictor) (proportional hazards).'
                  : undefined
            }
          />
        ) : null;
      })}
      {r.fromModel && (
        <div className="hint">
          The diagram on the Model tab with its count indicators: count indicators load on their
          factors through the log link (rate ratios exp(loading) per unit of the factor); a
          zero-inflated one has an inflation intercept (its logit of a structural zero, Mplus u#1);
          a negative binomial one a dispersion (Mplus’s α = 1/θ).
        </div>
      )}
      <div className="hint">
        Maximum likelihood by numerical integration: {RULE[r.integration.type]} with{' '}
        {r.integration.points} {r.integration.type === 'mc' ? 'draws' : 'points per dimension'}
        {r.integration.adaptive
          ? ', adaptive (each case’s posterior mean and standard deviation, as Mplus)'
          : ''}
        ; up to {r.dims} dimension{r.dims === 1 ? '' : 's'} per case. Standard errors:{' '}
        {r.se === 'mlr' ? 'the sandwich (Mplus’s MLR)' : 'the observed information (ML)'}. Base R
        (optim) written out.{r.converged ? '' : ' The optimizer did not report convergence.'}
      </div>
    </div>
  );
}

/** The card's two inputs: Mplus-style syntax, or the CB-SEM diagram (count indicators). */
export const QUAD_SOURCES = ['syntax', 'model'] as const;
export const quadAnalysis: AnalysisType<QuadOptions, Result> = {
  id: 'quadml',
  title: 'Integration ML',
  sub: 'factors and random effects with censored, count, categorical or survival outcomes (Mplus syntax, numerical integration)',
  group: 'Measurement',
  entries: [
    {
      title: 'Integration ML',
      sub: 'factors and random effects with censored, count, categorical or survival outcomes (Mplus syntax, numerical integration)',
      options: (o) => o,
    },
    {
      title: 'Count indicators: the diagram by integration',
      sub: 'the CB-SEM diagram with count indicators (Poisson, negative binomial, zero-inflated), by numerical integration',
      options: (o) => ({ ...o, source: 'model' }),
    },
  ],
  cardTitle: (o) => (o.source === 'model' ? 'Integration ML: the diagram' : 'Integration ML'),
  defaults: () => ({ syntax: '' }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          syntax: typeof raw.syntax === 'string' ? raw.syntax.slice(0, 40000) : '',
          ...(raw.source === 'model' ? { source: 'model' as const } : {}),
        }
      : null,
  Options: QuadForm,
  View: ({ result }) => <QuadView r={result} />,
  blocked: (o, ctx) => {
    if (!rawData(ctx)) return 'Import raw data first.';
    if (o.source !== 'model' && !o.syntax.trim()) return 'Write the model (Mplus syntax).';
    try {
      quadSpec(o, ctx);
      return null;
    } catch (e) {
      if (e instanceof QuadSyntaxError) return e.message;
      throw e;
    }
  },
  // (the diagram's syntax and the cases kept: the card is stale when the diagram, its settings or the data change)
  fingerprint: (o, ctx) => {
    try {
      const q = quadSpec(o, ctx);
      return columnsFingerprint(ctx, q.spec.columns, [
        q.syntax,
        ...(o.source === 'model' ? ['model', q.data.cols[0]?.length ?? 0] : []),
      ]);
    } catch {
      return null;
    }
  },
  run: async (o, ctx) => {
    const q = quadSpec(o, ctx);
    const r = await (await import('../rengine/quadml')).quadR(q.data, q.spec);
    return o.source === 'model' ? { ...renamed(r, q.names), fromModel: true } : r;
  },
  script: async (o, ctx) => {
    const q = quadSpec(o, ctx);
    return (await import('../rengine/quadml')).quadScriptR(q.data, q.spec);
  },
  summary: (o) => {
    if (o.source === 'model') return 'the diagram (count indicators)';
    const m = /MODEL\s*:\s*([^;]+);/i.exec(o.syntax);
    return m ? m[1].trim().slice(0, 60) : 'no model';
  },
};

/** Open the Analyses tab on the integration card for the diagram: the existing one, or a new one. */
export async function openDiagramIntegration() {
  const { addAnalysis, selectCard, useAnalyses } = await import('./store');
  const { useStore } = await import('../store');
  const existing = useAnalyses
    .getState()
    .cards.find(
      (k) =>
        k.kind === 'analysis' &&
        k.type === 'quadml' &&
        (k.options as QuadOptions).source === 'model',
    );
  if (existing) selectCard(existing.id);
  else addAnalysis('quadml', { source: 'model' });
  useStore.getState().setWorkspace('analyses');
}
