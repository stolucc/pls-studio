// Bayesian multilevel / DSEM card: two-level, three-level and cross-classified models with random intercepts, slopes,
// loadings and residual variances, and dynamic SEM (lagged effects of observed variables and factors, N = 1 time series
// and many subjects), written in Mplus's syntax (analyses/dsemSyntax.ts) and estimated by MCMC: a Stan program written
// from the model and sampled by rstan in desktop R through the helper (R/dsem.R). Mplus's default priors (flat).

import { c, Table, type Row } from '../components/results/Table';
import { columnsIn, parseFormula } from '../data/compute';
import { fmt } from '../format';
import { useCompute } from '../rengine/compute';
import type { DsemParameter, DsemResult } from '../rengine/dsem';
import { clampNum, columnsFingerprint, isObj, rawData, rhatClass } from './common';
import { dsemData, DsemSyntaxError, parseDsem } from './dsemSyntax';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

/**
 * syntax: Mplus-style input (VARIABLE and DEFINE options, MODEL); chains, warm-up and draws per chain of Stan's sampler;
 * parametrization 'noncentred': every level's random effects sampled standardised (absent: centred where clusters have
 * 20 or more rows each, which suits random effects the clusters' data determine well; random effects whose variances
 * are near 0, such as a random log residual variance or trend that hardly varies, mix better standardised).
 */
export interface DsemOptions {
  syntax: string;
  chains: number;
  warmup: number;
  draws: number;
  parametrization?: 'noncentred';
}

const EXAMPLE =
  'CLUSTER = subject;\nLAGGED = y(1);\nTYPE = TWOLEVEL RANDOM;\nMODEL:\n%WITHIN%\ns | y ON y&1;\n%BETWEEN%\ny WITH s;';

/** The model for R and the data with DEFINE's columns, or the syntax error. */
export function dsemModel(o: DsemOptions, ctx: AnalysisCtx) {
  const data = rawData(ctx);
  if (!data) throw new DsemSyntaxError('Import raw data first.');
  const parsed = parseDsem(o.syntax, data);
  return { ...parsed, data: parsed.define.length ? dsemData(data, parsed.define) : data };
}

/** The data columns the model reads (for the fingerprint). */
function modelColumns(o: DsemOptions, ctx: AnalysisCtx): string[] | null {
  try {
    const { spec, define } = dsemModel(o, ctx);
    const made = new Set(define.map((d) => d.name));
    const used = [
      ...spec.levels.map((l) => l.column),
      ...spec.nodes.flatMap((n) => (n.column ? [n.column] : [])),
      ...spec.btargets.flatMap((t) => (t.column ? [t.column] : [])),
      ...spec.bterms.flatMap((t) => (t.x ? [t.x] : [])),
      ...(spec.series.time ? [spec.series.time] : []),
      ...define.flatMap((d) => columnsIn(parseFormula(d.expr))),
    ];
    return [...new Set(used.filter((x) => !made.has(x) || rawData(ctx)!.names.includes(x)))];
  } catch {
    return null;
  }
}

function DsemForm({ options: o, set, ctx, disabled }: OptionsProps<DsemOptions>) {
  if (!rawData(ctx)) return <div className="empty-results">Import raw data first.</div>;
  const n =
    (k: 'chains' | 'warmup' | 'draws', lo: number, hi: number) =>
    (e: { target: { value: string } }) => {
      const v = Math.round(Number(e.target.value));
      if (Number.isFinite(v) && v >= lo && v <= hi) set({ ...o, [k]: v });
    };
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Estimated by MCMC: a Stan program written from the model, compiled once (a C++ toolchain is
        needed: Xcode Command Line Tools on macOS, Rtools on Windows) and sampled by rstan in
        desktop R through the PLS Studio Helper; Stan does not run in the browser.
      </p>
      <div className="field">
        <label htmlFor="dsem-syntax">Model (Mplus syntax)</label>
        <textarea
          id="dsem-syntax"
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
          Mplus’s VARIABLE options CATEGORICAL (binary, probit), WITHIN, BETWEEN (with (cluster) for
          two cluster variables), CLUSTER, LAGGED = y(1), TINTERVAL = time (step); DEFINE: CENTER x
          (GROUPMEAN) and new variables (timescor = (time − 1)/100); TYPE = TWOLEVEL, THREELEVEL or
          CROSSCLASSIFIED (RANDOM), or no TYPE for an N = 1 time series. MODEL: %WITHIN% and
          %BETWEEN% (%BETWEEN cluster% for two cluster variables) with BY, ON, WITH, random slopes
          and loadings (s | y ON x; s1-s4 | f BY y1-y4), random residual variances (logv | y), lags
          (y&1; a factor’s with (&1) after its BY list), [means and thresholds], variances, @ fixed
          values, (labels) for equal parameters across statements and levels. MODEL PRIORS: label ~
          N(mean, variance) for a labelled parameter (a range of labels: lam2-lam4). Mplus’s
          defaults: the first loading fixed at 1, every outcome’s intercept random over the clusters
          (unless WITHIN), random effects uncorrelated unless WITH, residual covariances among final
          outcomes; flat priors (N(0, 5) for the loadings and thresholds of binary outcomes). Lagged
          values before a series’ first occasion and missing outcomes are sampled as missing data;
          TINTERVAL inserts the occasions a series skips.
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="dsem-ch">Chains</label>
          <input
            id="dsem-ch"
            className="input num"
            type="number"
            min={1}
            max={8}
            value={o.chains}
            onChange={n('chains', 1, 8)}
          />
        </div>
        <div className="field">
          <label htmlFor="dsem-wu">Warm-up per chain</label>
          <input
            id="dsem-wu"
            className="input num"
            type="number"
            min={100}
            max={100000}
            step={100}
            value={o.warmup}
            onChange={n('warmup', 100, 100000)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="dsem-dr">Draws per chain</label>
        <input
          id="dsem-dr"
          className="input num"
          type="number"
          min={100}
          max={100000}
          step={100}
          value={o.draws}
          onChange={n('draws', 100, 100000)}
        />
        <div className="hint">
          Stan’s sampler (NUTS) mixes far better per draw than Mplus’s Gibbs sampler: 2 chains of
          1,000 draws after 1,000 warm-up usually suffice; check R-hat and n_eff. The seed is the
          project’s.
        </div>
      </div>
      <div className="field">
        <label htmlFor="dsem-par">Random effects sampled</label>
        <select
          id="dsem-par"
          className="input"
          value={o.parametrization ?? 'auto'}
          onChange={(e) => {
            const { parametrization: _p, ...rest } = o;
            set(
              e.target.value === 'noncentred' ? { ...rest, parametrization: 'noncentred' } : rest,
            );
          }}
        >
          <option value="auto">centred where clusters have 20 or more rows (default)</option>
          <option value="noncentred">standardised (non-centred) on every level</option>
        </select>
        <div className="hint">
          Standardised suits random effects whose variances are near 0 (a random log variance or
          trend that hardly varies): with many divergent transitions or a large R-hat, try it.
        </div>
      </div>
    </fieldset>
  );
}

const rhatCell = (v: number | null) => (v === null ? c(null) : { v: fmt(v, 3), cls: rhatClass(v) });
/** A parameter as Mplus words it. */
const label = (p: DsemParameter) => {
  if (p.op === '~1') return `${p.lhs} (mean or intercept)`;
  if (p.op === '|') return `${p.lhs}$1 (threshold)`;
  if (p.op === '=~') return `${p.lhs} BY ${p.rhs}`;
  if (p.op === '~') return `${p.lhs} ON ${p.rhs}`;
  if (p.lhs === p.rhs) return `${p.lhs} (variance)`;
  return `${p.lhs} WITH ${p.rhs}`;
};
/** The multilevel structure an Mplus input declares. */
const levelsOf = (syntax: string) => {
  if (/CROSSCLASSIFIED/i.test(syntax)) return 'cross-classified';
  if (/THREELEVEL/i.test(syntax)) return 'three-level';
  if (/TWOLEVEL/i.test(syntax)) return 'two-level';
  return 'single-level';
};

function DsemView({ r }: { r: DsemResult }) {
  const blocks = [...new Set(r.parameters.map((p) => p.block))];
  const pct = `${Math.round(r.confidence * 100)}%`;
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.chains} chains × {r.draws.toLocaleString('en')} draws after{' '}
        {r.warmup.toLocaleString('en')} warm-up, seed {r.seed}; {r.n.toLocaleString('en')} rows
        {r.clusters.length
          ? `, ${r.clusters.map((k) => k.toLocaleString('en')).join(' and ')} clusters`
          : ''}
        {r.series > 1 ? `, ${r.series} series` : ''}; {r.npar} free parameters; rstan{' '}
        {r.engine.version}
        {r.engine.desktop ? ` in desktop ${r.engine.desktop}` : ''}.
      </p>
      <div className="stat-cards">
        <div className="stat-card">
          <div className="k">Converged</div>
          <div className={`v ${r.converged ? 'good' : 'bad'}`}>{r.converged ? 'yes' : 'no'}</div>
        </div>
        <div className="stat-card">
          <div className="k">Largest R-hat</div>
          <div className={`v ${rhatClass(r.maxRhat ?? 9)}`}>
            {r.maxRhat === null ? '—' : fmt(r.maxRhat, 3)}
          </div>
        </div>
        <div className="stat-card">
          <div className="k">Smallest n_eff</div>
          <div className={`v ${(r.minNeff ?? 0) < 400 ? 'warn' : ''}`}>
            {r.minNeff === null ? '—' : fmt(r.minNeff, 0)}
          </div>
        </div>
        <div className="stat-card">
          <div className="k">Divergent transitions</div>
          <div className={`v ${r.divergent ? 'warn' : 'good'}`}>{r.divergent}</div>
        </div>
      </div>
      {!r.converged && (
        <p className="hint" style={{ color: 'var(--bad)' }}>
          The chains did not converge (an R-hat of 1.05 or more): the estimates below are not
          reliable. Run more warm-up and draws, or another seed.
        </p>
      )}
      {blocks.map((b) => (
        <Table
          key={b || 'model'}
          title={b || 'Model results'}
          file={`dsem-${(b || 'model').replace(/\W+/g, '-').toLowerCase()}`}
          columns={[
            'Parameter',
            'Posterior median',
            'Posterior SD',
            'One-tailed p',
            `${pct} credible interval`,
            'R-hat',
            'n_eff',
          ]}
          rows={r.parameters
            .filter((p) => p.block === b)
            .map(
              (p): Row =>
                p.fixed
                  ? [
                      c(label(p)),
                      c(p.median),
                      c('fixed', 'dim'),
                      c(null),
                      c(null),
                      c(null),
                      c(null),
                    ]
                  : [
                      c(label(p)),
                      c(p.median),
                      c(p.sd),
                      c(p.pOne),
                      c(`[${fmt(p.low)}, ${fmt(p.high)}]`),
                      rhatCell(p.rhat),
                      c(p.neff, undefined, 0),
                    ],
            )}
        />
      ))}
      <p className="hint">
        As Mplus prints a Bayesian analysis: posterior medians, posterior SDs, one-tailed p (the
        posterior share on the other side of 0) and equal-tailed credible intervals. Random effects’
        means and (co)variances are on the between levels; a random log residual variance (logv) is
        on the log scale. R-hat compares the chains (1.05 or more: not converged); n_eff is the
        number of independent draws they are worth.
      </p>
    </div>
  );
}

export const dsemAnalysis: AnalysisType<DsemOptions, DsemResult> = {
  id: 'dsem',
  title: 'Bayesian multilevel / DSEM (Stan)',
  sub: 'random effects, cross-classified and dynamic SEM (lags, random AR and log variances) in Mplus syntax; desktop R',
  group: 'Longitudinal',
  defaults: () => ({ syntax: '', chains: 2, warmup: 1000, draws: 1000 }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          syntax: typeof raw.syntax === 'string' ? raw.syntax.slice(0, 40000) : '',
          chains: clampNum(raw.chains, 1, 8, 2, true),
          warmup: clampNum(raw.warmup, 100, 100000, 1000, true),
          draws: clampNum(raw.draws, 100, 100000, 1000, true),
          ...(raw.parametrization === 'noncentred'
            ? { parametrization: 'noncentred' as const }
            : {}),
        }
      : null,
  Options: DsemForm,
  View: ({ result }) => <DsemView r={result} />,
  blocked: (o, ctx) => {
    if (!rawData(ctx)) return 'Import raw data first.';
    if (!o.syntax.trim()) return 'Write the model (Mplus syntax).';
    try {
      dsemModel(o, ctx);
    } catch (e) {
      if (e instanceof DsemSyntaxError) return e.message;
      return (e as Error).message;
    }
    if (useCompute.getState().backend !== 'helper')
      return 'Bayesian multilevel and DSEM models run in desktop R (Stan does not run in the browser): choose Desktop R (helper) under R runs in, on the Model tab, with the PLS Studio Helper running.';
    return null;
  },
  fingerprint: (o, ctx) => {
    const cols = modelColumns(o, ctx);
    return (
      cols &&
      columnsFingerprint(ctx, cols, [
        o.syntax,
        o.chains,
        o.warmup,
        o.draws,
        ctx.settings.seed,
        ctx.settings.confidence,
        ...(o.parametrization ? [o.parametrization] : []),
      ])
    );
  },
  run: async (o, ctx) => {
    const m = dsemModel(o, ctx);
    return (await import('../rengine/dsem')).dsemR(
      m.data,
      m.spec,
      o,
      ctx.settings.seed,
      ctx.settings.confidence,
    );
  },
  script: async (o, ctx) => {
    const m = dsemModel(o, ctx);
    return (await import('../rengine/dsem')).dsemScriptR(
      m.data,
      m.spec,
      o,
      ctx.settings.seed,
      ctx.settings.confidence,
    );
  },
  summary: (o) => {
    if (!o.syntax.trim()) return 'not set up yet';
    // Lagged variables (y&1) make it a dynamic SEM.
    const dynamic = /&\d/.test(o.syntax) ? ' DSEM' : '';
    const parametrization = o.parametrization ? ' (non-centred)' : '';
    return `${levelsOf(o.syntax)}${dynamic} · ${o.chains} chains × ${o.draws}${parametrization}`;
  },
};
