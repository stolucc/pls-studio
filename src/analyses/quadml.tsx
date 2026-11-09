// Integration card: maximum likelihood by numerical integration (Mplus's ALGORITHM = INTEGRATION) for structural
// equation models written in Mplus's syntax whose outcomes are censored, counts, categorical, survival times or normal
// outcomes of products of factors (XWITH), with factors, growth factors or random effects; continuous outcomes and
// continuous mediators missing for some cases are integrated over where missing. analyses/quadmlSyntax.ts reads the
// syntax with Mplus's defaults; R/quadml.R fits the likelihood (MLR standard errors).

import { c, Table } from '../components/results/Table';
import { fmt } from '../format';
import type { QuadParam, QuadResult } from '../rengine/quadml';
import { buildQuad, QuadSyntaxError } from './quadmlSyntax';
import { columnsFingerprint, isObj, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

/** syntax: Mplus-style input (VARIABLE and ANALYSIS options; MODEL: …). */
export interface QuadOptions { syntax: string }

const EXAMPLE = 'CATEGORICAL = u1-u4;\nMODEL:\nf BY u1-u4;\nf ON x;';

/** The specification for R, or the syntax error. */
export function quadSpec(o: QuadOptions, ctx: AnalysisCtx) {
  const data = rawData(ctx);
  if (!data) throw new QuadSyntaxError('Import raw data first.');
  return buildQuad(o.syntax, data);
}

function QuadForm({ options: o, set, ctx, disabled }: OptionsProps<QuadOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) return <div className="empty-results">Import raw data first.</div>;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <div className="field">
        <label htmlFor="quad-syntax">Model (Mplus syntax)</label>
        <textarea id="quad-syntax" className="input" rows={Math.min(30, Math.max(8, o.syntax.split('\n').length + 1))} spellCheck={false} maxLength={40000} value={o.syntax} placeholder={EXAMPLE}
          onChange={(e) => set({ ...o, syntax: e.target.value })} style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12, width: '100%', resize: 'vertical' }} />
        <div className="hint">
          Mplus’s VARIABLE and ANALYSIS options: CATEGORICAL (ordered, logit or LINK = PROBIT), COUNT (Poisson; (i) zero-inflated; (nb) negative binomial), CENSORED with (a) or (b) and inflated (ai) or (bi), SURVIVAL = t (intervals, e.g. 20*1) with TIMECENSORED (continuous-time survival, the baseline hazard of each interval), ESTIMATOR = ML or MLR, INTEGRATION = n, STANDARD (n), GAUSSHERMITE (n) or MONTECARLO (n), ADAPTIVE = OFF. MODEL: BY, growth (i s | y1@0 y2@1 …; the inflation of zero-inflated counts or censored-inflated outcomes: ii si | y1#1@0 …), XWITH (f2 | f XWITH f), ON, WITH, [means, thresholds u$1, inflations u#1, base hazards t#1-t#21], variances, @ fixed values, * starting values, (labels) for equality. Mplus’s defaults: the first loading of a factor fixed at 1, factor means 0 (growth factor means free), independent factors and growth factors correlated, thresholds of a growth model equal over time. Continuous variables that predict another outcome and are missing are integrated over. Variables are the data’s columns; a range y1-y4 runs in column order.
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
  { title: 'Variances and covariances', test: (p) => p.op === '~~', label: (p) => (p.lhs === p.rhs ? `${p.lhs} (variance)` : `${p.lhs} WITH ${p.rhs}`) },
  { title: 'Base hazards', test: (p) => p.op === 'hazard', label: (p) => p.lhs },
  { title: 'Dispersion', test: (p) => p.op === 'dispersion', label: (p) => p.lhs },
];
const RULE = { rect: 'rectangular (Mplus’s STANDARD)', gh: 'Gauss–Hermite', mc: 'Monte Carlo' } as const;

function QuadView({ r }: { r: QuadResult }) {
  const z = (p: QuadParam) => (p.se && !p.fixed ? p.est / p.se : null);
  return (
    <div className="tables">
      <div className="stat-cards">
        {([['n', r.n, 0], ['Log-likelihood', r.logLik, 3], ['Parameters', r.npar, 0], ['AIC', r.aic, 3], ['BIC', r.bic, 3], ['Dimensions', r.dims, 0]] as const).map(([k, v, d]) => (
          <div className="stat-card" key={k}><div className="k">{k}</div><div className="v">{Number.isFinite(v) ? fmt(v, d) : '—'}</div></div>
        ))}
      </div>
      {GROUPS.map((g) => {
        const rows = r.params.filter(g.test);
        return rows.length ? <Table key={g.title} title={g.title} file={`quadml-${g.title.replace(/\W+/g, '-').toLowerCase()}`} columns={['Parameter', 'Estimate', r.se === 'mlr' ? 'Robust SE' : 'Std. error', 'z']}
          rows={rows.map((p) => [c(g.label(p)), c(p.est), p.fixed ? c('fixed', 'dim') : c(p.se), c(z(p))])}
          note={g.title === 'Thresholds' ? 'Mplus’s parameterization: P(u ≤ category j) = F(threshold j − linear predictor), F logistic (or normal with LINK = PROBIT).' : g.title === 'Base hazards' ? 'The baseline hazard in each interval of the survival time; the regressions of the time multiply it by exp(slope × predictor) (proportional hazards).' : undefined} /> : null;
      })}
      <div className="hint">Maximum likelihood by numerical integration: {RULE[r.integration.type]} with {r.integration.points} {r.integration.type === 'mc' ? 'draws' : 'points per dimension'}{r.integration.adaptive ? ', adaptive (each case’s posterior mean and standard deviation, as Mplus)' : ''}; up to {r.dims} dimension{r.dims === 1 ? '' : 's'} per case. Standard errors: {r.se === 'mlr' ? 'the sandwich (Mplus’s MLR)' : 'the observed information (ML)'}. Base R (optim) written out.{r.converged ? '' : ' The optimizer did not report convergence.'}</div>
    </div>
  );
}

export const quadAnalysis: AnalysisType<QuadOptions, QuadResult> = {
  id: 'quadml',
  title: 'Integration ML',
  sub: 'factors and random effects with censored, count, categorical or survival outcomes (Mplus syntax, numerical integration)',
  group: 'Measurement',
  defaults: () => ({ syntax: '' }),
  parseOptions: (raw) => (isObj(raw) ? { syntax: typeof raw.syntax === 'string' ? raw.syntax.slice(0, 40000) : '' } : null),
  Options: QuadForm,
  View: ({ result }) => <QuadView r={result} />,
  blocked: (o, ctx) => {
    if (!rawData(ctx)) return 'Import raw data first.';
    if (!o.syntax.trim()) return 'Write the model (Mplus syntax).';
    try { quadSpec(o, ctx); return null; } catch (e) { if (e instanceof QuadSyntaxError) return e.message; throw e; }
  },
  fingerprint: (o, ctx) => { try { return columnsFingerprint(ctx, quadSpec(o, ctx).spec.columns, [o.syntax]); } catch { return null; } },
  run: async (o, ctx) => (await import('../rengine/quadml')).quadR(rawData(ctx)!, quadSpec(o, ctx).spec),
  script: async (o, ctx) => (await import('../rengine/quadml')).quadScriptR(rawData(ctx)!, quadSpec(o, ctx).spec),
  summary: (o) => { const m = /MODEL\s*:\s*([^;]+);/i.exec(o.syntax); return m ? m[1].trim().slice(0, 60) : 'no model'; },
};
