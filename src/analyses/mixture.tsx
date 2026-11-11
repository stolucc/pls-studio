// Mixture model card: finite mixtures written in Mplus's syntax for TYPE = MIXTURE (mixture regression, latent class
// analysis with indicators of any type, covariates and direct effects, constraints, several latent class variables,
// known classes, factor and growth mixtures, latent transition and hidden Markov models). analyses/mixtureSyntax.ts
// reads the syntax with Mplus's defaults; R/mixture.R fits the likelihood (MLR standard errors).

import { c, Table } from '../components/results/Table';
import { fmt } from '../format';
import type { MixtureParam, MixtureResult } from '../rengine/mixture';
import { buildMixture, MixtureSyntaxError } from './mixtureSyntax';
import { clampNum, columnsFingerprint, isObj, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

/**
 * syntax: Mplus-style input (CLASSES, CATEGORICAL, …; MODEL: …); starts: random starts (absent: STARTS in the syntax,
 * else Mplus's 20, the best 4 continued); order: per latent class variable, the fitted class shown as class 1, 2, …
 */
export interface MixtureOptions {
  syntax: string;
  starts?: number;
  order?: Record<string, number[]>;
}

const EXAMPLE = 'CLASSES = c (2);\nMODEL:\n%OVERALL%\ny ON x;\nc ON x;\n%c#2%\ny ON x;\ny;';

/** The specification for R, or the syntax error. */
export function mixtureSpec(o: MixtureOptions, ctx: AnalysisCtx) {
  const data = rawData(ctx);
  if (!data) throw new MixtureSyntaxError('Import raw data first.');
  const parsed = buildMixture(o.syntax, data, { seed: ctx.settings.seed, starts: o.starts });
  if (o.order && Object.keys(o.order).length) {
    const order = parsed.classes.map(
      (cl) => o.order![cl.name] ?? Array.from({ length: cl.k }, (_, i) => i + 1),
    );
    order.forEach((p, v) => {
      const k = parsed.classes[v].k;
      if (p.length !== k || [...p].sort((a, b) => a - b).some((x, i) => x !== i + 1))
        throw new MixtureSyntaxError(
          `Class order of ${parsed.classes[v].name}: give each of its classes 1–${k} once.`,
        );
    });
    for (const name of Object.keys(o.order))
      if (!parsed.classes.some((cl) => cl.name === name))
        throw new MixtureSyntaxError(
          `Class order: ${name} is not a latent class variable of the model.`,
        );
    parsed.spec.order = order;
  }
  return parsed;
}

const orderText = (o?: Record<string, number[]>) =>
  Object.entries(o ?? {})
    .map(([k, v]) => `${k} = ${v.join(' ')}`)
    .join('; ');
function readOrder(s: string): Record<string, number[]> | undefined {
  const out: Record<string, number[]> = {};
  for (const part of s
    .split(/[;\n]/)
    .map((x) => x.trim())
    .filter(Boolean)) {
    const m = /^([A-Za-z_]\w*)\s*[=:]\s*([\d\s,]+)$/.exec(part);
    if (!m) continue;
    out[m[1].toLowerCase()] = m[2]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
  }
  return Object.keys(out).length ? out : undefined;
}

function MixtureForm({ options: o, set, ctx, disabled }: OptionsProps<MixtureOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) return <div className="empty-results">Import raw data first.</div>;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <div className="field">
        <label htmlFor="mix-syntax">Model (Mplus syntax)</label>
        <textarea
          id="mix-syntax"
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
          Mplus’s VARIABLE and ANALYSIS options (CLASSES, CATEGORICAL, NOMINAL, COUNT with (i) for
          zero inflation, CENSORED with (a) or (b), KNOWNCLASS, FREQWEIGHT, MISSING,
          PARAMETERIZATION = LOGIT, LOGLINEAR or PROBABILITY, STARTS) and its MODEL: %OVERALL% and
          class-specific parts (%c#1%, %cg#1.c#2%, MODEL c1:), BY, ON, WITH, growth (i s | y1@0 y2@1
          …), [means and thresholds], variances, @ fixed values, * starting values, (labels) for
          equality, MODEL CONSTRAINT with linear expressions. Mplus’s defaults: intercepts, means
          and thresholds differ between classes, variances, slopes and loadings do not, unless a
          class-specific part mentions them. Variables are the data’s columns; a range y1-y4 runs in
          column order. ALGORITHM = INTEGRATION (INTEGRATION = n, GAUSSHERMITE (n) or MONTECARLO
          (n); Mplus’s default 15 rectangular points per dimension, adaptive): factors of
          categorical, count or censored outcomes, c ON f, growth factors with variance; COUNT (nb)
          for negative binomial counts; MODEL CONSTRAINT with NEW parameters and non-linear
          expressions. TYPE = TWOLEVEL MIXTURE with CLUSTER, WITHIN, BETWEEN and %WITHIN% /
          %BETWEEN% parts: cluster-level random intercepts (y, c#1), between-level factors and
          latent class variables, random slopes with no variance (s | y ON x; s@0).
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="mix-starts">Random starts</label>
          <input
            id="mix-starts"
            className="input num"
            type="number"
            min={0}
            max={500}
            placeholder="STARTS or 20"
            value={o.starts ?? ''}
            onChange={(e) => {
              const v = Math.round(Number(e.target.value));
              set({
                ...o,
                starts:
                  e.target.value === '' || !Number.isFinite(v)
                    ? undefined
                    : Math.max(0, Math.min(500, v)),
              });
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="mix-order">Class order (optional)</label>
          <input
            id="mix-order"
            className="input"
            placeholder="c = 2 1"
            defaultValue={orderText(o.order)}
            onChange={(e) => set({ ...o, order: readOrder(e.target.value) })}
          />
        </div>
      </div>
      <div className="hint">
        Starts: the first from the syntax’s starting values (* or the defaults), the others
        perturbed at random (seed from the Model settings); a quarter of them, at least the best
        four, are continued to convergence, as Mplus’s STARTS. Class order: the class shown first,
        second, … for each latent class variable (classes are numbered arbitrarily; e.g. to compare
        with a published solution).
      </div>
    </fieldset>
  );
}

/** The heading a parameter is printed under: the classes it belongs to, or every class. */
export function blockOf(
  p: Pick<MixtureParam, 'lhs' | 'at' | 'level' | 'op'>,
  names: string[],
): string {
  if (p.op === 'new') return 'New parameters (MODEL CONSTRAINT)';
  // (two-level: the level first, as Mplus prints it)
  if (p.level)
    return `${p.level === 'between' ? 'Between' : 'Within'} level: ${blockOf({ ...p, level: undefined }, names)}`;
  if (names.some((n) => p.lhs.split('#')[0] === n))
    return p.at.some((a) => a > 0)
      ? `Latent class variables (${names
          .map((n, i) => (p.at[i] ? `${n}#${p.at[i]}` : ''))
          .filter(Boolean)
          .join(', ')})`
      : 'Latent class variables';
  const set = p.at.map((a, i) => (a ? `${names[i]}#${a}` : '')).filter(Boolean);
  return set.length ? `Class ${set.join(', ')}` : 'All classes';
}
const OP: Record<string, string> = {
  '~': 'ON',
  '=~': 'BY',
  '~~': 'WITH',
  '~1': 'Mean / intercept',
  '|': 'Threshold',
};
const label = (p: MixtureParam) =>
  p.op === 'new'
    ? p.lhs
    : p.op === '~1'
      ? `[${p.lhs}]`
      : p.op === '|'
        ? `${p.lhs}$${p.rhs.slice(1)}`
        : p.op === '~~' && p.lhs === p.rhs
          ? `${p.lhs} (variance)`
          : `${p.lhs} ${OP[p.op] ?? p.op} ${p.rhs}`;

function MixtureView({ r }: { r: MixtureResult }) {
  const names = r.classes.map((x) => x.name);
  const blocks = [...new Set(r.params.map((p) => blockOf(p, names)))].sort((a, b) =>
    a === 'All classes'
      ? -1
      : b === 'All classes'
        ? 1
        : a.startsWith('Latent')
          ? 1
          : b.startsWith('Latent')
            ? -1
            : a.localeCompare(b, undefined, { numeric: true }),
  );
  const z = (p: MixtureParam) => (p.se && !p.fixed ? p.est / p.se : null);
  const best = r.lls.filter((l) => Math.abs(l - r.lls[0]) < 1e-3).length;
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
            ['Entropy', r.entropy ?? NaN, 3],
          ] as const
        ).map(([k, v, d]) => (
          <div className="stat-card" key={k}>
            <div className="k">{k}</div>
            <div className="v">{Number.isFinite(v) ? fmt(v, d) : '—'}</div>
          </div>
        ))}
      </div>
      <div className="hint">
        The best log-likelihood was reached by {best} of the {r.lls.length} starts continued to
        convergence
        {best < 2 && r.lls.length > 1 ? ': increase the starts to make sure it is the maximum' : ''}
        .
      </div>
      {r.classes.map((cl) => (
        <Table
          key={cl.name}
          title={`Classes of ${cl.name}`}
          file={`mixture-classes-${cl.name}`}
          columns={['Class', 'Share']}
          rows={cl.shares.map((s, i) => [c(`${cl.name}#${i + 1}`), c(s)])}
          note="Shares from the posterior class probabilities (Mplus: final class counts based on the estimated model)."
        />
      ))}
      {r.classes.length > 1 && (
        <Table
          title="Joint classes"
          file="mixture-patterns"
          columns={['Pattern', 'Share']}
          rows={r.patterns.map((p) => [
            c(p.classes.map((k, i) => `${names[i]}#${k}`).join(' ')),
            c(p.share),
          ])}
        />
      )}
      {blocks.map((b) => (
        <Table
          key={b}
          title={b}
          file={`mixture-${b.replace(/\W+/g, '-').toLowerCase()}`}
          columns={['Parameter', 'Estimate', 'Robust SE', 'z']}
          rows={r.params
            .filter((p) => blockOf(p, names) === b)
            .map((p) => [c(label(p)), c(p.est), p.fixed ? c('fixed', 'dim') : c(p.se), c(z(p))])}
          note={
            b === 'Latent class variables' || b.startsWith('Latent class')
              ? 'Mplus’s parameterization: logits of each class against the last (c#1 ~1; ON for covariates and other latent class variables), loglinear associations (WITH), or probabilities (PARAMETERIZATION = PROBABILITY: c#1 ~1 the share, c2#1 ON c1#1 a transition probability).'
              : undefined
          }
        />
      ))}
      <div className="hint">
        Thresholds and logits are Mplus’s: P(u ≤ category j) = 1 / (1 + exp(−(threshold j − linear
        predictor))). Standard errors: the sandwich (Mplus’s MLR). Base R (optim) on the likelihood
        summed over the joint classes.
      </div>
    </div>
  );
}

export const mixtureAnalysis: AnalysisType<MixtureOptions, MixtureResult> = {
  id: 'mixture',
  title: 'Mixture model',
  sub: 'mixture regression, latent classes and transitions, factor and growth mixtures (Mplus syntax)',
  group: 'Measurement',
  defaults: () => ({ syntax: '' }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const o: MixtureOptions = {
      syntax: typeof raw.syntax === 'string' ? raw.syntax.slice(0, 40000) : '',
    };
    if (raw.starts !== undefined) o.starts = clampNum(raw.starts, 0, 500, 20, true);
    if (isObj(raw.order)) {
      const ord: Record<string, number[]> = {};
      for (const [k, v] of Object.entries(raw.order))
        if (Array.isArray(v) && v.length <= 12 && v.every((x) => Number.isInteger(x)))
          ord[k.slice(0, 50)] = v as number[];
      if (Object.keys(ord).length) o.order = ord;
    }
    return o;
  },
  Options: MixtureForm,
  View: ({ result }) => <MixtureView r={result} />,
  blocked: (o, ctx) => {
    if (!rawData(ctx)) return 'Import raw data first.';
    if (!o.syntax.trim()) return 'Write the model (Mplus syntax).';
    try {
      mixtureSpec(o, ctx);
      return null;
    } catch (e) {
      if (e instanceof MixtureSyntaxError) return e.message;
      throw e;
    }
  },
  fingerprint: (o, ctx) => {
    try {
      return columnsFingerprint(ctx, mixtureSpec(o, ctx).spec.columns, [
        ctx.settings.seed,
        o.syntax,
        o.starts ?? '',
        orderText(o.order),
      ]);
    } catch {
      return null;
    }
  },
  run: async (o, ctx) =>
    (await import('../rengine/mixture')).mixtureR(rawData(ctx)!, mixtureSpec(o, ctx).spec),
  script: async (o, ctx) =>
    (await import('../rengine/mixture')).mixtureScriptR(rawData(ctx)!, mixtureSpec(o, ctx).spec),
  summary: (o) => {
    const m = /CLASSES\s*=\s*([^;]+);/i.exec(o.syntax);
    return m ? `classes ${m[1].trim()}` : 'no model';
  },
};
