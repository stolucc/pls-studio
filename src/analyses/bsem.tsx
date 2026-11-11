// Bayesian SEM card: the CB-SEM model of the diagram fitted by blavaan (Stan) in
// desktop R through the helper. Convergence first (R-hat, effective sample
// sizes), then blavaan's fit measures and the posterior of every parameter;
// optionally Mplus's default priors, priors on labelled parameters (MODEL
// PRIORS), approximate invariance across groups (DIFF priors, blavaan's wiggle),
// a defined quantity over a moderator (LOOP) and plausible values. Or the same
// model by INLAvaan (approximate Bayesian inference, also in the browser): its
// diagnostics of the approximation instead of R-hat, and default priors by type.

import { useState } from 'react';
import { ChartFrame } from '../components/ChartFrame';
import { c, Table, type Row } from '../components/results/Table';
import { fmt } from '../format';
import { namesIn, parseExpr } from '../model/expr';
import { labelUses, toSpec, validateModel } from '../model/project';
import { useCompute } from '../rengine/compute';
import type {
  BsemLoop,
  BsemLoopResult,
  BsemOptions,
  BsemPrior,
  BsemResult,
  InlaPriorType,
} from '../rengine/bsem';
import { Choice, clampNum, columnsFingerprint, isObj, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';
import { fingerprint } from './codec';

const engine = () => import('../rengine/bsem');
/** MCMC (blavaan, desktop R) or the INLA approximation (INLAvaan). */
export const BSEM_ENGINES = ['blavaan', 'inlavaan'] as const;
const pct = (conf: number) => `${Math.round(conf * 100)}%`;
const modelIndicators = (ctx: AnalysisCtx) => [
  ...new Set((ctx.model?.constructs ?? []).flatMap((k) => k.indicators)),
];
const OP_NAME: Record<string, string> = {
  '=~': 'Loadings',
  '~': 'Regressions',
  '~~': 'Variances and covariances',
  '~1': 'Intercepts and means',
  '|': 'Thresholds',
};
const OP_FILE: Record<string, string> = {
  '=~': 'loadings',
  '~': 'regressions',
  '~~': 'covariances',
  '~1': 'means',
  '|': 'thresholds',
};

// ---- INLAvaan's default priors by parameter type (priors_for) ----

export const INLA_PRIOR_TYPES: readonly InlaPriorType[] = [
  'lambda',
  'beta',
  'nu',
  'alpha',
  'tau',
  'theta',
  'psi',
  'rho',
];
/** INLAvaan's own defaults (priors_for()). */
export const INLA_PRIOR_DEFAULTS: Record<InlaPriorType, string> = {
  lambda: 'normal(0,10)',
  beta: 'normal(0,10)',
  nu: 'normal(0,32)',
  alpha: 'normal(0,10)',
  tau: 'normal(0,1.5)',
  theta: 'gamma(1,.5)[sd]',
  psi: 'gamma(1,.5)[sd]',
  rho: 'beta(1,1)',
};
const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const PRIOR_RE = new RegExp(
  `^\\s*(normal|gamma|beta)\\s*\\(\\s*(${NUM})\\s*,\\s*(${NUM})\\s*\\)\\s*(\\[sd\\]|\\[prec\\])?\\s*$`,
);
/** A default prior as INLAvaan writes it, checked and rewritten from its numbers: normal(mean, SD) for loadings, regressions, intercepts, means and thresholds; gamma(shape, rate) on a variance ([sd]: on the SD; [prec]: on the precision); beta(a, b) on a correlation. Null when invalid. */
export function inlaPrior(type: InlaPriorType, text: string): string | null {
  const m = text.length <= 60 ? PRIOR_RE.exec(text) : null;
  if (!m) return null;
  const family = type === 'theta' || type === 'psi' ? 'gamma' : type === 'rho' ? 'beta' : 'normal';
  const a = Number(m[2]),
    b = Number(m[3]);
  if (
    m[1] !== family ||
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !(b > 0) ||
    (family !== 'normal' && !(a > 0)) ||
    (m[4] && family !== 'gamma')
  )
    return null;
  return `${family}(${a},${b})${m[4] ?? ''}`;
}

// ---- Priors on labelled parameters, written as Mplus's MODEL PRIORS: "xload1-xload6 ~ N(0, 0.01);" ----

/** Labels with a numeric suffix as a range (dir1-dir18), or one by one. */
function expandLabels(text: string): string[] {
  return text
    .replace(/\s*-\s*/g, '-')
    .split(/[\s,]+/)
    .filter(Boolean)
    .flatMap((t) => {
      const parts = t.split('-');
      if (parts.length === 1) return [t];
      const m = parts.map((p) => /^([A-Za-z][A-Za-z0-9_]*?)(\d+)$/.exec(p));
      if (
        parts.length !== 2 ||
        !m[0] ||
        !m[1] ||
        m[0][1] !== m[1][1] ||
        Number(m[1][2]) < Number(m[0][2])
      )
        throw new Error(`“${t}” is not a range of labels (such as dir1-dir18).`);
      return Array.from(
        { length: Number(m[1][2]) - Number(m[0][2]) + 1 },
        (_, i) => `${m[0]![1]}${Number(m[0]![2]) + i}`,
      );
    });
}
/** Parse prior lines "labels ~ N(mean, variance)"; throws with a readable message. */
export function parsePriors(text: string): BsemPrior[] {
  return text
    .split(/[;\n]/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m =
        /^(.+?)~\s*N\s*\(\s*([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s*,\s*([\d.]+(?:[eE][-+]?\d+)?)\s*\)$/i.exec(
          l,
        );
      if (!m)
        throw new Error(
          `“${l}”: write a prior as labels ~ N(mean, variance), for example xload1-xload6 ~ N(0, 0.01).`,
        );
      const mean = Number(m[2]),
        variance = Number(m[3]);
      if (!Number.isFinite(mean) || !(variance > 0))
        throw new Error(`“${l}”: the variance must be positive.`);
      return { labels: expandLabels(m[1]), mean, variance };
    });
}
/** Ranges are kept as typed only in the text box: the stored form lists every label. */
export const printPriors = (ps: BsemPrior[]) =>
  ps.map((p) => `${p.labels.join(' ')} ~ N(${p.mean}, ${p.variance});`).join('\n');

function PriorBox({ value, onChange }: { value: BsemPrior[]; onChange: (v: BsemPrior[]) => void }) {
  const [text, setText] = useState(printPriors(value));
  const [err, setErr] = useState<string | null>(null);
  const commit = (t: string) => {
    try {
      onChange(parsePriors(t));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="field">
      <label htmlFor="bs-pri">Priors on labelled parameters</label>
      <textarea
        id="bs-pri"
        className="input"
        rows={3}
        value={text}
        placeholder="xload1-xload6 ~ N(0, 0.01);"
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
      />
      <div className="hint">
        {err ??
          'As Mplus’s MODEL PRIORS: labels (a range such as dir1-dir18) ~ N(mean, variance). A zero mean and a small variance (0.01) lets cross-loadings and direct effects be near zero rather than zero (BSEM, Muthén & Asparouhov 2012).'}
      </div>
    </div>
  );
}

const PRIOR_TYPE_NAME: Record<InlaPriorType, string> = {
  lambda: 'Loadings',
  beta: 'Regressions',
  nu: 'Intercepts',
  alpha: 'Latent means',
  tau: 'Thresholds',
  theta: 'Residual variances',
  psi: 'Factor variances',
  rho: 'Correlations',
};

/** INLAvaan's default priors by parameter type: its own until changed. */
function TypePriors({
  value,
  onChange,
}: {
  value: Partial<Record<InlaPriorType, string>>;
  onChange: (v: Partial<Record<InlaPriorType, string>>) => void;
}) {
  const [text, setText] = useState<Partial<Record<InlaPriorType, string>>>(value);
  const [err, setErr] = useState<string | null>(null);
  const commit = (t: InlaPriorType, s: string) => {
    if (!s.trim() || s.trim() === INLA_PRIOR_DEFAULTS[t]) {
      const { [t]: _x, ...rest } = value;
      onChange(rest);
      setErr(null);
      return;
    }
    const p = inlaPrior(t, s);
    if (!p) {
      setErr(
        `${PRIOR_TYPE_NAME[t]}: write ${t === 'rho' ? 'beta(a, b)' : t === 'theta' || t === 'psi' ? 'gamma(shape, rate), on the variance, or with [sd] on the SD' : 'normal(mean, SD)'}.`,
      );
      return;
    }
    onChange({ ...value, [t]: p });
    setErr(null);
  };
  return (
    <div className="field">
      <label>Default priors by parameter type</label>
      <div className="row2" style={{ flexWrap: 'wrap' }}>
        {INLA_PRIOR_TYPES.map((t) => (
          <div key={t} className="field">
            <label htmlFor={`bs-dp-${t}`}>{PRIOR_TYPE_NAME[t]}</label>
            <input
              id={`bs-dp-${t}`}
              className="input"
              value={text[t] ?? ''}
              placeholder={INLA_PRIOR_DEFAULTS[t]}
              onChange={(e) => setText({ ...text, [t]: e.target.value })}
              onBlur={(e) => commit(t, e.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="hint">
        {err ??
          'As INLAvaan’s priors_for(): normal(mean, SD); gamma(shape, rate) on a variance, [sd] on the SD, [prec] on the precision; beta(a, b) on a correlation (on −1 to 1). Empty: INLAvaan’s default (shown).'}
      </div>
    </div>
  );
}

function BsemForm({ options: o, set, disabled, ctx }: OptionsProps<BsemOptions>) {
  const n =
    (k: 'chains' | 'burnin' | 'sample', lo: number, hi: number) =>
    (e: { target: { value: string } }) => {
      const v = Math.round(Number(e.target.value));
      if (Number.isFinite(v) && v >= lo && v <= hi) set({ ...o, [k]: v });
    };
  const groups = !!ctx?.model?.multigroup;
  const inla = o.engine === 'inlavaan';
  const loop = o.loop;
  const setLoop = (p: Partial<BsemLoop>) => set({ ...o, loop: { ...loop!, ...p } });
  const lnum = (k: 'from' | 'to' | 'by') => (e: { target: { value: string } }) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) setLoop({ [k]: v });
  };
  const priorKind = o.priors === 'mplus' ? 'mplus' : inla && o.defaultPriors ? 'custom' : 'package';
  const setPriors = (p: 'package' | 'mplus' | 'custom') => {
    const { priors: _p, defaultPriors: _d, ...rest } = o;
    set(
      p === 'mplus'
        ? { ...rest, priors: 'mplus' }
        : p === 'custom'
          ? { ...rest, defaultPriors: {} }
          : rest,
    );
  };
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Choice
        label="Engine"
        value={inla ? 'inlavaan' : 'blavaan'}
        onChange={(e) => {
          const { engine: _e, defaultPriors: _d, wiggle: _w, ...rest } = o;
          set(e === 'inlavaan' ? { ...rest, engine: 'inlavaan' } : rest);
        }}
        options={[
          ['blavaan', 'blavaan (MCMC)'],
          ['inlavaan', 'INLAvaan (approximate)'],
        ]}
        hint={
          inla
            ? 'INLAvaan (Jamil & Rue): approximate Bayesian inference without MCMC — the posterior mode, a Laplace approximation with a variational-Bayes correction of the mean, and skew-normal marginals. Seconds instead of minutes, in the browser or desktop R; no chains, so no R-hat: check its diagnostics instead.'
            : 'blavaan with Stan: MCMC, the reference for Bayesian SEM, in desktop R through the PLS Studio Helper (Stan does not run in the browser).'
        }
      />
      <Choice
        label="Identification of the factors"
        value={o.identification}
        onChange={(identification) => set({ ...o, identification })}
        options={[
          ['unit', 'Unit factor variances'],
          ['marker', 'Marker indicators (as the diagram)'],
        ]}
        hint={
          o.identification === 'unit'
            ? `Each factor’s variance fixed at 1, every loading estimated (lavaan’s std.lv)${inla ? '' : ': the chains mix more reliably'}. The loadings are then on the standardised-factor scale.`
            : `The first loading of each factor fixed at 1, as in the ML fit.${inla ? ' Its loadings’ posteriors are skewed more, which the approximation finds harder.' : ' Chains can get stuck in a second mode; check R-hat.'}`
        }
      />
      <Choice
        label="Default priors"
        value={priorKind}
        onChange={setPriors}
        options={
          inla
            ? [
                ['package', 'INLAvaan’s'],
                ['mplus', 'Mplus’s (flat)'],
                ['custom', 'By parameter type'],
              ]
            : [
                ['package', 'blavaan’s'],
                ['mplus', 'Mplus’s (flat)'],
              ]
        }
        hint={
          o.priors === 'mplus'
            ? 'Mplus’s defaults: flat for loadings, regressions, intercepts and means (N(0, 10⁶) here), flat for variances (IG(−1, 0)) and covariance matrices (IW(0, −p−1); here a uniform correlation with variance priors that make a pair’s covariance matrix flat), N(0, 5) for the loadings and thresholds of ordinal indicators.'
            : `${inla ? 'INLAvaan’s defaults, which are blavaan’s' : 'blavaan’s defaults'}: N(0, 10) for loadings and regressions, N(0, 32) for intercepts, Gamma(1, 0.5) on the SDs, uniform correlations.`
        }
      />
      {priorKind === 'custom' && (
        <TypePriors
          value={o.defaultPriors ?? {}}
          onChange={(defaultPriors) => set({ ...o, defaultPriors })}
        />
      )}
      <PriorBox
        value={o.labelPriors ?? []}
        onChange={(ps) => {
          const { labelPriors: _l, ...rest } = o;
          set(ps.length ? { ...rest, labelPriors: ps } : rest);
        }}
      />
      {groups && !inla && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={!!o.wiggle}
              onChange={(e) => {
                const { wiggle: _w, ...rest } = o;
                set(
                  e.target.checked
                    ? { ...rest, wiggle: { what: ['loadings', 'intercepts'], variance: 0.01 } }
                    : rest,
                );
              }}
            />{' '}
            Approximate invariance: parameters held equal across groups may differ a little
          </label>
          {o.wiggle && (
            <div className="row2">
              <div className="field">
                <label>Approximately equal</label>
                {(['loadings', 'intercepts'] as const).map((w) => (
                  <label key={w} className="check">
                    <input
                      type="checkbox"
                      checked={o.wiggle!.what.includes(w)}
                      onChange={(e) => {
                        const what = e.target.checked
                          ? [...o.wiggle!.what, w]
                          : o.wiggle!.what.filter((x) => x !== w);
                        if (what.length) set({ ...o, wiggle: { ...o.wiggle!, what } });
                      }}
                    />{' '}
                    {w}
                  </label>
                ))}
              </div>
              <div className="field">
                <label htmlFor="bs-wv">Prior variance of a difference</label>
                <input
                  id="bs-wv"
                  className="input num"
                  type="number"
                  min={0.0001}
                  step={0.001}
                  value={o.wiggle.variance}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v > 0) set({ ...o, wiggle: { ...o.wiggle!, variance: v } });
                  }}
                />
                <div className="hint">
                  Mplus’s DIFF(…) ~ N(0, v): every difference between two groups has prior variance
                  v. blavaan (wiggle) centres each group on the first with SD √(v/2): a difference
                  between two other groups then has variance v, one from the first group v/2.
                </div>
              </div>
            </div>
          )}
        </>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={!!loop}
          onChange={(e) => {
            const { loop: _l, ...rest } = o;
            set(
              e.target.checked
                ? {
                    ...rest,
                    loop: { name: 'effect', expr: '', variable: 'mod', from: -2, to: 2, by: 0.1 },
                  }
                : rest,
            );
          }}
        />{' '}
        A quantity over a moderator (Mplus LOOP)
      </label>
      {loop && (
        <>
          <div className="row2">
            <div className="field">
              <label htmlFor="bs-ln">Name</label>
              <input
                id="bs-ln"
                className="input"
                value={loop.name}
                onChange={(e) => setLoop({ name: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="bs-lv">Moderator</label>
              <input
                id="bs-lv"
                className="input"
                value={loop.variable}
                onChange={(e) => setLoop({ variable: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="bs-le">Expression</label>
            <input
              id="bs-le"
              className="input"
              value={loop.expr}
              placeholder="b*(gamma1 + gamma2*mod)"
              onChange={(e) => setLoop({ expr: e.target.value })}
            />
            <div className="hint">
              Labelled parameters, the moderator, numbers and arithmetic; computed from every draw.
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label htmlFor="bs-lf">From</label>
              <input
                id="bs-lf"
                className="input num"
                type="number"
                value={loop.from}
                onChange={lnum('from')}
              />
            </div>
            <div className="field">
              <label htmlFor="bs-lt">To</label>
              <input
                id="bs-lt"
                className="input num"
                type="number"
                value={loop.to}
                onChange={lnum('to')}
              />
            </div>
            <div className="field">
              <label htmlFor="bs-lb">Step</label>
              <input
                id="bs-lb"
                className="input num"
                type="number"
                min={0}
                value={loop.by}
                onChange={lnum('by')}
              />
            </div>
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="bs-pv">Plausible values per case</label>
        <input
          id="bs-pv"
          className="input num"
          type="number"
          min={0}
          max={500}
          value={o.plausible ?? 0}
          onChange={(e) => {
            const v = Math.round(Number(e.target.value));
            if (v >= 0 && v <= 500) {
              const { plausible: _p, ...rest } = o;
              set(v ? { ...rest, plausible: v } : rest);
            }
          }}
        />
        <div className="hint">
          Draws of every case’s factor scores from the posterior (Mplus FSCORES(n)): summarised over
          cases and draws. 0: none.
        </div>
      </div>
      {inla ? (
        <div className="field">
          <label htmlFor="bs-s">Posterior draws</label>
          <input
            id="bs-s"
            className="input num"
            type="number"
            min={100}
            max={100000}
            step={100}
            value={o.sample}
            onChange={n('sample', 100, 100000)}
          />
          <div className="hint">
            INLAvaan’s nsamp (default 1,000): draws from the approximate posterior for PPP, DIC,
            defined parameters, the loop and intervals other than 95%. The seed is the project’s.
          </div>
        </div>
      ) : (
        <>
          <div className="row2">
            <div className="field">
              <label htmlFor="bs-ch">Chains</label>
              <input
                id="bs-ch"
                className="input num"
                type="number"
                min={1}
                max={8}
                value={o.chains}
                onChange={n('chains', 1, 8)}
              />
            </div>
            <div className="field">
              <label htmlFor="bs-bi">Burn-in per chain</label>
              <input
                id="bs-bi"
                className="input num"
                type="number"
                min={100}
                max={100000}
                step={100}
                value={o.burnin}
                onChange={n('burnin', 100, 100000)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="bs-s">Draws per chain</label>
            <input
              id="bs-s"
              className="input num"
              type="number"
              min={100}
              max={100000}
              step={100}
              value={o.sample}
              onChange={n('sample', 100, 100000)}
            />
            <div className="hint">
              blavaan’s defaults: 3 chains, 500 burn-in and 1,000 draws each. The seed is the
              project’s.
            </div>
          </div>
        </>
      )}
    </fieldset>
  );
}

function LoopChart({ l, conf }: { l: BsemLoopResult; conf: number }) {
  const W = 520,
    H = 300,
    pad = { l: 56, r: 16, t: 14, b: 44 };
  const lo = Math.min(0, ...l.low),
    hi = Math.max(0, ...l.high),
    m = (hi - lo || 1) * 0.06;
  const x0 = l.x[0],
    x1 = l.x[l.x.length - 1];
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi + m - v) / (hi - lo + 2 * m)) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: 6 }, (_, i) => lo - m + ((hi - lo + 2 * m) * i) / 5);
  const xt = Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4);
  const line = (ys: number[]) =>
    ys.map((y, i) => `${i ? 'L' : 'M'}${sx(l.x[i]).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');
  return (
    <ChartFrame
      id="bsem:loop"
      name="bsem-loop"
      width={W}
      height={H}
      defaults={{ x: l.variable, y: l.name }}
      caption={
        <span className="hint">
          Posterior median of {l.name} at each value of {l.variable} (line) and the central{' '}
          {pct(conf)} credible interval (dashed).
        </span>
      }
    >
      {(labels) => (
        <svg className="mc-chart data-chart" width={W} height={H} role="img" aria-label={l.name}>
          {ticks.map((v) => (
            <g key={v}>
              <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} />
              <text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">
                {fmt(v, 2)}
              </text>
            </g>
          ))}
          {xt.map((v) => (
            <text key={v} x={sx(v)} y={H - pad.b + 16} textAnchor="middle">
              {fmt(v, 2)}
            </text>
          ))}
          <line className="ref-line" x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} />
          <path d={line(l.low)} fill="none" stroke="currentColor" strokeDasharray="4 3" />
          <path d={line(l.high)} fill="none" stroke="currentColor" strokeDasharray="4 3" />
          <path d={line(l.median)} fill="none" stroke="var(--accent)" strokeWidth={2} />
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

const paramName = (p: BsemResult['parameters'][number]) =>
  (p.op === '~1'
    ? `${p.lhs} (intercept)`
    : p.op === '|'
      ? `${p.lhs} threshold ${p.rhs.replace(/^t/, '')}`
      : `${p.lhs} ${p.op} ${p.rhs}`) + (p.label ? ` (${p.label})` : '');
const present = (rows: [string, number | undefined | null][]) =>
  rows.filter((x): x is [string, number] => x[1] !== undefined && x[1] !== null);

/** The defined parameters, the loop and the plausible values: the same for both engines. */
function Derived({ r }: { r: BsemResult }) {
  return (
    <>
      {!!r.defined?.length && (
        <Table
          title="Defined parameters"
          file="bsem-defined"
          columns={[
            'Parameter',
            'Posterior median',
            'Mean',
            'SD',
            `${pct(r.confidence)} credible interval`,
          ]}
          rows={r.defined.map(
            (d): Row => [
              c(`${d.name} := ${d.expr}`),
              c(d.median),
              c(d.mean),
              c(d.sd),
              c(`[${fmt(d.low)}, ${fmt(d.high)}]`),
            ],
          )}
          note="Computed from every draw of the parameters they combine."
        />
      )}
      {r.loop && (
        <>
          <LoopChart l={r.loop} conf={r.confidence} />
          <Table
            title={`${r.loop.name} = ${r.loop.expr}`}
            file="bsem-loop"
            columns={[
              r.loop.variable,
              'Posterior median',
              'SD',
              `${pct(r.confidence)} credible interval`,
            ]}
            rows={r.loop.x.map(
              (x, i): Row => [
                c(fmt(x, 3)),
                c(r.loop!.median[i]),
                c(r.loop!.sd[i]),
                c(`[${fmt(r.loop!.low[i])}, ${fmt(r.loop!.high[i])}]`),
              ],
            )}
          />
        </>
      )}
      {r.plausible && (
        <Table
          title="Plausible values"
          file="bsem-plausible"
          columns={['Factor', 'Mean', 'Variance', 'Mean of the cases’ SDs']}
          rows={r.plausible.factors.map(
            (k, i): Row => [
              c(k),
              c(r.plausible!.mean[i]),
              c(r.plausible!.cov[i]?.[i] ?? null),
              c(r.plausible!.meanSd[i]),
            ],
          )}
          note={`${r.plausible.draws} draws of each of the ${r.plausible.cases} cases’ factor scores${r.engine.package === 'INLAvaan' ? ', each from a fresh draw of the parameters' : ', spaced evenly over the posterior draws'}: mean and variance over all cases and draws, and each case’s SD over its draws, averaged (Mplus’s SUMMARIES OF PLAUSIBLE VALUES).`}
        />
      )}
    </>
  );
}

/** INLAvaan's result: no chains; the diagnostics of the approximation instead of R-hat. */
function InlaView({ r }: { r: BsemResult }) {
  const f = r.fit,
    d = r.diagnostics ?? {};
  const groups = r.groups?.length ? r.groups : [null];
  const flag = (v: number | null | undefined, warn: number) =>
    v === null || v === undefined
      ? c(null)
      : { v: fmt(v, 3), cls: Math.abs(v) > warn ? 'warn' : '' };
  const withPrior = r.parameters.some((p) => p.prior);
  const cols = [
    'Parameter',
    'Posterior median',
    'Mean',
    'SD',
    `${pct(r.confidence)} credible interval`,
    'NMAD',
    'VB shift (SD)',
    ...(withPrior ? ['Prior'] : []),
  ];
  const priors =
    r.priors === 'mplus'
      ? 'Mplus’s default priors'
      : r.priors === 'custom'
        ? `default priors by type (${Object.entries(r.defaultPriors ?? {})
            .map(([k, v]) => `${k} ${v}`)
            .join(', ')})`
        : 'INLAvaan’s default priors';
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        Approximate Bayesian inference by INLAvaan {r.engine.version}
        {r.engine.desktop ? ` in desktop ${r.engine.desktop}` : ''} (Laplace approximation,
        VB-corrected mean, skew-normal marginals; no MCMC)
        {r.seconds !== undefined && r.seconds !== null ? `, ${fmt(r.seconds, 1)} s` : ''}; n = {r.n}
        {r.groups?.length ? ` in ${r.groups.length} groups` : ''}; factors identified by{' '}
        {r.identification === 'unit' ? 'unit variances (std.lv)' : 'marker indicators'}; {priors};{' '}
        {r.sample.toLocaleString('en')} posterior draws, seed {r.seed}.
      </p>
      <div className="stat-cards">
        <div className="stat-card">
          <div className="k">Optimiser converged</div>
          <div className={`v ${r.converged ? 'good' : 'bad'}`}>{r.converged ? 'yes' : 'no'}</div>
        </div>
        {d.nmadMax !== undefined && d.nmadMax !== null && (
          <div className="stat-card">
            <div className="k">Largest NMAD</div>
            <div className={`v ${d.nmadMax > 0.1 ? 'warn' : 'good'}`}>{fmt(d.nmadMax, 3)}</div>
          </div>
        )}
        {d.vbShiftMax !== undefined && d.vbShiftMax !== null && (
          <div className="stat-card">
            <div className="k">Largest VB shift</div>
            <div className={`v ${d.vbShiftMax > 1 ? 'warn' : 'good'}`}>
              {fmt(d.vbShiftMax, 2)} SD
            </div>
          </div>
        )}
        {f.ppp !== undefined && f.ppp !== null && (
          <div className="stat-card">
            <div className="k">PPP</div>
            <div className="v">{fmt(f.ppp, 3)}</div>
          </div>
        )}
      </div>
      {!r.converged && (
        <p className="hint" style={{ color: 'var(--bad)' }}>
          The optimiser did not converge: the posterior mode, and everything built on it, is not
          reliable. Try unit factor variances, or check the model for identification problems.
        </p>
      )}
      <Table
        title="Fit"
        file="bsem-fit"
        columns={['Measure', 'Value']}
        rows={present([
          ['Posterior predictive p (PPP)', f.ppp],
          ['DIC', f.dic],
          ['Effective parameters (pD)', f.pDic],
          ['WAIC', f.waic],
          ['SE of WAIC', f.seWaic],
          ['Effective parameters (WAIC)', f.pWaic],
          ['LOOIC', f.looic],
          ['SE of LOOIC', f.seLooic],
          ['Effective parameters (LOO)', f.pLoo],
          ['Marginal log-likelihood', f.margLogLik],
          ['BRMSEA', f.brmsea],
          ['BGammaHat', f.bgammahat],
          ['Adjusted BGammaHat', f.adjBgammahat],
          ['BMc', f.bmc],
          ['BCFI', f.bcfi],
          ['BTLI', f.btli],
          ['BNFI', f.bnfi],
        ]).map(([k, v]): Row => [c(k), c(v, undefined, /^(Posterior|B|Adjusted)/.test(k) ? 3 : 1)])}
        note="PPP: near 0.5 is good, below about 0.05 signals misfit. DIC, WAIC and LOOIC compare models (smaller is better); INLAvaan computes WAIC and leave-one-out from the single fit. The Bayesian fit indices (Garnier-Villarreal & Jorgensen 2020) are posterior means, the incremental ones against the independence model."
      />
      {groups.flatMap((g, gi) =>
        ['=~', '~', '~~', '~1', '|']
          .map(
            (op) =>
              [
                op,
                r.parameters.filter((p) => p.op === op && (g === null || p.group === gi + 1)),
              ] as const,
          )
          .filter(([, ps]) => ps.length)
          .map(([op, ps]) => (
            <Table
              key={`${gi}${op}`}
              title={`${OP_NAME[op] ?? op}${g === null ? '' : ` — group ${g}`}`}
              file={`bsem-${OP_FILE[op] ?? 'parameters'}${g === null ? '' : `-g${gi + 1}`}`}
              columns={cols}
              rows={ps.map(
                (p): Row => [
                  c(paramName(p)),
                  c(p.median ?? null),
                  c(p.mean),
                  c(p.sd),
                  c(`[${fmt(p.low)}, ${fmt(p.high)}]`),
                  flag(p.nmad, 0.1),
                  flag(p.vbShift, 1),
                  ...(withPrior ? [c(p.prior ?? '')] : []),
                ],
              )}
            />
          )),
      )}
      <Derived r={r} />
      <Table
        title="Diagnostics of the approximation"
        file="bsem-diagnostics"
        columns={['Diagnostic', 'Value', 'Healthy']}
        rows={present([
          ['Optimiser iterations', d.iterations],
          ['Largest gradient at the mode', d.gradInf],
          ['Largest Newton step at the mode (posterior SDs)', d.modeShiftMax],
          ['Condition number of the Hessian', d.hessCond],
          ['Largest VB shift of a mean (posterior SDs)', d.vbShiftMax],
          ['Largest KL divergence of the VB correction', d.kldMax],
          ['Largest NMAD of a marginal', d.nmadMax],
          ['Largest mass outside a marginal’s scan', d.scanEndMassMax],
        ]).map(
          ([k, v]): Row => [
            c(k),
            c(v, undefined, k.startsWith('Optimiser') ? 0 : 4),
            c(
              (
                {
                  'Largest Newton step at the mode (posterior SDs)': 'below 0.1',
                  'Condition number of the Hessian': 'below 10⁸',
                  'Largest VB shift of a mean (posterior SDs)': 'below 1',
                  'Largest NMAD of a marginal': 'below 0.1',
                  'Largest mass outside a marginal’s scan': 'below 0.05',
                  'Largest gradient at the mode': 'near 0',
                } as Record<string, string>
              )[k] ?? '',
            ),
          ],
        )}
        note="INLAvaan’s own checks (its warnings appear above when one trips): they are its defaults, prompts to look again rather than calibrated cut-offs. NMAD: how far a skew-normal marginal deviates from the scanned posterior; VB shift: how far the correction moved a mean from the mode, in posterior SDs (large values: the Gaussian approximation at the mode may be poor)."
      />
      <p className="hint">
        {r.intervals === 'draws'
          ? `The ${pct(r.confidence)} intervals are quantiles of the ${r.sample.toLocaleString('en')} posterior draws (INLAvaan reports 95% intervals from its marginals).`
          : 'The 95% intervals are INLAvaan’s, from its skew-normal marginals.'}{' '}
        An approximation, close to MCMC for most models; confirm a final model with blavaan (MCMC)
        when the diagnostics flag a parameter.
      </p>
    </div>
  );
}

function BsemView({ r }: { r: BsemResult }) {
  if (r.engine.package === 'INLAvaan') return <InlaView r={r} />;
  const f = r.fit;
  const groups = r.groups?.length ? r.groups : [null];
  const rhatCell = (v: number | null | undefined) =>
    v === null || v === undefined
      ? c(null)
      : { v: fmt(v, 3), cls: v >= 1.05 ? 'bad' : v >= 1.01 ? 'warn' : 'good' };
  const withPrior = r.parameters.some((p) => p.prior);
  const cols = [
    'Parameter',
    'Posterior median',
    'Mean',
    'SD',
    `${pct(r.confidence)} credible interval`,
    'R-hat',
    'n_eff',
    ...(withPrior ? ['Prior'] : []),
  ];
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.chains} chains × {r.sample.toLocaleString('en')} draws after{' '}
        {r.burnin.toLocaleString('en')} burn-in, seed {r.seed}; n = {r.n}
        {r.groups?.length ? ` in ${r.groups.length} groups` : ''}; factors identified by{' '}
        {r.identification === 'unit' ? 'unit variances (std.lv)' : 'marker indicators'};{' '}
        {r.priors === 'mplus' ? 'Mplus’s default priors' : 'blavaan’s default priors'}
        {r.wiggleSd !== undefined && r.wiggleSd !== null
          ? `; approximate invariance, SD ${fmt(r.wiggleSd, 4)} around the first group`
          : ''}
        ; blavaan {r.engine.version}
        {r.engine.desktop ? ` in desktop ${r.engine.desktop}` : ''}.
      </p>
      <div className={`stat-cards`}>
        <div className="stat-card">
          <div className="k">Converged</div>
          <div className={`v ${r.converged ? 'good' : 'bad'}`}>{r.converged ? 'yes' : 'no'}</div>
        </div>
        <div className="stat-card">
          <div className="k">Largest R-hat</div>
          <div
            className={`v ${(r.maxRhat ?? 0) >= 1.05 ? 'bad' : (r.maxRhat ?? 0) >= 1.01 ? 'warn' : 'good'}`}
          >
            {fmt(r.maxRhat, 3)}
          </div>
        </div>
        <div className="stat-card">
          <div className="k">Smallest n_eff</div>
          <div className={`v ${(r.minNeff ?? 0) < 400 ? 'warn' : ''}`}>{fmt(r.minNeff, 0)}</div>
        </div>
        {f.ppp !== undefined && f.ppp !== null && (
          <div className="stat-card">
            <div className="k">PPP</div>
            <div className="v">{fmt(f.ppp, 3)}</div>
          </div>
        )}
      </div>
      {!r.converged && (
        <p className="hint" style={{ color: 'var(--bad)' }}>
          The chains did not converge (an R-hat of 1.05 or more): the estimates below are not
          reliable. Run more burn-in and draws, another seed, or unit factor variances.
        </p>
      )}
      <Table
        title="Fit"
        file="bsem-fit"
        columns={['Measure', 'Value']}
        rows={(
          [
            ['Posterior predictive p (PPP)', f.ppp],
            ['DIC', f.dic],
            ['Effective parameters (pD)', f.pDic],
            ['WAIC', f.waic],
            ['LOOIC', f.looic],
            ['SE of LOOIC', f.seLooic],
            ['Marginal log-likelihood', f.margLogLik],
            ['BIC', f.bic],
          ] as [string, number | undefined][]
        )
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]): Row => [c(k), c(v!, undefined, k.startsWith('Posterior') ? 3 : 1)])}
        note="PPP: the share of draws in which data replicated from the model fit worse than the observed data; near 0.5 is good, below about 0.05 signals misfit. DIC, WAIC and LOOIC compare models: smaller is better."
      />
      {groups.flatMap((g, gi) =>
        ['=~', '~', '~~', '~1', '|']
          .map(
            (op) =>
              [
                op,
                r.parameters.filter((p) => p.op === op && (g === null || p.group === gi + 1)),
              ] as const,
          )
          .filter(([, ps]) => ps.length)
          .map(([op, ps]) => (
            <Table
              key={`${gi}${op}`}
              title={`${OP_NAME[op] ?? op}${g === null ? '' : ` — group ${g}`}`}
              file={`bsem-${OP_FILE[op] ?? 'parameters'}${g === null ? '' : `-g${gi + 1}`}`}
              columns={cols}
              rows={ps.map(
                (p): Row => [
                  c(paramName(p)),
                  c(p.median ?? null),
                  c(p.mean),
                  c(p.sd),
                  c(`[${fmt(p.low)}, ${fmt(p.high)}]`),
                  rhatCell(p.rhat),
                  c(p.neff ?? null, undefined, 0),
                  ...(withPrior ? [c(p.prior ?? '')] : []),
                ],
              )}
            />
          )),
      )}
      <Derived r={r} />
      <p className="hint">
        R-hat compares the chains with each other (1.00 means they agree; 1.05 or more: not
        converged). n_eff: the number of independent draws the chains are worth. The posterior
        median is Mplus’s point estimate for Bayes; blavaan prints the mean.
      </p>
    </div>
  );
}

const prior = (v: unknown): BsemPrior | null => {
  if (!isObj(v) || !Array.isArray(v.labels)) return null;
  const labels = v.labels
    .filter((x): x is string => typeof x === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(x))
    .slice(0, 500);
  const mean = Number(v.mean),
    variance = Number(v.variance);
  return labels.length && Number.isFinite(mean) && Number.isFinite(variance) && variance > 0
    ? { labels, mean, variance }
    : null;
};
const loopOf = (v: unknown): BsemLoop | null => {
  if (
    !isObj(v) ||
    typeof v.expr !== 'string' ||
    typeof v.name !== 'string' ||
    typeof v.variable !== 'string'
  )
    return null;
  const from = Number(v.from),
    to = Number(v.to),
    by = Number(v.by);
  return Number.isFinite(from) && Number.isFinite(to) && by > 0
    ? {
        name: v.name.slice(0, 31),
        expr: v.expr.slice(0, 500),
        variable: v.variable.slice(0, 31),
        from,
        to,
        by,
      }
    : null;
};

/** Why the card's own options cannot run on this model, or null. */
function optionsProblem(o: BsemOptions, ctx: AnalysisCtx): string | null {
  const m = ctx.model!;
  const labels = labelUses(m);
  const known = new Set([...labels.keys(), ...(m.defined ?? []).map((d) => d.name)]);
  for (const p of o.labelPriors ?? []) {
    const bad = p.labels.filter((l) => !labels.has(l));
    if (bad.length)
      return `Priors: ${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not a label of the model.`;
  }
  if (o.plausible && m.multigroup)
    return 'Plausible values here are for one group (no grouping column).';
  if (o.wiggle && o.engine === 'inlavaan')
    return 'Approximate invariance (blavaan’s wiggle) is not available with INLAvaan: choose blavaan.';
  if (o.wiggle && !m.multigroup)
    return 'Approximate invariance needs several groups (a grouping column on the Model tab).';
  if (o.wiggle && (m.multigroup?.invariance ?? 'configural') === 'configural')
    return 'Approximate invariance relaxes parameters held equal across groups: choose metric or scalar invariance on the Model tab.';
  if (o.loop) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(o.loop.name) ||
      !/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(o.loop.variable)
    )
      return 'The loop’s name and moderator are names: a letter, then letters, digits or _.';
    let e;
    try {
      e = parseExpr(o.loop.expr);
    } catch (err) {
      return `The loop’s expression: ${(err as Error).message}`;
    }
    const bad = namesIn(e).filter((x) => x !== o.loop!.variable && !known.has(x));
    if (bad.length)
      return `The loop’s expression: ${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not a label of the model or the moderator.`;
    if (o.loop.to < o.loop.from || (o.loop.to - o.loop.from) / o.loop.by > 1000)
      return 'The loop runs from its start to its end in at most 1,000 steps.';
  }
  return null;
}

export const bsemAnalysis: AnalysisType<BsemOptions, BsemResult> = {
  id: 'bsem',
  title: 'Bayesian SEM (blavaan, INLAvaan)',
  sub: 'the CB-SEM model by MCMC (blavaan, Stan; desktop R) or by approximate Bayesian inference (INLAvaan; also in the browser): posterior, R-hat or diagnostics, PPP, WAIC, LOO; Mplus’s priors, BSEM priors, approximate invariance',
  group: 'CB-SEM model',
  fitsModel: true,
  // (a new card in the browser starts with INLAvaan, which runs there; with desktop R, blavaan's MCMC)
  defaults: () => ({
    ...(useCompute.getState().backend === 'helper' ? {} : { engine: 'inlavaan' as const }),
    identification: 'unit',
    chains: 3,
    burnin: 500,
    sample: 1000,
  }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const o: BsemOptions = {
      ...(raw.engine === 'inlavaan' ? { engine: 'inlavaan' as const } : {}),
      identification: oneOf(raw.identification, ['unit', 'marker'] as const, 'unit'),
      chains: clampNum(raw.chains, 1, 8, 3, true),
      burnin: clampNum(raw.burnin, 100, 100000, 500, true),
      sample: clampNum(raw.sample, 100, 100000, 1000, true),
    };
    if (raw.priors === 'mplus') o.priors = 'mplus';
    // (default priors by type: INLAvaan's only, not with Mplus's; each checked and rewritten from its numbers)
    else if (o.engine && isObj(raw.defaultPriors)) {
      const dp = raw.defaultPriors;
      o.defaultPriors = Object.fromEntries(
        INLA_PRIOR_TYPES.flatMap((t) => {
          const p = typeof dp[t] === 'string' ? inlaPrior(t, dp[t]) : null;
          return p ? [[t, p]] : [];
        }),
      );
    }
    const ps = Array.isArray(raw.labelPriors)
      ? raw.labelPriors
          .slice(0, 100)
          .map(prior)
          .filter((p): p is BsemPrior => !!p)
      : [];
    if (ps.length) o.labelPriors = ps;
    if (isObj(raw.wiggle)) {
      const what = (Array.isArray(raw.wiggle.what) ? raw.wiggle.what : []).filter(
        (w): w is 'loadings' | 'intercepts' => w === 'loadings' || w === 'intercepts',
      );
      const variance = Number(raw.wiggle.variance);
      if (what.length && variance > 0 && variance <= 100)
        o.wiggle = { what: [...new Set(what)], variance };
    }
    const l = loopOf(raw.loop);
    if (l) o.loop = l;
    const pv = clampNum(raw.plausible, 0, 500, 0, true);
    if (pv > 0) o.plausible = pv;
    return o;
  },
  Options: BsemForm,
  View: ({ result }) => <BsemView r={result} />,
  blocked: (o, ctx) => {
    if (ctx.settings.method !== 'cbsem')
      return 'Bayesian SEM fits a CB-SEM model: switch the model to CB-SEM (Model tab).';
    if (!rawData(ctx))
      return 'Bayesian SEM needs raw data: import a dataset (not a covariance matrix).';
    if (!ctx.model?.constructs.length) return 'Draw a CB-SEM model first (Model tab).';
    const m = ctx.model;
    if (m.multilevel) return 'Bayesian SEM here fits models without clusters.';
    if (m.moderations.length) return 'Bayesian SEM here does not include latent interactions.';
    if (m.esem?.blocks.length) return 'ESEM blocks are not available in Bayesian SEM.';
    if (m.constructs.some((k) => k.type === 'composite'))
      return 'Composites are not available in Bayesian SEM.';
    if (ctx.settings.missing === 'mi')
      return 'Bayesian SEM handles missing values itself: choose casewise or FIML, not multiple imputation.';
    if (
      o.engine === 'inlavaan' &&
      ['pairwise', 'twostage', 'robusttwostage'].includes(ctx.settings.missing)
    )
      return 'Bayesian SEM by INLAvaan: choose casewise deletion, mean replacement or FIML for the missing values.';
    if (m.constant && o.identification === 'unit')
      return 'Means and intercepts need marker identification: choose Marker indicators.';
    const own = optionsProblem(o, ctx);
    if (own) return own;
    if (o.engine !== 'inlavaan' && useCompute.getState().backend !== 'helper')
      return 'Bayesian SEM by blavaan runs in desktop R (Stan does not run in the browser): choose the INLAvaan engine, which runs here, or Desktop R (helper) under R runs in, on the Model tab, with the PLS Studio Helper running.';
    const err = validateModel(m, rawData(ctx)!, {
      ...ctx.settings,
      estimator: m.ordered?.length ? 'WLSMV' : 'ML',
    }).find((i) => i.level === 'error');
    return err ? `Fix the model first: ${err.message}` : null;
  },
  fingerprint: (o, ctx) => {
    if (ctx.settings.method !== 'cbsem' || !ctx.model || !rawData(ctx)) return null;
    const cols = columnsFingerprint(ctx, [
      ...modelIndicators(ctx),
      ...(ctx.model.multigroup ? [ctx.model.multigroup.column] : []),
    ]);
    // (the options added later enter only when set: an old run keeps its fingerprint)
    const extra = [o.priors, o.labelPriors, o.wiggle, o.loop, o.plausible].some(
      (x) => x !== undefined,
    )
      ? [
          JSON.stringify([
            o.priors ?? null,
            o.labelPriors ?? null,
            o.wiggle ?? null,
            o.loop ?? null,
            o.plausible ?? null,
          ]),
        ]
      : [];
    const inla =
      o.engine === 'inlavaan' ? [JSON.stringify(['inlavaan', o.defaultPriors ?? null])] : [];
    return (
      cols &&
      fingerprint([
        cols,
        JSON.stringify(toSpec(ctx.model)),
        ctx.settings.missing,
        o.identification,
        o.chains,
        o.burnin,
        o.sample,
        ctx.settings.seed,
        ctx.settings.confidence,
        ...extra,
        ...inla,
      ])
    );
  },
  run: async (o, ctx) =>
    (await engine()).bsemR(
      rawData(ctx)!,
      toSpec(ctx.model!),
      ctx.settings.missing,
      o,
      ctx.settings.seed,
      ctx.settings.confidence,
    ),
  script: async (o, ctx) =>
    (await engine()).bsemScriptR(
      rawData(ctx)!,
      toSpec(ctx.model!),
      ctx.settings.missing,
      o,
      ctx.settings.seed,
      ctx.settings.confidence,
    ),
  summary: (o) =>
    `the CB-SEM model on the canvas · ${o.engine === 'inlavaan' ? `INLAvaan, ${o.sample} draws` : `${o.chains} chains × ${o.sample}`} · ${o.identification === 'unit' ? 'unit variances' : 'markers'}${o.priors === 'mplus' ? ' · Mplus’s priors' : o.defaultPriors ? ' · priors by type' : ''}${o.labelPriors?.length ? ` · ${o.labelPriors.reduce((a, p) => a + p.labels.length, 0)} priors` : ''}${o.wiggle ? ' · approximate invariance' : ''}`,
};
