// EQS's multivariate Lagrange multiplier test (forward stepwise: which fixed parameters to free) and Wald test
// (backward stepwise: which free parameters to drop) for the CB-SEM model on the canvas, with lavaan's score and Wald
// tests (lavTestScore, lavTestWald), and the univariate increments EQS reports.

import type { REngineInfo } from '../rengine/lavaan';
import type { LmWaldRequest, LmWaldStep, TestKind } from '../rengine/search';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { cbCall, cbFingerprint, cbModelBlocked } from './cbModel';
import { clampNum, isObj } from './common';
import type { AnalysisType } from './types';

export interface LmWaldOptions {
  lmKinds: TestKind[];
  waldKinds: TestKind[];
  alpha: number;
  maxCandidates: number;
}
export interface LmWaldResult {
  lm: { candidates: number; steps: LmWaldStep[] } | null;
  wald: { candidates: number; steps: LmWaldStep[] } | null;
  chisq: number | null;
  df: number | null;
  alpha: number;
  warnings: string[];
  engine: REngineInfo;
}

const KINDS: [TestKind, string][] = [
  ['loadings', 'Loadings (cross-loadings)'],
  ['paths', 'Structural paths'],
  ['covariances', 'Covariances (errors, disturbances)'],
];
const kindsOf = (v: unknown, fallback: TestKind[]): TestKind[] =>
  Array.isArray(v) ? KINDS.map(([k]) => k).filter((k) => v.includes(k)) : fallback;

function Kinds({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TestKind[];
  onChange: (v: TestKind[]) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {KINDS.map(([id, text]) => (
        <label key={id} className="check" style={{ marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={value.includes(id)}
            onChange={(e) =>
              onChange(
                KINDS.map(([k]) => k).filter((k) =>
                  k === id ? e.target.checked : value.includes(k),
                ),
              )
            }
          />
          <span>{text}</span>
        </label>
      ))}
    </div>
  );
}

function LmWaldView({ r }: { r: LmWaldResult }) {
  const a = r.alpha;
  const row = (s: LmWaldStep, i: number, extra: Row): Row => [
    c(i + 1, undefined, 0),
    c(s.label),
    ...extra,
    c(s.chisq, undefined, 3),
    c(s.df, undefined, 0),
    pCell(s.p),
    c(s.increment, undefined, 3),
    pCell(s.incrementP),
    c(s.univariate, undefined, 3),
  ];
  return (
    <div className="tables">
      {r.lm &&
        (r.lm.steps.length ? (
          <Table
            title="Multivariate Lagrange multiplier test (forward stepwise)"
            file="lm-test"
            columns={[
              'Step',
              'Parameter to free',
              'Cumulative χ²',
              'df',
              'p',
              'Univariate increment',
              'p',
              'Univariate χ² (MI)',
              'Parameter change',
            ]}
            rows={r.lm.steps.map((s, i) => [...row(s, i, []), c(s.epc ?? null, undefined, 3)])}
            note={`EQS’s LM test (Bentler 1986; Chou & Bentler 1990): of ${r.lm.candidates} fixed-at-zero candidates (lavaan’s modification indices of the chosen kinds), each step adds the parameter that raises the multivariate score statistic most (lavTestScore of the set, df = the number added), as long as its univariate increment is significant at ${a}. Freeing all of them is expected to lower χ² by about the cumulative statistic; the univariate χ² is the parameter’s own modification index and the parameter change its expected value when freed. Free parameters only where theory supports them: stepwise model modification capitalises on chance (MacCallum, Roznowski & Necowitz 1992). Model χ² = ${r.chisq?.toFixed(3)}, df = ${r.df}; lavaan ${r.engine.version}.`}
          />
        ) : (
          <p className="muted">
            LM test: no fixed parameter of the chosen kinds has a significant univariate increment
            at {a} ({r.lm.candidates} candidates): freeing any one would not improve the fit
            significantly.
          </p>
        ))}
      {r.wald &&
        (r.wald.steps.length ? (
          <Table
            title="Multivariate Wald test (backward stepwise)"
            file="wald-test"
            columns={[
              'Step',
              'Parameter to drop',
              'Estimate',
              'Cumulative χ²',
              'df',
              'p',
              'Univariate increment',
              'p',
              'Univariate χ² (z²)',
            ]}
            rows={r.wald.steps.map((s, i) => row(s, i, [c(s.est ?? null, undefined, 3)]))}
            note={`EQS’s Wald test: of ${r.wald.candidates} free parameters of the chosen kinds (parameters held equal count once), each step drops the parameter that raises the multivariate Wald statistic of “all dropped = 0” least (lavTestWald, df = the number dropped), as long as neither its univariate increment nor the multivariate statistic is significant at ${a}. Fixing all of them at zero is expected to raise χ² by about the cumulative statistic. lavaan ${r.engine.version}.`}
          />
        ) : (
          <p className="muted">
            Wald test: every free parameter of the chosen kinds is needed: dropping any one would
            worsen the fit significantly at {a} ({r.wald.candidates} candidates).
          </p>
        ))}
    </div>
  );
}

const requestOf = (o: LmWaldOptions): LmWaldRequest => ({
  lm: { kinds: o.lmKinds, maxCandidates: o.maxCandidates },
  wald: { kinds: o.waldKinds },
  alpha: o.alpha,
});

export const lmWaldAnalysis: AnalysisType<LmWaldOptions, LmWaldResult> = {
  id: 'lmwald',
  title: 'Multivariate LM and Wald tests',
  sub: 'which parameters to free or drop, stepwise as EQS (lavaan score and Wald tests)',
  group: 'CB-SEM model',
  fitsModel: true,
  defaults: () => ({
    lmKinds: ['loadings', 'paths', 'covariances'],
    waldKinds: ['paths', 'covariances'],
    alpha: 0.05,
    maxCandidates: 60,
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          lmKinds: kindsOf(raw.lmKinds, ['loadings', 'paths', 'covariances']),
          waldKinds: kindsOf(raw.waldKinds, ['paths', 'covariances']),
          alpha: clampNum(raw.alpha, 0.001, 0.2, 0.05),
          maxCandidates: clampNum(raw.maxCandidates, 1, 500, 60, true),
        }
      : null,
  Options: ({ options: o, set, ctx, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Model modification as EQS does it: the Lagrange multiplier (score) test adds fixed
        parameters one at a time while each adds significantly; the Wald test drops free parameters
        one at a time while the fit does not worsen significantly. The CB-SEM model on the canvas,
        estimated with {ctx.settings.estimator} (Model settings); one group.
      </p>
      <Kinds
        label="LM test: parameters to consider freeing"
        value={o.lmKinds}
        onChange={(lmKinds) => set({ ...o, lmKinds })}
      />
      <Kinds
        label="Wald test: parameters to consider dropping"
        value={o.waldKinds}
        onChange={(waldKinds) => set({ ...o, waldKinds })}
      />
      <div className="field">
        <label htmlFor="lmw-alpha">Significance level</label>
        <input
          id="lmw-alpha"
          className="input"
          type="number"
          min={0.001}
          max={0.2}
          step={0.01}
          value={o.alpha}
          onChange={(e) => set({ ...o, alpha: clampNum(e.target.value, 0.001, 0.2, o.alpha) })}
        />
      </div>
      <div className="field">
        <label htmlFor="lmw-max">LM candidates</label>
        <input
          id="lmw-max"
          className="input"
          type="number"
          min={1}
          max={500}
          value={o.maxCandidates}
          onChange={(e) =>
            set({ ...o, maxCandidates: clampNum(e.target.value, 1, 500, o.maxCandidates, true) })
          }
        />
        <div className="hint">
          the fixed parameters with the largest modification indices that the stepwise test
          considers (1–500).
        </div>
      </div>
    </fieldset>
  ),
  View: ({ result }) => <LmWaldView r={result} />,
  blocked: (o, ctx) =>
    cbModelBlocked(ctx, 'The multivariate LM and Wald tests', false) ??
    (ctx.model?.multigroup
      ? 'The multivariate LM and Wald tests are available for one group: remove the grouping.'
      : null) ??
    (o.lmKinds.length || o.waldKinds.length ? null : 'Choose the parameters to test.'),
  fingerprint: (o, ctx) =>
    cbFingerprint(ctx, [o.lmKinds.join(','), o.waldKinds.join(','), o.alpha, o.maxCandidates]),
  run: async (o, ctx) => ({
    ...(await (await import('../rengine/search')).lmWaldR(cbCall(ctx), requestOf(o))),
    alpha: o.alpha,
  }),
  script: async (o, ctx) =>
    (await import('../rengine/search')).lmWaldScriptR(cbCall(ctx), requestOf(o)),
  summary: (o) =>
    [o.lmKinds.length ? 'LM' : '', o.waldKinds.length ? 'Wald' : ''].filter(Boolean).join(' and ') +
    `, α = ${o.alpha}`,
};
