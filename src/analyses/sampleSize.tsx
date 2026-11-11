// Minimum sample size for PLS-SEM by the inverse square root method (Kock &
// Hadaya 2018): n_min > ((z(1−α) + z(power)) / |β_min|)², with β_min the
// smallest path coefficient expected to be significant (one-tailed test, as in
// the paper: z.95 + z.80 = 2.486).

import { qnorm } from '../engine/stats';
import { fmt } from '../format';
import { c, Table } from '../components/results/Table';

export { qnorm };
import { fingerprint } from './codec';
import { clampNum, isObj, oneOf } from './common';
import type { AnalysisCtx, AnalysisType } from './types';

/** Inverse square root method: the smallest n for which β can be significant with the given power. */
export function minSampleSize(
  beta: number,
  alpha: number,
  power: number,
  tails: 1 | 2 = 1,
): number {
  const z = qnorm(1 - alpha / tails) + qnorm(power);
  return Math.ceil((z / Math.abs(beta)) ** 2);
}

export interface SampleSizeOptions {
  alpha: number;
  power: number;
  tails: 'one' | 'two';
  source: 'model' | 'manual';
  beta: number;
}
export interface SampleSizeResult {
  z: number;
  betaMin: number;
  nMin: number;
  n: number | null;
  paths: { from: string; to: string; beta: number; nMin: number }[];
}

function compute(o: SampleSizeOptions, ctx: AnalysisCtx): SampleSizeResult {
  const tails = o.tails === 'two' ? 2 : 1;
  const z = qnorm(1 - o.alpha / tails) + qnorm(o.power);
  const pls = ctx.pls;
  const paths =
    o.source === 'model' && pls
      ? pls.constructs.flatMap((from, i) =>
          pls.constructs.flatMap((to, j) =>
            pls.hasPath[i][j]
              ? [
                  {
                    from,
                    to,
                    beta: pls.pathCoef[i][j],
                    nMin: minSampleSize(pls.pathCoef[i][j], o.alpha, o.power, tails),
                  },
                ]
              : [],
          ),
        )
      : [];
  const betaMin =
    o.source === 'manual' ? Math.abs(o.beta) : Math.min(...paths.map((p) => Math.abs(p.beta)));
  return {
    z,
    betaMin,
    nMin: minSampleSize(betaMin, o.alpha, o.power, tails),
    n: o.source === 'model' && pls ? pls.n : null,
    paths,
  };
}

function SampleSizeView({ r, o }: { r: SampleSizeResult; o: SampleSizeOptions }) {
  const enough = r.n !== null ? r.n >= r.nMin : null;
  return (
    <div className="tables">
      <Table
        title={`Minimum sample size: ${r.nMin}${r.n !== null ? ` (this sample: ${r.n})` : ''}`}
        file="minimum-sample-size"
        columns={[
          'Smallest |β|',
          'z(1−α) + z(power)',
          'n minimum',
          ...(r.n !== null ? ['n here', 'Enough?'] : []),
        ]}
        rows={[
          [
            c(r.betaMin),
            c(r.z, undefined, 3),
            c(r.nMin, undefined, 0),
            ...(r.n !== null
              ? [c(r.n, undefined, 0), c(enough ? 'yes' : 'no', enough ? 'good' : 'bad')]
              : []),
          ],
        ]}
        note={`Kock & Hadaya (2018), inverse square root method: n_min > ((z(1−α) + z(power)) / |β_min|)², α = ${o.alpha} (${o.tails === 'one' ? 'one' : 'two'}-tailed), power ${o.power}. β_min is the smallest path coefficient expected to be significant; the method is slightly conservative (the paper also gives the gamma-exponential method, a little smaller).`}
      />
      {r.paths.length > 0 && (
        <Table
          title="Per path"
          file="minimum-sample-size-paths"
          columns={['Path', 'β', 'n minimum']}
          rows={r.paths.map((p) => [
            c(`${p.from} → ${p.to}`),
            c(p.beta),
            c(p.nMin, r.n !== null && r.n < p.nMin ? 'bad' : '', 0),
          ])}
          note={`The sample size each path would need to be detected with this power${r.n !== null ? `; red: more than the ${r.n} observations here` : ''}. Path coefficients of the current PLS-SEM results.`}
        />
      )}
    </div>
  );
}

export const sampleSizeAnalysis: AnalysisType<SampleSizeOptions, SampleSizeResult> = {
  id: 'minsample',
  title: 'Minimum sample size',
  sub: 'inverse square root method (Kock & Hadaya 2018)',
  group: 'PLS-SEM model',
  fitsModel: (o) => o.source === 'model',
  defaults: () => ({ alpha: 0.05, power: 0.8, tails: 'one', source: 'model', beta: 0.2 }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          alpha: [0.01, 0.05, 0.1].includes(Number(raw.alpha)) ? Number(raw.alpha) : 0.05,
          power: [0.8, 0.9, 0.95].includes(Number(raw.power)) ? Number(raw.power) : 0.8,
          tails: oneOf(raw.tails, ['one', 'two'] as const, 'one'),
          source: oneOf(raw.source, ['model', 'manual'] as const, 'model'),
          beta: clampNum(raw.beta, 0.001, 0.99, 0.2),
        }
      : null,
  Options: ({ options: o, set, ctx, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        How many observations does the PLS-SEM model need so that its smallest path can be
        significant? Kock &amp; Hadaya (2018), the inverse square root method (as SmartPLS).
      </p>
      <div className="field">
        <label>Smallest path</label>
        <div className="segmented">
          <button
            className={o.source === 'model' ? 'on' : ''}
            disabled={!ctx.pls}
            onClick={() => set({ ...o, source: 'model' })}
            title={
              ctx.pls
                ? 'The smallest path coefficient of the current PLS-SEM results'
                : 'Calculate the PLS-SEM model first'
            }
          >
            From the results
          </button>
          <button
            className={o.source === 'manual' ? 'on' : ''}
            onClick={() => set({ ...o, source: 'manual' })}
          >
            Expected value
          </button>
        </div>
        {o.source === 'manual' && (
          <input
            className="input num"
            type="number"
            step={0.05}
            min={0.01}
            max={0.99}
            aria-label="Smallest expected |β|"
            value={o.beta}
            onChange={(e) => set({ ...o, beta: clampNum(e.target.value, 0.001, 0.99, 0.2) })}
          />
        )}
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="ss-alpha">α</label>
          <select
            id="ss-alpha"
            className="select"
            value={o.alpha}
            onChange={(e) => set({ ...o, alpha: Number(e.target.value) })}
          >
            {[0.01, 0.05, 0.1].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ss-power">Power</label>
          <select
            id="ss-power"
            className="select"
            value={o.power}
            onChange={(e) => set({ ...o, power: Number(e.target.value) })}
          >
            {[0.8, 0.9, 0.95].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Test</label>
        <div className="segmented">
          <button
            className={o.tails === 'one' ? 'on' : ''}
            onClick={() => set({ ...o, tails: 'one' })}
          >
            One-tailed (Kock &amp; Hadaya)
          </button>
          <button
            className={o.tails === 'two' ? 'on' : ''}
            onClick={() => set({ ...o, tails: 'two' })}
          >
            Two-tailed
          </button>
        </div>
      </div>
    </fieldset>
  ),
  View: ({ result, options }) => <SampleSizeView r={result} o={options} />,
  blocked: (o, ctx) =>
    o.source === 'model' && !ctx.pls
      ? 'Calculate the PLS-SEM model first (Model tab), or enter the smallest path you expect.'
      : o.source === 'model' && !ctx.pls!.hasPath.some((r) => r.some(Boolean))
        ? 'The model has no structural paths.'
        : null,
  fingerprint: (o, ctx) =>
    o.source === 'manual'
      ? fingerprint(['manual'])
      : ctx.pls
        ? fingerprint([JSON.stringify(ctx.pls.pathCoef), ctx.pls.n])
        : null,
  run: async (o, ctx) => compute(o, ctx),
  summary: (o) =>
    `${o.source === 'manual' ? `|β| = ${fmt(o.beta, 2)}` : 'smallest path of the results'} · α ${o.alpha} ${o.tails}-tailed · power ${o.power}`,
};
